/**
 * Deep Health Check Endpoint
 *
 * Reports the health of all critical dependencies:
 *  - Redis connectivity
 *  - Docker daemon connectivity
 *  - Running container count
 *  - Node.js process stats (uptime, memory)
 *
 * Overall status:
 *  - "healthy"  → all checks pass
 *  - "degraded" → some non-critical checks fail (e.g., Redis down but fallback works)
 *  - "unhealthy" → critical failure
 *
 * Used by UptimeRobot and manual monitoring.
 */

import { json, type LoaderFunctionArgs } from '@remix-run/node';
import { isRedisAvailable } from '~/lib/.server/deployment/redis-client';
import { listResourceContainers } from '~/lib/.server/deployment/docker-client';

interface HealthCheck {
  status: 'ok' | 'warn' | 'fail';
  latencyMs?: number;
  message?: string;
}

interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  memory: {
    rss: string;
    heapUsed: string;
    heapTotal: string;
  };
  checks: {
    redis: HealthCheck;
    docker: HealthCheck;
    containers?: {
      status: 'ok' | 'warn' | 'fail';
      running: number;
      total: number;
    };
  };
}

export const loader = async ({ request: _request }: LoaderFunctionArgs) => {
  const checks: HealthResponse['checks'] = {
    redis: { status: 'fail' },
    docker: { status: 'fail' },
  };

  // ─── Redis Check ────────────────────────────────────────────────────────
  try {
    const start = performance.now();
    const available = isRedisAvailable();
    const latencyMs = Math.round(performance.now() - start);

    if (available) {
      checks.redis = { status: 'ok', latencyMs };
    } else {
      checks.redis = { status: 'warn', latencyMs, message: 'Redis unavailable, using in-memory fallback' };
    }
  } catch (err) {
    checks.redis = {
      status: 'fail',
      message: err instanceof Error ? err.message : 'Redis check failed',
    };
  }

  // ─── Docker Check ───────────────────────────────────────────────────────
  try {
    const start = performance.now();
    const containers = await listResourceContainers();
    const latencyMs = Math.round(performance.now() - start);

    const running = containers.filter(
      (c) => (c as Record<string, unknown>).State === 'running' || c.status === 'running',
    ).length;

    checks.docker = { status: 'ok', latencyMs };
    checks.containers = {
      status: running > 0 ? 'ok' : 'warn',
      running,
      total: containers.length,
    };
  } catch (err) {
    checks.docker = {
      status: 'fail',
      message: err instanceof Error ? err.message : 'Docker check failed',
    };
  }

  // ─── Process Stats ──────────────────────────────────────────────────────
  const mem = process.memoryUsage();
  const formatMB = (bytes: number) => `${Math.round(bytes / 1024 / 1024)}MB`;

  // ─── Overall Status ─────────────────────────────────────────────────────
  const allChecks = [checks.redis, checks.docker];
  const hasFail = allChecks.some((c) => c.status === 'fail');
  const hasWarn = allChecks.some((c) => c.status === 'warn');

  let overallStatus: HealthResponse['status'] = 'healthy';

  if (hasFail) {
    overallStatus = 'unhealthy';
  } else if (hasWarn) {
    overallStatus = 'degraded';
  }

  const response: HealthResponse = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
    memory: {
      rss: formatMB(mem.rss),
      heapUsed: formatMB(mem.heapUsed),
      heapTotal: formatMB(mem.heapTotal),
    },
    checks,
  };

  // Return 200 for healthy/degraded, 503 for unhealthy
  // UptimeRobot will alert on non-2xx status codes
  return json(response, {
    status: overallStatus === 'unhealthy' ? 503 : 200,
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
};
