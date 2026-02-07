/**
 * SSE Log Streaming Endpoint
 *
 * GET /api/logs/stream?id={resourceId}&tail=50
 *
 * Streams container logs in real-time via Server-Sent Events.
 * Connects to Docker Engine API with follow=true and pipes
 * log lines to the browser as they arrive.
 */

import type { LoaderFunction } from '@remix-run/cloudflare';
import { DeploymentService } from '~/lib/.server/deployment';

/* Docker API via Unix socket */
const DOCKER_API_VERSION = 'v1.43';
const DOCKER_SOCKET_PATH = '/var/run/docker.sock';

/**
 * Strip Docker multiplexed log frame headers.
 * Each frame: [stream_type(1 byte)][0 0 0][payload_length(4 bytes big-endian)][payload]
 * Stream type: 1 = stdout, 2 = stderr
 */
function stripDockerFrameHeaders(buf: Buffer): string {
  const lines: string[] = [];
  let offset = 0;

  while (offset < buf.length) {
    if (offset + 8 > buf.length) {
      /* Partial header at end of buffer -- emit as raw text */
      lines.push(buf.subarray(offset).toString('utf8'));
      break;
    }

    const payloadLength = buf.readUInt32BE(offset + 4);

    if (offset + 8 + payloadLength > buf.length) {
      /* Partial payload -- emit what we have */
      lines.push(buf.subarray(offset + 8).toString('utf8'));
      break;
    }

    const payload = buf.subarray(offset + 8, offset + 8 + payloadLength).toString('utf8');
    lines.push(payload);
    offset += 8 + payloadLength;
  }

  return lines.join('');
}

export const loader: LoaderFunction = async ({ request }) => {
  const url = new URL(request.url);
  const resourceId = url.searchParams.get('id');
  const tail = parseInt(url.searchParams.get('tail') || '50', 10);

  if (!resourceId) {
    return new Response('Missing id parameter', { status: 400 });
  }

  /* Look up the resource to get its container ID */
  const resource = await DeploymentService.getStatus(resourceId);

  if (!resource) {
    return new Response(`Resource not found: ${resourceId}`, { status: 404 });
  }

  if (!resource.containerId) {
    return new Response(`Resource has no container: ${resourceId}`, { status: 404 });
  }

  const containerId = resource.containerId;

  /*
   * Connect to Docker via Unix socket and stream logs.
   * We use Node's native http module since undici's Unix socket support
   * doesn't easily expose a streaming readable for SSE piping.
   */
  const http = await import('node:http');

  const dockerPath = `/${DOCKER_API_VERSION}/containers/${containerId}/logs?follow=true&stdout=true&stderr=true&tail=${tail}&timestamps=true`;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;

      function send(text: string) {
        if (closed) {
          return;
        }

        /* Split into individual lines and send each as an SSE event */
        const lines = text.split('\n');

        for (const line of lines) {
          const trimmed = line.trimEnd();

          if (trimmed) {
            controller.enqueue(encoder.encode(`data: ${trimmed}\n\n`));
          }
        }
      }

      function close() {
        if (closed) {
          return;
        }

        closed = true;

        try {
          controller.enqueue(encoder.encode('event: close\ndata: stream ended\n\n'));
          controller.close();
        } catch {
          /* already closed */
        }
      }

      const dockerReq = http.request(
        {
          socketPath: DOCKER_SOCKET_PATH,
          path: dockerPath,
          method: 'GET',
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 400) {
            send(`[error] Docker returned ${res.statusCode}`);
            close();

            return;
          }

          res.on('data', (chunk: Buffer) => {
            try {
              const text = stripDockerFrameHeaders(chunk);
              send(text);
            } catch {
              /* If frame parsing fails, send raw */
              send(chunk.toString('utf8'));
            }
          });

          res.on('end', close);
          res.on('error', close);
        },
      );

      dockerReq.on('error', () => {
        send('[error] Failed to connect to Docker');
        close();
      });

      dockerReq.end();

      /* Clean up when client disconnects */
      request.signal.addEventListener('abort', () => {
        closed = true;
        dockerReq.destroy();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Resource-Id': resourceId,
      'X-Container-Id': containerId,
    },
  });
};
