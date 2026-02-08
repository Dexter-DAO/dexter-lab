/**
 * Deployment API Route
 *
 * Handles x402 resource deployment operations.
 *
 * POST /api/deploy - Deploy a new resource
 * GET /api/deploy/:id - Get resource status
 * DELETE /api/deploy/:id - Remove a resource
 * POST /api/deploy/:id/stop - Stop a resource
 * POST /api/deploy/:id/restart - Restart a resource
 * GET /api/deploy/:id/logs - Get resource logs
 * GET /api/deploy - List all resources
 */

import { type ActionFunction, type LoaderFunction, json } from '@remix-run/cloudflare';
import { DeploymentService, reconcileState, runPostDeployTests, formatTestResults } from '~/lib/.server/deployment';
import type { ResourceConfig, ResourceEndpoint } from '~/lib/.server/deployment/types';
import type { TestSuiteResult } from '~/lib/.server/deployment/test-runner';

const DEXTER_API_BASE = process.env.DEXTER_API_URL || 'https://api.dexter.cash';
const LAB_SECRET = process.env.LAB_INTERNAL_SECRET || '';
const AUTH_HEADERS: Record<string, string> = LAB_SECRET
  ? { 'Content-Type': 'application/json', Authorization: `Bearer ${LAB_SECRET}` }
  : { 'Content-Type': 'application/json' };

interface DeployRequestBody {
  name: string;
  description: string;
  creatorWallet: string;
  type: 'api' | 'webhook' | 'stream';
  basePriceUsdc: number;
  pricingModel: 'per-request' | 'per-token' | 'per-minute' | 'flat';
  tags: string[];
  envVars?: Record<string, string>;
  endpoints: ResourceEndpoint[];
  files: Record<string, string>;
}

/**
 * Validate deployment request
 */
function validateDeployRequest(body: unknown): body is DeployRequestBody {
  if (!body || typeof body !== 'object') {
    return false;
  }

  const req = body as Record<string, unknown>;

  return (
    typeof req.name === 'string' &&
    typeof req.description === 'string' &&
    typeof req.creatorWallet === 'string' &&
    ['api', 'webhook', 'stream'].includes(req.type as string) &&
    typeof req.basePriceUsdc === 'number' &&
    ['per-request', 'per-token', 'per-minute', 'flat'].includes(req.pricingModel as string) &&
    Array.isArray(req.tags) &&
    Array.isArray(req.endpoints) &&
    typeof req.files === 'object'
  );
}

/**
 * GET /api/deploy - List resources or get single resource
 */
export const loader: LoaderFunction = async ({ request }) => {
  const url = new URL(request.url);
  const resourceId = url.searchParams.get('id');

  if (resourceId) {
    // Get single resource
    const resource = await DeploymentService.getStatus(resourceId);

    if (!resource) {
      return json({ error: 'Resource not found' }, { status: 404 });
    }

    return json(resource);
  }

  // List all resources
  const resources = await DeploymentService.list();

  return json({ resources });
};

/**
 * POST /api/deploy - Deploy new resource or perform actions
 */
export const action: ActionFunction = async ({ request }) => {
  const url = new URL(request.url);
  const resourceId = url.searchParams.get('id');
  const actionType = url.searchParams.get('action');

  // Handle resource actions
  if (resourceId && actionType) {
    switch (actionType) {
      case 'stop': {
        const success = await DeploymentService.stop(resourceId);
        return json({ success, resourceId, action: 'stop' });
      }

      case 'restart': {
        const success = await DeploymentService.restart(resourceId);
        return json({ success, resourceId, action: 'restart' });
      }

      case 'logs': {
        const tail = parseInt(url.searchParams.get('tail') || '100');
        const logs = await DeploymentService.getLogs(resourceId, tail);

        return json({ resourceId, logs });
      }

      case 'metrics': {
        const metrics = await DeploymentService.getMetrics(resourceId);
        return json({ resourceId, metrics });
      }

      default:
        return json({ error: `Unknown action: ${actionType}` }, { status: 400 });
    }
  }

  // Handle reconciliation (no resourceId needed)
  if (actionType === 'reconcile') {
    const stats = await reconcileState();
    return json({ action: 'reconcile', ...stats });
  }

  // Handle DELETE
  if (request.method === 'DELETE' && resourceId) {
    const success = await DeploymentService.remove(resourceId);
    return json({ success, resourceId, action: 'remove' });
  }

  // Handle UPDATE (PUT) - redeploy updated code to existing resource
  if (request.method === 'PUT' && resourceId) {
    try {
      const body = await request.json();

      if (!validateDeployRequest(body)) {
        return json({ error: 'Invalid update request. Check required fields.' }, { status: 400 });
      }

      const files = new Map<string, string>(Object.entries(body.files));

      // Resolve wallet (same logic as deploy — header first, body fallback)
      const headerWallet = request.headers.get('X-Creator-Wallet');
      const bodyWallet = body.creatorWallet;

      const resolvedWallet =
        headerWallet && headerWallet !== '{{USER_WALLET}}'
          ? headerWallet
          : bodyWallet && bodyWallet !== '{{USER_WALLET}}'
            ? bodyWallet
            : null;

      if (!resolvedWallet) {
        return json(
          {
            error: 'wallet_required',
            message: 'Please connect your wallet before updating a resource.',
          },
          { status: 400 },
        );
      }

      /*
       * For updates, use the EXISTING managed wallet (pay_to_wallet from the resource).
       * We don't generate a new one -- the resource keeps its wallet and URL.
       * Fetch the resource to get the managed wallet address.
       */
      let payToWallet: string = resolvedWallet;

      try {
        const resourceRes = await fetch(`${DEXTER_API_BASE}/api/dexter-lab/resources/${resourceId}`);

        if (resourceRes.ok) {
          const resourceData = (await resourceRes.json()) as { pay_to_wallet?: string };

          if (resourceData.pay_to_wallet) {
            payToWallet = resourceData.pay_to_wallet;
            console.log(`[Deploy API] Update: reusing managed wallet ${payToWallet} for ${resourceId}`);
          }
        }
      } catch {
        console.warn(`[Deploy API] Could not fetch existing resource ${resourceId}, using resolved wallet`);
      }

      const config: Omit<ResourceConfig, 'id'> = {
        name: body.name,
        description: body.description,
        creatorWallet: payToWallet,
        type: body.type,
        basePriceUsdc: body.basePriceUsdc,
        pricingModel: body.pricingModel,
        tags: body.tags,
        envVars: body.envVars || {},
        endpoints: body.endpoints,
      };

      console.log(`[Deploy API] Redeploying ${resourceId}...`);

      const result = await DeploymentService.redeploy(resourceId, files, config);

      if (!result.success) {
        return json({ error: result.error || 'Redeploy failed' }, { status: 500 });
      }

      // Update resource in database
      persistResourceToApi({
        id: resourceId,
        creator_wallet: resolvedWallet,
        pay_to_wallet: payToWallet,
        name: body.name,
        description: body.description,
        source_files_json: JSON.stringify(body.files),
        status: 'running',
        healthy: false,
      }).catch((err) => console.error('[Deploy API] Failed to update resource:', err));

      // Log update event
      persistEventToApi({
        resource_id: resourceId,
        event_type: 'update',
        message: `Redeployed ${body.name} with updated code`,
        data: { containerId: result.containerId, fileCount: Object.keys(body.files).length },
        actor_system: true,
      }).catch((e) => console.warn('[Deploy API] Event persist failed:', e));

      // Run post-deployment tests on the updated resource
      let testResults: TestSuiteResult | null = null;

      try {
        testResults = await runPostDeployTests(
          resourceId,
          result.publicUrl!,
          payToWallet,
          body.basePriceUsdc,
          body.endpoints,
        );

        if (testResults.allPassed) {
          persistResourceUpdateToApi(resourceId, {
            healthy: true,
            status: 'running',
          }).catch((e) => console.warn('[Deploy API] Health update failed:', e));
        }
      } catch (testError) {
        console.error('[Deploy API] Test runner error on redeploy:', testError);
      }

      return json(
        {
          success: true,
          resourceId,
          publicUrl: result.publicUrl,
          containerId: result.containerId,
          action: 'update',
          testResults: testResults
            ? {
                allPassed: testResults.allPassed,
                totalDurationMs: testResults.totalDurationMs,
                summary: formatTestResults(testResults),
                tests: testResults.tests.map((t) => ({
                  testType: t.testType,
                  passed: t.passed,
                  durationMs: t.durationMs,
                  errorMessage: t.errorMessage,
                })),
              }
            : null,
        },
        { status: 200 },
      );
    } catch (error) {
      console.error('[Deploy API] Update error:', error);
      return json({ error: error instanceof Error ? error.message : 'Internal error' }, { status: 500 });
    }
  }

  // Handle new deployment
  if (request.method === 'POST' && !actionType) {
    try {
      const body = await request.json();

      if (!validateDeployRequest(body)) {
        return json({ error: 'Invalid deployment request. Check required fields.' }, { status: 400 });
      }

      // Convert files object to Map
      const files = new Map<string, string>(Object.entries(body.files));

      /*
       * Resolve the creator wallet.
       * Primary source: X-Creator-Wallet header (set by MCP deploy tool from client state).
       * Fallback: body.creatorWallet (for direct API callers who pass a real address).
       */
      const headerWallet = request.headers.get('X-Creator-Wallet');
      const bodyWallet = body.creatorWallet;

      const resolvedWallet =
        headerWallet && headerWallet !== '{{USER_WALLET}}'
          ? headerWallet
          : bodyWallet && bodyWallet !== '{{USER_WALLET}}'
            ? bodyWallet
            : null;

      if (!resolvedWallet) {
        return json(
          {
            error: 'wallet_required',
            message: 'Please connect your wallet before deploying. Use the Connect button in the header.',
          },
          { status: 400 },
        );
      }

      /*
       * Generate a managed wallet for this resource.
       * The managed wallet becomes the x402 payTo address (Dexter-controlled).
       * The creator's connected wallet is stored separately for payouts.
       */
      let managedWalletAddress = resolvedWallet; // fallback if generation fails

      try {
        console.log('[Deploy API] Generating managed wallet for resource...');

        const walletResponse = await fetch(`${DEXTER_API_BASE}/api/dexter-lab/wallets/generate`, {
          method: 'POST',
          headers: AUTH_HEADERS,
          body: JSON.stringify({ resource_id: `pending-${Date.now()}` }),
        });

        if (walletResponse.ok) {
          const walletResult = (await walletResponse.json()) as { public_key?: string };

          if (walletResult.public_key) {
            managedWalletAddress = walletResult.public_key;
            console.log(`[Deploy API] Managed wallet generated: ${managedWalletAddress}`);
          }
        } else {
          console.warn(
            `[Deploy API] Managed wallet generation failed (HTTP ${walletResponse.status}), using creator wallet as fallback`,
          );
        }
      } catch (walletErr) {
        console.warn('[Deploy API] Managed wallet generation error, using creator wallet as fallback:', walletErr);
      }

      /*
       * creatorWallet in the config is used for {{USER_WALLET}} substitution in source code.
       * We set it to the managed wallet so the x402 payTo points to Dexter's wallet.
       */
      const config: Omit<ResourceConfig, 'id'> = {
        name: body.name,
        description: body.description,
        creatorWallet: managedWalletAddress,
        type: body.type,
        basePriceUsdc: body.basePriceUsdc,
        pricingModel: body.pricingModel,
        tags: body.tags,
        envVars: body.envVars || {},
        endpoints: body.endpoints,
      };

      // Deploy the resource
      const result = await DeploymentService.deploy(files, config);

      if (!result.success) {
        return json({ error: result.error || 'Deployment failed' }, { status: 500 });
      }

      /*
       * Update the managed wallet label with the real resource ID
       * (we used a temp ID during generation since resourceId wasn't known yet)
       */
      if (managedWalletAddress !== resolvedWallet) {
        fetch(`${DEXTER_API_BASE}/api/dexter-lab/resources/${result.resourceId}`, {
          method: 'PATCH',
          headers: AUTH_HEADERS,
          body: JSON.stringify({ pay_to_wallet: managedWalletAddress }),
        }).catch(() => {});

        console.log(
          `[Deploy API] Resource ${result.resourceId}: payTo=${managedWalletAddress}, creator=${resolvedWallet}`,
        );
      }

      // Persist resource record to database
      persistResourceToApi({
        id: result.resourceId,
        creator_wallet: resolvedWallet,
        pay_to_wallet: managedWalletAddress,
        platform_fee_bps: 3000,
        name: body.name,
        description: body.description,
        resource_type: body.type,
        pricing_model: body.pricingModel,
        base_price_usdc: body.basePriceUsdc,
        tags: body.tags,
        public_url: result.publicUrl,
        container_id: result.containerId,
        status: 'running',
        healthy: false, // Will be updated by tests
        source_files_json: JSON.stringify(body.files),
        deployed_at: new Date().toISOString(),
      }).catch((err) => console.error('[Deploy API] Failed to persist resource:', err));

      // Log deploy event
      persistEventToApi({
        resource_id: result.resourceId,
        event_type: 'deploy',
        message: `Deployed ${body.name} to ${result.publicUrl}`,
        data: { containerId: result.containerId, version: 1 },
        actor_system: true,
      }).catch((e) => console.warn('[Deploy API] Event persist failed:', e));

      // Run post-deployment tests (pass declared endpoints so the x402 test hits the right paths)
      let testResults: TestSuiteResult | null = null;

      try {
        testResults = await runPostDeployTests(
          result.resourceId,
          result.publicUrl!,
          resolvedWallet,
          body.basePriceUsdc,
          body.endpoints,
        );

        // Update resource health status based on test results
        if (testResults.allPassed) {
          persistResourceUpdateToApi(result.resourceId, {
            healthy: true,
            status: 'running',
          }).catch((e) => console.warn('[Deploy API] Health update failed:', e));
        }

        // Log test event
        persistEventToApi({
          resource_id: result.resourceId,
          event_type: 'test',
          message: testResults.allPassed
            ? `All ${testResults.tests.length} post-deploy tests passed`
            : `${testResults.tests.filter((t) => !t.passed).length} of ${testResults.tests.length} tests failed`,
          data: {
            allPassed: testResults.allPassed,
            tests: testResults.tests.map((t) => ({
              type: t.testType,
              passed: t.passed,
              durationMs: t.durationMs,
            })),
          },
          actor_system: true,
        }).catch((e) => console.warn('[Deploy API] Test event persist failed:', e));
      } catch (testError) {
        console.error('[Deploy API] Test runner error:', testError);
      }

      return json(
        {
          success: true,
          resourceId: result.resourceId,
          publicUrl: result.publicUrl,
          containerId: result.containerId,
          testResults: testResults
            ? {
                allPassed: testResults.allPassed,
                totalDurationMs: testResults.totalDurationMs,
                summary: formatTestResults(testResults),
                tests: testResults.tests.map((t) => ({
                  testType: t.testType,
                  passed: t.passed,
                  durationMs: t.durationMs,
                  errorMessage: t.errorMessage,
                })),
              }
            : null,
        },
        { status: 201 },
      );
    } catch (error) {
      console.error('[Deploy API] Error:', error);
      return json({ error: error instanceof Error ? error.message : 'Internal error' }, { status: 500 });
    }
  }

  return json({ error: 'Method not allowed' }, { status: 405 });
};

/*
 * =============================================================================
 * Helper functions for persisting to dexter-api
 * =============================================================================
 */

async function persistResourceToApi(data: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${DEXTER_API_BASE}/api/dexter-lab/resources`, {
    method: 'POST',
    headers: AUTH_HEADERS,
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
}

async function persistResourceUpdateToApi(resourceId: string, data: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${DEXTER_API_BASE}/api/dexter-lab/resources/${resourceId}`, {
    method: 'PATCH',
    headers: AUTH_HEADERS,
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
}

async function persistEventToApi(data: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${DEXTER_API_BASE}/api/dexter-lab/events`, {
    method: 'POST',
    headers: AUTH_HEADERS,
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    console.warn(`[Deploy API] Event persistence failed: HTTP ${response.status}`);
  }
}
