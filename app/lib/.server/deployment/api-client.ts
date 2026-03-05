/**
 * Dexter API Client
 *
 * Shared persistence functions for syncing resource state to the dexter-api
 * database. Used by both the deploy route (api.deploy.ts) and the
 * reconciliation loop (deployment-service.ts).
 *
 * Follows the same pattern as docker-client.ts (Docker) and redis-client.ts
 * (Redis) — one module per external data store.
 */

export const DEXTER_API_BASE = process.env.DEXTER_API_URL || 'https://api.dexter.cash';

const LAB_SECRET = process.env.LAB_INTERNAL_SECRET || '';
export const AUTH_HEADERS: Record<string, string> = LAB_SECRET
  ? { 'Content-Type': 'application/json', Authorization: `Bearer ${LAB_SECRET}` }
  : { 'Content-Type': 'application/json' };

export class DeployApiError extends Error {
  readonly status: number;
  readonly responseBody: string;

  constructor(status: number, responseBody: string) {
    super(`HTTP ${status}: ${responseBody}`);
    this.status = status;
    this.responseBody = responseBody;
  }
}

async function assertOkOrThrow(response: Response): Promise<void> {
  if (response.ok) {
    return;
  }

  const text = await response.text();
  throw new DeployApiError(response.status, text);
}

function isDeployApiError(error: unknown, status?: number): error is DeployApiError {
  if (!(error instanceof DeployApiError)) {
    return false;
  }

  if (status === undefined) {
    return true;
  }

  return error.status === status;
}

export type ApiSyncOutcome = 'patched' | 'recreated_after_404';

/**
 * Create a new resource record in the dexter-api database.
 */
export async function persistResourceToApi(data: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${DEXTER_API_BASE}/api/dexter-lab/resources`, {
    method: 'POST',
    headers: AUTH_HEADERS,
    body: JSON.stringify(data),
  });
  await assertOkOrThrow(response);
}

/**
 * Update an existing resource record in the dexter-api database.
 */
export async function persistResourceUpdateToApi(resourceId: string, data: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${DEXTER_API_BASE}/api/dexter-lab/resources/${resourceId}`, {
    method: 'PATCH',
    headers: AUTH_HEADERS,
    body: JSON.stringify(data),
  });
  await assertOkOrThrow(response);
}

/**
 * Update resource status in dexter-api and auto-recreate metadata on 404 drift.
 * Non-404 errors are rethrown to preserve retry behavior in callers.
 */
export async function syncResourceUpdateWithRecovery(params: {
  resourceId: string;
  update: Record<string, unknown>;
  recreate: Record<string, unknown>;
}): Promise<ApiSyncOutcome> {
  try {
    await persistResourceUpdateToApi(params.resourceId, params.update);
    return 'patched';
  } catch (error) {
    if (!isDeployApiError(error, 404)) {
      throw error;
    }

    await persistResourceToApi(params.recreate);

    return 'recreated_after_404';
  }
}

/**
 * Persist a deployment event to the dexter-api database.
 */
export async function persistEventToApi(data: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${DEXTER_API_BASE}/api/dexter-lab/events`, {
    method: 'POST',
    headers: AUTH_HEADERS,
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    console.warn(`[Deploy API] Event persistence failed: HTTP ${response.status}`);
  }
}
