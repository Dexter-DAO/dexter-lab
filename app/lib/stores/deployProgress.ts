/**
 * Deploy Progress Store
 *
 * Tracks active deploy/update operations and their progress events.
 * Used by the DeployVerification component to show live test results.
 */

import { atom } from 'nanostores';

const dbg = () => typeof window !== 'undefined' && localStorage.getItem('DEXTER_DEBUG') === 'true';

export interface DeployProgressEvent {
  type: 'building' | 'container_started' | 'testing' | 'test_result' | 'minting_identity' | 'complete' | 'error';
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

export interface ActiveDeploy {
  resourceId: string;
  resourceName: string;
  events: DeployProgressEvent[];
  status: 'in_progress' | 'complete' | 'error';
  startedAt: number;
}

/** Currently active deploys, keyed by resourceId */
export const $activeDeploys = atom<Map<string, ActiveDeploy>>(new Map());

/** Track which resource IDs we're already subscribing to */
const subscribedIds = new Set<string>();

/**
 * Start listening for deploy progress events via SSE.
 * Called when the chat SSE stream detects a deploy_x402 or update_x402 tool call.
 */
export function startDeployProgress(resourceId: string, resourceName: string): void {
  if (subscribedIds.has(resourceId)) {
    return; // Already subscribed
  }

  subscribedIds.add(resourceId);

  // Create the active deploy entry
  const deploy: ActiveDeploy = {
    resourceId,
    resourceName,
    events: [],
    status: 'in_progress',
    startedAt: Date.now(),
  };

  const current = new Map($activeDeploys.get());
  current.set(resourceId, deploy);
  $activeDeploys.set(current);

  // Start SSE subscription
  const sseUrl = `/api/deploy-progress?id=${encodeURIComponent(resourceId)}`;

  if (dbg()) {
    console.log(`[DexterDebug:DeployProgress] Opening EventSource: ${sseUrl}`);
  }

  const eventSource = new EventSource(sseUrl);

  eventSource.onopen = () => {
    if (dbg()) {
      console.log(`[DexterDebug:DeployProgress] EventSource connected for ${resourceId}`);
    }
  };

  eventSource.onmessage = (e) => {
    if (dbg()) {
      console.log(`[DexterDebug:DeployProgress] Event received for ${resourceId}:`, e.data.substring(0, 100));
    }

    if (e.data === '[DONE]') {
      if (dbg()) {
        console.log(`[DexterDebug:DeployProgress] Stream complete for ${resourceId}`);
      }

      eventSource.close();
      subscribedIds.delete(resourceId);

      return;
    }

    try {
      const event = JSON.parse(e.data) as DeployProgressEvent;

      // Update the store
      const deploys = new Map($activeDeploys.get());
      const existing = deploys.get(resourceId);

      if (existing) {
        const updated: ActiveDeploy = {
          ...existing,
          events: [...existing.events, event],
          status:
            event.type === 'complete'
              ? 'complete'
              : event.type === 'error'
                ? 'error'
                : existing.status === 'complete'
                  ? 'complete' // Don't regress from complete (e.g. late minting_identity event)
                  : 'in_progress',
        };

        // Capture publicUrl and endpoints from complete event
        if (event.publicUrl) {
          updated.resourceName = event.resourceName || updated.resourceName;
        }

        deploys.set(resourceId, updated);
        $activeDeploys.set(deploys);
      }
    } catch {
      // Ignore parse errors
    }
  };

  eventSource.onerror = (err) => {
    if (dbg()) {
      console.error(`[DexterDebug:DeployProgress] EventSource error for ${resourceId}:`, err);
    }

    eventSource.close();
    subscribedIds.delete(resourceId);
  };

  // Safety timeout -- close after 2 minutes
  setTimeout(
    () => {
      if (subscribedIds.has(resourceId)) {
        eventSource.close();
        subscribedIds.delete(resourceId);
      }
    },
    2 * 60 * 1000,
  );
}
