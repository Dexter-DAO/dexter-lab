/**
 * UI Utils Types
 *
 * These types replace @ai-sdk/ui-utils types for compatibility.
 */

export interface TextUIPart {
  type: 'text';
  text: string;
}

export interface FileUIPart {
  type: 'file';
  mimeType: string;
  data: string;
}

export interface ImageUIPart {
  type: 'image';
  image: string | Uint8Array | Buffer | ArrayBuffer | URL;
  mimeType?: string;
}

export interface ToolCallUIPart {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  args: unknown;
}

export interface ToolResultUIPart {
  type: 'tool-result';
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError?: boolean;
}

export interface ReasoningUIPart {
  type: 'reasoning';
  reasoning: string;
}

export interface ToolInvocationUIPart {
  type: 'tool-invocation';
  toolInvocation: {
    state: 'partial-call' | 'call' | 'result';
    toolCallId: string;
    toolName: string;
    args?: unknown;
    result?: unknown;
  };
}

export interface SourceUIPart {
  type: 'source';
  source: {
    type: string;
    url?: string;
    title?: string;
  };
}

export interface StepStartUIPart {
  type: 'step-start';
  stepId: string;
}

export type UIPart =
  | TextUIPart
  | FileUIPart
  | ImageUIPart
  | ToolCallUIPart
  | ToolResultUIPart
  | ReasoningUIPart
  | ToolInvocationUIPart
  | SourceUIPart
  | StepStartUIPart;

/**
 * Parts type alias that includes ImageUIPart for component compatibility
 */
export type MessageParts = (
  | TextUIPart
  | FileUIPart
  | ImageUIPart
  | ReasoningUIPart
  | ToolInvocationUIPart
  | SourceUIPart
  | StepStartUIPart
)[];

export interface Attachment {
  name?: string;
  contentType?: string;
  url: string;
}
