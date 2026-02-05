/**
 * Chat Debugger Utility
 *
 * Comprehensive debugging for the message flow in Dexter Lab.
 * Logs at every critical point so we can trace exactly what's happening.
 */

import { createScopedLogger } from './logger';

const logger = createScopedLogger('chat-debugger');

// Configuration
const DEBUG_CONFIG = {
  enabled: true, // Master switch
  logToConsole: true,
  logMessageContent: true, // Show actual message content (truncated)
  maxContentLength: 300, // Max chars to show in content previews
  logTimestamps: true,
};

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export interface DebugMessage {
  id?: string;
  role: MessageRole;
  content: string;
  annotations?: unknown[];
  parts?: unknown[];
  [key: string]: unknown;
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

function truncateContent(content: string, maxLength: number = DEBUG_CONFIG.maxContentLength): string {
  if (content.length <= maxLength) {
    return content;
  }

  return content.substring(0, maxLength) + '...[TRUNCATED]';
}

function formatMessage(msg: DebugMessage, index: number): string {
  const lines: string[] = [];
  const truncatedContent = DEBUG_CONFIG.logMessageContent
    ? truncateContent(msg.content.replace(/\n/g, '\\n'))
    : '[content logging disabled]';

  lines.push(`  [${index}] Role: ${msg.role}, ID: ${msg.id || 'no-id'}`);
  lines.push(`      Annotations: ${JSON.stringify(msg.annotations || [])}`);
  lines.push(`      Has Parts: ${!!msg.parts}, Parts Count: ${msg.parts?.length || 0}`);
  lines.push(`      Content: ${truncatedContent}`);

  // Check for hidden markers
  if (msg.annotations?.includes('hidden')) {
    lines.push(`      ⚠️ HIDDEN MESSAGE (should not display in UI)`);
  }

  // Check for model/provider prefix
  const hasModelPrefix = msg.content.includes('[Model:');
  const hasProviderPrefix = msg.content.includes('[Provider:');
  lines.push(`      Has Model Prefix: ${hasModelPrefix}, Has Provider Prefix: ${hasProviderPrefix}`);

  return lines.join('\n');
}

/**
 * Debug point: When user submits a message
 */
export function debugUserSubmit(params: {
  input: string;
  chatStarted: boolean;
  isLoading: boolean;
  model: string;
  provider: string;
  hasSelectedElement: boolean;
}): void {
  if (!DEBUG_CONFIG.enabled) {
    return;
  }

  const timestamp = DEBUG_CONFIG.logTimestamps ? `[${formatTimestamp()}] ` : '';

  logger.info(`${timestamp}=== USER SUBMIT ===`);
  logger.info(`  Chat Started: ${params.chatStarted}`);
  logger.info(`  Is Loading: ${params.isLoading}`);
  logger.info(`  Model: ${params.model}`);
  logger.info(`  Provider: ${params.provider}`);
  logger.info(`  Has Selected Element: ${params.hasSelectedElement}`);
  logger.info(`  Input: ${truncateContent(params.input)}`);
}

/**
 * Debug point: Template selection
 */
export function debugTemplateSelection(params: {
  template: string;
  title: string;
  hasAssistantMessage: boolean;
  assistantMessageLength?: number;
  userMessage?: string;
}): void {
  if (!DEBUG_CONFIG.enabled) {
    return;
  }

  const timestamp = DEBUG_CONFIG.logTimestamps ? `[${formatTimestamp()}] ` : '';

  logger.info(`${timestamp}=== TEMPLATE SELECTION ===`);
  logger.info(`  Selected Template: ${params.template}`);
  logger.info(`  Title: ${params.title}`);
  logger.info(`  Has Assistant Message: ${params.hasAssistantMessage}`);

  if (params.assistantMessageLength !== undefined) {
    logger.info(`  Assistant Message Length: ${params.assistantMessageLength}`);
  }

  if (params.userMessage !== undefined) {
    logger.info(`  User Message (from template): ${truncateContent(params.userMessage)}`);
  }
}

/**
 * Debug point: Messages being set before API call
 */
export function debugMessagesSet(messages: DebugMessage[], context: string = 'unknown'): void {
  if (!DEBUG_CONFIG.enabled) {
    return;
  }

  const timestamp = DEBUG_CONFIG.logTimestamps ? `[${formatTimestamp()}] ` : '';

  logger.info(`${timestamp}=== MESSAGES SET (${context}) ===`);
  logger.info(`  Total Messages: ${messages.length}`);

  messages.forEach((msg, idx) => {
    logger.info(formatMessage(msg, idx));
  });

  // Summary
  const hiddenCount = messages.filter((m) => m.annotations?.includes('hidden')).length;
  const userCount = messages.filter((m) => m.role === 'user').length;
  const assistantCount = messages.filter((m) => m.role === 'assistant').length;

  logger.info(`  Summary: ${userCount} user, ${assistantCount} assistant, ${hiddenCount} hidden`);
}

/**
 * Debug point: API request being made
 */
export function debugApiRequest(params: {
  endpoint: string;
  messageCount: number;
  messages: DebugMessage[];
  chatMode?: string;
  model?: string;
  provider?: string;
}): void {
  if (!DEBUG_CONFIG.enabled) {
    return;
  }

  const timestamp = DEBUG_CONFIG.logTimestamps ? `[${formatTimestamp()}] ` : '';

  logger.info(`${timestamp}=== API REQUEST ===`);
  logger.info(`  Endpoint: ${params.endpoint}`);
  logger.info(`  Message Count: ${params.messageCount}`);
  logger.info(`  Chat Mode: ${params.chatMode || 'not specified'}`);
  logger.info(`  Model: ${params.model || 'not specified'}`);
  logger.info(`  Provider: ${params.provider || 'not specified'}`);

  logger.info(`  Messages Being Sent:`);
  params.messages.forEach((msg, idx) => {
    logger.info(formatMessage(msg, idx));
  });
}

/**
 * Debug point: Server-side message receipt
 */
export function debugServerReceipt(params: {
  messages: DebugMessage[];
  hasApiKeys: boolean;
  chatMode?: string;
  contextOptimization?: boolean;
}): void {
  if (!DEBUG_CONFIG.enabled) {
    return;
  }

  const timestamp = DEBUG_CONFIG.logTimestamps ? `[${formatTimestamp()}] ` : '';

  logger.info(`${timestamp}=== SERVER RECEIPT ===`);
  logger.info(`  Has API Keys: ${params.hasApiKeys}`);
  logger.info(`  Chat Mode: ${params.chatMode || 'not specified'}`);
  logger.info(`  Context Optimization: ${params.contextOptimization}`);
  logger.info(`  Message Count: ${params.messages.length}`);

  logger.info(`  Messages Received:`);
  params.messages.forEach((msg, idx) => {
    logger.info(formatMessage(msg, idx));
  });
}

/**
 * Debug point: System prompt being used
 */
export function debugSystemPrompt(params: {
  promptId?: string;
  promptLength: number;
  hasSkills: boolean;
  hasSupabaseConnection: boolean;
  chatMode?: string;
}): void {
  if (!DEBUG_CONFIG.enabled) {
    return;
  }

  const timestamp = DEBUG_CONFIG.logTimestamps ? `[${formatTimestamp()}] ` : '';

  logger.info(`${timestamp}=== SYSTEM PROMPT ===`);
  logger.info(`  Prompt ID: ${params.promptId || 'default'}`);
  logger.info(`  Prompt Length: ${params.promptLength} chars`);
  logger.info(`  Has Skills: ${params.hasSkills}`);
  logger.info(`  Has Supabase Connection: ${params.hasSupabaseConnection}`);
  logger.info(`  Chat Mode: ${params.chatMode || 'not specified'}`);
}

/**
 * Debug point: LLM call being made
 */
export function debugLlmCall(params: {
  model: string;
  provider: string;
  messageCount: number;
  maxTokens?: number;
  temperature?: number;
}): void {
  if (!DEBUG_CONFIG.enabled) {
    return;
  }

  const timestamp = DEBUG_CONFIG.logTimestamps ? `[${formatTimestamp()}] ` : '';

  logger.info(`${timestamp}=== LLM CALL ===`);
  logger.info(`  Model: ${params.model}`);
  logger.info(`  Provider: ${params.provider}`);
  logger.info(`  Message Count: ${params.messageCount}`);

  if (params.maxTokens !== undefined) {
    logger.info(`  Max Tokens: ${params.maxTokens}`);
  }

  if (params.temperature !== undefined) {
    logger.info(`  Temperature: ${params.temperature}`);
  }
}

/**
 * Debug point: Streaming response chunk
 */
export function debugStreamChunk(params: { chunkNumber: number; contentLength: number; finishReason?: string }): void {
  if (!DEBUG_CONFIG.enabled) {
    return;
  }

  // Only log every 10th chunk to avoid spam
  if (params.chunkNumber % 10 !== 0 && !params.finishReason) {
    return;
  }

  const timestamp = DEBUG_CONFIG.logTimestamps ? `[${formatTimestamp()}] ` : '';

  logger.debug(
    `${timestamp}Stream chunk #${params.chunkNumber}: ${params.contentLength} chars${params.finishReason ? `, finish: ${params.finishReason}` : ''}`,
  );
}

/**
 * Debug point: Stream completion
 */
export function debugStreamComplete(params: {
  totalChunks: number;
  totalLength: number;
  finishReason?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}): void {
  if (!DEBUG_CONFIG.enabled) {
    return;
  }

  const timestamp = DEBUG_CONFIG.logTimestamps ? `[${formatTimestamp()}] ` : '';

  logger.info(`${timestamp}=== STREAM COMPLETE ===`);
  logger.info(`  Total Chunks: ${params.totalChunks}`);
  logger.info(`  Total Length: ${params.totalLength} chars`);
  logger.info(`  Finish Reason: ${params.finishReason || 'unknown'}`);

  if (params.usage) {
    logger.info(
      `  Token Usage: prompt=${params.usage.promptTokens}, completion=${params.usage.completionTokens}, total=${params.usage.totalTokens}`,
    );
  }
}

/**
 * Debug point: UI message display
 */
export function debugUiDisplay(params: {
  messages: DebugMessage[];
  hiddenMessages: number;
  displayedMessages: number;
}): void {
  if (!DEBUG_CONFIG.enabled) {
    return;
  }

  const timestamp = DEBUG_CONFIG.logTimestamps ? `[${formatTimestamp()}] ` : '';

  logger.info(`${timestamp}=== UI DISPLAY ===`);
  logger.info(`  Total Messages: ${params.messages.length}`);
  logger.info(`  Hidden: ${params.hiddenMessages}`);
  logger.info(`  Displayed: ${params.displayedMessages}`);
}

/**
 * Debug point: Error occurred
 */
export function debugError(params: {
  context: string;
  error: Error | string;
  additionalInfo?: Record<string, unknown>;
}): void {
  if (!DEBUG_CONFIG.enabled) {
    return;
  }

  const timestamp = DEBUG_CONFIG.logTimestamps ? `[${formatTimestamp()}] ` : '';
  const errorMessage = params.error instanceof Error ? params.error.message : params.error;
  const errorStack = params.error instanceof Error ? params.error.stack : undefined;

  logger.error(`${timestamp}=== ERROR: ${params.context} ===`);
  logger.error(`  Message: ${errorMessage}`);

  if (errorStack) {
    logger.error(`  Stack: ${errorStack.split('\n').slice(0, 3).join('\n    ')}`);
  }

  if (params.additionalInfo) {
    logger.error(`  Additional Info: ${JSON.stringify(params.additionalInfo, null, 2)}`);
  }
}

// Export config for runtime modification
export const debugConfig = DEBUG_CONFIG;
