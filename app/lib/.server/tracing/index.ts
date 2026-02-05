/**
 * Dexter Lab Server-Side Tracing System
 *
 * Comprehensive tracing for debugging agent workflows, x402 resource creation,
 * and deployment pipelines. Designed to be:
 * - Searchable by grep/text tools (AI-friendly debugging)
 * - Correlated by sessionId and traceId
 * - Persistent to both console and file for post-mortem analysis
 *
 * Log format: [TIMESTAMP] [LEVEL] [TRACE_ID] [CATEGORY] message {json_data}
 *
 * Note: File logging is optional and will gracefully degrade if unavailable
 * (e.g., in Cloudflare Workers environment without full Node.js compat)
 */

// Node.js modules for file logging (server-side only)
import * as fs from 'fs';
import * as path from 'path';

// Log levels with numeric priority for filtering
export enum LogLevel {
  TRACE = 0, // Extremely detailed, every step
  DEBUG = 1, // Debugging info
  INFO = 2, // Normal operations
  WARN = 3, // Warnings
  ERROR = 4, // Errors
  FATAL = 5, // Critical failures
}

// Categories for filtering and searching
export type LogCategory =
  | 'AGENT' // Agent prompts, responses, decisions
  | 'AGENT_TOOL' // Tool calls and results
  | 'AGENT_COST' // Cost tracking
  | 'X402_CREATE' // Resource creation steps
  | 'X402_VALIDATE' // Validation steps
  | 'X402_DEPLOY' // Deployment pipeline
  | 'X402_RUNTIME' // Runtime execution
  | 'PROXY_API' // Proxy API calls
  | 'SESSION' // Session management
  | 'ERROR'; // Errors and exceptions

// Structured log entry
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  levelName: string;
  traceId: string;
  sessionId?: string;
  category: LogCategory;
  message: string;
  data?: Record<string, unknown>;
  durationMs?: number;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

// Span for tracking operation duration
export interface Span {
  traceId: string;
  spanId: string;
  name: string;
  category: LogCategory;
  startTime: number;
  data: Record<string, unknown>;
  end: (result?: Record<string, unknown>) => void;
  error: (err: Error, data?: Record<string, unknown>) => void;
}

// Configuration
interface TracerConfig {
  minLevel: LogLevel;
  logToConsole: boolean;
  logToFile: boolean;
  logDir: string;
  maxFileSize: number; // bytes
  prettyPrint: boolean;
}

// Default config
const defaultConfig: TracerConfig = {
  minLevel: LogLevel.TRACE, // Capture EVERYTHING by default
  logToConsole: true,
  logToFile: true,
  logDir: process.env.DEXTER_LOG_DIR || '/tmp/dexter-lab-logs',
  maxFileSize: 50 * 1024 * 1024, // 50MB per file
  prettyPrint: process.env.NODE_ENV !== 'production',
};

class DexterTracer {
  private _config: TracerConfig;
  private _fileStream: NodeJS.WritableStream | null = null;
  private _currentFileSize = 0;
  private _fileIndex = 0;
  private _activeSpans = new Map<string, Span>();

  constructor(config: Partial<TracerConfig> = {}) {
    this._config = { ...defaultConfig, ...config };
    this._initializeFileLogging();
  }

  private _initializeFileLogging(): void {
    if (!this._config.logToFile) {
      return;
    }

    try {
      if (!fs.existsSync(this._config.logDir)) {
        fs.mkdirSync(this._config.logDir, { recursive: true });
      }

      this._openLogFile();
    } catch (err) {
      console.error('[TRACER] Failed to initialize file logging:', err);
      this._config.logToFile = false;
    }
  }

  private _openLogFile(): void {
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `dexter-lab-${timestamp}-${this._fileIndex}.jsonl`;
    const filepath = path.join(this._config.logDir, filename);

    this._fileStream = fs.createWriteStream(filepath, { flags: 'a' });
    this._currentFileSize = 0;

    // Write header
    const header = {
      type: 'LOG_FILE_START',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      config: {
        minLevel: LogLevel[this._config.minLevel],
      },
    };
    this._fileStream.write(JSON.stringify(header) + '\n');
  }

  private _rotateFileIfNeeded(entrySize: number): void {
    if (!this._fileStream) {
      return;
    }

    this._currentFileSize += entrySize;

    if (this._currentFileSize >= this._config.maxFileSize) {
      this._fileStream.end();
      this._fileIndex++;
      this._openLogFile();
    }
  }

  /**
   * Generate a unique trace ID
   */
  generateTraceId(): string {
    return `trc_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
  }

  /**
   * Generate a unique span ID
   */
  private _generateSpanId(): string {
    return `spn_${Math.random().toString(36).substring(2, 10)}`;
  }

  /**
   * Core logging function
   */
  log(
    level: LogLevel,
    category: LogCategory,
    message: string,
    options: {
      traceId?: string;
      sessionId?: string;
      data?: Record<string, unknown>;
      durationMs?: number;
      error?: Error;
    } = {},
  ): void {
    if (level < this._config.minLevel) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      levelName: LogLevel[level],
      traceId: options.traceId || 'no-trace',
      sessionId: options.sessionId,
      category,
      message,
      data: options.data,
      durationMs: options.durationMs,
      error: options.error
        ? {
            name: options.error.name,
            message: options.error.message,
            stack: options.error.stack,
          }
        : undefined,
    };

    // Console output
    if (this._config.logToConsole) {
      this._writeToConsole(entry);
    }

    // File output
    if (this._config.logToFile && this._fileStream) {
      const jsonLine = JSON.stringify(entry) + '\n';
      this._rotateFileIfNeeded(jsonLine.length);
      this._fileStream.write(jsonLine);
    }
  }

  private _writeToConsole(entry: LogEntry): void {
    const levelColors: Record<LogLevel, string> = {
      [LogLevel.TRACE]: '\x1b[90m', // Gray
      [LogLevel.DEBUG]: '\x1b[36m', // Cyan
      [LogLevel.INFO]: '\x1b[32m', // Green
      [LogLevel.WARN]: '\x1b[33m', // Yellow
      [LogLevel.ERROR]: '\x1b[31m', // Red
      [LogLevel.FATAL]: '\x1b[35m', // Magenta
    };
    const reset = '\x1b[0m';
    const color = levelColors[entry.level];

    // Format: [TIMESTAMP] [LEVEL] [TRACE_ID] [CATEGORY] message
    const prefix = `${color}[${entry.timestamp}] [${entry.levelName.padEnd(5)}] [${entry.traceId}] [${entry.category}]${reset}`;

    if (this._config.prettyPrint && entry.data) {
      console.log(`${prefix} ${entry.message}`);
      console.log('  Data:', JSON.stringify(entry.data, null, 2).split('\n').join('\n  '));

      if (entry.durationMs !== undefined) {
        console.log(`  Duration: ${entry.durationMs}ms`);
      }

      if (entry.error) {
        console.log(`  Error: ${entry.error.name}: ${entry.error.message}`);

        if (entry.error.stack) {
          console.log(`  Stack:\n    ${entry.error.stack.split('\n').join('\n    ')}`);
        }
      }
    } else {
      const dataStr = entry.data ? ` ${JSON.stringify(entry.data)}` : '';
      const durationStr = entry.durationMs !== undefined ? ` [${entry.durationMs}ms]` : '';
      const errorStr = entry.error ? ` ERROR: ${entry.error.message}` : '';
      console.log(`${prefix} ${entry.message}${dataStr}${durationStr}${errorStr}`);
    }
  }

  /**
   * Start a span for tracking operation duration
   */
  startSpan(
    name: string,
    category: LogCategory,
    options: {
      traceId?: string;
      sessionId?: string;
      data?: Record<string, unknown>;
    } = {},
  ): Span {
    const traceId = options.traceId || this.generateTraceId();
    const spanId = this._generateSpanId();
    const startTime = Date.now();

    this.log(LogLevel.DEBUG, category, `[SPAN START] ${name}`, {
      traceId,
      sessionId: options.sessionId,
      data: { spanId, ...options.data },
    });

    const span: Span = {
      traceId,
      spanId,
      name,
      category,
      startTime,
      data: options.data || {},
      end: (result?: Record<string, unknown>) => {
        const durationMs = Date.now() - startTime;
        this.log(LogLevel.DEBUG, category, `[SPAN END] ${name}`, {
          traceId,
          sessionId: options.sessionId,
          data: { spanId, ...result },
          durationMs,
        });
        this._activeSpans.delete(spanId);
      },
      error: (err: Error, data?: Record<string, unknown>) => {
        const durationMs = Date.now() - startTime;
        this.log(LogLevel.ERROR, category, `[SPAN ERROR] ${name}`, {
          traceId,
          sessionId: options.sessionId,
          data: { spanId, ...data },
          durationMs,
          error: err,
        });
        this._activeSpans.delete(spanId);
      },
    };

    this._activeSpans.set(spanId, span);

    return span;
  }

  // Convenience methods for different log levels
  trace(category: LogCategory, message: string, options?: Parameters<DexterTracer['log']>[3]) {
    this.log(LogLevel.TRACE, category, message, options);
  }

  debug(category: LogCategory, message: string, options?: Parameters<DexterTracer['log']>[3]) {
    this.log(LogLevel.DEBUG, category, message, options);
  }

  info(category: LogCategory, message: string, options?: Parameters<DexterTracer['log']>[3]) {
    this.log(LogLevel.INFO, category, message, options);
  }

  warn(category: LogCategory, message: string, options?: Parameters<DexterTracer['log']>[3]) {
    this.log(LogLevel.WARN, category, message, options);
  }

  error(category: LogCategory, message: string, options?: Parameters<DexterTracer['log']>[3]) {
    this.log(LogLevel.ERROR, category, message, options);
  }

  fatal(category: LogCategory, message: string, options?: Parameters<DexterTracer['log']>[3]) {
    this.log(LogLevel.FATAL, category, message, options);
  }

  /**
   * Flush any pending writes
   */
  async flush(): Promise<void> {
    return new Promise((resolve) => {
      if (this._fileStream) {
        this._fileStream.once('drain', resolve);
        this._fileStream.write('');
      } else {
        resolve();
      }
    });
  }

  /**
   * Close the tracer
   */
  close(): void {
    if (this._fileStream) {
      this._fileStream.end();
      this._fileStream = null;
    }
  }
}

// Export singleton instance
export const tracer = new DexterTracer();

// Export class for testing/custom instances
export { DexterTracer };

/*
 * ============================================================================
 * AGENT-SPECIFIC TRACING HELPERS
 * ============================================================================
 */

/**
 * Trace an agent prompt
 */
export function traceAgentPrompt(
  traceId: string,
  sessionId: string,
  prompt: string,
  options?: { model?: string; additionalInstructions?: string },
): void {
  tracer.info('AGENT', 'User prompt received', {
    traceId,
    sessionId,
    data: {
      promptLength: prompt.length,
      promptPreview: prompt.substring(0, 500) + (prompt.length > 500 ? '...' : ''),
      model: options?.model,
      hasAdditionalInstructions: !!options?.additionalInstructions,
    },
  });
}

/**
 * Trace an agent response chunk (for streaming)
 */
export function traceAgentResponseChunk(
  traceId: string,
  sessionId: string,
  chunk: { type: string; content?: string },
): void {
  tracer.trace('AGENT', `Response chunk: ${chunk.type}`, {
    traceId,
    sessionId,
    data: {
      type: chunk.type,
      contentLength: chunk.content?.length,
    },
  });
}

/**
 * Trace agent completion
 */
export function traceAgentComplete(
  traceId: string,
  sessionId: string,
  result: {
    success: boolean;
    totalCostUsd?: number;
    numTurns?: number;
    usage?: Record<string, unknown>;
    durationMs: number;
  },
): void {
  tracer.info('AGENT', 'Agent run completed', {
    traceId,
    sessionId,
    data: result,
    durationMs: result.durationMs,
  });

  // Separate cost tracking for easy searching
  if (result.totalCostUsd !== undefined) {
    tracer.info('AGENT_COST', `Cost: $${result.totalCostUsd.toFixed(6)}`, {
      traceId,
      sessionId,
      data: {
        costUsd: result.totalCostUsd,
        turns: result.numTurns,
        usage: result.usage,
      },
    });
  }
}

/**
 * Trace a tool call
 */
export function traceToolCall(
  traceId: string,
  sessionId: string,
  toolName: string,
  args: Record<string, unknown>,
): void {
  tracer.debug('AGENT_TOOL', `Tool call: ${toolName}`, {
    traceId,
    sessionId,
    data: {
      tool: toolName,
      args: sanitizeForLogging(args),
    },
  });
}

/**
 * Trace a tool result
 */
export function traceToolResult(
  traceId: string,
  sessionId: string,
  toolName: string,
  result: { success: boolean; data?: unknown; error?: string },
  durationMs: number,
): void {
  const level = result.success ? LogLevel.DEBUG : LogLevel.WARN;
  tracer.log(level, 'AGENT_TOOL', `Tool result: ${toolName}`, {
    traceId,
    sessionId,
    data: {
      tool: toolName,
      success: result.success,
      resultPreview: result.data ? JSON.stringify(result.data).substring(0, 500) : undefined,
      error: result.error,
    },
    durationMs,
  });
}

/*
 * ============================================================================
 * X402 RESOURCE TRACING HELPERS
 * ============================================================================
 */

/**
 * Trace x402 resource creation start
 */
export function traceX402CreateStart(
  traceId: string,
  sessionId: string,
  config: {
    name: string;
    type: string;
    pricingModel: string;
    basePriceUsdc: number;
    endpoints: Array<{ path: string; method: string }>;
  },
): void {
  tracer.info('X402_CREATE', 'Starting x402 resource creation', {
    traceId,
    sessionId,
    data: config,
  });
}

/**
 * Trace x402 validation
 */
export function traceX402Validation(
  traceId: string,
  sessionId: string,
  result: {
    isValid: boolean;
    errors: string[];
    warnings: string[];
    structure: Record<string, boolean>;
  },
): void {
  const level = result.isValid ? LogLevel.INFO : LogLevel.WARN;
  tracer.log(level, 'X402_VALIDATE', `Validation ${result.isValid ? 'passed' : 'failed'}`, {
    traceId,
    sessionId,
    data: result,
  });
}

/**
 * Trace x402 deployment step
 */
export function traceX402DeployStep(
  traceId: string,
  sessionId: string,
  step: string,
  status: 'start' | 'success' | 'error',
  data?: Record<string, unknown>,
): void {
  const level = status === 'error' ? LogLevel.ERROR : LogLevel.INFO;
  tracer.log(level, 'X402_DEPLOY', `[${status.toUpperCase()}] ${step}`, {
    traceId,
    sessionId,
    data,
  });
}

/**
 * Trace x402 deployment complete
 */
export function traceX402DeployComplete(
  traceId: string,
  sessionId: string,
  result: {
    success: boolean;
    resourceId?: string;
    publicUrl?: string;
    error?: string;
    durationMs: number;
  },
): void {
  const level = result.success ? LogLevel.INFO : LogLevel.ERROR;
  tracer.log(level, 'X402_DEPLOY', `Deployment ${result.success ? 'succeeded' : 'failed'}`, {
    traceId,
    sessionId,
    data: result,
    durationMs: result.durationMs,
  });
}

/*
 * ============================================================================
 * PROXY API TRACING
 * ============================================================================
 */

/**
 * Trace proxy API call
 */
export function traceProxyCall(
  traceId: string,
  sessionId: string,
  provider: string,
  endpoint: string,
  method: string,
): void {
  tracer.debug('PROXY_API', `${method} ${provider}${endpoint}`, {
    traceId,
    sessionId,
    data: { provider, endpoint, method },
  });
}

/**
 * Trace proxy API result
 */
export function traceProxyResult(
  traceId: string,
  sessionId: string,
  provider: string,
  success: boolean,
  statusCode?: number,
  durationMs?: number,
): void {
  const level = success ? LogLevel.DEBUG : LogLevel.WARN;
  tracer.log(level, 'PROXY_API', `${provider} response: ${statusCode || 'error'}`, {
    traceId,
    sessionId,
    data: { provider, success, statusCode },
    durationMs,
  });
}

/*
 * ============================================================================
 * UTILITY FUNCTIONS
 * ============================================================================
 */

/**
 * Sanitize sensitive data for logging
 */
function sanitizeForLogging(data: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = ['apiKey', 'secret', 'password', 'token', 'privateKey', 'authorization'];
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (sensitiveKeys.some((k) => key.toLowerCase().includes(k.toLowerCase()))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeForLogging(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Create a trace context for a request
 */
export function createTraceContext(sessionId?: string): {
  traceId: string;
  sessionId: string;
} {
  return {
    traceId: tracer.generateTraceId(),
    sessionId: sessionId || `sess_${Date.now().toString(36)}`,
  };
}
