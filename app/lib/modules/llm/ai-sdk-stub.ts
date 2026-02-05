/**
 * AI SDK Implementation with Anthropic
 *
 * These implementations replace the Vercel AI SDK with direct Anthropic API calls.
 * The core streaming functionality uses the @anthropic-ai/sdk package directly.
 * Other providers are stubbed for future multi-provider support.
 */

import Anthropic from '@anthropic-ai/sdk';

/**
 * Stub for LanguageModelV1 from 'ai' package
 * This is the core type used by Vercel AI SDK providers
 */
export interface LanguageModelV1 {
  readonly specificationVersion: 'v1';
  readonly provider: string;
  readonly modelId: string;
  readonly defaultObjectGenerationMode?: 'json' | 'tool' | 'grammar';

  // Methods are stubbed - they won't be called in Claude-only mode
  doGenerate?: (...args: unknown[]) => Promise<unknown>;
  doStream?: (...args: unknown[]) => Promise<unknown>;
}

/**
 * Create a stub model instance
 * Returns a placeholder that satisfies the type but won't work
 */
export function createStubModel(provider: string, modelId: string): LanguageModelV1 {
  return {
    specificationVersion: 'v1',
    provider,
    modelId,
    doGenerate: async () => {
      throw new Error(
        `Multi-provider support is currently disabled. ` +
          `Using Claude Agent SDK. Model ${modelId} from ${provider} is not available.`,
      );
    },
    doStream: async () => {
      throw new Error(
        `Multi-provider support is currently disabled. ` +
          `Using Claude Agent SDK. Model ${modelId} from ${provider} is not available.`,
      );
    },
  };
}

/**
 * Stub for createOpenAI from @ai-sdk/openai
 */
export function createOpenAI(options: { baseURL?: string; apiKey?: string }) {
  return (model: string): LanguageModelV1 => {
    return createStubModel('openai', model);
  };
}

/**
 * Stub for createAnthropic from @ai-sdk/anthropic
 */
export function createAnthropic(options: { apiKey?: string; headers?: Record<string, string> }) {
  return (model: string): LanguageModelV1 => {
    return createStubModel('anthropic', model);
  };
}

/**
 * Stub for createGoogleGenerativeAI from @ai-sdk/google
 */
export function createGoogleGenerativeAI(options: { baseURL?: string; apiKey?: string }) {
  return (model: string): LanguageModelV1 => {
    return createStubModel('google', model);
  };
}

/**
 * Stub for createMistral from @ai-sdk/mistral
 */
export function createMistral(options: { baseURL?: string; apiKey?: string }) {
  return (model: string): LanguageModelV1 => {
    return createStubModel('mistral', model);
  };
}

/**
 * Stub for createCohere from @ai-sdk/cohere
 */
export function createCohere(options: { baseURL?: string; apiKey?: string }) {
  return (model: string): LanguageModelV1 => {
    return createStubModel('cohere', model);
  };
}

/**
 * Stub for createAmazonBedrock from @ai-sdk/amazon-bedrock
 */
export function createAmazonBedrock(options: { region?: string; accessKeyId?: string; secretAccessKey?: string }) {
  return (model: string): LanguageModelV1 => {
    return createStubModel('amazon-bedrock', model);
  };
}

/**
 * Stub for xai from @ai-sdk/xai
 */
export function createXai(options: { apiKey?: string }) {
  return (model: string): LanguageModelV1 => {
    return createStubModel('xai', model);
  };
}

/**
 * Stub for createOllama (if it existed)
 */
export function createOllama(options: { baseURL?: string }) {
  return (model: string): LanguageModelV1 => {
    return createStubModel('ollama', model);
  };
}

/**
 * Utility: Convert messages to core format (stub)
 */
export function convertToCoreMessages(messages: unknown[]): unknown[] {
  // Just pass through - actual conversion happens in Claude Agent SDK
  return messages;
}

/**
 * StreamText options type
 */
/**
 * Tool call type for step callbacks
 */
export interface ToolCallInfo {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface StreamTextOptions {
  model: LanguageModelV1;
  messages?: unknown[];
  system?: string;
  tools?: Record<string, unknown>;
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'tool'; toolName: string };
  maxTokens?: number;
  maxCompletionTokens?: number;
  temperature?: number;
  topP?: number;
  maxSteps?: number;
  onStepFinish?: (step: { toolCalls: ToolCallInfo[] }) => void;
  onFinish?: (result: {
    text: string;
    finishReason: string;
    usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  }) => void;
  [key: string]: unknown;
}

/**
 * Stream part type for fullStream
 */
export interface StreamPart {
  type: 'text-delta' | 'tool-call' | 'tool-result' | 'error' | 'finish';
  textDelta?: string;
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
  error?: Error;
  finishReason?: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}

/**
 * Stream text using Anthropic SDK directly
 * This is the main entry point for LLM calls
 */
export async function streamText(options: StreamTextOptions): Promise<{
  textStream: ReadableStream<string>;
  fullStream: AsyncIterable<StreamPart>;
  text: Promise<string>;
  mergeIntoDataStream: (stream: unknown) => void;
}> {
  const { model, messages, system, maxTokens = 4096, temperature = 0.7, onFinish, onStepFinish } = options;

  // Get API key from environment
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set in environment variables');
  }

  // Determine the model ID
  const modelId = model.modelId || 'claude-opus-4-5-20251101';

  // Initialize Anthropic client
  const anthropic = new Anthropic({ apiKey });

  // Convert messages to Anthropic format
  const rawMessages = messages || [];
  const anthropicMessages = rawMessages
    .map((msg: unknown) => {
      const m = msg as { role: string; content: string | unknown[] };
      return {
        role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      };
    })
    .filter((msg) => msg.role === 'user' || msg.role === 'assistant');

  let fullText = '';
  let resolveText: (text: string) => void;
  const textPromise = new Promise<string>((resolve) => {
    resolveText = resolve;
  });

  // Create the streaming response
  const stream = anthropic.messages.stream({
    model: modelId,
    max_tokens: maxTokens,
    system: system || undefined,
    messages: anthropicMessages,
  });

  // Create text stream
  const textStream = new ReadableStream<string>({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta && 'text' in event.delta) {
            const text = event.delta.text;
            fullText += text;
            controller.enqueue(text);
          }
        }

        // Get final message for usage stats
        const finalMessage = await stream.finalMessage();

        // Call onFinish callback
        if (onFinish) {
          onFinish({
            text: fullText,
            finishReason: finalMessage.stop_reason || 'stop',
            usage: {
              promptTokens: finalMessage.usage?.input_tokens || 0,
              completionTokens: finalMessage.usage?.output_tokens || 0,
              totalTokens: (finalMessage.usage?.input_tokens || 0) + (finalMessage.usage?.output_tokens || 0),
            },
          });
        }

        resolveText(fullText);
        controller.close();
      } catch (error) {
        controller.error(error);
        resolveText('');
      }
    },
  });

  // Create async iterable for full stream
  async function* createFullStream(): AsyncIterable<StreamPart> {
    try {
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta && 'text' in event.delta) {
          yield {
            type: 'text-delta',
            textDelta: event.delta.text,
          };
        }
      }

      const finalMessage = await stream.finalMessage();
      yield {
        type: 'finish',
        finishReason: finalMessage.stop_reason || 'stop',
        usage: {
          promptTokens: finalMessage.usage?.input_tokens || 0,
          completionTokens: finalMessage.usage?.output_tokens || 0,
          totalTokens: (finalMessage.usage?.input_tokens || 0) + (finalMessage.usage?.output_tokens || 0),
        },
      };
    } catch (error) {
      yield {
        type: 'error',
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  return {
    textStream,
    fullStream: createFullStream(),
    text: textPromise,
    mergeIntoDataStream: () => {
      /*
       * This would merge into a Vercel AI SDK data stream
       * For now, this is a no-op since we're using direct streaming
       */
    },
  };
}

/**
 * GenerateText options type
 */
export interface GenerateTextOptions {
  model: LanguageModelV1;
  messages?: unknown[];
  system?: string;
  tools?: Record<string, unknown>;
  maxTokens?: number;
  temperature?: number;
  [key: string]: unknown;
}

/**
 * Generate text using Anthropic SDK
 * Uses streaming internally because Anthropic requires it for long operations (>10 min)
 */
export async function generateText(
  options: GenerateTextOptions,
): Promise<{ text: string; usage?: { promptTokens: number; completionTokens: number; totalTokens: number } }> {
  const { model, messages, system, maxTokens = 4096 } = options;

  // Get API key from environment
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set in environment variables');
  }

  // Determine the model ID
  const modelId = model.modelId || 'claude-opus-4-5-20251101';

  // Initialize Anthropic client
  const anthropic = new Anthropic({ apiKey });

  // Convert messages to Anthropic format
  const rawMsgs = messages || [];
  const anthropicMessages = rawMsgs
    .map((msg: unknown) => {
      const m = msg as { role: string; content: string | unknown[] };
      return {
        role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      };
    })
    .filter((msg) => msg.role === 'user' || msg.role === 'assistant');

  /*
   * Use streaming to avoid timeout issues with Anthropic
   * (Anthropic requires streaming for operations >10 minutes)
   */
  const stream = anthropic.messages.stream({
    model: modelId,
    max_tokens: maxTokens,
    system: system || undefined,
    messages: anthropicMessages,
  });

  // Collect all text from stream
  let fullText = '';

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta && 'text' in event.delta) {
      fullText += event.delta.text;
    }
  }

  // Get final message for usage stats
  const finalMessage = await stream.finalMessage();

  return {
    text: fullText,
    usage: {
      promptTokens: finalMessage.usage?.input_tokens || 0,
      completionTokens: finalMessage.usage?.output_tokens || 0,
      totalTokens: (finalMessage.usage?.input_tokens || 0) + (finalMessage.usage?.output_tokens || 0),
    },
  };
}

/**
 * Utility: Create data stream (stub)
 */
export function createDataStream(options: {
  execute: (dataStream: DataStreamWriter) => Promise<void>;
  onError?: (error: unknown) => string;
}): ReadableStream {
  // Create a simple passthrough for backward compatibility
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      const writer: DataStreamWriter = {
        writeData: (data) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        },
        writeMessageAnnotation: (annotation) => {
          const annotationData =
            typeof annotation === 'object' && annotation !== null
              ? { type: 'annotation', ...(annotation as Record<string, unknown>) }
              : { type: 'annotation', value: annotation };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(annotationData)}\n\n`));
        },
        write: (data) => {
          controller.enqueue(encoder.encode(data));
        },
      };

      try {
        await options.execute(writer);
        controller.close();
      } catch (error) {
        const errorMessage = options.onError?.(error) || 'Stream error';
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: errorMessage })}\n\n`));
        controller.close();
      }
    },
  });
}

export interface DataStreamWriter {
  writeData: (data: unknown) => void;
  writeMessageAnnotation: (annotation: unknown) => void;
  write: (data: string) => void;
}

/**
 * Utility: Generate ID
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}
