/**
 * Dexter Lab Agent - Type Definitions
 *
 * Core types for the Claude Agent SDK integration.
 */

export interface DexterAgentOptions {
  /** Session ID to resume a previous conversation */
  sessionId?: string;

  /** Fork the session instead of continuing it */
  forkSession?: boolean;

  /** Working directory for file operations */
  cwd?: string;

  /** Additional system prompt to append to the Dexter Lab identity */
  additionalInstructions?: string;

  /** Maximum number of conversation turns */
  maxTurns?: number;

  /** Maximum budget in USD for this query */
  maxBudgetUsd?: number;

  /** Model to use (defaults to claude-opus-4-5, Claude 4.5 Opus flagship) */
  model?: string;

  /** User ID for cost attribution (Supabase UUID) */
  userId?: string;

  /** Connected wallet address from the client (Solana base58 pubkey) */
  walletAddress?: string;
}

export interface DexterAgentResult {
  /** The final result text from the agent */
  result: string;

  /** Session ID for continuing this conversation */
  sessionId: string;

  /** Whether the operation completed successfully */
  success: boolean;

  /** Error message if success is false */
  error?: string;

  /** Total cost in USD */
  totalCostUsd?: number;

  /** Number of turns taken */
  numTurns?: number;

  /** Token usage statistics */
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

export interface StreamMessage {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'system' | 'result' | 'error';
  content: string;
  toolName?: string;
  toolInput?: unknown;
  sessionId?: string;
  timestamp: number;
}

export interface ProxyApiRequest {
  provider: 'openai' | 'anthropic' | 'gemini' | 'helius' | 'jupiter' | 'solscan' | 'birdeye';
  endpoint: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
}

export interface X402ResourceValidation {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  structure: {
    hasPackageJson: boolean;
    hasEntryPoint: boolean;
    hasDockerfile: boolean;
    hasX402Sdk: boolean;
  };
}

export interface X402ResourceDeployment {
  success: boolean;
  resourceId?: string;
  resourceUrl?: string;
  error?: string;
}
