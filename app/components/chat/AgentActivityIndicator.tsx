import { useStore } from '@nanostores/react';
import { $agentActivity, $agentActivityHistory } from '~/lib/stores/agentActivity';
import { memo, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

/**
 * Shows what the agent is currently doing during tool execution.
 * Replaces the generic orange dots with contextual status like
 * "Reading proxy-api-reference.md", "Writing index.ts", "Deploying resource..."
 *
 * Rendered inside Messages.client.tsx when isStreaming is true.
 */
export const AgentActivityIndicator = memo(() => {
  const activity = useStore($agentActivity);
  const history = useStore($agentActivityHistory);
  const [elapsed, setElapsed] = useState(0);

  // Update elapsed time every second when active
  useEffect(() => {
    if (!activity) {
      setElapsed(0);

      return undefined;
    }

    setElapsed(0);

    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - activity.startedAt) / 1000));
    }, 1000);

    return () => {
      clearInterval(interval);
    };
  }, [activity]);

  if (!activity && history.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col items-center gap-1 w-full mt-2 mb-1">
      {/* Faded history trail - show last 2 completed activities */}
      <AnimatePresence mode="popLayout">
        {history.slice(-3, -1).map((item, i) => (
          <motion.div
            key={`${item.toolName}-${item.startedAt}`}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 0.25 - i * 0.1 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.3 }}
            className="text-[10px] text-gray-600 dark:text-gray-600 tracking-wide"
          >
            {item.label}
          </motion.div>
        ))}
      </AnimatePresence>

      {/* Current activity */}
      <AnimatePresence mode="wait">
        {activity && (
          <motion.div
            key={`${activity.toolName}-${activity.startedAt}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
            className="flex items-center gap-2"
          >
            <div className="i-svg-spinners:ring-resize text-accent-500 text-sm" />
            <span className="text-xs text-gray-400 dark:text-gray-500 tracking-wide">{activity.label}</span>
            {elapsed > 3 && (
              <span className="text-[10px] text-gray-600 dark:text-gray-700 tabular-nums">{elapsed}s</span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

AgentActivityIndicator.displayName = 'AgentActivityIndicator';
