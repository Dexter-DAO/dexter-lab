/**
 * Deployment Service Types
 *
 * Types for the x402 resource deployment pipeline.
 */

/**
 * Resource deployment status
 */
export type DeploymentStatus =
  | 'pending'
  | 'building'
  | 'deploying'
  | 'running'
  | 'stopped'
  | 'failed'
  | 'updating'
  | 'lost';

/**
 * Resource configuration
 */
export interface ResourceConfig {
  /** Unique resource identifier */
  id: string;

  /** Human-readable name */
  name: string;

  /** Creator's wallet address */
  creatorWallet: string;

  /** Resource type (e.g., 'api', 'webhook', 'stream') */
  type: 'api' | 'webhook' | 'stream';

  /** Base pricing in USDC (smallest unit) */
  basePriceUsdc: number;

  /** Pricing model */
  pricingModel: 'per-request' | 'per-token' | 'per-minute' | 'flat';

  /** Resource description */
  description: string;

  /** Tags for discovery */
  tags: string[];

  /** Environment variables (sanitized, no secrets) */
  envVars: Record<string, string>;

  /** Resource endpoints */
  endpoints: ResourceEndpoint[];
}

/**
 * Resource endpoint definition
 */
export interface ResourceEndpoint {
  /** HTTP method */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

  /** Path (relative to resource base) */
  path: string;

  /** Endpoint description */
  description: string;

  /** Price for this endpoint (if different from base) */
  priceUsdc?: number;

  /** Request schema (JSON Schema) */
  requestSchema?: Record<string, unknown>;

  /** Response schema (JSON Schema) */
  responseSchema?: Record<string, unknown>;
}

/**
 * Deployed resource instance
 */
export interface DeployedResource {
  /** Resource configuration */
  config: ResourceConfig;

  /** Current deployment status */
  status: DeploymentStatus;

  /** Docker container ID */
  containerId: string | null;

  /** Internal container port */
  internalPort: number;

  /** Public URL (via Traefik) */
  publicUrl: string;

  /** Deployment timestamp */
  deployedAt: Date;

  /** Last updated timestamp */
  updatedAt: Date;

  /** Error message if failed */
  error?: string;

  /** Health check status */
  healthy: boolean;

  /** Request count since deployment */
  requestCount: number;

  /** Revenue generated (USDC) */
  revenueUsdc: number;

  /** Stored source files for rebuild after container loss (JSON-stringified file map) */
  sourceFiles?: string;
}

/**
 * Build context for resource Docker image
 */
export interface BuildContext {
  /** Source files */
  files: Map<string, string>;

  /** Dockerfile content */
  dockerfile: string;

  /** Build arguments */
  buildArgs: Record<string, string>;
}

/**
 * Container creation options
 */
export interface ContainerOptions {
  /** Resource ID (used for naming) */
  resourceId: string;

  /** Docker image name */
  image: string;

  /** Environment variables */
  env: Record<string, string>;

  /** Traefik labels for routing */
  labels: Record<string, string>;

  /** Memory limit (MB) */
  memoryMb: number;

  /** CPU limit (cores) */
  cpuLimit: number;

  /** Health check configuration */
  healthCheck: {
    path: string;
    intervalSeconds: number;
    timeoutSeconds: number;
    retries: number;
  };
}

/**
 * Deployment result
 */
export interface DeploymentResult {
  success: boolean;
  resourceId: string;
  containerId?: string;
  publicUrl?: string;
  error?: string;
}

/**
 * Resource metrics
 */
export interface ResourceMetrics {
  resourceId: string;
  requestCount: number;
  errorCount: number;
  avgResponseTimeMs: number;
  p99ResponseTimeMs: number;
  revenueUsdc: number;
  cpuUsagePercent: number;
  memoryUsageMb: number;
  timestamp: Date;
}
