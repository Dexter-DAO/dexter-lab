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
  removeImage,
  imageExists,
  getImageLabel,
  startContainer,
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

// Base image name for x402 resources
const BASE_IMAGE = 'dexter-x402-base:latest';

// Max build context size (5MB) to prevent abuse
const MAX_BUILD_CONTEXT_BYTES = 5 * 1024 * 1024;

/**
 * Check if the base image is available and log staleness warnings
 */
async function checkBaseImage(): Promise<boolean> {
  const exists = await imageExists(BASE_IMAGE);

  if (!exists) {
    console.error(`[Deploy] Base image ${BASE_IMAGE} not found! Run: ./infrastructure/build-base-image.sh`);
    return false;
  }

  // Check SDK version staleness (non-blocking warning)
  const imageVersion = await getImageLabel(BASE_IMAGE, 'dexter.x402.sdk.version');
  const builtDate = await getImageLabel(BASE_IMAGE, 'dexter.x402.base.built');

  if (imageVersion) {
    console.log(`[Deploy] Base image: SDK v${imageVersion}, built ${builtDate || 'unknown'}`);
  }

  return true;
}

/**
 * Generate Dockerfile for an x402 resource
 * Uses pre-built base image with all standard deps already installed.
 */
function generateDockerfile(_resourceType: 'api' | 'webhook' | 'stream'): string {
  return `# Auto-generated Dockerfile for x402 resource
# Uses pre-built base with @dexterai/x402 + express + typescript
FROM ${BASE_IMAGE}

# Copy source files (deps are already in base image)
COPY . .

# Install any additional dependencies not in base image
RUN npm install --prefer-offline 2>/dev/null; true

# Build TypeScript if present
RUN if [ -f "tsconfig.json" ]; then npx tsc 2>/dev/null || true; fi

# Health check (curl already in base image)
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \\
  CMD curl -f http://localhost:3000/health || exit 1

# Run
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["sh", "-c", "if [ -f dist/index.js ]; then node dist/index.js; else node index.js; fi"]
`;
}

/**
 * Default tsconfig.json for x402 resources
 */
const DEFAULT_TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      target: 'ES2020',
      module: 'ESNext',
      moduleResolution: 'node',
      esModuleInterop: true,
      strict: true,
      skipLibCheck: true,
      outDir: './dist',
      rootDir: '.',
      declaration: false,
    },
    include: ['*.ts'],
    exclude: ['node_modules'],
  },
  null,
  2,
);

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

  /*
   * Substitute {{USER_WALLET}} placeholder with the actual creator wallet.
   * The AI always writes {{USER_WALLET}} in the source code; the real address
   * is provided via config.creatorWallet from the deployment request.
   */
  if (config.creatorWallet && config.creatorWallet !== '{{USER_WALLET}}') {
    for (const [filename, content] of files.entries()) {
      if (content.includes('{{USER_WALLET}}')) {
        files.set(filename, content.replace(/\{\{USER_WALLET\}\}/g, config.creatorWallet));
      }
    }
  }

  // Auto-generate tsconfig.json if TypeScript files exist but no tsconfig
  const hasTypeScript = Array.from(files.keys()).some((f) => f.endsWith('.ts'));
  const hasTsConfig = files.has('tsconfig.json');

  if (hasTypeScript && !hasTsConfig) {
    files.set('tsconfig.json', DEFAULT_TSCONFIG);
  }

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

  // Check base image is available
  const baseReady = await checkBaseImage();

  if (!baseReady) {
    return {
      success: false,
      resourceId,
      error: `Base image ${BASE_IMAGE} not found. Run: ./infrastructure/build-base-image.sh`,
    };
  }

  // Check build context size
  let totalBytes = 0;

  for (const content of files.values()) {
    totalBytes += Buffer.byteLength(content, 'utf8');
  }

  if (totalBytes > MAX_BUILD_CONTEXT_BYTES) {
    return {
      success: false,
      resourceId,
      error: `Build context too large: ${(totalBytes / 1024 / 1024).toFixed(1)}MB exceeds ${MAX_BUILD_CONTEXT_BYTES / 1024 / 1024}MB limit`,
    };
  }

  // Store source files for rebuild capability
  const sourceFiles = JSON.stringify(Object.fromEntries(files));

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
    sourceFiles,
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

    // Clean up the Docker image
    const imageName = `dexter-resource-${resourceId}:latest`;
    await removeImage(imageName);

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

/**
 * Reconcile Redis state with Docker reality
 *
 * Detects ghost entries (Redis says running, Docker has no container),
 * recovers lost containers from stored source files, and cleans up
 * stale failed/stopped resources.
 *
 * Runs on server startup and every 5 minutes.
 */
export async function reconcileState(): Promise<{
  total: number;
  healthy: number;
  recovered: number;
  lost: number;
  cleaned: number;
  errors: number;
}> {
  const stats = { total: 0, healthy: 0, recovered: 0, lost: 0, cleaned: 0, errors: 0 };

  try {
    const resources = await resourceRegistry.list();
    stats.total = resources.length;

    console.log(`[Reconcile] Checking ${resources.length} resources against Docker...`);

    for (const resource of resources) {
      const resourceId = resource.config.id;

      try {
        // Check if container exists in Docker
        if (resource.containerId) {
          try {
            const status = await getContainerStatus(resource.containerId);

            if (status.running) {
              // Container is running -- update Redis to match
              resource.healthy = status.healthy;
              resource.status = 'running';
              resource.updatedAt = new Date();
              await resourceRegistry.set(resourceId, resource);
              stats.healthy++;
            } else {
              // Container exists but stopped -- try to restart if it was supposed to be running
              if (resource.status === 'running') {
                console.log(`[Reconcile] ${resourceId}: container stopped unexpectedly, restarting...`);

                try {
                  await startContainer(resource.containerId);
                  resource.status = 'running';
                  resource.updatedAt = new Date();
                  await resourceRegistry.set(resourceId, resource);
                  stats.recovered++;
                  console.log(`[Reconcile] ${resourceId}: restarted successfully`);
                } catch (restartErr) {
                  console.warn(`[Reconcile] ${resourceId}: restart failed:`, restartErr);
                  resource.status = 'failed';
                  resource.error = 'Container restart failed';
                  resource.healthy = false;
                  resource.updatedAt = new Date();
                  await resourceRegistry.set(resourceId, resource);
                  stats.errors++;
                }
              }
            }
          } catch {
            // Docker doesn't know about this container -- it's a ghost
            console.warn(
              `[Reconcile] ${resourceId}: container ${resource.containerId.slice(0, 12)} not found in Docker`,
            );
            await handleLostContainer(resource, resourceId, stats);
          }
        } else if (resource.status === 'running' || resource.status === 'deploying') {
          // No container ID but marked as running -- also a ghost
          console.warn(`[Reconcile] ${resourceId}: marked as ${resource.status} but has no container ID`);
          await handleLostContainer(resource, resourceId, stats);
        }

        // Clean up stale resources (failed/stopped/lost for >48h since deployment)
        if (
          (resource.status === 'failed' || resource.status === 'stopped' || resource.status === 'lost') &&
          resource.deployedAt
        ) {
          const ageMs = Date.now() - new Date(resource.deployedAt).getTime();
          const ageHours = ageMs / (1000 * 60 * 60);

          if (ageHours > 48) {
            console.log(
              `[Reconcile] ${resourceId}: stale (${resource.status} for ${ageHours.toFixed(0)}h), cleaning up`,
            );

            try {
              if (resource.containerId) {
                await removeContainer(resource.containerId, true).catch(() => {});
              }

              await removeImage(`dexter-resource-${resourceId}:latest`);
              await resourceRegistry.delete(resourceId);
              stats.cleaned++;
            } catch (cleanErr) {
              console.warn(`[Reconcile] ${resourceId}: cleanup failed:`, cleanErr);
              stats.errors++;
            }
          }
        }
      } catch (err) {
        console.error(`[Reconcile] ${resourceId}: unexpected error:`, err);
        stats.errors++;
      }
    }

    console.log(
      `[Reconcile] Done: ${stats.total} total, ${stats.healthy} healthy, ${stats.recovered} recovered, ${stats.lost} lost, ${stats.cleaned} cleaned, ${stats.errors} errors`,
    );
  } catch (err) {
    console.error('[Reconcile] Fatal error:', err);
  }

  return stats;
}

/**
 * Handle a container that Docker has lost
 * Attempts rebuild from stored source files, or marks as lost
 */
async function handleLostContainer(
  resource: DeployedResource,
  resourceId: string,
  stats: { recovered: number; lost: number; errors: number },
): Promise<void> {
  if (resource.sourceFiles) {
    // We have the source -- attempt rebuild
    console.log(`[Reconcile] ${resourceId}: attempting rebuild from stored source...`);

    try {
      const filesObj = JSON.parse(resource.sourceFiles) as Record<string, string>;
      const files = new Map<string, string>(Object.entries(filesObj));

      const context = createBuildContext(files, resource.config);
      const result = await deployResource(resourceId, context, {
        RESOURCE_ID: resourceId,
        CREATOR_WALLET: resource.config.creatorWallet,
        BASE_PRICE_USDC: String(resource.config.basePriceUsdc),
        PROXY_BASE_URL: process.env.DEXTER_PROXY_URL || 'https://x402.dexter.cash/proxy',
        ...resource.config.envVars,
      });

      if (result.success) {
        resource.status = 'running';
        resource.containerId = result.containerId || null;
        resource.healthy = true;
        resource.error = undefined;
        resource.updatedAt = new Date();
        await resourceRegistry.set(resourceId, resource);
        stats.recovered++;
        console.log(`[Reconcile] ${resourceId}: rebuilt and redeployed successfully`);
      } else {
        resource.status = 'failed';
        resource.error = `Rebuild failed: ${result.error}`;
        resource.healthy = false;
        resource.containerId = null;
        resource.updatedAt = new Date();
        await resourceRegistry.set(resourceId, resource);
        stats.errors++;
        console.error(`[Reconcile] ${resourceId}: rebuild failed: ${result.error}`);
      }
    } catch (err) {
      resource.status = 'failed';
      resource.error = `Rebuild threw: ${err instanceof Error ? err.message : String(err)}`;
      resource.healthy = false;
      resource.containerId = null;
      resource.updatedAt = new Date();
      await resourceRegistry.set(resourceId, resource);
      stats.errors++;
      console.error(`[Reconcile] ${resourceId}: rebuild threw:`, err);
    }
  } else {
    // No source files -- can't recover
    (resource as DeployedResource & { status: string }).status = 'lost';
    resource.healthy = false;
    resource.containerId = null;
    resource.error = 'Container lost and no source files stored for rebuild';
    resource.updatedAt = new Date();
    await resourceRegistry.set(resourceId, resource);
    stats.lost++;
    console.warn(`[Reconcile] ${resourceId}: LOST -- no stored source files for rebuild`);
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
  reconcileState,
};

// Also export as DeploymentService for backward compatibility
export { deploymentService as DeploymentService };

export default deploymentService;
