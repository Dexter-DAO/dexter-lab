import { atom } from 'nanostores';

/**
 * Tracks the current agent tool activity for live visibility in the chat UI.
 * Updated by useChat.ts when tool_use SSE events arrive.
 * Consumed by AgentActivityIndicator component.
 */

export interface AgentActivity {
  /** Raw tool name from the SSE event */
  toolName: string;

  /** Human-readable label for display */
  label: string;

  /** Timestamp when this activity started */
  startedAt: number;
}

/** Current agent activity (null when idle or streaming text) */
export const $agentActivity = atom<AgentActivity | null>(null);

/** History of recent activities for a subtle trail effect */
export const $agentActivityHistory = atom<AgentActivity[]>([]);

const MAX_HISTORY = 5;

/**
 * Map raw MCP/SDK tool names to human-readable labels.
 */
function humanizeToolName(toolName: string, toolInput?: Record<string, unknown>): string {
  // MCP deploy/update tools
  if (toolName === 'mcp__dexter-x402__deploy_x402') {
    const name = (toolInput?.name as string) || 'resource';
    return `Deploying ${name}...`;
  }

  if (toolName === 'mcp__dexter-x402__update_x402') {
    return 'Updating resource...';
  }

  if (toolName === 'mcp__dexter-x402__deployment_status') {
    return 'Checking deployment status...';
  }

  if (toolName === 'mcp__dexter-x402__validate_x402') {
    return 'Validating x402 configuration...';
  }

  if (toolName === 'mcp__dexter-x402__x402_sdk_docs') {
    return 'Reading SDK documentation...';
  }

  if (toolName === 'mcp__dexter-x402__proxy_api') {
    return 'Calling proxy API...';
  }

  // File operations
  if (toolName === 'Read') {
    const path = toolInput?.file_path as string;

    if (path) {
      const filename = path.split('/').pop() || path;
      return `Reading ${filename}`;
    }

    return 'Reading file...';
  }

  if (toolName === 'Edit' || toolName === 'Write') {
    const path = (toolInput?.file_path || toolInput?.filePath) as string;

    if (path) {
      const filename = path.split('/').pop() || path;
      return `Writing ${filename}`;
    }

    return 'Writing code...';
  }

  if (toolName === 'Glob') {
    return 'Searching files...';
  }

  if (toolName === 'Grep') {
    return 'Searching code...';
  }

  // Shell/Bash
  if (toolName === 'Bash') {
    const cmd = toolInput?.command as string;

    if (cmd) {
      // Show first meaningful word of the command
      const firstWord = cmd.trim().split(/\s+/)[0];

      if (firstWord === 'npm' || firstWord === 'pnpm') {
        return 'Running package manager...';
      }

      if (firstWord === 'docker') {
        return 'Running Docker...';
      }

      if (firstWord === 'curl') {
        return 'Making HTTP request...';
      }

      return `Running ${firstWord}...`;
    }

    return 'Running command...';
  }

  // Fallback: clean up the tool name
  return `${toolName.replace(/^mcp__\w+__/, '').replace(/_/g, ' ')}...`;
}

/**
 * Called by useChat.ts when a tool_use SSE event arrives.
 */
export function setAgentActivity(toolName: string, toolInput?: Record<string, unknown>): void {
  const activity: AgentActivity = {
    toolName,
    label: humanizeToolName(toolName, toolInput),
    startedAt: Date.now(),
  };

  $agentActivity.set(activity);

  // Add to history, keeping only the last N
  const history = $agentActivityHistory.get();
  $agentActivityHistory.set([...history.slice(-(MAX_HISTORY - 1)), activity]);
}

/**
 * Called when the agent sends text (meaning it's done with tools for now).
 */
export function clearAgentActivity(): void {
  $agentActivity.set(null);
}

/**
 * Called when the agent stream ends.
 */
export function resetAgentActivity(): void {
  $agentActivity.set(null);
  $agentActivityHistory.set([]);
}
