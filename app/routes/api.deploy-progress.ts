/**
 * Deploy Progress SSE Endpoint
 *
 * GET /api/deploy-progress?id={resourceId}
 *
 * Streams deploy progress events from Redis as Server-Sent Events.
 * The client subscribes when it detects a deploy_x402/update_x402 tool call
 * and renders each event live in the DeployVerification component.
 */

import type { LoaderFunction } from '@remix-run/cloudflare';
import { getDeployProgress } from '~/lib/.server/deployment/redis-client';

const POLL_INTERVAL_MS = 300;
const MAX_DURATION_MS = 120_000; // 2 minute timeout

export const loader: LoaderFunction = async ({ request }) => {
  const url = new URL(request.url);
  const resourceId = url.searchParams.get('id');

  if (!resourceId) {
    return new Response(JSON.stringify({ error: 'id parameter required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();
  let cancelled = false;

  // Listen for client disconnect
  request.signal.addEventListener('abort', () => {
    cancelled = true;
  });

  const stream = new ReadableStream({
    async start(controller) {
      let cursor = 0;
      const startTime = Date.now();

      while (!cancelled && Date.now() - startTime < MAX_DURATION_MS) {
        try {
          const events = await getDeployProgress(resourceId, cursor);

          for (const event of events) {
            const sse = `data: ${JSON.stringify(event)}\n\n`;
            controller.enqueue(encoder.encode(sse));
            cursor++;

            // If we hit the complete or error event, close the stream
            if (event.type === 'complete' || event.type === 'error') {
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              controller.close();

              return;
            }
          }

          // Wait before polling again
          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        } catch {
          // Redis error, keep trying
          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS * 3));
        }
      }

      // Timeout reached
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
};
