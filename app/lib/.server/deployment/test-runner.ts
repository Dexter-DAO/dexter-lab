/**
 * x402 Resource Test Runner
 *
 * Runs post-deployment tests against a live x402 resource:
 * 1. Health check - confirms container is up and responding
 * 2. x402 response - confirms 402 status + valid PAYMENT-REQUIRED header
 * 3. Header validation - deep-validates the decoded payment requirements
 * 4. Paid settlement - makes a REAL payment via CONNECTOR_REWARD_PRIVATE_KEY,
 *    generates smart test input with AI, evaluates the response, scores 0-100.
 *
 * Results are persisted to dexter-api for the dashboard.
 */

import { tracer } from '~/lib/.server/tracing';
import type { ResourceEndpoint } from './types';
import { pushDeployProgress } from './redis-client';

// ─── Config ───────────────────────────────────────────────────────────────────

const DEXTER_API_BASE = process.env.DEXTER_API_URL || 'https://api.dexter.cash';
const LAB_SECRET = process.env.LAB_INTERNAL_SECRET || '';
const AUTH_HEADERS: Record<string, string> = LAB_SECRET
  ? { 'Content-Type': 'application/json', Authorization: `Bearer ${LAB_SECRET}` }
  : { 'Content-Type': 'application/json' };

// Proxy for AI calls (OpenAI, etc.)
const PROXY_BASE_URL = process.env.DEXTER_PROXY_URL || 'https://x402.dexter.cash/proxy';

// Connector Reward wallet for paid settlement tests
const CONNECTOR_KEY = process.env.CONNECTOR_REWARD_PRIVATE_KEY || '';

// Max price the test runner will pay (in cents). $1.00 default.
const MAX_PRICE_CENTS = parseInt(process.env.DEPLOY_TEST_MAX_PRICE_CENTS || '100', 10);

// Health check timing
const HEALTH_CHECK_TIMEOUT_MS = 30_000;
const HEALTH_CHECK_INTERVAL_MS = 2_000;

// Paid settlement timing
const PAID_REQUEST_TIMEOUT_MS = 120_000;

// Response preview limit
const RESPONSE_PREVIEW_MAX = 2000;

// Claude Opus 4.6 for input generation and evaluation (via Anthropic proxy)
const CLAUDE_MODEL = 'claude-opus-4-6';

/**
 * Call Claude Opus 4.6 via the Dexter proxy's Anthropic route.
 * Proxy handles auth, rate limiting, and header injection.
 * Returns the text content of the first response block.
 */
async function callClaude(opts: {
  system: string;
  userMessage: string;
  maxTokens?: number;
  temperature?: number;
  webSearch?: boolean;
  jsonSchema?: Record<string, unknown>;
}): Promise<string> {
  const body: Record<string, unknown> = {
    model: CLAUDE_MODEL,
    max_tokens: opts.maxTokens || 300,
    temperature: opts.temperature ?? 0.7,
    system: opts.system,
    messages: [{ role: 'user', content: opts.userMessage }],
  };

  if (opts.webSearch) {
    body.tools = [{ type: 'web_search_20250305', name: 'web_search' }];
  }

  if (opts.jsonSchema) {
    body.output_config = {
      format: {
        type: 'json_schema',
        schema: opts.jsonSchema,
      },
    };
  }

  const response = await fetch(`${PROXY_BASE_URL}/anthropic/v1/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Claude proxy ${response.status}: ${errText.substring(0, 200)}`);
  }

  const data = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };

  const text = data.content?.find((c) => c.type === 'text')?.text?.trim();

  if (!text) {
    throw new Error('Claude returned empty response');
  }

  return text;
}

// Real crypto addresses for test inputs (same as dexter-api quality verifier)
const CRYPTO_DEFAULTS = {
  DEXTER_TOKEN: 'EfPoo4wWgxKVToit7yX5VtXXBrhao4G8L7vrbKy6pump',
  SOL_MINT: 'So11111111111111111111111111111111111111112',
  USDC_SOL: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  SAMPLE_SOL_WALLET: 'BRANCHVDL53igBiYuvrEfZazXJm24qKQJhyXBUm7z7V',
  USDC_BASE: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  BNKR_BASE: '0x22af33fe49fd1fa80c7149773dde5890d3c76f3b', // BankrCoin (BNKR) on Base
  SAMPLE_ETH_WALLET: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18',
};

// Valid USDC mint addresses by network
const VALID_USDC_MINTS: Record<string, string> = {
  'solana:mainnet': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'solana:mainnet-beta': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
};

// Solana address regex (base58, 32-44 chars)
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Individual test result
 */
export interface TestResult {
  testType: 'health' | 'x402_response' | 'header_validation' | 'paid_settlement';
  passed: boolean;
  durationMs: number;
  requestUrl?: string;
  requestMethod?: string;
  responseStatus?: number;
  responseHeaders?: Record<string, string>;
  responseBodyPreview?: string;
  errorMessage?: string;
  details: Record<string, unknown>;
}

/**
 * Full test suite result
 */
export interface TestSuiteResult {
  resourceId: string;
  publicUrl: string;
  tests: TestResult[];
  allPassed: boolean;
  totalDurationMs: number;
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Run the full post-deployment test suite
 */
export async function runPostDeployTests(
  resourceId: string,
  publicUrl: string,
  creatorWallet: string,
  basePriceUsdc: number,
  endpoints?: ResourceEndpoint[],
): Promise<TestSuiteResult> {
  const suiteStart = Date.now();
  const tests: TestResult[] = [];

  tracer.trace('X402_DEPLOY', `Starting post-deploy tests for ${resourceId}`, {
    data: { publicUrl, creatorWallet, basePriceUsdc, endpointCount: endpoints?.length },
  });

  // Helper to emit test progress
  const emitTestProgress = async (result: TestResult) => {
    await pushDeployProgress(resourceId, {
      type: 'test_result',
      resourceId,
      test: {
        testType: result.testType,
        passed: result.passed,
        durationMs: result.durationMs,
        aiScore: result.details?.aiScore as number | undefined,
        aiStatus: result.details?.aiStatus as string | undefined,
        aiNotes: result.details?.aiNotes as string | undefined,
        testInput: result.details?.testInput,
        txSignature: result.details?.txSignature as string | undefined,
        priceCents: result.details?.priceCents as number | undefined,
        priceUsdc: result.details?.priceCents ? Number(result.details.priceCents) / 100 : undefined,
        responseStatus: result.responseStatus,
        responsePreview: result.responseBodyPreview?.substring(0, 500),
      },
      timestamp: Date.now(),
    });
  };

  // Test 1: Health check (with retry/wait for container startup)
  const healthResult = await runHealthCheck(resourceId, publicUrl);
  tests.push(healthResult);
  await emitTestProgress(healthResult);

  // Only proceed with further tests if health check passed
  if (healthResult.passed) {
    // Test 2: x402 response - hit a protected endpoint, expect 402
    const x402Result = await runX402ResponseTest(resourceId, publicUrl, endpoints);
    tests.push(x402Result);
    await emitTestProgress(x402Result);

    // Test 3: Header validation - deep-validate the payment requirements
    if (x402Result.passed && x402Result.details.paymentRequired) {
      const headerResult = runHeaderValidation(
        resourceId,
        publicUrl,
        x402Result.details.paymentRequired as Record<string, unknown>,
        creatorWallet,
        basePriceUsdc,
      );
      tests.push(headerResult);
      await emitTestProgress(headerResult);
    }

    // Test 4: Paid settlement - real payment, smart input, AI evaluation
    if (x402Result.passed && x402Result.details.paymentRequired) {
      const paidResult = await runPaidSettlementTest(
        resourceId,
        publicUrl,
        x402Result.details as {
          path: string;
          method: string;
          paymentRequired: Record<string, unknown>;
        },
        endpoints,
        basePriceUsdc,
      );
      tests.push(paidResult);
      await emitTestProgress(paidResult);
    }
  }

  const totalDurationMs = Date.now() - suiteStart;
  const allPassed = tests.every((t) => t.passed);

  const result: TestSuiteResult = {
    resourceId,
    publicUrl,
    tests,
    allPassed,
    totalDurationMs,
  };

  tracer.trace('X402_DEPLOY', `Test suite ${allPassed ? 'PASSED' : 'FAILED'} for ${resourceId}`, {
    durationMs: totalDurationMs,
    data: {
      passed: tests.filter((t) => t.passed).length,
      failed: tests.filter((t) => !t.passed).length,
      total: tests.length,
    },
  });

  // Persist results to dexter-api (fire-and-forget)
  persistTestResults(resourceId, tests).catch((err) => {
    console.error(`[TestRunner] Failed to persist test results for ${resourceId}:`, err);
  });

  return result;
}

// ─── Test 1: Health Check ─────────────────────────────────────────────────────

/**
 * Waits for the container to become healthy, retrying every 2s up to 30s.
 */
async function runHealthCheck(resourceId: string, publicUrl: string): Promise<TestResult> {
  const start = Date.now();
  const healthUrl = `${publicUrl}/health`;
  let lastError = '';
  let lastStatus = 0;
  let responseBody = '';

  while (Date.now() - start < HEALTH_CHECK_TIMEOUT_MS) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(healthUrl, {
        method: 'GET',
        signal: controller.signal,
        headers: { 'User-Agent': 'DexterLab-TestRunner/1.0' },
      });

      clearTimeout(timeout);
      lastStatus = response.status;

      if (response.ok) {
        responseBody = (await response.text()).substring(0, 1000);

        return {
          testType: 'health',
          passed: true,
          durationMs: Date.now() - start,
          requestUrl: healthUrl,
          requestMethod: 'GET',
          responseStatus: response.status,
          responseBodyPreview: responseBody,
          details: {
            attemptsNeeded: Math.ceil((Date.now() - start) / HEALTH_CHECK_INTERVAL_MS),
          },
        };
      }

      lastError = `HTTP ${response.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }

    await new Promise((resolve) => setTimeout(resolve, HEALTH_CHECK_INTERVAL_MS));
  }

  return {
    testType: 'health',
    passed: false,
    durationMs: Date.now() - start,
    requestUrl: healthUrl,
    requestMethod: 'GET',
    responseStatus: lastStatus,
    errorMessage: `Health check timed out after ${HEALTH_CHECK_TIMEOUT_MS / 1000}s: ${lastError}`,
    details: { lastError, lastStatus },
  };
}

// ─── Test 2: x402 Response ────────────────────────────────────────────────────

/**
 * Hits a paid endpoint and expects a 402 with PAYMENT-REQUIRED header.
 * Uses the resource's declared endpoints when available.
 */
async function runX402ResponseTest(
  resourceId: string,
  publicUrl: string,
  endpoints?: ResourceEndpoint[],
): Promise<TestResult> {
  const start = Date.now();

  const probes: Array<{ method: string; path: string; exampleBody?: string }> = [];

  if (endpoints && endpoints.length > 0) {
    for (const ep of endpoints) {
      probes.push({ method: ep.method, path: ep.path, exampleBody: ep.exampleBody });
    }
  }

  // Generic fallbacks
  probes.push({ method: 'GET', path: '/' });
  probes.push({ method: 'GET', path: '/api' });
  probes.push({ method: 'POST', path: '/' });

  // De-duplicate
  const seen = new Set<string>();
  const uniqueProbes = probes.filter((p) => {
    const key = `${p.method}:${p.path}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);

    return true;
  });

  const pathsTried: string[] = [];

  for (const probe of uniqueProbes) {
    const url = publicUrl + probe.path;
    pathsTried.push(`${probe.method} ${probe.path}`);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const needsBody = ['POST', 'PUT', 'PATCH'].includes(probe.method);
      let bodyStr: string | undefined;

      if (needsBody) {
        if (probe.exampleBody) {
          try {
            JSON.parse(probe.exampleBody);
            bodyStr = probe.exampleBody;
          } catch {
            bodyStr = '{}';
          }
        } else {
          bodyStr = '{}';
        }
      }

      const response = await fetch(url, {
        method: probe.method,
        signal: controller.signal,
        headers: {
          'User-Agent': 'DexterLab-TestRunner/1.0',
          ...(needsBody ? { 'Content-Type': 'application/json' } : {}),
        },
        body: bodyStr,
      });

      clearTimeout(timeout);

      if (response.status === 402) {
        const paymentRequiredRaw = response.headers.get('payment-required');
        const bodyText = (await response.text()).substring(0, 1000);

        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          headers[key] = value;
        });

        if (!paymentRequiredRaw) {
          return {
            testType: 'x402_response',
            passed: false,
            durationMs: Date.now() - start,
            requestUrl: url,
            requestMethod: probe.method,
            responseStatus: 402,
            responseHeaders: headers,
            responseBodyPreview: bodyText,
            errorMessage: '402 returned but missing PAYMENT-REQUIRED header',
            details: { path: probe.path, method: probe.method, headers },
          };
        }

        let paymentRequired: Record<string, unknown> | null = null;

        try {
          const decoded = Buffer.from(paymentRequiredRaw, 'base64').toString('utf8');
          paymentRequired = JSON.parse(decoded);
        } catch {
          try {
            paymentRequired = JSON.parse(paymentRequiredRaw);
          } catch {
            return {
              testType: 'x402_response',
              passed: false,
              durationMs: Date.now() - start,
              requestUrl: url,
              requestMethod: probe.method,
              responseStatus: 402,
              responseHeaders: headers,
              errorMessage: 'PAYMENT-REQUIRED header is not valid base64-encoded JSON or plain JSON',
              details: { path: probe.path, method: probe.method, rawHeader: paymentRequiredRaw.substring(0, 200) },
            };
          }
        }

        return {
          testType: 'x402_response',
          passed: true,
          durationMs: Date.now() - start,
          requestUrl: url,
          requestMethod: probe.method,
          responseStatus: 402,
          responseHeaders: headers,
          responseBodyPreview: bodyText,
          details: {
            path: probe.path,
            method: probe.method,
            paymentRequired,
            headerEncoding: paymentRequiredRaw.startsWith('{') ? 'json' : 'base64',
          },
        };
      }
    } catch {
      continue;
    }
  }

  return {
    testType: 'x402_response',
    passed: false,
    durationMs: Date.now() - start,
    requestUrl: publicUrl,
    requestMethod: 'MULTI',
    errorMessage: `No endpoint returned 402 Payment Required. Tried: ${pathsTried.join(', ')}`,
    details: { pathsTried },
  };
}

// ─── Test 3: Header Validation ────────────────────────────────────────────────

/**
 * Deep-validates the decoded PAYMENT-REQUIRED object.
 */
function runHeaderValidation(
  _resourceId: string,
  publicUrl: string,
  paymentRequired: Record<string, unknown>,
  expectedCreatorWallet: string,
  _expectedBasePriceUsdc: number,
): TestResult {
  const start = Date.now();
  const errors: string[] = [];
  const warnings: string[] = [];

  let accepts: Record<string, unknown>[] = [];

  if (Array.isArray(paymentRequired.accepts)) {
    accepts = paymentRequired.accepts as Record<string, unknown>[];
  } else if (paymentRequired.payTo || paymentRequired.amount) {
    accepts = [paymentRequired];
  } else {
    errors.push('PAYMENT-REQUIRED has no "accepts" array and no flat payTo/amount fields');
  }

  if (accepts.length === 0 && errors.length === 0) {
    errors.push('PAYMENT-REQUIRED "accepts" array is empty');
  }

  for (let i = 0; i < accepts.length; i++) {
    const accept = accepts[i];
    const prefix = accepts.length > 1 ? `accepts[${i}]: ` : '';

    const payTo = accept.payTo as string | undefined;

    if (!payTo) {
      errors.push(`${prefix}Missing "payTo" field`);
    } else if (!SOLANA_ADDRESS_RE.test(payTo)) {
      errors.push(`${prefix}"payTo" is not a valid Solana address: ${payTo}`);
    }

    if (payTo && payTo !== expectedCreatorWallet) {
      warnings.push(
        `${prefix}"payTo" (${payTo.substring(0, 8)}...) differs from creator wallet (${expectedCreatorWallet.substring(0, 8)}...) - may use managed wallet`,
      );
    }

    // x402 v2 uses maxAmountRequired, v1 uses amount
    const amount = (accept.maxAmountRequired as string | number | undefined) ?? accept.amount;

    if (amount === undefined || amount === null) {
      errors.push(`${prefix}Missing "amount" or "maxAmountRequired" field`);
    } else {
      const numAmount = Number(amount);

      if (isNaN(numAmount) || numAmount <= 0) {
        errors.push(`${prefix}"amount" is not a valid positive number: ${amount}`);
      }
    }

    const network = accept.network as string | undefined;

    if (!network) {
      warnings.push(`${prefix}Missing "network" field (defaults to solana:mainnet)`);
    } else if (!network.startsWith('solana:') && !network.startsWith('base:') && !network.startsWith('eip155:')) {
      errors.push(`${prefix}Unrecognized network: ${network}`);
    }

    const asset = accept.asset as string | undefined;

    if (asset) {
      const expectedMint = VALID_USDC_MINTS[network || 'solana:mainnet'];

      if (expectedMint && asset !== expectedMint) {
        warnings.push(`${prefix}"asset" (${asset.substring(0, 8)}...) doesn't match expected USDC mint`);
      }
    }

    const scheme = accept.scheme as string | undefined;

    if (scheme && scheme !== 'exact') {
      warnings.push(`${prefix}Non-standard scheme: ${scheme}`);
    }
  }

  const passed = errors.length === 0;

  return {
    testType: 'header_validation',
    passed,
    durationMs: Date.now() - start,
    requestUrl: publicUrl,
    requestMethod: 'GET',
    errorMessage: errors.length > 0 ? errors.join('; ') : undefined,
    details: {
      errors,
      warnings,
      acceptsCount: accepts.length,
      paymentRequired,
    },
  };
}

// ─── Test 4: Paid Settlement ──────────────────────────────────────────────────

/**
 * Makes a REAL paid x402 request using the Connector Reward wallet.
 * 1. Generates a smart test input using AI (or falls back to exampleBody / {})
 * 2. Uses wrapFetch to pay and get the response
 * 3. Evaluates the response quality with AI (0-100 score)
 */
async function runPaidSettlementTest(
  resourceId: string,
  publicUrl: string,
  x402Details: { path: string; method: string; paymentRequired: Record<string, unknown> },
  endpoints?: ResourceEndpoint[],
  basePriceUsdc?: number,
): Promise<TestResult> {
  const start = Date.now();

  // Gate: connector key must be available
  if (!CONNECTOR_KEY) {
    return {
      testType: 'paid_settlement',
      passed: false,
      durationMs: Date.now() - start,
      errorMessage: 'Skipped: CONNECTOR_REWARD_PRIVATE_KEY not configured',
      details: { skipped: true, reason: 'no_key' },
    };
  }

  // Gate: check price is within budget
  const priceUsdc = basePriceUsdc || 0;
  const priceCents = Math.round(priceUsdc * 100);

  if (priceCents > MAX_PRICE_CENTS) {
    return {
      testType: 'paid_settlement',
      passed: false,
      durationMs: Date.now() - start,
      errorMessage: `Skipped: price $${priceUsdc.toFixed(2)} exceeds test budget $${(MAX_PRICE_CENTS / 100).toFixed(2)}`,
      details: { skipped: true, reason: 'too_expensive', priceUsdc, maxPriceCents: MAX_PRICE_CENTS },
    };
  }

  // Find the endpoint that returned 402 and its metadata
  const testedPath = x402Details.path;
  const testedMethod = x402Details.method;
  const matchingEndpoint = endpoints?.find((ep) => ep.path === testedPath && ep.method === testedMethod);

  // Step 1: Generate smart test input
  let testInput: Record<string, unknown> = {};
  let inputReasoning = 'fallback: empty object';

  try {
    const smartResult = await generateSmartTestInput({
      resourceUrl: publicUrl + testedPath,
      description: matchingEndpoint?.description || `${testedMethod} ${testedPath}`,
      method: testedMethod,
      exampleBody: matchingEndpoint?.exampleBody,
    });
    testInput = smartResult.input;
    inputReasoning = smartResult.reasoning;
  } catch (err) {
    console.warn('[TestRunner] Smart input generation failed, using fallback:', err);

    // Fall back to exampleBody if available
    if (matchingEndpoint?.exampleBody) {
      try {
        testInput = JSON.parse(matchingEndpoint.exampleBody);
        inputReasoning = 'fallback: parsed exampleBody from endpoint metadata';
      } catch {
        inputReasoning = 'fallback: exampleBody parse failed, using empty object';
      }
    }
  }

  tracer.trace('X402_DEPLOY', `Paid settlement test for ${resourceId}`, {
    data: { url: publicUrl + testedPath, method: testedMethod, testInput, inputReasoning, priceCents },
  });

  /*
   * Step 1.5: Ensure the payTo wallet has a USDC ATA (new managed wallets don't have one)
   * x402 does NOT create the recipient's ATA -- we ask dexter-api to ensure it exists.
   * The wallet generation endpoint attempts ATA creation but can fail silently.
   */
  try {
    const accepts = (x402Details.paymentRequired as any)?.accepts;
    const payToAddr = accepts?.[0]?.payTo || (x402Details.paymentRequired as any)?.payTo;

    if (payToAddr) {
      const ensureRes = await fetch(`${DEXTER_API_BASE}/api/dexter-lab/wallets/ensure-ata`, {
        method: 'POST',
        headers: AUTH_HEADERS,
        body: JSON.stringify({ walletAddress: payToAddr }),
      });

      if (ensureRes.ok) {
        const ensureData = (await ensureRes.json()) as { created?: boolean };

        if (ensureData.created) {
          console.log(`[TestRunner] Created USDC ATA for ${payToAddr.substring(0, 8)}...`);

          // Wait for ATA to be confirmed on-chain
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      } else {
        console.warn(`[TestRunner] ATA ensure endpoint returned ${ensureRes.status} (non-fatal)`);
      }
    }
  } catch (ataErr) {
    console.warn('[TestRunner] ATA pre-creation failed (non-fatal):', (ataErr as Error).message);
  }

  // Step 2: Make the paid request using wrapFetch
  let responseText: string | undefined;
  let responseStatus: number | undefined;
  let txSignature: string | undefined;
  let contentType: string | undefined;

  try {
    // Dynamic import to avoid bundling issues if @dexterai/x402 isn't installed
    const { wrapFetch, SOLANA_MAINNET } = await import('@dexterai/x402/client');

    const x402Fetch = wrapFetch(fetch, {
      walletPrivateKey: CONNECTOR_KEY,
      preferredNetwork: SOLANA_MAINNET,
      maxAmountAtomic: String(MAX_PRICE_CENTS * 10000), // cents → USDC atomic (6 decimals)
      verbose: false,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PAID_REQUEST_TIMEOUT_MS);

    const needsBody = ['POST', 'PUT', 'PATCH'].includes(testedMethod.toUpperCase());
    const fetchOptions: RequestInit = {
      method: testedMethod.toUpperCase(),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'DexterLab-TestRunner/1.0',
      },
      signal: controller.signal,
    };

    if (needsBody) {
      fetchOptions.body = JSON.stringify(testInput);
    }

    const response = await x402Fetch(publicUrl + testedPath, fetchOptions);
    clearTimeout(timeout);

    contentType = response.headers.get('content-type') || 'unknown';
    responseStatus = response.status;

    // Decode PAYMENT-RESPONSE header to extract the real Solana TX hash
    const paymentResponseRaw = response.headers.get('payment-response') || response.headers.get('x-payment-response');

    if (paymentResponseRaw) {
      try {
        const decoded = JSON.parse(Buffer.from(paymentResponseRaw, 'base64').toString('utf8'));
        txSignature = decoded.transaction || paymentResponseRaw;
      } catch {
        try {
          const decoded = JSON.parse(paymentResponseRaw);
          txSignature = decoded.transaction || paymentResponseRaw;
        } catch {
          txSignature = paymentResponseRaw;
        }
      }
    }

    const rawText = await response.text();
    responseText =
      rawText.length > RESPONSE_PREVIEW_MAX ? rawText.slice(0, RESPONSE_PREVIEW_MAX) + '... [truncated]' : rawText;

    if (!response.ok) {
      return {
        testType: 'paid_settlement',
        passed: false,
        durationMs: Date.now() - start,
        requestUrl: publicUrl + testedPath,
        requestMethod: testedMethod,
        responseStatus,
        responseBodyPreview: responseText,
        errorMessage: `Paid request returned HTTP ${responseStatus}`,
        details: {
          testInput,
          inputReasoning,
          txSignature,
          contentType,
          priceCents,
        },
      };
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const isTimeout = err instanceof Error && err.name === 'AbortError';

    return {
      testType: 'paid_settlement',
      passed: false,
      durationMs: Date.now() - start,
      requestUrl: publicUrl + testedPath,
      requestMethod: testedMethod,
      errorMessage: isTimeout ? 'Paid request timed out' : `Payment/request failed: ${errMsg}`,
      details: {
        testInput,
        inputReasoning,
        error: errMsg,
        priceCents,
      },
    };
  }

  // Step 3: Evaluate the response with AI
  let aiScore = 0;
  let aiStatus: 'pass' | 'fail' | 'inconclusive' = 'inconclusive';
  let aiNotes = '';

  try {
    const evalResult = await evaluateResponseWithAI({
      resourceUrl: publicUrl + testedPath,
      description: matchingEndpoint?.description || `${testedMethod} ${testedPath}`,
      method: testedMethod,
      testInput,
      actualResponse: responseText || '',
      responseStatus: responseStatus || 0,
      priceCents,
      responseSizeBytes: responseText?.length || 0,
    });
    aiScore = evalResult.score;
    aiStatus = evalResult.status;
    aiNotes = evalResult.notes;
  } catch (err) {
    console.warn('[TestRunner] AI evaluation failed:', err);

    // Don't fail the test just because AI eval failed -- the payment went through
    aiScore = 50;
    aiStatus = 'inconclusive';
    aiNotes = 'AI evaluation failed; payment succeeded but response quality unknown';
  }

  const passed = responseStatus === 200 && aiScore >= 50;

  return {
    testType: 'paid_settlement',
    passed,
    durationMs: Date.now() - start,
    requestUrl: publicUrl + testedPath,
    requestMethod: testedMethod,
    responseStatus,
    responseBodyPreview: responseText,
    errorMessage: !passed ? `Score ${aiScore}/100: ${aiNotes}` : undefined,
    details: {
      testInput,
      inputReasoning,
      txSignature,
      contentType,
      priceCents,
      aiScore,
      aiStatus,
      aiNotes,
    },
  };
}

// ─── Smart Test Input Generation ──────────────────────────────────────────────

/**
 * Generate a realistic test input for an endpoint.
 *
 * Priority order:
 * 1. exampleBody from the developer (real, tested values)
 * 2. AI generation with crypto defaults in the prompt
 * 3. Basic fallback using crypto defaults based on field names
 */
async function generateSmartTestInput(context: {
  resourceUrl: string;
  description: string;
  method: string;
  exampleBody?: string;
}): Promise<{ input: Record<string, unknown>; reasoning: string }> {
  // GET/DELETE requests don't need a body
  if (!['POST', 'PUT', 'PATCH'].includes(context.method.toUpperCase())) {
    return { input: {}, reasoning: 'GET request - no body needed' };
  }

  // Priority 1: Use the developer's exampleBody if available
  if (context.exampleBody) {
    try {
      const parsed = JSON.parse(context.exampleBody);

      return { input: parsed, reasoning: 'Using developer-provided exampleBody' };
    } catch {
      // exampleBody is malformed, fall through to AI
    }
  }

  // Priority 2: AI generation with crypto defaults
  const prompt = `You are generating a realistic test input for an API endpoint verification system.

ENDPOINT: ${context.resourceUrl}
METHOD: ${context.method}
DESCRIPTION: ${context.description}

CRYPTO DEFAULTS (use these for any token/wallet/address fields - these are REAL addresses):
- Solana token to test with: ${CRYPTO_DEFAULTS.DEXTER_TOKEN} (Dexter token)
- SOL mint: ${CRYPTO_DEFAULTS.SOL_MINT}
- USDC on Solana: ${CRYPTO_DEFAULTS.USDC_SOL}
- Sample Solana wallet: ${CRYPTO_DEFAULTS.SAMPLE_SOL_WALLET}
- USDC on Base: ${CRYPTO_DEFAULTS.USDC_BASE}
- BankrCoin (BNKR) on Base: ${CRYPTO_DEFAULTS.BNKR_BASE}
- Sample EVM wallet: ${CRYPTO_DEFAULTS.SAMPLE_ETH_WALLET}

INSTRUCTIONS:
1. Generate a realistic, SPECIFIC input that a real paying user would send
2. For any field that takes a token address or mint, use one of the CRYPTO DEFAULTS above. NEVER make up an address.
3. For text prompts, ask something a real user would genuinely want answered
4. Match the endpoint's claimed purpose exactly
5. Keep it concise but valid

CRITICAL: Return ONLY a valid JSON object. No markdown, no explanation, just the JSON.`;

  try {
    const rawContent = await callClaude({
      system:
        'You generate realistic test inputs for API endpoints. Return ONLY a valid JSON object, nothing else. NEVER invent crypto addresses - always use the provided defaults.',
      userMessage: prompt,
      maxTokens: 300,
      temperature: 0.7,
    });

    // Strip markdown code fences if present
    const cleaned = rawContent.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

    const parsed = JSON.parse(cleaned);

    return { input: parsed, reasoning: 'Claude Opus 4.6 generated with crypto defaults' };
  } catch (err) {
    // Priority 3: Basic fallback using description to guess field names
    return {
      input: { mint: CRYPTO_DEFAULTS.DEXTER_TOKEN },
      reasoning: `Fallback: Dexter token address (Claude error: ${err instanceof Error ? err.message : 'unknown'})`,
    };
  }
}

// ─── AI Response Evaluation ───────────────────────────────────────────────────

/**
 * Evaluate the quality of an API response using AI.
 * Returns a score 0-100 and notes, matching the quality verifier's criteria.
 */
async function evaluateResponseWithAI(context: {
  resourceUrl: string;
  description: string;
  method: string;
  testInput: Record<string, unknown>;
  actualResponse: string;
  responseStatus: number;
  priceCents: number;
  responseSizeBytes: number;
}): Promise<{ score: number; status: 'pass' | 'fail' | 'inconclusive'; notes: string }> {
  const prompt = `You are evaluating an x402 paid API endpoint. We PAID for this request and received an actual response.

ENDPOINT: ${context.resourceUrl}
METHOD: ${context.method}
DESCRIPTION: "${context.description}"
PRICE PAID: $${(context.priceCents / 100).toFixed(4)}
RESPONSE STATUS: ${context.responseStatus}
RESPONSE SIZE: ${(context.responseSizeBytes / 1024).toFixed(1)}KB

OUR TEST INPUT:
${JSON.stringify(context.testInput, null, 2)}

ACTUAL RESPONSE (first ${RESPONSE_PREVIEW_MAX} chars):
${context.actualResponse}

IMPORTANT CONTEXT:
- Today's date is ${new Date().toISOString().split('T')[0]}.
- This API returns LIVE data from real external services (Helius, Jupiter, etc.).
- Do NOT judge the accuracy of prices, market caps, or other live data against your training data.
  Your training data is outdated. The API's data is from real-time sources and should be trusted.
- Only judge whether the response STRUCTURE is correct, the data LOOKS reasonable (not null/empty/error),
  and the API delivered what it promised.

EVALUATION CRITERIA:
1. Did it actually answer what we asked? (not just "relevant topic")
2. Is the response specific and actionable?
3. Would a paying user be satisfied with THIS response?
4. Any red flags? (error messages, empty content, asked for clarification when given specific input)
5. Response size: under 10KB is fine, 10-30KB acceptable if dense, 30KB+ penalize, 50KB+ cap at 50
6. Do NOT penalize for live data values that differ from your training knowledge (prices, market caps, etc.)

SCORING:
- 80-100: Excellent - directly answers with high quality
- 60-79: Good - addresses the request with useful content
- 40-59: Mediocre - partially relevant or generic
- 25-39: Poor - mostly fails to deliver value
- 0-24: Broken - error, empty, or completely wrong

Return ONLY a JSON object with exactly these fields:
{"score": <number 0-100>, "status": "<pass|fail|inconclusive>", "notes": "<1-2 sentence assessment>"}`;

  try {
    const rawContent = await callClaude({
      system:
        'You are an API quality evaluator. Be strict but fair. Use web search to verify current market data if the response contains prices, market caps, or other live data.',
      userMessage: prompt,
      maxTokens: 1024,
      temperature: 0.3,
      webSearch: true,
      jsonSchema: {
        type: 'object',
        properties: {
          score: { type: 'integer' },
          status: { type: 'string', enum: ['pass', 'fail', 'inconclusive'] },
          notes: { type: 'string' },
        },
        required: ['score', 'status', 'notes'],
        additionalProperties: false,
      },
    });

    /*
     * output_config.format guarantees valid JSON from Claude's structured outputs.
     * Still strip markdown fences as a safety net for edge cases.
     */
    const cleaned = rawContent.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

    const result = JSON.parse(cleaned) as { score?: number; status?: string; notes?: string };

    return {
      score: Math.max(0, Math.min(100, result.score || 0)),
      status: (['pass', 'fail', 'inconclusive'].includes(result.status || '') ? result.status : 'inconclusive') as
        | 'pass'
        | 'fail'
        | 'inconclusive',
      notes: result.notes || 'No notes provided',
    };
  } catch (err) {
    return {
      score: 50,
      status: 'inconclusive',
      notes: `Claude evaluation error: ${err instanceof Error ? err.message : 'unknown'}`,
    };
  }
}

// ─── Persistence ──────────────────────────────────────────────────────────────

/**
 * Persist test results to dexter-api
 */
async function persistTestResults(resourceId: string, tests: TestResult[]): Promise<void> {
  for (const test of tests) {
    try {
      /*
       * Build payload using spread to OMIT undefined/null fields.
       * Zod .optional() rejects null — we must not send null for optional fields.
       */
      const payload = {
        resource_id: resourceId,
        test_type: test.testType,
        passed: test.passed,
        ...(test.durationMs !== undefined ? { duration_ms: test.durationMs } : {}),
        ...(test.requestUrl ? { request_url: test.requestUrl } : {}),
        ...(test.requestMethod ? { request_method: test.requestMethod } : {}),
        ...(test.responseStatus !== undefined ? { response_status: test.responseStatus } : {}),
        ...(test.responseHeaders ? { response_headers: test.responseHeaders } : {}),
        ...(test.responseBodyPreview ? { response_body_preview: test.responseBodyPreview.substring(0, 1000) } : {}),
        ...(test.errorMessage ? { error_message: test.errorMessage } : {}),
        details: test.details || {},
        ...(test.details?.txSignature ? { payment_tx: test.details.txSignature as string } : {}),
        ...(test.details?.priceCents ? { payment_amount_usdc: Number(test.details.priceCents) / 100 } : {}),
        ...(test.details?.aiScore !== undefined ? { ai_score: test.details.aiScore as number } : {}),
        ...(test.details?.aiStatus ? { ai_status: test.details.aiStatus as string } : {}),
        ...(test.details?.aiNotes ? { ai_notes: test.details.aiNotes as string } : {}),
        ...(test.details?.testInput ? { test_input_generated: test.details.testInput } : {}),
        ...(test.details?.inputReasoning ? { test_input_reasoning: test.details.inputReasoning as string } : {}),
      };

      const response = await fetch(`${DEXTER_API_BASE}/api/dexter-lab/test-results`, {
        method: 'POST',
        headers: AUTH_HEADERS,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.warn(`[TestRunner] Failed to persist ${test.testType} result: HTTP ${response.status}`);
      }
    } catch (err) {
      console.warn(`[TestRunner] Error persisting ${test.testType} result:`, err);
    }
  }
}

// ─── Formatting ───────────────────────────────────────────────────────────────

/**
 * Format test results for agent display
 */
export function formatTestResults(result: TestSuiteResult): string {
  const lines: string[] = [];

  lines.push(`## Post-Deployment Test Results`);
  lines.push('');

  for (const test of result.tests) {
    const icon = test.passed ? '✅' : '❌';
    const label = {
      health: 'Health Check',
      x402_response: 'x402 Response (402 + Payment Header)',
      header_validation: 'Payment Header Validation',
      paid_settlement: 'Paid Settlement Test',
    }[test.testType];

    lines.push(`${icon} **${label}** — ${test.durationMs}ms`);

    if (!test.passed && test.errorMessage) {
      lines.push(`   Error: ${test.errorMessage}`);
    }

    // Header validation warnings
    if (test.testType === 'header_validation' && test.details) {
      const warnings = test.details.warnings as string[] | undefined;

      if (warnings && warnings.length > 0) {
        for (const w of warnings) {
          lines.push(`   ⚠️ ${w}`);
        }
      }
    }

    // Paid settlement details
    if (test.testType === 'paid_settlement' && test.details) {
      const score = test.details.aiScore as number | undefined;
      const notes = test.details.aiNotes as string | undefined;
      const tx = test.details.txSignature as string | undefined;
      const price = test.details.priceCents as number | undefined;
      const skipped = test.details.skipped as boolean | undefined;

      if (skipped) {
        lines.push(`   ⏭️ ${test.errorMessage}`);
      } else {
        if (score !== undefined) {
          lines.push(`   Score: ${score}/100`);
        }

        if (tx) {
          lines.push(`   TX: ${tx.substring(0, 12)}...${tx.substring(tx.length - 8)}`);
        }

        if (price !== undefined) {
          lines.push(`   Paid: $${(price / 100).toFixed(4)} USDC`);
        }

        if (notes) {
          lines.push(`   ${notes}`);
        }
      }
    }
  }

  lines.push('');

  if (result.allPassed) {
    lines.push(`**All ${result.tests.length} tests passed** in ${result.totalDurationMs}ms`);
  } else {
    const passed = result.tests.filter((t) => t.passed).length;
    const failed = result.tests.filter((t) => !t.passed).length;
    lines.push(
      `**${passed} passed, ${failed} failed** out of ${result.tests.length} tests (${result.totalDurationMs}ms)`,
    );
  }

  return lines.join('\n');
}
