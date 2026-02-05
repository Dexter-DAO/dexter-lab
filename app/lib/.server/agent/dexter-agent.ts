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

import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { createDexterMcpServer } from './mcp-tools';
import { getSkillsPromptSection } from '../skills';
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
├── Dockerfile        # For deployment
└── README.md         # Documentation
\`\`\`

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
    "@dexterai/x402": "^2.0.0",
    "express": "^4.18.0"
  }
}
\`\`\`

**Dockerfile template:**
\`\`\`dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist/ ./dist/
EXPOSE 3000
CMD ["node", "dist/index.js"]
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

<rules>
1. ALWAYS identify as Dexter Lab
2. ALWAYS use @dexterai/x402 SDK for payments
3. ALWAYS use {{USER_WALLET}} placeholder, never hardcode addresses
4. Use the proxy_api tool for external API calls
5. Create complete, production-ready code
6. Include proper error handling
7. Write clear documentation
8. Test resources before deployment
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
    ],

    // MCP servers
    mcpServers: {
      'dexter-x402': createDexterMcpServer(),
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
     * Model - Use Claude 4 Opus for code generation (flagship model)
     * claude-opus-4-20250514 is the API name for Claude 4 Opus
     */
    model: options.model || 'claude-opus-4-20250514',
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
  const agentOptions = createAgentOptions(options);
  let sessionId = options.sessionId || '';
  let result = '';
  let success = true;
  let error: string | undefined;
  let totalCostUsd: number | undefined;
  let numTurns: number | undefined;
  let usage: DexterAgentResult['usage'] | undefined;

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

    for await (const message of query({
      prompt: generateInput(),
      options: agentOptions,
    })) {
      // Extract session ID from system init message
      if (message.type === 'system' && 'subtype' in message && message.subtype === 'init') {
        sessionId = message.session_id;
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
            yield {
              type: 'text',
              content: block.text,
              sessionId,
              timestamp: Date.now(),
            };
          } else if ('name' in block) {
            yield {
              type: 'tool_use',
              content: `Using tool: ${block.name}`,
              toolName: block.name,
              toolInput: 'input' in block ? block.input : undefined,
              sessionId,
              timestamp: Date.now(),
            };
          }
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
          } else {
            success = false;
            error = (message as any).errors?.join(', ') || message.subtype;
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

    yield {
      type: 'error',
      content: error,
      sessionId,
      timestamp: Date.now(),
    };
  }

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
