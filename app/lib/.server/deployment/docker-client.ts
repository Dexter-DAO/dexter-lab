/**
 * Docker Client
 *
 * Handles Docker operations for x402 resource deployment.
 * Uses Docker Engine API via HTTP socket.
 */

import type { ContainerOptions, BuildContext, DeploymentResult } from './types';

/*
 * Docker API configuration
 * Note: In production, would use unix socket at /var/run/docker.sock
 */
const DOCKER_API_VERSION = 'v1.43';

// Network for x402 resources
const RESOURCE_NETWORK = 'dexter-resources';

// Base domain for resources (configured via env)
const RESOURCE_BASE_DOMAIN = process.env.RESOURCE_BASE_DOMAIN || 'resources.dexter.cash';

/**
 * Execute a Docker API request via Unix socket
 */
async function dockerRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const url = `http://localhost${path}`;

  /*
   * In production, this would use a proper Docker client library
   * For now, we use fetch with the socket adapter
   */
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Host: 'docker',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Docker API error: ${response.status} - ${error}`);
  }

  return response.json() as Promise<T>;
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
   * In production, this would use a proper tar library
   */
  const buildContextData = await createBuildContextTar(context);

  /*
   * Build the image
   * Note: In production with real Docker, this would send a proper tar archive
   * For now, we send JSON which won't work with real Docker API
   * TODO: Install 'tar-stream' package and create proper tar archive
   */
  const buildResponse = await fetch(`http://localhost/${DOCKER_API_VERSION}/build?t=${encodeURIComponent(imageName)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-tar',
      Host: 'docker',
    },
    body: buildContextData,
  });

  if (!buildResponse.ok) {
    const error = await buildResponse.text();
    throw new Error(`Docker build failed: ${error}`);
  }

  // Stream build output and wait for completion
  const reader = buildResponse.body?.getReader();

  if (reader) {
    const decoder = new TextDecoder();
    let lastLine = '';

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(Boolean);

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);

          if (parsed.error) {
            throw new Error(`Build error: ${parsed.error}`);
          }

          if (parsed.stream) {
            lastLine = parsed.stream.trim();
          }
        } catch {
          // Ignore parse errors for partial lines
        }
      }
    }

    console.log(`[Docker] Build completed: ${lastLine}`);
  }

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
  const response = await fetch(
    `http://localhost/${DOCKER_API_VERSION}/containers/${containerId}/logs?stdout=true&stderr=true&tail=${tail}`,
    {
      method: 'GET',
      headers: {
        Host: 'docker',
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to get logs: ${response.status}`);
  }

  return response.text();
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
 * (Simplified implementation - production would use proper tar library)
 */
async function createBuildContextTar(context: BuildContext): Promise<string> {
  /*
   * This is a simplified placeholder
   * In production, use a proper tar library like 'tar-stream' or 'archiver'
   */

  const files: Array<{ name: string; content: string }> = [
    { name: 'Dockerfile', content: context.dockerfile },
    ...Array.from(context.files.entries()).map(([name, content]) => ({
      name,
      content,
    })),
  ];

  /*
   * For now, return JSON representation
   * The actual implementation would create a proper tar archive
   * When integrating with real Docker, install 'tar-stream' or 'archiver' package
   */
  return JSON.stringify(files);
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
