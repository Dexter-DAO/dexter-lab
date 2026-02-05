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
    api = '/api/chat', // Default to existing chat endpoint for backward compatibility
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

      console.log('[useChat.sendMessage] Sending to API:', api);
      console.log('[useChat.sendMessage] Content:', content.slice(0, 100) + '...');
      console.log('[useChat.sendMessage] Existing messages count:', existingMessages.length);

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

        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);

              if (data === '[DONE]') {
                continue;
              }

              try {
                const parsed = JSON.parse(data);

                // Handle different message types
                if (parsed.type === 'text') {
                  assistantContent += parsed.content;
                  setMessages((prev) =>
                    prev.map((m) => (m.id === assistantMessageId ? { ...m, content: assistantContent } : m)),
                  );
                } else if (parsed.type === 'system' && parsed.sessionId) {
                  sessionIdRef.current = parsed.sessionId;
                } else if (parsed.type === 'final' && parsed.result) {
                  // Update with final result
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
          // Aborted by user
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
    [api, body, headers, onFinish, onError, onResponse],
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

      // Get the last user message and resend
      const lastUserMessageIndex = currentMessages.findLastIndex((m) => m.role === 'user');

      if (lastUserMessageIndex === -1) {
        console.warn('[useChat.reload] No user message found to reload');
        return;
      }

      const lastUserMessage = currentMessages[lastUserMessageIndex];
      const previousMessages = currentMessages.slice(0, lastUserMessageIndex);

      console.log('[useChat.reload] Reloading message:', lastUserMessage.content.slice(0, 100) + '...');

      setMessages(previousMessages);

      // Options could include attachments for the reload
      await sendMessage(lastUserMessage.content, previousMessages);
    },
    [sendMessage, setMessages],
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
