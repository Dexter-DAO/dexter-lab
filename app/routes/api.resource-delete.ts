/**
 * Resource Delete API Route
 *
 * Proxies delete requests to dexter-api (soft-delete: sets status to 'stopped').
 * POST /api/resource-delete - Stop and hide a lab resource
 */

import { type ActionFunction, json } from '@remix-run/cloudflare';

const DEXTER_API_BASE = process.env.DEXTER_API_URL || 'https://api.dexter.cash';
const LAB_SECRET = process.env.LAB_INTERNAL_SECRET || '';

export const action: ActionFunction = async ({ request }) => {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  let body: { resourceId?: string };

  try {
    body = (await request.json()) as { resourceId?: string };
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { resourceId } = body;

  if (!resourceId || typeof resourceId !== 'string') {
    return json({ error: 'resourceId is required' }, { status: 400 });
  }

  try {
    const res = await fetch(`${DEXTER_API_BASE}/api/dexter-lab/resources/${encodeURIComponent(resourceId)}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...(LAB_SECRET ? { Authorization: `Bearer ${LAB_SECRET}` } : {}),
      },
    });

    const data = await res.json();

    return json(data, { status: res.status });
  } catch (error) {
    console.error('[api.resource-delete] Delete request failed:', error);

    return json({ error: 'Delete request failed' }, { status: 500 });
  }
};
