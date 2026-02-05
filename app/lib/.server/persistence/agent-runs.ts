/**
 * Agent Run Persistence Service
 *
 * Persists agent run data to the dexter-api database for cost tracking,
 * debugging, and attribution. All data is also logged via the tracing
 * system for real-time debugging.
 *
 * Flow:
 * 1. Agent completes a run
 * 2. This service sends the data to dexter-api
 * 3. dexter-api persists to Supabase
 * 4. Data is available for cost analysis and debugging
 */

import { tracer } from '~/lib/.server/tracing';

/*
 * API endpoint for dexter-api
 * Note: API is served from api.dexter.cash, NOT dexter.cash/api/
 */
const DEXTER_API_BASE = process.env.DEXTER_API_URL || 'https://api.dexter.cash';

export interface AgentRunData {
  sessionId: string;
  traceId: string;
  userId?: string;
  prompt: string;
  model: string;
  additionalInstructions?: string;
  success: boolean;
  errorMessage?: string;
  result?: string;
  costUsd: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  numTurns?: number;
  durationMs?: number;
  x402ResourceId?: string;
  x402ResourceName?: string;
  x402DeploymentSuccess?: boolean;
}

export interface PersistenceResult {
  success: boolean;
  id?: string;
  error?: string;
}

/**
 * Persist an agent run to the database
 * This is fire-and-forget - errors are logged but don't block the response
 */
export async function persistAgentRun(data: AgentRunData): Promise<PersistenceResult> {
  const startTime = Date.now();

  try {
    tracer.trace('SESSION', `Persisting agent run to database`, {
      traceId: data.traceId,
      sessionId: data.sessionId,
      data: { model: data.model, costUsd: data.costUsd },
    });

    const payload = {
      session_id: data.sessionId,
      trace_id: data.traceId,
      supabase_user_id: data.userId,
      prompt_preview: data.prompt,
      prompt_length: data.prompt.length,
      model: data.model,
      additional_instructions: data.additionalInstructions,
      success: data.success,
      error_message: data.errorMessage,
      result_preview: data.result,
      result_length: data.result?.length,
      cost_usd: data.costUsd,
      input_tokens: data.inputTokens,
      output_tokens: data.outputTokens,
      cache_creation_tokens: data.cacheCreationTokens,
      cache_read_tokens: data.cacheReadTokens,
      num_turns: data.numTurns,
      duration_ms: data.durationMs,
      x402_resource_id: data.x402ResourceId,
      x402_resource_name: data.x402ResourceName,
      x402_deployment_success: data.x402DeploymentSuccess,
    };

    const response = await fetch(`${DEXTER_API_BASE}/api/dexter-lab/agent-runs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const duration = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      tracer.trace('ERROR', `Failed to persist agent run: ${response.status}`, {
        traceId: data.traceId,
        durationMs: duration,
        data: { status: response.status, errorText },
      });

      return {
        success: false,
        error: `HTTP ${response.status}: ${errorText}`,
      };
    }

    const result = (await response.json()) as { id?: string; trace_id?: string };

    tracer.trace('SESSION', `Agent run persisted successfully`, {
      traceId: data.traceId,
      durationMs: duration,
      data: { persistedId: result.id, costUsd: data.costUsd },
    });

    return {
      success: true,
      id: result.id,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    tracer.trace('ERROR', `Exception persisting agent run: ${errorMessage}`, {
      traceId: data.traceId,
      durationMs: duration,
      error: error instanceof Error ? error : new Error(errorMessage),
    });

    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Fire-and-forget version that logs errors but doesn't await
 * Use this when you don't want to block on persistence
 */
export function persistAgentRunAsync(data: AgentRunData): void {
  persistAgentRun(data).catch((err) => {
    tracer.trace('ERROR', `Background persistence failed: ${err}`, {
      traceId: data.traceId,
    });
  });
}
