/**
 * Deployment Service
 *
 * Orchestrates x402 resource deployment and lifecycle management.
 * Integrates with Dexter Facilitator for payment registration.
 */

import type {
  ResourceConfig,
  DeployedResource,
  DeploymentStatus,
  DeploymentResult,
  BuildContext,
  ResourceMetrics,
} from './types';
import {
  deployResource,
  stopContainer,
  removeContainer,
  getContainerStatus,
  getContainerLogs,
  listResourceContainers,
} from './docker-client';
import { resourceRegistry } from './redis-client';

// Base domain for resources (wildcard *.dexter.cash)
const RESOURCE_BASE_DOMAIN = process.env.RESOURCE_BASE_DOMAIN || 'dexter.cash';

// Dexter Facilitator URL
const FACILITATOR_URL = process.env.FACILITATOR_URL || 'https://dexter.cash';

/**
 * Generate a unique resource ID
 */
function generateResourceId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);

  return `res-${timestamp}-${random}`;
}

/**
 * Generate Dockerfile for an x402 resource
 */
function generateDockerfile(_resourceType: 'api' | 'webhook' | 'stream'): string {
  return `# Auto-generated Dockerfile for x402 resource
FROM node:20-alpine

WORKDIR /app

# Copy source files
COPY . .

# Install all dependencies (including devDependencies for build)
RUN npm install

# Build TypeScript if present
RUN if [ -f "tsconfig.json" ]; then npm run build 2>/dev/null || true; fi

# Remove devDependencies after build
RUN npm prune --omit=dev

# Health check
RUN apk add --no-cache curl
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \\
  CMD curl -f http://localhost:3000/health || exit 1

# Run - check for compiled output first, then fallback to source
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Start script that handles both compiled (dist/) and direct (index.js) setups
CMD ["sh", "-c", "if [ -f dist/index.js ]; then node dist/index.js; else node index.js; fi"]
`;
}

/**
 * Create build context from resource files
 */
function createBuildContext(files: Map<string, string>, config: ResourceConfig): BuildContext {
  /*
   * Remove any agent-provided Dockerfile - we always generate our own
   * This ensures consistent containerization and prevents outdated templates
   */
  files.delete('Dockerfile');
  files.delete('dockerfile');

  // Ensure health endpoint exists in the main file
  const indexContent = files.get('index.ts') || files.get('index.js') || '';

  // Add health endpoint if missing
  if (!indexContent.includes('/health')) {
    const healthEndpoint = `
// Health check endpoint (auto-added by Dexter Lab)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', resourceId: '${config.id}', timestamp: Date.now() });
});
`;

    // This is a simplified check - production would use AST manipulation
    const updatedContent = indexContent.replace(/app\.listen\(/, `${healthEndpoint}\n\napp.listen(`);
    files.set(files.has('index.ts') ? 'index.ts' : 'index.js', updatedContent);
  }

  return {
    files,
    dockerfile: generateDockerfile(config.type),
    buildArgs: {
      RESOURCE_ID: config.id,
      CREATOR_WALLET: config.creatorWallet,
    },
  };
}

/**
 * Register resource with Dexter Facilitator
 */
async function registerWithFacilitator(resource: DeployedResource): Promise<boolean> {
  try {
    /*
     * The facilitator automatically picks up x402 transactions
     * This endpoint pre-registers the resource for faster discovery
     */
    const response = await fetch(`${FACILITATOR_URL}/api/x402/resources/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        resourceId: resource.config.id,
        name: resource.config.name,
        description: resource.config.description,
        creatorWallet: resource.config.creatorWallet,
        publicUrl: resource.publicUrl,
        basePriceUsdc: resource.config.basePriceUsdc,
        pricingModel: resource.config.pricingModel,
        endpoints: resource.config.endpoints,
        tags: resource.config.tags,
        status: 'active',
      }),
    });

    if (!response.ok) {
      console.warn(`[Facilitator] Registration returned ${response.status}`);
      return false;
    }

    console.log(`[Facilitator] Resource ${resource.config.id} registered successfully`);

    return true;
  } catch (error) {
    // Registration is optional - resource still works via x402 protocol
    console.warn('[Facilitator] Registration failed (resource still usable):', error);
    return false;
  }
}

/**
 * Deploy a new x402 resource
 */
export async function deploy(
  files: Map<string, string>,
  config: Omit<ResourceConfig, 'id'>,
): Promise<DeploymentResult> {
  const resourceId = generateResourceId();
  const fullConfig: ResourceConfig = {
    ...config,
    id: resourceId,
  };

  // Create initial registry entry
  const resource: DeployedResource = {
    config: fullConfig,
    status: 'pending',
    containerId: null,
    internalPort: 3000,
    publicUrl: `https://${resourceId}.${RESOURCE_BASE_DOMAIN}`,
    deployedAt: new Date(),
    updatedAt: new Date(),
    healthy: false,
    requestCount: 0,
    revenueUsdc: 0,
  };

  await resourceRegistry.set(resourceId, resource);

  try {
    // Update status to building
    resource.status = 'building';
    resource.updatedAt = new Date();
    await resourceRegistry.set(resourceId, resource);

    // Create build context
    const context = createBuildContext(files, fullConfig);

    // Update status to deploying
    resource.status = 'deploying';
    resource.updatedAt = new Date();
    await resourceRegistry.set(resourceId, resource);

    // Deploy the resource
    const result = await deployResource(resourceId, context, {
      RESOURCE_ID: resourceId,
      CREATOR_WALLET: config.creatorWallet,
      BASE_PRICE_USDC: String(config.basePriceUsdc),
      ...config.envVars,
    });

    if (!result.success) {
      resource.status = 'failed';
      resource.error = result.error;
      resource.updatedAt = new Date();
      await resourceRegistry.set(resourceId, resource);

      return result;
    }

    // Update registry with deployment info
    resource.status = 'running';
    resource.containerId = result.containerId || null;
    resource.publicUrl = result.publicUrl || resource.publicUrl;
    resource.healthy = true;
    resource.updatedAt = new Date();
    await resourceRegistry.set(resourceId, resource);

    // Register with facilitator (async, non-blocking)
    registerWithFacilitator(resource).catch(console.error);

    return {
      success: true,
      resourceId,
      containerId: result.containerId,
      publicUrl: resource.publicUrl,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Deployment failed';
    resource.status = 'failed';
    resource.error = errorMessage;
    resource.updatedAt = new Date();
    await resourceRegistry.set(resourceId, resource);

    return {
      success: false,
      resourceId,
      error: errorMessage,
    };
  }
}

/**
 * Stop a deployed resource
 */
export async function stop(resourceId: string): Promise<boolean> {
  const resource = await resourceRegistry.get(resourceId);

  if (!resource) {
    throw new Error(`Resource not found: ${resourceId}`);
  }

  if (!resource.containerId) {
    throw new Error(`Resource has no container: ${resourceId}`);
  }

  try {
    await stopContainer(resource.containerId);
    resource.status = 'stopped';
    resource.healthy = false;
    resource.updatedAt = new Date();
    await resourceRegistry.set(resourceId, resource);

    return true;
  } catch (error) {
    console.error(`[Stop] Failed to stop ${resourceId}:`, error);
    return false;
  }
}

/**
 * Remove a deployed resource completely
 */
export async function remove(resourceId: string): Promise<boolean> {
  const resource = await resourceRegistry.get(resourceId);

  if (!resource) {
    throw new Error(`Resource not found: ${resourceId}`);
  }

  try {
    if (resource.containerId) {
      await removeContainer(resource.containerId, true);
    }

    await resourceRegistry.delete(resourceId);

    return true;
  } catch (error) {
    console.error(`[Remove] Failed to remove ${resourceId}:`, error);
    return false;
  }
}

/**
 * Get resource status
 */
export async function getStatus(resourceId: string): Promise<DeployedResource | null> {
  const resource = await resourceRegistry.get(resourceId);

  if (!resource) {
    return null;
  }

  // Update live status from Docker
  if (resource.containerId) {
    try {
      const status = await getContainerStatus(resource.containerId);
      resource.healthy = status.healthy;

      if (!status.running && resource.status === 'running') {
        resource.status = status.exitCode === 0 ? 'stopped' : 'failed';
      }

      // Persist updated status
      await resourceRegistry.set(resourceId, resource);
    } catch {
      // Container may not exist anymore
      resource.healthy = false;
    }
  }

  return resource;
}

/**
 * Get logs for a resource
 */
export async function getLogs(resourceId: string, tail = 100): Promise<string> {
  const resource = await resourceRegistry.get(resourceId);

  if (!resource?.containerId) {
    throw new Error(`Resource has no container: ${resourceId}`);
  }

  return getContainerLogs(resource.containerId, tail);
}

/**
 * List all deployed resources
 */
export async function list(): Promise<DeployedResource[]> {
  // Sync with Docker to get actual container states
  const containers = await listResourceContainers();

  // Get all resources from registry
  const resources = await resourceRegistry.list();

  // Update registry with container states
  for (const container of containers) {
    const resource = resources.find((r) => r.config.id === container.resourceId);

    if (resource) {
      resource.containerId = container.id;

      const statusMap: Record<string, DeploymentStatus> = {
        running: 'running',
        exited: 'stopped',
        dead: 'failed',
        created: 'pending',
      };
      resource.status = statusMap[container.status] || 'stopped';

      // Persist the updated state
      await resourceRegistry.set(container.resourceId, resource);
    }
  }

  return resources;
}

/**
 * Get resource metrics
 */
export async function getMetrics(resourceId: string): Promise<ResourceMetrics | null> {
  const resource = await resourceRegistry.get(resourceId);

  if (!resource) {
    return null;
  }

  /*
   * In production, this would query Prometheus/InfluxDB
   * For now, return synthetic metrics from registry
   */
  return {
    resourceId,
    requestCount: resource.requestCount,
    errorCount: 0,
    avgResponseTimeMs: 150,
    p99ResponseTimeMs: 500,
    revenueUsdc: resource.revenueUsdc,
    cpuUsagePercent: 5,
    memoryUsageMb: 128,
    timestamp: new Date(),
  };
}

/**
 * Update resource metrics (called by payment webhook)
 */
export async function updateMetrics(resourceId: string, requests: number, revenueUsdc: number): Promise<void> {
  const resource = await resourceRegistry.get(resourceId);

  if (resource) {
    resource.requestCount += requests;
    resource.revenueUsdc += revenueUsdc;
    resource.updatedAt = new Date();
    await resourceRegistry.set(resourceId, resource);
  }
}

/**
 * Restart a resource
 */
export async function restart(resourceId: string): Promise<boolean> {
  const resource = await resourceRegistry.get(resourceId);

  if (!resource?.containerId) {
    throw new Error(`Resource has no container: ${resourceId}`);
  }

  try {
    await stopContainer(resource.containerId);

    // Wait a moment before starting
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const { startContainer } = await import('./docker-client');
    await startContainer(resource.containerId);

    resource.status = 'running';
    resource.updatedAt = new Date();
    await resourceRegistry.set(resourceId, resource);

    return true;
  } catch (error) {
    console.error(`[Restart] Failed to restart ${resourceId}:`, error);
    resource.status = 'failed';
    resource.error = error instanceof Error ? error.message : 'Restart failed';
    await resourceRegistry.set(resourceId, resource);

    return false;
  }
}

// Export the deployment service
export const deploymentService = {
  deploy,
  stop,
  remove,
  restart,
  getStatus,
  getLogs,
  list,
  getMetrics,
  updateMetrics,
};

// Also export as DeploymentService for backward compatibility
export { deploymentService as DeploymentService };

export default deploymentService;
