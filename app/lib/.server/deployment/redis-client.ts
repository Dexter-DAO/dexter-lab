/**
 * Redis Client for Deployment Service
 *
 * Provides persistent storage for the resource registry.
 * Falls back to in-memory storage if Redis is unavailable.
 */

import Redis from 'ioredis';
import type { DeployedResource } from './types';

// Redis connection URL (defaults to local container)
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Key prefix for all deployment-related keys
const KEY_PREFIX = 'dexter:lab:resources:';

// TTL for resource data (7 days in seconds)
const RESOURCE_TTL = 7 * 24 * 60 * 60;

// Singleton Redis instance
let redis: Redis | null = null;
let redisAvailable = true;

// In-memory fallback
const memoryFallback = new Map<string, DeployedResource>();

/**
 * Get or create Redis connection
 */
function getRedis(): Redis | null {
  if (!redisAvailable) {
    return null;
  }

  if (!redis) {
    try {
      redis = new Redis(REDIS_URL, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => {
          if (times > 3) {
            console.warn('[Redis] Max retries reached, falling back to in-memory storage');
            redisAvailable = false;

            return null;
          }

          return Math.min(times * 100, 3000);
        },
        lazyConnect: true,
      });

      redis.on('error', (err) => {
        console.error('[Redis] Connection error:', err.message);
      });

      redis.on('connect', () => {
        console.log('[Redis] Connected to', REDIS_URL);
      });

      // Connect asynchronously
      redis.connect().catch((err) => {
        console.warn('[Redis] Initial connection failed, using in-memory fallback:', err.message);
        redisAvailable = false;
        redis = null;
      });
    } catch (err) {
      console.warn('[Redis] Failed to create client:', err);
      redisAvailable = false;

      return null;
    }
  }

  return redis;
}

/**
 * Convert DeployedResource to a Redis-storable format
 * (Dates become ISO strings)
 */
function serializeResource(resource: DeployedResource): string {
  return JSON.stringify({
    ...resource,
    deployedAt: resource.deployedAt.toISOString(),
    updatedAt: resource.updatedAt.toISOString(),
  });
}

/**
 * Parse stored resource back to DeployedResource
 */
function deserializeResource(data: string): DeployedResource {
  const parsed = JSON.parse(data);
  return {
    ...parsed,
    deployedAt: new Date(parsed.deployedAt),
    updatedAt: new Date(parsed.updatedAt),
  };
}

/**
 * Store a resource in Redis (or memory fallback)
 */
export async function setResource(resourceId: string, resource: DeployedResource): Promise<void> {
  const client = getRedis();

  if (client && redisAvailable) {
    try {
      await client.setex(KEY_PREFIX + resourceId, RESOURCE_TTL, serializeResource(resource));

      // Also maintain a set of all resource IDs for listing
      await client.sadd(KEY_PREFIX + 'index', resourceId);

      return;
    } catch (err) {
      console.warn('[Redis] setResource failed, using memory fallback:', err);
    }
  }

  // Memory fallback
  memoryFallback.set(resourceId, resource);
}

/**
 * Get a resource from Redis (or memory fallback)
 */
export async function getResource(resourceId: string): Promise<DeployedResource | null> {
  const client = getRedis();

  if (client && redisAvailable) {
    try {
      const data = await client.get(KEY_PREFIX + resourceId);

      if (data) {
        // Refresh TTL on access
        await client.expire(KEY_PREFIX + resourceId, RESOURCE_TTL);
        return deserializeResource(data);
      }

      return null;
    } catch (err) {
      console.warn('[Redis] getResource failed, using memory fallback:', err);
    }
  }

  // Memory fallback
  return memoryFallback.get(resourceId) || null;
}

/**
 * Delete a resource from Redis (or memory fallback)
 */
export async function deleteResource(resourceId: string): Promise<void> {
  const client = getRedis();

  if (client && redisAvailable) {
    try {
      await client.del(KEY_PREFIX + resourceId);
      await client.srem(KEY_PREFIX + 'index', resourceId);

      return;
    } catch (err) {
      console.warn('[Redis] deleteResource failed, using memory fallback:', err);
    }
  }

  // Memory fallback
  memoryFallback.delete(resourceId);
}

/**
 * List all resources from Redis (or memory fallback)
 */
export async function listResources(): Promise<DeployedResource[]> {
  const client = getRedis();

  if (client && redisAvailable) {
    try {
      const ids = await client.smembers(KEY_PREFIX + 'index');

      if (ids.length === 0) {
        return [];
      }

      const keys = ids.map((id) => KEY_PREFIX + id);
      const values = await client.mget(...keys);

      return values.filter((v): v is string => v !== null).map(deserializeResource);
    } catch (err) {
      console.warn('[Redis] listResources failed, using memory fallback:', err);
    }
  }

  // Memory fallback
  return Array.from(memoryFallback.values());
}

/**
 * Check if Redis is available
 */
export function isRedisAvailable(): boolean {
  return redisAvailable && redis !== null;
}

// ─── Deploy Progress Events ───────────────────────────────────────────────────

const PROGRESS_PREFIX = 'dexter:lab:deploy:progress:';
const PROGRESS_TTL = 300; // 5 minutes, auto-cleanup

export interface DeployProgressEvent {
  type: 'building' | 'container_started' | 'testing' | 'test_result' | 'complete' | 'error';
  resourceId: string;
  resourceName?: string;
  test?: {
    testType: string;
    passed: boolean;
    durationMs: number;
    aiScore?: number;
    aiStatus?: string;
    aiNotes?: string;
    testInput?: unknown;
    txSignature?: string;
    priceCents?: number;
    priceUsdc?: number;
    responseStatus?: number;
    responsePreview?: string;
  };
  endpoints?: Array<{ path: string; method: string; priceUsdc?: number }>;
  publicUrl?: string;
  error?: string;
  timestamp: number;
}

/**
 * Push a deploy progress event to Redis.
 * Events are stored in a list and expire after 5 minutes.
 */
export async function pushDeployProgress(resourceId: string, event: DeployProgressEvent): Promise<void> {
  const client = getRedis();

  if (client && redisAvailable) {
    try {
      const key = PROGRESS_PREFIX + resourceId;
      await client.rpush(key, JSON.stringify(event));
      await client.expire(key, PROGRESS_TTL);
    } catch (err) {
      console.warn('[Redis] pushDeployProgress failed:', err);
    }
  }
}

/**
 * Read all deploy progress events from a given index onward.
 * Returns events starting from `fromIndex` (0-based).
 */
export async function getDeployProgress(resourceId: string, fromIndex: number = 0): Promise<DeployProgressEvent[]> {
  const client = getRedis();

  if (client && redisAvailable) {
    try {
      const key = PROGRESS_PREFIX + resourceId;
      const items = await client.lrange(key, fromIndex, -1);

      return items.map((item) => JSON.parse(item) as DeployProgressEvent);
    } catch (err) {
      console.warn('[Redis] getDeployProgress failed:', err);
    }
  }

  return [];
}

/**
 * Close Redis connection (for cleanup)
 */
export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}

// Export a resource registry interface that mirrors the old Map API
export const resourceRegistry = {
  get: getResource,
  set: setResource,
  delete: deleteResource,
  list: listResources,
  isRedisAvailable,
};

export default resourceRegistry;
