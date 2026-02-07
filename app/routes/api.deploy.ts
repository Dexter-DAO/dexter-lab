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
import { DeploymentService, reconcileState } from '~/lib/.server/deployment';
import type { ResourceConfig, ResourceEndpoint } from '~/lib/.server/deployment/types';

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

      return json(
        {
          success: true,
          resourceId: result.resourceId,
          publicUrl: result.publicUrl,
          containerId: result.containerId,
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
