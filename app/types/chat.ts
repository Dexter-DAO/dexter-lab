/**
 * Dexter Lab Chat Types
 * 
 * These types replace the 'ai' package types for chat messages.
 * Compatible with both the old Vercel AI SDK format and Claude Agent SDK.
 */

/**
 * Content part types for multi-modal messages
 * These match the UI part types from @ai-sdk/ui-utils
 */
export interface TextPart {
  type: 'text';
  text: string;
}

export interface ImagePart {
  type: 'image';
  image: string | Uint8Array | Buffer | ArrayBuffer | URL;
  mimeType?: string;
  /** Base64 or URL data for UI compatibility */
  data?: string;
}

export interface FilePart {
  type: 'file';
  data: string;
  mimeType: string;
}

export interface ToolCallPart {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  args: unknown;
}

export interface ToolResultPart {
  type: 'tool-result';
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError?: boolean;
}

export interface ReasoningPart {
  type: 'reasoning';
  reasoning: string;
}

export interface ToolInvocationPart {
  type: 'tool-invocation';
  toolInvocation: {
    state: 'partial-call' | 'call' | 'result';
    toolCallId: string;
    toolName: string;
    args?: unknown;
    result?: unknown;
  };
}

export interface SourcePart {
  type: 'source';
  source: {
    type: string;
    url?: string;
    title?: string;
  };
}

export interface StepStartPart {
  type: 'step-start';
  stepId: string;
}

export type MessagePart = 
  | TextPart 
  | ImagePart 
  | FilePart 
  | ToolCallPart 
  | ToolResultPart 
  | ReasoningPart 
  | ToolInvocationPart 
  | SourcePart 
  | StepStartPart;

/**
 * Message role types
 */
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

/**
 * Core Message type - replaces 'Message' from 'ai' package
 */
export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  createdAt?: Date;
  
  // Multi-modal content parts (optional)
  parts?: MessagePart[];
  
  // Tool invocations for assistant messages
  toolInvocations?: ToolInvocation[];
  
  // Experimental attachments
  experimental_attachments?: Attachment[];
  
  // Annotations for metadata
  annotations?: MessageAnnotation[];
}

/**
 * Tool invocation tracking
 */
export interface ToolInvocation {
  state: 'partial-call' | 'call' | 'result';
  toolCallId: string;
  toolName: string;
  args?: unknown;
  result?: unknown;
}

/**
 * File attachments
 */
export interface Attachment {
  name?: string;
  contentType?: string;
  url: string;
}

import type { JSONValue, JSONObject } from './json';

/**
 * Message annotations for metadata
 * Can be a string (e.g., 'no-store', 'hidden') or a JSON object with type
 */
export type MessageAnnotation = JSONValue;

/**
 * Generate a unique message ID
 */
export function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Create a user message
 */
export function createUserMessage(content: string, id?: string): Message {
  return {
    id: id || generateId(),
    role: 'user',
    content,
    createdAt: new Date(),
  };
}

/**
 * Create an assistant message
 */
export function createAssistantMessage(content: string, id?: string): Message {
  return {
    id: id || generateId(),
    role: 'assistant',
    content,
    createdAt: new Date(),
  };
}

/**
 * Create a system message
 */
export function createSystemMessage(content: string, id?: string): Message {
  return {
    id: id || generateId(),
    role: 'system',
    content,
    createdAt: new Date(),
  };
}

/**
 * Convert messages to core format (for LLM APIs)
 */
export function convertToCoreMessages(messages: Message[]): Array<{
  role: MessageRole;
  content: string | MessagePart[];
}> {
  return messages.map((msg) => ({
    role: msg.role,
    content: msg.parts && msg.parts.length > 0 ? msg.parts : msg.content,
  }));
}

/**
 * Extract text content from a message (handles both string and parts array)
 */
export function extractTextContent(message: Message): string {
  if (typeof message.content === 'string') {
    return message.content;
  }
  
  if (Array.isArray(message.parts)) {
    const textPart = message.parts.find((p): p is TextPart => p.type === 'text');
    return textPart?.text || '';
  }
  
  return '';
}

/**
 * Type guard for checking if content is a string
 */
export function isStringContent(content: unknown): content is string {
  return typeof content === 'string';
}

/**
 * Type guard for Message
 */
export function isMessage(obj: unknown): obj is Message {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'id' in obj &&
    'role' in obj &&
    'content' in obj
  );
}
