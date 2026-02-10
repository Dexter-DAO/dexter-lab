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
import { pushDeployProgress } from '~/lib/.server/deployment/redis-client';
import {
  persistResourceToApi,
  persistResourceUpdateToApi,
  persistEventToApi,
  DEXTER_API_BASE,
  AUTH_HEADERS,
} from '~/lib/.server/deployment/api-client';

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

      await pushDeployProgress(resourceId, {
        type: 'building',
        resourceId,
        resourceName: body.name,
        timestamp: Date.now(),
      });

      const result = await DeploymentService.redeploy(resourceId, files, config);

      if (!result.success) {
        await pushDeployProgress(resourceId, {
          type: 'error',
          resourceId,
          error: result.error || 'Redeploy failed',
          timestamp: Date.now(),
        });

        return json({ error: result.error || 'Redeploy failed' }, { status: 500 });
      }

      await pushDeployProgress(resourceId, {
        type: 'container_started',
        resourceId,
        resourceName: body.name,
        publicUrl: result.publicUrl,
        timestamp: Date.now(),
      });

      // Update resource in database
      persistResourceToApi({
        id: resourceId,
        creator_wallet: resolvedWallet,
        pay_to_wallet: payToWallet,
        name: body.name,
        description: body.description,
        source_files_json: JSON.stringify(body.files),
        endpoints_json: body.endpoints,
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

      await pushDeployProgress(resourceId, {
        type: 'testing',
        resourceId,
        resourceName: body.name,
        timestamp: Date.now(),
      });

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

      await pushDeployProgress(resourceId, {
        type: 'complete',
        resourceId,
        resourceName: body.name,
        publicUrl: result.publicUrl,
        endpoints: body.endpoints?.map((e: ResourceEndpoint) => ({
          path: e.path,
          method: e.method,
          priceUsdc: e.priceUsdc,
        })),
        timestamp: Date.now(),
      });

      // Fire-and-forget: generate cover image in background
      fetch(`${DEXTER_API_BASE}/api/dexter-lab/resources/${resourceId}/generate-cover`, {
        method: 'POST',
        headers: AUTH_HEADERS,
      }).catch((e) => console.warn('[Deploy API] Cover image generation failed:', e));

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

      // Emit building progress (resourceId not known yet, use temp)
      const tempProgressId = `pending-${Date.now()}`;

      await pushDeployProgress(tempProgressId, {
        type: 'building',
        resourceId: tempProgressId,
        resourceName: body.name,
        timestamp: Date.now(),
      });

      // Deploy the resource
      const result = await DeploymentService.deploy(files, config);

      if (!result.success) {
        await pushDeployProgress(tempProgressId, {
          type: 'error',
          resourceId: tempProgressId,
          error: result.error || 'Deployment failed',
          timestamp: Date.now(),
        });

        return json({ error: result.error || 'Deployment failed' }, { status: 500 });
      }

      // Re-emit progress under the real resource ID so the client can find it
      await pushDeployProgress(result.resourceId, {
        type: 'building',
        resourceId: result.resourceId,
        resourceName: body.name,
        timestamp: Date.now(),
      });

      await pushDeployProgress(result.resourceId, {
        type: 'container_started',
        resourceId: result.resourceId,
        resourceName: body.name,
        publicUrl: result.publicUrl,
        timestamp: Date.now(),
      });

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
        endpoints_json: body.endpoints,
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

      // Emit testing progress
      await pushDeployProgress(result.resourceId, {
        type: 'testing',
        resourceId: result.resourceId,
        resourceName: body.name,
        timestamp: Date.now(),
      });

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

      // Emit complete progress event
      await pushDeployProgress(result.resourceId, {
        type: 'complete',
        resourceId: result.resourceId,
        resourceName: body.name,
        publicUrl: result.publicUrl,
        endpoints: body.endpoints?.map((e: ResourceEndpoint) => ({
          path: e.path,
          method: e.method,
          priceUsdc: e.priceUsdc,
        })),
        timestamp: Date.now(),
      });

      // Fire-and-forget: generate cover image in background
      fetch(`${DEXTER_API_BASE}/api/dexter-lab/resources/${result.resourceId}/generate-cover`, {
        method: 'POST',
        headers: AUTH_HEADERS,
      }).catch((e) => console.warn('[Deploy API] Cover image generation failed:', e));

      /*
       * Auto-mint ERC-8004 identity for this resource.
       * Gives the deployed resource an on-chain identity on Base so it's
       * discoverable on 8004scan and by other agents via A2A.
       * Runs inline (not fire-and-forget) so we can include the result in
       * the response, but a mint failure does NOT block the deploy.
       */
      let erc8004Result: { agentId?: number; txHash?: string; error?: string } | null = null;

      try {
        console.log(`[Deploy API] Auto-minting ERC-8004 identity for ${result.resourceId}...`);

        await pushDeployProgress(result.resourceId, {
          type: 'minting_identity',
          resourceId: result.resourceId,
          resourceName: body.name,
          timestamp: Date.now(),
        });

        const mintRes = await fetch(`${DEXTER_API_BASE}/api/identity/mint`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'X-Internal-Key': process.env.INTERNAL_API_KEY || '',
          },
          body: JSON.stringify({
            chain: 'base',
            name: body.name,
            description: body.description,
            walletAddress: managedWalletAddress,
            services: [
              {
                name: 'x402',
                endpoint: result.publicUrl,
                version: 'v2',
              },
              {
                name: 'A2A',
                endpoint: `${DEXTER_API_BASE}/api/dexter-lab/resources/${result.resourceId}/agent.json`,
                version: '0.2.1',
              },
            ],
          }),
        });

        if (mintRes.ok) {
          const mintData = (await mintRes.json()) as { agentId?: number; txHash?: string };
          erc8004Result = mintData;
          console.log(
            `[Deploy API] ERC-8004 identity minted for ${result.resourceId}: agentId=${mintData.agentId}, tx=${mintData.txHash}`,
          );

          // Store the agent ID on the resource record
          if (mintData.agentId) {
            persistResourceUpdateToApi(result.resourceId, {
              erc8004_agent_id: mintData.agentId,
              erc8004_agent_registry: 'eip155:8453:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
            }).catch(() => {});
          }

          persistEventToApi({
            resource_id: result.resourceId,
            event_type: 'identity_minted',
            message: `ERC-8004 identity minted on Base: agent #${mintData.agentId}`,
            data: { agentId: mintData.agentId, txHash: mintData.txHash, chain: 'base' },
            actor_system: true,
          }).catch(() => {});
        } else {
          const errText = await mintRes.text();
          erc8004Result = { error: `HTTP ${mintRes.status}: ${errText}` };
          console.error(`[Deploy API] ERC-8004 mint failed for ${result.resourceId}: ${erc8004Result.error}`);

          persistEventToApi({
            resource_id: result.resourceId,
            event_type: 'identity_mint_failed',
            message: `ERC-8004 mint failed: ${erc8004Result.error}`,
            data: { error: erc8004Result.error },
            actor_system: true,
          }).catch(() => {});
        }
      } catch (mintErr) {
        const errMsg = mintErr instanceof Error ? mintErr.message : String(mintErr);
        erc8004Result = { error: errMsg };
        console.error(`[Deploy API] ERC-8004 mint error for ${result.resourceId}:`, mintErr);
      }

      return json(
        {
          success: true,
          resourceId: result.resourceId,
          publicUrl: result.publicUrl,
          containerId: result.containerId,
          identity: erc8004Result
            ? {
                minted: !!erc8004Result.agentId,
                agentId: erc8004Result.agentId ?? null,
                txHash: erc8004Result.txHash ?? null,
                error: erc8004Result.error ?? null,
                chain: 'base',
                explorer: erc8004Result.agentId ? `https://www.8004scan.io/agents/base/${erc8004Result.agentId}` : null,
              }
            : null,
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
 * Moved to ~/lib/.server/deployment/api-client.ts
 * Imported at the top of this file.
 * =============================================================================
 */
