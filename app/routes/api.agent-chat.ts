/**
 * API Route: /api/agent-chat
 *
 * Streaming endpoint for the Dexter Lab AI agent.
 * Uses the Claude Agent SDK for stateful, agentic conversations.
 */

import type { ActionFunctionArgs } from '@remix-run/cloudflare';
import { streamDexterAgent, type StreamMessage, type DexterAgentResult } from '~/lib/.server/agent';
import { resolveDexterHolderStatus } from '~/lib/.server/auth/holder-status';
import { clampRequestedLimits, getTierCaps } from '~/lib/.server/auth/tier-policy';
import {
  getWalletGatingMode,
  readWalletSessionFromRequest,
  type WalletAccessTier,
} from '~/lib/.server/auth/wallet-auth';

interface ChatRequest {
  prompt: string;
  sessionId?: string;
  forkSession?: boolean;
  maxTurns?: number;
  maxBudgetUsd?: number;
  additionalInstructions?: string;

  /** User ID for cost attribution (Supabase UUID) */
  userId?: string;

  /** Connected Solana wallet address from the client */
  walletAddress?: string;
}

function resolveTier(
  hasSession: boolean,
  holderStatus: { isHolder: boolean } | null,
): WalletAccessTier {
  if (!hasSession) return 'unverified';
  return holderStatus?.isHolder ? 'verified_holder' : 'verified_non_holder';
}

/**
 * Stream text as Server-Sent Events
 */
function createEventStream(stream: AsyncGenerator<StreamMessage, DexterAgentResult, undefined>) {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      /*
       * SSE keepalive: send a comment every 15s to prevent Cloudflare/nginx
       * from killing the connection during long tool executions (Docker builds,
       * test runs, etc.) where no agent events are emitted.
       * SSE comments (lines starting with ':') are ignored by clients.
       */
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch {
          clearInterval(keepalive);
        }
      }, 15_000);

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
      } finally {
        clearInterval(keepalive);
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

  const walletGatingMode = getWalletGatingMode();
  const walletSession = readWalletSessionFromRequest(request);

  let holderStatus: { isHolder: boolean; balanceRaw?: string; checkedAtMs?: number } | null = null;
  if (walletGatingMode !== 'off' && walletSession) {
    try {
      const status = await resolveDexterHolderStatus(walletSession.walletAddress);
      holderStatus = {
        isHolder: status.isHolder,
        balanceRaw: status.balanceRaw,
        checkedAtMs: status.checkedAtMs,
      };
    } catch (error) {
      console.warn('[wallet-gating] holder_check_failed', {
        mode: walletGatingMode,
        sessionId: walletSession.sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const resolvedTier = resolveTier(!!walletSession, holderStatus);
  const requestedLimits = {
    maxTurns: typeof body.maxTurns === 'number' ? body.maxTurns : undefined,
    maxBudgetUsd: typeof body.maxBudgetUsd === 'number' ? body.maxBudgetUsd : undefined,
  };

  const tierLimited = clampRequestedLimits(requestedLimits, getTierCaps(resolvedTier));

  // Legacy behavior retained for off/shadow rollout safety.
  const legacyHasAttributedUser = typeof body.userId === 'string' && body.userId.trim().length > 0;
  const legacyTier = legacyHasAttributedUser ? 'verified_holder' : 'unverified';
  const legacyLimited = clampRequestedLimits(requestedLimits, getTierCaps(legacyTier));

  const effectiveLimits = walletGatingMode === 'enforce' ? tierLimited : legacyLimited;
  if (walletGatingMode === 'shadow') {
    console.info('[wallet-gating] shadow_decision', {
      sessionPresent: !!walletSession,
      resolvedTier,
      holder: holderStatus,
      requested: requestedLimits,
      legacyApplied: legacyLimited,
      wouldEnforce: tierLimited,
      suppliedWalletAddress: body.walletAddress ? 'present' : 'missing',
      suppliedUserId: body.userId ? 'present' : 'missing',
    });
  } else {
    console.info('[wallet-gating] decision', {
      mode: walletGatingMode,
      sessionPresent: !!walletSession,
      resolvedTier,
      holder: holderStatus,
      requested: requestedLimits,
      applied: effectiveLimits,
    });
  }

  const walletAddressForTools =
    walletGatingMode === 'off' ? body.walletAddress : walletSession?.walletAddress;
  const userIdForAttribution = walletGatingMode === 'enforce' ? undefined : body.userId;

  // Create the agent stream
  const stream = streamDexterAgent(body.prompt, {
    sessionId: body.sessionId,
    forkSession: body.forkSession,
    maxTurns: effectiveLimits.maxTurns,
    maxBudgetUsd: effectiveLimits.maxBudgetUsd,
    additionalInstructions: body.additionalInstructions,
    userId: userIdForAttribution, // Cost attribution only (not auth)
    walletAddress: walletAddressForTools, // Server-trusted in shadow/enforce
    accessTier: resolvedTier,
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
          maxTurns: 'number (optional) - Requested max turns, clamped by active policy tier',
          maxBudgetUsd: 'number (optional) - Requested max budget, clamped by active policy tier',
          additionalInstructions: 'string (optional) - Extra system context',
          userId: 'string (optional) - Untrusted client value (used only for legacy attribution in off/shadow)',
          walletAddress: 'string (optional) - Untrusted client value (ignored in enforce mode)',
        },
        response: 'Server-Sent Events stream',
      },
    }),
    {
      headers: { 'Content-Type': 'application/json' },
    },
  );
}
