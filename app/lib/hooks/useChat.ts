/**
 * useChat Hook - Claude Agent SDK Implementation
 *
 * This replaces the @ai-sdk/react useChat hook with a Claude Agent SDK-based implementation.
 * It maintains API compatibility with the Vercel AI SDK useChat hook while using
 * our new Claude Agent backend.
 */

import { useState, useCallback, useRef, useEffect } from 'react';

import type { Message } from '~/types/chat';
import { generateId } from '~/types/chat';
import type { JSONValue } from '~/types/json';
import { createScopedLogger } from '~/utils/logger';
import { setAgentActivity, clearAgentActivity, resetAgentActivity } from '~/lib/stores/agentActivity';

const chatHookLogger = createScopedLogger('useChat');

/**
 * Debug logging for deploy verification and sendMessage diagnostics.
 * Activate by setting localStorage.setItem('DEXTER_DEBUG', 'true') in the browser console.
 * Deactivate by removing the key or setting it to anything else.
 */
const debugLog = (...args: unknown[]) => {
  if (typeof window !== 'undefined' && localStorage.getItem('DEXTER_DEBUG') === 'true') {
    console.log('[DexterDebug]', ...args);
  }
};

/**
 * Throttle function for streaming updates
 * Ensures UI updates happen at a reasonable rate for smooth animation
 */
function createThrottledUpdater(updateFn: (content: string) => void, minInterval = 16) {
  let lastUpdate = 0;
  let pendingContent = '';
  let rafId: number | null = null;

  return (content: string) => {
    pendingContent = content;

    const now = Date.now();

    if (now - lastUpdate >= minInterval) {
      // Immediate update if enough time has passed
      lastUpdate = now;
      updateFn(pendingContent);
    } else if (!rafId) {
      // Schedule update on next animation frame
      rafId = requestAnimationFrame(() => {
        rafId = null;
        lastUpdate = Date.now();
        updateFn(pendingContent);
      });
    }
  };
}

/**
 * Response metadata from chat completion
 */
export interface ChatResponseMeta {
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

/**
 * Tool result to add back to the conversation
 */
export interface ToolResultInput {
  toolCallId: string;
  result: unknown;
}

export interface UseChatOptions {
  /**
   * API endpoint for chat
   */
  api?: string;

  /**
   * Initial messages
   */
  initialMessages?: Message[];

  /**
   * Initial input value
   */
  initialInput?: string;

  /**
   * Callback when response finishes
   */
  onFinish?: (message: Message, response: ChatResponseMeta) => void;

  /**
   * Callback on error
   */
  onError?: (error: Error) => void;

  /**
   * Callback on response (for progress updates)
   */
  onResponse?: (response: Response) => void;

  /**
   * Body to send with requests
   */
  body?: Record<string, unknown>;

  /**
   * Headers to send with requests
   */
  headers?: Record<string, string>;

  /**
   * Send extra message fields
   */
  sendExtraMessageFields?: boolean;

  /**
   * Maximum number of tool invocations
   */
  maxSteps?: number;
}

/**
 * Attachments for messages (images, files)
 */
export interface MessageAttachment {
  name?: string;
  contentType?: string;
  url: string;
}

/**
 * Options for append and reload operations
 */
export interface ChatRequestOptions {
  experimental_attachments?: MessageAttachment[];
  data?: Record<string, string>;
}

export interface UseChatReturn {
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  handleSubmit: (e?: React.FormEvent<HTMLFormElement>, options?: ChatRequestOptions) => void;
  isLoading: boolean;
  error: Error | undefined;
  stop: () => void;
  reload: (options?: ChatRequestOptions) => Promise<void>;
  append: (message: Message | { role: 'user'; content: string }, options?: ChatRequestOptions) => Promise<void>;
  data: JSONValue[] | undefined;
  setData: React.Dispatch<React.SetStateAction<JSONValue[] | undefined>>;
  addToolResult: (result: ToolResultInput) => void;
}

/**
 * Chat hook that interfaces with the Claude Agent SDK backend
 */
export function useChat(options: UseChatOptions = {}): UseChatReturn {
  const {
    api = '/api/agent-chat', // Use Claude Agent SDK endpoint for stateful sessions
    initialMessages = [],
    initialInput = '',
    onFinish,
    onError,
    onResponse,
    body = {},
    headers = {},
  } = options;

  const [messages, setMessagesState] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState(initialInput);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | undefined>(undefined);
  const [data, setData] = useState<JSONValue[] | undefined>([]);

  const abortControllerRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef<string | undefined>(undefined);
  const responseMetaRef = useRef<ChatResponseMeta>({});

  // Use ref to track messages synchronously (for closures like reload/append)
  const messagesRef = useRef<Message[]>(initialMessages);

  // Keep ref in sync with state
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Wrapper to update both state and ref synchronously
  const setMessages: React.Dispatch<React.SetStateAction<Message[]>> = useCallback((action) => {
    setMessagesState((prev) => {
      const newMessages = typeof action === 'function' ? action(prev) : action;
      messagesRef.current = newMessages;

      // Update ref synchronously
      return newMessages;
    });
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setInput(e.target.value);
  }, []);

  const stop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    setIsLoading(false);
  }, []);

  const sendMessage = useCallback(
    async (content: string, existingMessages: Message[]) => {
      if (!content.trim()) {
        console.warn('[useChat.sendMessage] Empty content, skipping');
        return;
      }

      debugLog('sendMessage: Sending to API:', api);
      debugLog('sendMessage: Content:', content.slice(0, 100) + '...');
      debugLog('sendMessage: Existing messages count:', existingMessages.length);

      setError(undefined);
      setIsLoading(true);

      // Add user message
      const userMessage: Message = {
        id: generateId(),
        role: 'user',
        content,
        createdAt: new Date(),
      };

      const newMessages = [...existingMessages, userMessage];
      setMessages(newMessages);

      // Create abort controller
      abortControllerRef.current = new AbortController();

      try {
        const response = await fetch(api, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...headers,
          },
          body: JSON.stringify({
            prompt: content,
            sessionId: sessionIdRef.current,
            ...body,
          }),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP error: ${response.status}`);
        }

        onResponse?.(response);

        // Handle SSE stream
        const reader = response.body?.getReader();

        if (!reader) {
          throw new Error('No response body');
        }

        const decoder = new TextDecoder();
        let assistantContent = '';
        const assistantMessageId = generateId();

        // Add placeholder assistant message
        setMessages((prev) => [
          ...prev,
          {
            id: assistantMessageId,
            role: 'assistant',
            content: '',
            createdAt: new Date(),
          },
        ]);

        // Create throttled updater for smooth streaming animation (~60fps)
        const throttledUpdate = createThrottledUpdater((content: string) => {
          setMessages((prev) => prev.map((m) => (m.id === assistantMessageId ? { ...m, content } : m)));
        }, 16); // 16ms = ~60fps

        // Buffer for partial SSE lines
        let sseBuffer = '';

        let clientEventCount = 0;

        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            console.log(
              `[SSE-Client] Stream done after ${clientEventCount} events, assistantContent length=${assistantContent.length}`,
            );
            break;
          }

          // Decode chunk and add to buffer
          const chunk = decoder.decode(value, { stream: true });
          sseBuffer += chunk;

          // Process complete lines from buffer
          const lines = sseBuffer.split('\n');

          // Keep the last potentially incomplete line in buffer
          sseBuffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);

              if (data === '[DONE]') {
                continue;
              }

              try {
                const parsed = JSON.parse(data);

                clientEventCount++;
                console.log(
                  `%c[SSE] Event #${clientEventCount}: type=${parsed.type} len=${parsed.content?.length || parsed.toolName?.length || 0}`,
                  'color: #4ade80; font-weight: bold',
                );

                // Handle different message types
                if (parsed.type === 'text') {
                  // Agent is speaking — clear the tool activity indicator
                  clearAgentActivity();

                  /*
                   * Ensure consecutive text chunks are separated.
                   * The agent sends multiple text events (planning, code, result) that get
                   * concatenated. Without a separator, sentences mash together.
                   */
                  if (
                    assistantContent.length > 0 &&
                    parsed.content.length > 0 &&
                    !assistantContent.endsWith('\n') &&
                    !assistantContent.endsWith(' ') &&
                    !parsed.content.startsWith('\n') &&
                    !parsed.content.startsWith(' ')
                  ) {
                    assistantContent += '\n\n';
                  }

                  assistantContent += parsed.content;

                  // Detect resourceId in agent response text and start deploy verification
                  const resIdMatch = assistantContent.match(/\bres-[a-z0-9]+-[a-z0-9]+\b/);

                  if (resIdMatch) {
                    const detectedResId = resIdMatch[0];
                    debugLog('DeployVerification: Detected resourceId in text:', detectedResId);
                    import('~/lib/stores/deployProgress').then(({ startDeployProgress, $activeDeploys }) => {
                      const alreadyTracked = $activeDeploys.get().has(detectedResId);
                      debugLog('DeployVerification: alreadyTracked=', alreadyTracked, 'for', detectedResId);

                      if (!alreadyTracked) {
                        debugLog('DeployVerification: Starting progress subscription for', detectedResId);
                        startDeployProgress(detectedResId, detectedResId);
                      }
                    });
                  }

                  // Use throttled updater for smooth streaming display
                  throttledUpdate(assistantContent);
                } else if (parsed.type === 'tool_use' && parsed.toolName) {
                  // Show tool activity in the chat UI
                  setAgentActivity(parsed.toolName, parsed.toolInput as Record<string, unknown> | undefined);

                  // Detect deploy/update tool calls and start live progress tracking
                  if (
                    parsed.toolName === 'mcp__dexter-x402__deploy_x402' ||
                    parsed.toolName === 'mcp__dexter-x402__update_x402'
                  ) {
                    const input = parsed.toolInput as Record<string, unknown> | undefined;
                    const name = (input?.name as string) || 'resource';
                    const resId = (input?.resourceId as string) || '';

                    // For updates, we know the resourceId immediately -- start live tracking
                    if (resId) {
                      import('~/lib/stores/deployProgress').then(({ startDeployProgress }) => {
                        startDeployProgress(resId, name);
                      });
                    }

                    /*
                     * For new deploys (no resId), we wait for the result text to contain
                     * the resourceId (res-xxx pattern) and start tracking then.
                     * This is handled in the 'text' handler below.
                     */
                  }
                } else if (parsed.type === 'system' && parsed.sessionId) {
                  sessionIdRef.current = parsed.sessionId;
                } else if (parsed.type === 'final' && parsed.result) {
                  console.log(
                    `[SSE-Client] FINAL event received. result.result length=${parsed.result.result?.length || 0}, assistantContent before final=${assistantContent.length}`,
                  );

                  // Final update
                  if (parsed.result.result) {
                    assistantContent = parsed.result.result;
                    setMessages((prev) =>
                      prev.map((m) => (m.id === assistantMessageId ? { ...m, content: assistantContent } : m)),
                    );
                  }

                  sessionIdRef.current = parsed.result.sessionId;

                  // Store usage info for onFinish callback
                  if (parsed.result.usage) {
                    responseMetaRef.current = {
                      usage: {
                        promptTokens: parsed.result.usage.inputTokens,
                        completionTokens: parsed.result.usage.outputTokens,
                        totalTokens: (parsed.result.usage.inputTokens || 0) + (parsed.result.usage.outputTokens || 0),
                      },
                    };
                  }
                } else if (parsed.type === 'error') {
                  throw new Error(parsed.content);
                }

                setData((prev) => [...(prev || []), parsed as JSONValue]);
              } catch {
                // Ignore parse errors for malformed chunks
              }
            }
          }
        }

        // Ensure final content is displayed (process any remaining buffer)
        if (sseBuffer.startsWith('data: ')) {
          try {
            const parsed = JSON.parse(sseBuffer.slice(6));

            if (parsed.type === 'text') {
              assistantContent += parsed.content;
            }
          } catch {
            // Ignore
          }
        }

        // Final sync to ensure all content is displayed
        console.log(
          `%c[SSE] Stream complete. ${clientEventCount} events, assistantContent=${assistantContent.length} chars`,
          'color: #60a5fa; font-weight: bold',
        );
        setMessages((prev) => prev.map((m) => (m.id === assistantMessageId ? { ...m, content: assistantContent } : m)));

        // Call onFinish with the final assistant message and response meta
        const finalMessage: Message = {
          id: assistantMessageId,
          role: 'assistant',
          content: assistantContent,
          createdAt: new Date(),
        };
        onFinish?.(finalMessage, responseMetaRef.current);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          console.log('%c[SSE] Stream aborted by user', 'color: #f59e0b');

          return;
        }

        console.error(
          '%c[SSE] Stream error:',
          'color: #ef4444; font-weight: bold',
          err instanceof Error ? err.message : err,
        );

        const error = err instanceof Error ? err : new Error('Unknown error');
        setError(error);
        onError?.(error);
      } finally {
        resetAgentActivity();
        setIsLoading(false);
        abortControllerRef.current = null;
      }
    },
    [api, body, headers, onFinish, onError, onResponse],
  );

  /**
   * Send a message to the API without creating a new user message.
   * Used for hidden continuation messages (like template prompts) where we want
   * to trigger the AI response without adding a new visible message.
   */
  const sendMessageWithoutNewUserMessage = useCallback(
    async (content: string, existingMessages: Message[]) => {
      if (!content.trim()) {
        console.warn('[useChat.sendMessageWithoutNewUserMessage] Empty content, skipping');
        return;
      }

      debugLog('sendMessageWithoutNewUserMessage: Sending to API (no new user message)');
      debugLog('sendMessageWithoutNewUserMessage: Existing messages count:', existingMessages.length);

      setError(undefined);
      setIsLoading(true);

      /*
       * Don't add a new user message - just use the existing messages
       * Create abort controller
       */
      abortControllerRef.current = new AbortController();

      try {
        const response = await fetch(api, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...headers,
          },
          body: JSON.stringify({
            prompt: content,
            sessionId: sessionIdRef.current,
            ...body,
          }),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP error: ${response.status}`);
        }

        onResponse?.(response);

        // Handle SSE stream
        const reader = response.body?.getReader();

        if (!reader) {
          throw new Error('No response body');
        }

        const decoder = new TextDecoder();
        let assistantContent = '';
        const assistantMessageId = generateId();

        // Add placeholder assistant message
        setMessages((prev) => [
          ...prev,
          {
            id: assistantMessageId,
            role: 'assistant',
            content: '',
            createdAt: new Date(),
          },
        ]);

        // Create throttled updater for smooth streaming
        const throttledUpdate = createThrottledUpdater((updatedContent: string) => {
          setMessages((prev) => prev.map((m) => (m.id === assistantMessageId ? { ...m, content: updatedContent } : m)));
        }, 16);

        let sseBuffer = '';

        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          const chunk = decoder.decode(value, { stream: true });
          sseBuffer += chunk;

          const lines = sseBuffer.split('\n');
          sseBuffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);

              if (data === '[DONE]') {
                continue;
              }

              try {
                const parsed = JSON.parse(data);

                if (parsed.type === 'text') {
                  if (
                    assistantContent.length > 0 &&
                    parsed.content.length > 0 &&
                    !assistantContent.endsWith('\n') &&
                    !assistantContent.endsWith(' ') &&
                    !parsed.content.startsWith('\n') &&
                    !parsed.content.startsWith(' ')
                  ) {
                    assistantContent += '\n\n';
                  }

                  assistantContent += parsed.content;

                  // Detect resourceId in agent response and start deploy verification
                  const resIdMatch = assistantContent.match(/\bres-[a-z0-9]+-[a-z0-9]+\b/);

                  if (resIdMatch) {
                    const detectedResId = resIdMatch[0];
                    debugLog('DeployVerification:reload: Detected resourceId:', detectedResId);
                    import('~/lib/stores/deployProgress').then(({ startDeployProgress, $activeDeploys }) => {
                      if (!$activeDeploys.get().has(detectedResId)) {
                        debugLog('DeployVerification:reload: Starting progress for', detectedResId);
                        startDeployProgress(detectedResId, detectedResId);
                      }
                    });
                  }

                  throttledUpdate(assistantContent);
                } else if (parsed.type === 'system' && parsed.sessionId) {
                  sessionIdRef.current = parsed.sessionId;
                } else if (parsed.type === 'final' && parsed.result) {
                  if (parsed.result.result) {
                    assistantContent = parsed.result.result;
                    setMessages((prev) =>
                      prev.map((m) => (m.id === assistantMessageId ? { ...m, content: assistantContent } : m)),
                    );
                  }

                  sessionIdRef.current = parsed.result.sessionId;

                  if (parsed.result.usage) {
                    responseMetaRef.current = {
                      usage: {
                        promptTokens: parsed.result.usage.inputTokens,
                        completionTokens: parsed.result.usage.outputTokens,
                        totalTokens: (parsed.result.usage.inputTokens || 0) + (parsed.result.usage.outputTokens || 0),
                      },
                    };
                  }
                } else if (parsed.type === 'error') {
                  throw new Error(parsed.content);
                }

                setData((prev) => [...(prev || []), parsed]);
              } catch {
                // Ignore parse errors for malformed chunks
              }
            }
          }
        }

        // Call onFinish with the final assistant message
        const finalMessage: Message = {
          id: assistantMessageId,
          role: 'assistant',
          content: assistantContent,
          createdAt: new Date(),
        };
        onFinish?.(finalMessage, responseMetaRef.current);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }

        const error = err instanceof Error ? err : new Error('Unknown error');
        setError(error);
        onError?.(error);
      } finally {
        setIsLoading(false);
        abortControllerRef.current = null;
      }
    },
    [api, body, headers, onFinish, onError, onResponse, setMessages],
  );

  const handleSubmit = useCallback(
    (e?: React.FormEvent<HTMLFormElement>, _options?: { data?: Record<string, string> }) => {
      e?.preventDefault();
      sendMessage(input, messagesRef.current);
      setInput('');
    },
    [input, sendMessage],
  );

  const append = useCallback(
    async (message: Message | { role: 'user'; content: string }, options?: ChatRequestOptions) => {
      const content = message.content;

      // Store attachments in body for the request if provided
      if (options?.experimental_attachments) {
        /*
         * Add attachments to the message or include in request body
         * For now, we send them as part of the body override
         */
      }

      // Use ref for latest messages (avoids stale closure issue)
      await sendMessage(content, messagesRef.current);
    },
    [sendMessage],
  );

  const reload = useCallback(
    async (_options?: ChatRequestOptions) => {
      // Use ref for latest messages (avoids stale closure issue when called right after setMessages)
      const currentMessages = messagesRef.current;

      chatHookLogger.info('=== RELOAD CALLED ===');
      chatHookLogger.info('Current message count:', currentMessages.length);
      currentMessages.forEach((msg, idx) => {
        chatHookLogger.info(
          `  Message ${idx}: role=${msg.role}, hasHiddenAnnotation=${msg.annotations?.includes('hidden')}, content=${msg.content.substring(0, 60)}...`,
        );
      });

      /*
       * Get the last user message and resend
       * For hidden messages (like template continuations), we send the content but keep the message hidden
       */
      const lastUserMessageIndex = currentMessages.findLastIndex((m) => m.role === 'user');

      if (lastUserMessageIndex === -1) {
        chatHookLogger.warn('No user message found to reload');
        return;
      }

      const lastUserMessage = currentMessages[lastUserMessageIndex];
      const isHiddenMessage = lastUserMessage.annotations?.includes('hidden');

      chatHookLogger.info('Last user message index:', lastUserMessageIndex);
      chatHookLogger.info('Is hidden message:', isHiddenMessage);
      chatHookLogger.info('Last user message content:', lastUserMessage.content.slice(0, 100) + '...');

      /*
       * If this is a hidden message (like template continuation), don't replace it
       * Just send to API and add the response
       */
      if (isHiddenMessage) {
        chatHookLogger.info('Handling hidden continuation message - sending to API without replacing');

        // Send all messages to API (hidden message included for context)
        await sendMessageWithoutNewUserMessage(lastUserMessage.content, currentMessages);

        return;
      }

      // For visible messages, proceed with normal reload behavior
      const previousMessages = currentMessages.slice(0, lastUserMessageIndex);
      chatHookLogger.info('Previous messages count:', previousMessages.length);

      setMessages(previousMessages);

      // Options could include attachments for the reload
      await sendMessage(lastUserMessage.content, previousMessages);
    },
    [sendMessage, sendMessageWithoutNewUserMessage, setMessages],
  );

  /**
   * Add a tool result back into the conversation
   * This is used when tools need user interaction or async completion
   */
  const addToolResult = useCallback(({ toolCallId, result }: ToolResultInput) => {
    // Update messages to include the tool result
    setMessages((prev) =>
      prev.map((message) => {
        if (message.toolInvocations) {
          return {
            ...message,
            toolInvocations: message.toolInvocations.map((invocation) =>
              invocation.toolCallId === toolCallId ? { ...invocation, state: 'result' as const, result } : invocation,
            ),
          };
        }

        return message;
      }),
    );
  }, []);

  return {
    messages,
    setMessages,
    input,
    setInput,
    handleInputChange,
    handleSubmit,
    isLoading,
    error,
    stop,
    reload,
    append,
    data,
    setData,
    addToolResult,
  };
}

// Re-export for compatibility
export default useChat;
