/**
 * API Route: /api/agent-chat
 *
 * Streaming endpoint for the Dexter Lab AI agent.
 * Uses the Claude Agent SDK for stateful, agentic conversations.
 */

import type { ActionFunctionArgs } from '@remix-run/cloudflare';
import { streamDexterAgent, type StreamMessage, type DexterAgentResult } from '~/lib/.server/agent';

interface ChatRequest {
  prompt: string;
  sessionId?: string;
  forkSession?: boolean;
  maxTurns?: number;
  additionalInstructions?: string;

  /** User ID for cost attribution (Supabase UUID) */
  userId?: string;

  /** Connected Solana wallet address from the client */
  walletAddress?: string;
}

/**
 * Stream text as Server-Sent Events
 */
function createEventStream(stream: AsyncGenerator<StreamMessage, DexterAgentResult, undefined>) {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      try {
        let lastResult: DexterAgentResult | undefined;

        let eventIndex = 0;

        while (true) {
          const { done, value } = await stream.next();

          if (done) {
            lastResult = value;
            console.log(`[SSE] Stream ended after ${eventIndex} events`);
            break;
          }

          // Send each message as an SSE event
          const event = `data: ${JSON.stringify(value)}\n\n`;
          controller.enqueue(encoder.encode(event));
          eventIndex++;
          console.log(
            `[SSE] Sent event #${eventIndex}: type=${value.type}, length=${(value as any).content?.length || 0}`,
          );
        }

        // Send final result
        if (lastResult) {
          const finalEvent = `data: ${JSON.stringify({
            type: 'final',
            result: lastResult,
            timestamp: Date.now(),
          })}\n\n`;
          controller.enqueue(encoder.encode(finalEvent));
        }

        // End the stream
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Stream error';
        const errorEvent = `data: ${JSON.stringify({
          type: 'error',
          content: errorMessage,
          timestamp: Date.now(),
        })}\n\n`;
        controller.enqueue(encoder.encode(errorEvent));
        controller.close();
      }
    },
  });
}

export async function action({ request }: ActionFunctionArgs) {
  // Verify content type
  const contentType = request.headers.get('content-type');

  if (!contentType?.includes('application/json')) {
    return new Response(JSON.stringify({ error: 'Content-Type must be application/json' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Parse request body
  let body: ChatRequest;

  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate prompt
  if (!body.prompt || typeof body.prompt !== 'string') {
    return new Response(JSON.stringify({ error: 'prompt is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check for API key
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

  if (!anthropicApiKey) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Create the agent stream
  const stream = streamDexterAgent(body.prompt, {
    sessionId: body.sessionId,
    forkSession: body.forkSession,
    maxTurns: body.maxTurns,
    additionalInstructions: body.additionalInstructions,
    userId: body.userId, // For cost attribution
    walletAddress: body.walletAddress, // Threaded to MCP deploy/update tools
  });

  // Return streaming response
  return new Response(createEventStream(stream), {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  });
}

/**
 * GET handler - returns API info
 */
export async function loader() {
  return new Response(
    JSON.stringify({
      name: 'Dexter Lab Agent API',
      version: '1.0.0',
      description: 'Streaming AI agent for building x402 paid API resources',
      usage: {
        method: 'POST',
        contentType: 'application/json',
        body: {
          prompt: 'string (required) - The user message',
          sessionId: 'string (optional) - Resume a previous conversation',
          forkSession: 'boolean (optional) - Fork instead of continue',
          maxTurns: 'number (optional) - Maximum conversation turns',
          additionalInstructions: 'string (optional) - Extra system context',
          userId: 'string (optional) - Supabase user ID for cost attribution',
          walletAddress: 'string (optional) - Connected Solana wallet address for deploy/update',
        },
        response: 'Server-Sent Events stream',
      },
    }),
    {
      headers: { 'Content-Type': 'application/json' },
    },
  );
}
