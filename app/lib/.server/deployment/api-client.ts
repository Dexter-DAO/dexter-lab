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

/**
 * Create a new resource record in the dexter-api database.
 */
export async function persistResourceToApi(data: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${DEXTER_API_BASE}/api/dexter-lab/resources`, {
    method: 'POST',
    headers: AUTH_HEADERS,
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
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

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
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
