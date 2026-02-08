/**
 * Dexter Lab Agent - Main Agent Wrapper
 *
 * This is the core of Dexter Lab's AI system, powered by the Claude Agent SDK.
 * It provides:
 * - Stateful session management
 * - Built-in tools (Read, Edit, Write, Bash, Glob, Grep)
 * - Custom x402 tools via MCP
 * - Streaming responses
 * - Dexter Lab identity and x402 expertise
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { createDexterMcpServer } from './mcp-tools';
import { getSkillsPromptSection } from '~/lib/.server/skills';
import type { DexterAgentOptions, DexterAgentResult, StreamMessage } from './types';

/**
 * The Dexter Lab system prompt
 * This defines the AI's identity, mission, and expertise
 */
const DEXTER_LAB_SYSTEM_PROMPT = `You are Dexter Lab, an expert AI assistant specialized in building **x402 paid API resources**.

<identity>
You are Dexter Lab - not Bolt, not Claude, not any other assistant. You are the AI powering Dexter Lab, a platform for creating monetized API endpoints using the x402 payment protocol on Solana.
</identity>

<mission>
Your PRIMARY PURPOSE is to help users create, test, and deploy **x402 resources** - paid API endpoints that accept USDC micropayments on Solana.

x402 is an HTTP-native payment protocol:
1. Client requests a paid endpoint
2. Server returns **402 Payment Required** with payment details in PAYMENT-REQUIRED header
3. Client signs a USDC transfer transaction
4. Client retries with PAYMENT-SIGNATURE header
5. Server verifies payment on-chain, returns content + PAYMENT-RESPONSE receipt

Every resource you build MUST use the \`@dexterai/x402\` SDK for payment handling.
</mission>

<capabilities>
You have access to powerful tools:

**File Operations:**
- Read: Read files (text, images, PDFs, notebooks)
- Edit: Make precise edits to existing files
- Write: Create new files
- Glob: Find files by pattern
- Grep: Search file contents

**Execution:**
- Bash: Run shell commands (npm, node, git, etc.)

**APIs (via proxy_api tool):**
- OpenAI: GPT-5.2, o3, DALL-E, Sora, Whisper, TTS
- Anthropic: Claude models
- Gemini: Google's AI models
- Helius: Solana RPC, DAS API, token metadata
- Jupiter: Token prices, swap quotes
- Solscan: Account info, transactions
- Birdeye: Token analytics

All proxy calls are authenticated - no API keys needed in user code.
</capabilities>

<x402_resource_structure>
Every x402 resource follows this structure:

\`\`\`
my-resource/
├── package.json      # Must include @dexterai/x402
├── index.ts          # Express app with x402 middleware
└── README.md         # Documentation (optional)
\`\`\`

**IMPORTANT: Do NOT create a Dockerfile.** The deployment service automatically generates the correct Dockerfile for containerization. Only provide the source code files.

**package.json template:**
\`\`\`json
{
  "name": "my-x402-resource",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@dexterai/x402": "^1.4.0",
    "express": "^4.18.0"
  }
}
\`\`\`
</x402_resource_structure>

<pricing_guidance>
Choose pricing based on resource type:

1. **Fixed Price** - Same cost every request
   - Simple endpoints: $0.001 - $0.01
   - Premium content: $0.05 - $0.50

2. **Dynamic Pricing** - Scales with input
   - Per character: $0.0001/char
   - Per image: $0.01 - $0.10
   - Per MB: $0.001/MB

3. **Token-Based** - For LLM wrappers
   - Use MODEL_PRICING from SDK
   - Add 15-25% markup
   - Estimate tokens from input length

Always use \`{{USER_WALLET}}\` for payTo - it's replaced at deploy time.
</pricing_guidance>

<deployment_tools>
You have TWO deployment tools — use the RIGHT one:

**deploy_x402** — ONLY for creating a BRAND NEW resource that has never been deployed.
- Creates a new resource ID, new URL, new managed wallet
- Use this the FIRST time you deploy something in a conversation

**update_x402** — ONLY for updating a resource that ALREADY EXISTS.
- Keeps the same resource ID, URL, managed wallet, and revenue
- Use this when the user asks to change, fix, or improve something you already deployed
- You MUST pass the resourceId you received from the original deploy_x402 call
- You MUST include ALL source files (complete set, not just changes)

CRITICAL: If you have already called deploy_x402 in this conversation and the user wants changes,
you MUST use update_x402 with the existing resourceId. NEVER call deploy_x402 twice for the same resource.

**exampleBody**: For every POST/PUT/PATCH endpoint, ALWAYS include an exampleBody field with a
minimal valid JSON string that satisfies the endpoint's input validation. This is used by the
post-deploy test runner to make a real paid request through the x402 facilitator. If the test
runner sends an invalid body, the resource fails its settlement test and enters the marketplace
with a failing score. Example: exampleBody: '{"prompt": "Write about the future of AI", "style": "professional"}'
</deployment_tools>

<rules>
1. ALWAYS identify as Dexter Lab
2. ALWAYS use @dexterai/x402 SDK for payments
3. ALWAYS use {{USER_WALLET}} placeholder, never hardcode addresses
4. Use the proxy_api tool for external API calls
5. Create complete, production-ready code
6. Include proper error handling
7. Write clear documentation
8. Test resources before deployment
9. When updating a resource, use update_x402 — NEVER deploy_x402 for changes to existing resources
10. Remember the resourceId from deploy_x402 — you will need it for update_x402
</rules>`;

/**
 * Create the Dexter Lab agent options
 */
function createAgentOptions(options: DexterAgentOptions) {
  // Load skills from /skills directory
  const skillsPrompt = getSkillsPromptSection();

  // Combine system prompt with skills and any additional instructions
  let fullSystemPrompt = DEXTER_LAB_SYSTEM_PROMPT;

  if (skillsPrompt) {
    fullSystemPrompt += `\n\n${skillsPrompt}`;
  }

  if (options.additionalInstructions) {
    fullSystemPrompt += `\n\n<additional_instructions>\n${options.additionalInstructions}\n</additional_instructions>`;
  }

  return {
    systemPrompt: fullSystemPrompt,

    // Tools configuration
    allowedTools: [
      'Read',
      'Edit',
      'Write',
      'Glob',
      'Grep',
      'Bash',
      'mcp__dexter-x402__proxy_api',
      'mcp__dexter-x402__validate_x402',
      'mcp__dexter-x402__x402_sdk_docs',
      'mcp__dexter-x402__deploy_x402',
      'mcp__dexter-x402__update_x402',
      'mcp__dexter-x402__deployment_status',
    ],

    // MCP servers — pass the user's wallet so deploy/update tools can forward it
    mcpServers: {
      'dexter-x402': createDexterMcpServer(options.walletAddress),
    },

    // Permission mode - auto-approve file edits
    permissionMode: 'acceptEdits' as const,

    // Session management
    resume: options.sessionId,
    forkSession: options.forkSession,

    // Working directory
    cwd: options.cwd || process.cwd(),

    // Limits
    maxTurns: options.maxTurns || 50,
    maxBudgetUsd: options.maxBudgetUsd,

    /*
     * Model - Use Claude Opus 4.5 for code generation (flagship model)
     * claude-opus-4-5 aliases to the latest dated version (currently 20251101)
     */
    model: options.model || 'claude-opus-4-5',
  };
}

/**
 * Stream messages from the Dexter Lab agent
 *
 * This is an async generator that yields StreamMessage objects
 * as the agent works. Use this for real-time UI updates.
 */
export async function* streamDexterAgent(
  prompt: string,
  options: DexterAgentOptions = {},
): AsyncGenerator<StreamMessage, DexterAgentResult, undefined> {
  // Import tracing (dynamic to avoid circular deps)
  const { tracer, createTraceContext, traceAgentPrompt, traceAgentComplete, traceToolCall, traceToolResult } =
    await import('~/lib/.server/tracing');

  const startTime = Date.now();
  const { traceId, sessionId: initialSessionId } = createTraceContext(options.sessionId);

  const agentOptions = createAgentOptions(options);
  let sessionId = options.sessionId || initialSessionId;
  let result = '';
  let success = true;
  let error: string | undefined;
  let totalCostUsd: number | undefined;
  let numTurns: number | undefined;
  let usage: DexterAgentResult['usage'] | undefined;
  let toolCallStartTime: number | undefined;
  let currentToolName: string | undefined;

  // Log the incoming prompt
  traceAgentPrompt(traceId, sessionId, prompt, {
    model: agentOptions.model,
    additionalInstructions: options.additionalInstructions,
  });

  try {
    /*
     * Create streaming input for MCP support
     * SDKUserMessage requires parent_tool_use_id (string | null) and session_id
     */
    async function* generateInput() {
      yield {
        type: 'user' as const,
        message: {
          role: 'user' as const,
          content: prompt,
        },
        parent_tool_use_id: null as string | null,
        session_id: options.sessionId || '',
      };
    }

    tracer.debug('AGENT', 'Starting agent query loop', { traceId, sessionId });

    for await (const message of query({
      prompt: generateInput(),
      options: agentOptions,
    })) {
      // Log every message type for comprehensive tracing
      tracer.trace('AGENT', `Message received: ${message.type}`, {
        traceId,
        sessionId,
        data: { messageType: message.type, hasSubtype: 'subtype' in message },
      });

      // Extract session ID from system init message
      if (message.type === 'system' && 'subtype' in message && message.subtype === 'init') {
        sessionId = message.session_id;
        tracer.info('SESSION', `Session initialized: ${sessionId}`, {
          traceId,
          sessionId,
          data: { forkedFrom: options.forkSession ? options.sessionId : undefined },
        });
        yield {
          type: 'system',
          content: `Session started: ${sessionId}`,
          sessionId,
          timestamp: Date.now(),
        };
      }

      // Handle assistant messages (Claude's responses)
      else if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if ('text' in block && block.text) {
            tracer.trace('AGENT', 'Text response chunk', {
              traceId,
              sessionId,
              data: { textLength: block.text.length },
            });
            yield {
              type: 'text',
              content: block.text,
              sessionId,
              timestamp: Date.now(),
            };
          } else if ('name' in block) {
            // Tool call started
            currentToolName = block.name;
            toolCallStartTime = Date.now();

            const toolInput = 'input' in block ? block.input : {};

            traceToolCall(traceId, sessionId, block.name, toolInput as Record<string, unknown>);

            yield {
              type: 'tool_use',
              content: `Using tool: ${block.name}`,
              toolName: block.name,
              toolInput,
              sessionId,
              timestamp: Date.now(),
            };
          }
        }
      }

      // Handle tool result messages
      else if (message.type === 'user' && 'tool_result' in (message as any)) {
        const toolResult = (message as any).tool_result;

        if (currentToolName && toolCallStartTime) {
          const toolDuration = Date.now() - toolCallStartTime;
          traceToolResult(
            traceId,
            sessionId,
            currentToolName,
            {
              success: !toolResult.is_error,
              data: toolResult.content,
              error: toolResult.is_error ? String(toolResult.content) : undefined,
            },
            toolDuration,
          );
          currentToolName = undefined;
          toolCallStartTime = undefined;
        }
      }

      // Handle result messages
      else if (message.type === 'result') {
        if ('subtype' in message) {
          if (message.subtype === 'success') {
            result = (message as any).result || '';
            totalCostUsd = (message as any).total_cost_usd;
            numTurns = (message as any).num_turns;
            usage = (message as any).usage;

            tracer.info('AGENT', 'Agent completed successfully', {
              traceId,
              sessionId,
              data: {
                resultLength: result.length,
                resultPreview: result.substring(0, 300),
              },
            });
          } else {
            success = false;
            error = (message as any).errors?.join(', ') || message.subtype;

            tracer.warn('AGENT', `Agent completed with status: ${message.subtype}`, {
              traceId,
              sessionId,
              data: { subtype: message.subtype, errors: (message as any).errors },
            });
          }
        }

        yield {
          type: 'result',
          content: result || error || 'Completed',
          sessionId,
          timestamp: Date.now(),
        };
      }
    }
  } catch (err) {
    success = false;
    error = err instanceof Error ? err.message : 'Unknown error occurred';

    tracer.error('AGENT', 'Agent threw exception', {
      traceId,
      sessionId,
      error: err instanceof Error ? err : new Error(String(err)),
    });

    yield {
      type: 'error',
      content: error,
      sessionId,
      timestamp: Date.now(),
    };
  }

  // Final completion trace with all metrics
  const totalDuration = Date.now() - startTime;
  traceAgentComplete(traceId, sessionId, {
    success,
    totalCostUsd,
    numTurns,
    usage: usage as Record<string, unknown>,
    durationMs: totalDuration,
  });

  /*
   * Persist the agent run to dexter-api for cost tracking
   * Fire-and-forget - don't block the response
   */
  const { persistAgentRunAsync } = await import('~/lib/.server/persistence/agent-runs');
  persistAgentRunAsync({
    sessionId,
    traceId,
    userId: options.userId, // Will be undefined if not authenticated
    prompt,
    model: agentOptions.model,
    additionalInstructions: options.additionalInstructions,
    success,
    errorMessage: error,
    result: result ? result.substring(0, 10000) : undefined, // Truncate large results
    costUsd: totalCostUsd || 0,
    inputTokens: usage?.input_tokens,
    outputTokens: usage?.output_tokens,
    cacheCreationTokens: usage?.cache_creation_input_tokens,
    cacheReadTokens: usage?.cache_read_input_tokens,
    numTurns,
    durationMs: totalDuration,
  });

  return {
    result,
    sessionId,
    success,
    error,
    totalCostUsd,
    numTurns,
    usage,
  };
}

/**
 * Run the Dexter Lab agent and return the final result
 *
 * This is a convenience function that collects all messages
 * and returns only the final result. Use streamDexterAgent
 * for real-time updates.
 */
export async function runDexterAgent(prompt: string, options: DexterAgentOptions = {}): Promise<DexterAgentResult> {
  const stream = streamDexterAgent(prompt, options);
  let result: DexterAgentResult | undefined;

  // Consume the stream
  while (true) {
    const { done, value } = await stream.next();

    if (done) {
      result = value;
      break;
    }
  }

  return (
    result || {
      result: '',
      sessionId: '',
      success: false,
      error: 'No result returned',
    }
  );
}

/**
 * Continue a previous conversation
 */
export async function* continueDexterAgent(
  prompt: string,
  sessionId: string,
  options: Omit<DexterAgentOptions, 'sessionId'> = {},
): AsyncGenerator<StreamMessage, DexterAgentResult, undefined> {
  return yield* streamDexterAgent(prompt, { ...options, sessionId });
}

/**
 * Fork a conversation to explore alternatives
 */
export async function* forkDexterAgent(
  prompt: string,
  sessionId: string,
  options: Omit<DexterAgentOptions, 'sessionId' | 'forkSession'> = {},
): AsyncGenerator<StreamMessage, DexterAgentResult, undefined> {
  return yield* streamDexterAgent(prompt, { ...options, sessionId, forkSession: true });
}
