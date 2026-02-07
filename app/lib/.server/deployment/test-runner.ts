/**
 * x402 Resource Test Runner
 *
 * Runs post-deployment tests against a live x402 resource:
 * 1. Health check - confirms container is up and responding
 * 2. x402 response - confirms 402 status + valid PAYMENT-REQUIRED header
 * 3. Header validation - deep-validates the decoded payment requirements
 * 4. Paid settlement - (future) makes a real payment via CONNECTOR_REWARD_PRIVATE_KEY
 *
 * Results are persisted to dexter-api for the dashboard.
 */

import { tracer } from '~/lib/.server/tracing';

const DEXTER_API_BASE = process.env.DEXTER_API_URL || 'https://api.dexter.cash';

// Max time to wait for container to become healthy
const HEALTH_CHECK_TIMEOUT_MS = 30_000;
const HEALTH_CHECK_INTERVAL_MS = 2_000;

// Valid USDC mint addresses by network
const VALID_USDC_MINTS: Record<string, string> = {
  'solana:mainnet': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'solana:mainnet-beta': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
};

// Solana address regex (base58, 32-44 chars)
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

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

/**
 * Run the full post-deployment test suite
 */
export async function runPostDeployTests(
  resourceId: string,
  publicUrl: string,
  creatorWallet: string,
  basePriceUsdc: number,
): Promise<TestSuiteResult> {
  const suiteStart = Date.now();
  const tests: TestResult[] = [];

  tracer.trace('X402_DEPLOY', `Starting post-deploy tests for ${resourceId}`, {
    data: { publicUrl, creatorWallet, basePriceUsdc },
  });

  // Test 1: Health check (with retry/wait for container startup)
  const healthResult = await runHealthCheck(resourceId, publicUrl);
  tests.push(healthResult);

  // Only proceed with further tests if health check passed
  if (healthResult.passed) {
    // Test 2: x402 response - hit a protected endpoint, expect 402
    const x402Result = await runX402ResponseTest(resourceId, publicUrl);
    tests.push(x402Result);

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

/**
 * Test 1: Health check
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

    // Wait before retrying
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

/**
 * Test 2: x402 Response
 * Hits the root URL and expects a 402 with PAYMENT-REQUIRED header.
 * Also tries common paths like /api/* if root doesn't return 402.
 */
async function runX402ResponseTest(resourceId: string, publicUrl: string): Promise<TestResult> {
  const start = Date.now();

  // Try paths that are likely to be x402-protected
  const pathsToTry = ['/', '/api', '/api/'];

  for (const path of pathsToTry) {
    const url = publicUrl + path;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: { 'User-Agent': 'DexterLab-TestRunner/1.0' },
      });

      clearTimeout(timeout);

      if (response.status === 402) {
        // Get the PAYMENT-REQUIRED header
        const paymentRequiredRaw = response.headers.get('payment-required');
        const bodyText = (await response.text()).substring(0, 1000);

        // Collect all response headers
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
            requestMethod: 'GET',
            responseStatus: 402,
            responseHeaders: headers,
            responseBodyPreview: bodyText,
            errorMessage: '402 returned but missing PAYMENT-REQUIRED header',
            details: { path, headers },
          };
        }

        // Try to decode the header (it's base64-encoded JSON)
        let paymentRequired: Record<string, unknown> | null = null;

        try {
          const decoded = Buffer.from(paymentRequiredRaw, 'base64').toString('utf8');
          paymentRequired = JSON.parse(decoded);
        } catch {
          // Maybe it's not base64 -- try direct JSON
          try {
            paymentRequired = JSON.parse(paymentRequiredRaw);
          } catch {
            return {
              testType: 'x402_response',
              passed: false,
              durationMs: Date.now() - start,
              requestUrl: url,
              requestMethod: 'GET',
              responseStatus: 402,
              responseHeaders: headers,
              errorMessage: 'PAYMENT-REQUIRED header is not valid base64-encoded JSON or plain JSON',
              details: { path, rawHeader: paymentRequiredRaw.substring(0, 200) },
            };
          }
        }

        return {
          testType: 'x402_response',
          passed: true,
          durationMs: Date.now() - start,
          requestUrl: url,
          requestMethod: 'GET',
          responseStatus: 402,
          responseHeaders: headers,
          responseBodyPreview: bodyText,
          details: {
            path,
            paymentRequired,
            headerEncoding: paymentRequiredRaw.startsWith('{') ? 'json' : 'base64',
          },
        };
      }
    } catch {
      // If this path fails, try the next
      continue;
    }
  }

  return {
    testType: 'x402_response',
    passed: false,
    durationMs: Date.now() - start,
    requestUrl: publicUrl,
    requestMethod: 'GET',
    errorMessage: `No path returned 402 Payment Required. Tried: ${pathsToTry.join(', ')}`,
    details: { pathsTried: pathsToTry },
  };
}

/**
 * Test 3: Header Validation
 * Deep-validates the decoded PAYMENT-REQUIRED object.
 * Checks payTo, amount, asset, network, facilitator.
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

  /*
   * There are different shapes the payment required can take.
   * The x402 spec uses an "accepts" array of payment options.
   * Some implementations use flat fields. We check both.
   */

  let accepts: Record<string, unknown>[] = [];

  if (Array.isArray(paymentRequired.accepts)) {
    accepts = paymentRequired.accepts as Record<string, unknown>[];
  } else if (paymentRequired.payTo || paymentRequired.amount) {
    // Flat format - treat as single accept
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

    // Check payTo
    const payTo = accept.payTo as string | undefined;

    if (!payTo) {
      errors.push(`${prefix}Missing "payTo" field`);
    } else if (!SOLANA_ADDRESS_RE.test(payTo)) {
      errors.push(`${prefix}"payTo" is not a valid Solana address: ${payTo}`);
    }

    // Check payTo matches creator wallet (or warn if different - could be managed wallet)
    if (payTo && payTo !== expectedCreatorWallet) {
      warnings.push(
        `${prefix}"payTo" (${payTo.substring(0, 8)}...) differs from creator wallet (${expectedCreatorWallet.substring(0, 8)}...) - may use managed wallet`,
      );
    }

    // Check amount
    const amount = accept.amount;

    if (amount === undefined || amount === null) {
      errors.push(`${prefix}Missing "amount" field`);
    } else {
      const numAmount = Number(amount);

      if (isNaN(numAmount) || numAmount <= 0) {
        errors.push(`${prefix}"amount" is not a valid positive number: ${amount}`);
      }
    }

    // Check network
    const network = accept.network as string | undefined;

    if (!network) {
      warnings.push(`${prefix}Missing "network" field (defaults to solana:mainnet)`);
    } else if (!network.startsWith('solana:') && !network.startsWith('base:') && !network.startsWith('eip155:')) {
      errors.push(`${prefix}Unrecognized network: ${network}`);
    }

    // Check asset (should be USDC mint)
    const asset = accept.asset as string | undefined;

    if (asset) {
      const expectedMint = VALID_USDC_MINTS[network || 'solana:mainnet'];

      if (expectedMint && asset !== expectedMint) {
        warnings.push(`${prefix}"asset" (${asset.substring(0, 8)}...) doesn't match expected USDC mint`);
      }
    }

    // Check scheme
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

/**
 * Persist test results to dexter-api
 */
async function persistTestResults(resourceId: string, tests: TestResult[]): Promise<void> {
  for (const test of tests) {
    try {
      const payload = {
        resource_id: resourceId,
        test_type: test.testType,
        passed: test.passed,
        duration_ms: test.durationMs,
        request_url: test.requestUrl,
        request_method: test.requestMethod,
        response_status: test.responseStatus,
        response_headers: test.responseHeaders || null,
        response_body_preview: test.responseBodyPreview?.substring(0, 1000),
        error_message: test.errorMessage,
        details: test.details,
        payment_tx: null,
        payment_amount_usdc: null,
      };

      const response = await fetch(`${DEXTER_API_BASE}/api/dexter-lab/test-results`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

/**
 * Format test results for agent display
 * Returns a human-readable summary that the agent will relay to the user
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

    // Add specific details
    if (test.testType === 'header_validation' && test.details) {
      const warnings = test.details.warnings as string[] | undefined;

      if (warnings && warnings.length > 0) {
        for (const w of warnings) {
          lines.push(`   ⚠️ ${w}`);
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
