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
       * Resolve the creator wallet: if the AI sent {{USER_WALLET}} (the placeholder),
       * try to read the real wallet from the X-Creator-Wallet header or cookie.
       */
      let resolvedWallet = body.creatorWallet;

      if (!resolvedWallet || resolvedWallet === '{{USER_WALLET}}') {
        const headerWallet = request.headers.get('X-Creator-Wallet');
        const cookieHeader = request.headers.get('Cookie') || '';
        const walletCookie = cookieHeader
          .split(';')
          .map((c) => c.trim())
          .find((c) => c.startsWith('dexter_creator_wallet='));
        const cookieWallet = walletCookie ? decodeURIComponent(walletCookie.split('=')[1]) : null;

        resolvedWallet = headerWallet || cookieWallet || resolvedWallet;
      }

      // Create resource config (without id - generated by service)
      const config: Omit<ResourceConfig, 'id'> = {
        name: body.name,
        description: body.description,
        creatorWallet: resolvedWallet,
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

      // Persist resource record to database (fire-and-forget)
      persistResourceToApi({
        id: result.resourceId,
        creator_wallet: resolvedWallet,
        pay_to_wallet: resolvedWallet, // Same for now, Option C will change this
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

      // Run post-deployment tests
      let testResults: TestSuiteResult | null = null;

      try {
        testResults = await runPostDeployTests(
          result.resourceId,
          result.publicUrl!,
          resolvedWallet,
          body.basePriceUsdc,
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
    headers: { 'Content-Type': 'application/json' },
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
    headers: { 'Content-Type': 'application/json' },
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    console.warn(`[Deploy API] Event persistence failed: HTTP ${response.status}`);
  }
}
