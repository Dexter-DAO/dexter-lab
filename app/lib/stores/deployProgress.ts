/**
 * Deploy Progress Store
 *
 * Tracks active deploy/update operations and their progress events.
 * Used by the DeployVerification component to show live test results.
 */

import { atom } from 'nanostores';

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
    responseStatus?: number;
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
  const eventSource = new EventSource(`/api/deploy-progress?id=${encodeURIComponent(resourceId)}`);

  eventSource.onmessage = (e) => {
    if (e.data === '[DONE]') {
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
          status: event.type === 'complete' ? 'complete' : event.type === 'error' ? 'error' : 'in_progress',
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

  eventSource.onerror = () => {
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
