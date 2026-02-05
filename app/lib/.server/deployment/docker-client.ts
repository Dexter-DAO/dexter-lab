/**
 * Docker Client
 *
 * Handles Docker operations for x402 resource deployment.
 * Uses Docker Engine API via Unix socket at /var/run/docker.sock.
 */

import * as tar from 'tar-stream';
import { Agent, request } from 'undici';
import type { ContainerOptions, BuildContext, DeploymentResult } from './types';

/*
 * Docker API configuration
 * Uses Unix socket for direct Docker daemon communication
 */
const DOCKER_API_VERSION = 'v1.43';
const DOCKER_SOCKET_PATH = '/var/run/docker.sock';

// Network for x402 resources
const RESOURCE_NETWORK = 'dexter-resources';

// Base domain for resources (wildcard *.dexter.cash)
const RESOURCE_BASE_DOMAIN = process.env.RESOURCE_BASE_DOMAIN || 'dexter.cash';

// Create a reusable undici agent for Unix socket connections
const dockerAgent = new Agent({
  connect: {
    socketPath: DOCKER_SOCKET_PATH,
  },
});

/**
 * Execute a Docker API request via Unix socket
 */
async function dockerRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  // undici requires a valid URL, but the host is ignored when using socketPath
  const url = `http://localhost${path}`;

  const response = await request(url, {
    method: method as 'GET' | 'POST' | 'PUT' | 'DELETE',
    dispatcher: dockerAgent,
    headers: {
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (response.statusCode >= 400) {
    const error = await response.body.text();
    throw new Error(`Docker API error: ${response.statusCode} - ${error}`);
  }

  // Handle 204 No Content and other empty responses
  if (response.statusCode === 204) {
    return undefined as T;
  }

  const text = await response.body.text();

  if (!text || text.trim() === '') {
    return undefined as T;
  }

  return JSON.parse(text) as T;
}

/**
 * Generate Traefik labels for a resource container
 */
function generateTraefikLabels(resourceId: string, internalPort: number): Record<string, string> {
  const routerName = `resource-${resourceId}`;
  const serviceName = `resource-${resourceId}`;

  return {
    // Enable Traefik for this container
    'traefik.enable': 'true',

    // Router configuration - subdomain routing
    [`traefik.http.routers.${routerName}.rule`]: `Host(\`${resourceId}.${RESOURCE_BASE_DOMAIN}\`)`,
    [`traefik.http.routers.${routerName}.entrypoints`]: 'web',
    [`traefik.http.routers.${routerName}.service`]: serviceName,
    [`traefik.http.routers.${routerName}.middlewares`]: 'x402-resource-chain@file',

    // Service configuration - load balancer to container
    [`traefik.http.services.${serviceName}.loadbalancer.server.port`]: String(internalPort),
    [`traefik.http.services.${serviceName}.loadbalancer.healthcheck.path`]: '/health',
    [`traefik.http.services.${serviceName}.loadbalancer.healthcheck.interval`]: '10s',

    // Custom labels for resource metadata
    'dexter.resource.id': resourceId,
    'dexter.resource.type': 'x402',
    'dexter.resource.port': String(internalPort),
  };
}

/**
 * Build a Docker image from source files
 */
export async function buildImage(resourceId: string, context: BuildContext): Promise<string> {
  const imageName = `dexter-resource-${resourceId}:latest`;

  /*
   * Create a tar archive of the build context
   */
  const buildContextData = await createBuildContextTar(context);

  /*
   * Build the image using Docker Engine API via Unix socket
   * Sends proper tar archive as build context
   */
  const buildUrl = `http://localhost/${DOCKER_API_VERSION}/build?t=${encodeURIComponent(imageName)}`;

  const buildResponse = await request(buildUrl, {
    method: 'POST',
    dispatcher: dockerAgent,
    headers: {
      'Content-Type': 'application/x-tar',
      'Content-Length': String(buildContextData.length),
    },
    body: buildContextData,
  });

  if (buildResponse.statusCode >= 400) {
    const error = await buildResponse.body.text();
    throw new Error(`Docker build failed: ${error}`);
  }

  // Stream build output and wait for completion
  const bodyText = await buildResponse.body.text();
  const lines = bodyText.split('\n').filter(Boolean);
  let lastLine = '';

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);

      if (parsed.error) {
        throw new Error(`Build error: ${parsed.error}`);
      }

      if (parsed.stream) {
        lastLine = parsed.stream.trim();
        console.log(`[Docker Build] ${parsed.stream.trim()}`);
      }
    } catch {
      // Ignore parse errors for partial lines
    }
  }

  console.log(`[Docker] Build completed: ${lastLine}`);

  return imageName;
}

/**
 * Create a container for a resource
 */
export async function createContainer(options: ContainerOptions): Promise<string> {
  const containerName = `dexter-resource-${options.resourceId}`;

  // Generate Traefik labels
  const traefikLabels = generateTraefikLabels(
    options.resourceId,
    3000, // Internal port (all resources use 3000 internally)
  );

  // Merge with custom labels
  const labels = {
    ...traefikLabels,
    ...options.labels,
  };

  // Container configuration
  const containerConfig = {
    Image: options.image,
    Env: Object.entries(options.env).map(([k, v]) => `${k}=${v}`),
    Labels: labels,
    ExposedPorts: {
      '3000/tcp': {},
    },
    HostConfig: {
      Memory: options.memoryMb * 1024 * 1024,
      NanoCpus: options.cpuLimit * 1e9,
      NetworkMode: RESOURCE_NETWORK,
      RestartPolicy: {
        Name: 'unless-stopped',
      },
    },
    Healthcheck: {
      Test: ['CMD', 'curl', '-f', `http://localhost:3000${options.healthCheck.path}`],
      Interval: options.healthCheck.intervalSeconds * 1e9,
      Timeout: options.healthCheck.timeoutSeconds * 1e9,
      Retries: options.healthCheck.retries,
    },
  };

  // Create the container
  const response = await dockerRequest<{ Id: string }>(
    'POST',
    `/${DOCKER_API_VERSION}/containers/create?name=${containerName}`,
    containerConfig,
  );

  return response.Id;
}

/**
 * Start a container
 */
export async function startContainer(containerId: string): Promise<void> {
  await dockerRequest('POST', `/${DOCKER_API_VERSION}/containers/${containerId}/start`);
}

/**
 * Stop a container
 */
export async function stopContainer(containerId: string): Promise<void> {
  await dockerRequest('POST', `/${DOCKER_API_VERSION}/containers/${containerId}/stop?t=10`);
}

/**
 * Remove a container
 */
export async function removeContainer(containerId: string, force = false): Promise<void> {
  await dockerRequest('DELETE', `/${DOCKER_API_VERSION}/containers/${containerId}?force=${force}&v=true`);
}

/**
 * Get container status
 */
export async function getContainerStatus(containerId: string): Promise<{
  running: boolean;
  healthy: boolean;
  exitCode: number | null;
}> {
  interface ContainerInspect {
    State: {
      Running: boolean;
      Health?: {
        Status: string;
      };
      ExitCode: number;
    };
  }

  const info = await dockerRequest<ContainerInspect>('GET', `/${DOCKER_API_VERSION}/containers/${containerId}/json`);

  return {
    running: info.State.Running,
    healthy: info.State.Health?.Status === 'healthy',
    exitCode: info.State.Running ? null : info.State.ExitCode,
  };
}

/**
 * Get container logs
 */
export async function getContainerLogs(containerId: string, tail = 100): Promise<string> {
  const url = `http://localhost/${DOCKER_API_VERSION}/containers/${containerId}/logs?stdout=true&stderr=true&tail=${tail}`;

  const response = await request(url, {
    method: 'GET',
    dispatcher: dockerAgent,
  });

  if (response.statusCode >= 400) {
    throw new Error(`Failed to get logs: ${response.statusCode}`);
  }

  return response.body.text();
}

/**
 * List all resource containers
 */
export async function listResourceContainers(): Promise<
  Array<{
    id: string;
    resourceId: string;
    status: string;
    created: number;
  }>
> {
  interface ContainerInfo {
    Id: string;
    Labels: Record<string, string>;
    State: string;
    Created: number;
  }

  const containers = await dockerRequest<ContainerInfo[]>(
    'GET',
    `/${DOCKER_API_VERSION}/containers/json?all=true&filters=${encodeURIComponent(
      JSON.stringify({ label: ['dexter.resource.type=x402'] }),
    )}`,
  );

  return containers.map((c) => ({
    id: c.Id,
    resourceId: c.Labels['dexter.resource.id'] || 'unknown',
    status: c.State,
    created: c.Created,
  }));
}

/**
 * Create a tar archive for Docker build context
 * Uses tar-stream to create a proper tar archive for Docker API
 */
async function createBuildContextTar(context: BuildContext): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pack = tar.pack();
    const chunks: Buffer[] = [];

    // Collect tar data
    pack.on('data', (chunk: Buffer) => chunks.push(chunk));
    pack.on('end', () => resolve(Buffer.concat(chunks)));
    pack.on('error', reject);

    // Add Dockerfile first
    const dockerfileContent = Buffer.from(context.dockerfile, 'utf8');
    pack.entry({ name: 'Dockerfile', size: dockerfileContent.length }, dockerfileContent);

    // Add all other files from the build context
    for (const [name, content] of context.files.entries()) {
      const fileContent = Buffer.from(content, 'utf8');
      pack.entry({ name, size: fileContent.length }, fileContent);
    }

    // Finalize the archive
    pack.finalize();
  });
}

/**
 * Deploy a complete resource
 */
export async function deployResource(
  resourceId: string,
  context: BuildContext,
  env: Record<string, string>,
): Promise<DeploymentResult> {
  try {
    // Build the image
    console.log(`[Deploy] Building image for ${resourceId}...`);

    const imageName = await buildImage(resourceId, context);

    // Create the container
    console.log(`[Deploy] Creating container for ${resourceId}...`);

    const containerId = await createContainer({
      resourceId,
      image: imageName,
      env: {
        ...env,
        NODE_ENV: 'production',
        PORT: '3000',
      },
      labels: {},
      memoryMb: 512,
      cpuLimit: 0.5,
      healthCheck: {
        path: '/health',
        intervalSeconds: 10,
        timeoutSeconds: 5,
        retries: 3,
      },
    });

    // Start the container
    console.log(`[Deploy] Starting container ${containerId.slice(0, 12)}...`);
    await startContainer(containerId);

    // Wait for health check
    console.log(`[Deploy] Waiting for health check...`);

    let healthy = false;

    for (let i = 0; i < 30; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const status = await getContainerStatus(containerId);

      if (status.healthy) {
        healthy = true;
        break;
      }

      if (!status.running) {
        throw new Error('Container exited unexpectedly');
      }
    }

    if (!healthy) {
      throw new Error('Health check timeout');
    }

    const publicUrl = `https://${resourceId}.${RESOURCE_BASE_DOMAIN}`;

    console.log(`[Deploy] Resource deployed successfully: ${publicUrl}`);

    return {
      success: true,
      resourceId,
      containerId,
      publicUrl,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Deploy] Deployment failed for ${resourceId}: ${errorMessage}`);

    return {
      success: false,
      resourceId,
      error: errorMessage,
    };
  }
}
