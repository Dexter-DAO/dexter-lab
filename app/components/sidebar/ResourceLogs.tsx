/**
 * ResourceLogs — Live log viewer for a deployed resource
 *
 * Connects to /api/logs/stream via SSE and displays log lines
 * in a scrollable monospace container with auto-scroll.
 */

import { useEffect, useRef, useState, useCallback } from 'react';

interface ResourceLogsProps {
  resourceId: string;
  onClose: () => void;
}

export function ResourceLogs({ resourceId, onClose }: ResourceLogsProps) {
  const [lines, setLines] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  /* Auto-scroll to bottom when new lines arrive */
  const scrollToBottom = useCallback(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [lines, scrollToBottom]);

  /* Connect to SSE endpoint */
  useEffect(() => {
    const es = new EventSource(`/api/logs/stream?id=${encodeURIComponent(resourceId)}&tail=50`);
    eventSourceRef.current = es;

    es.onopen = () => {
      setConnected(true);
      setError(null);
    };

    es.onmessage = (event) => {
      setLines((prev) => {
        const next = [...prev, event.data];

        /* Cap at 500 lines to prevent memory bloat */
        if (next.length > 500) {
          return next.slice(-500);
        }

        return next;
      });
    };

    es.addEventListener('close', () => {
      setConnected(false);
      es.close();
    });

    es.onerror = () => {
      setConnected(false);
      setError('Connection lost');
      es.close();
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [resourceId]);

  return (
    <div className="mt-2 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-200 dark:border-gray-800/50 bg-gray-50 dark:bg-gray-900/50">
        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-500 animate-pulse' : 'bg-gray-500'}`} />
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
            {connected ? 'Live' : error || 'Disconnected'}
          </span>
        </div>
        <button
          onClick={onClose}
          style={{ background: 'none' }}
          className="text-gray-400 hover:text-gray-200 transition-colors"
        >
          <div className="i-ph:x text-sm" />
        </button>
      </div>

      {/* Log output */}
      <div
        ref={containerRef}
        className="h-48 overflow-y-auto overflow-x-hidden p-2 bg-gray-950 font-mono text-xs leading-relaxed"
      >
        {lines.length === 0 && !error && <div className="text-gray-600 py-2">Waiting for logs...</div>}
        {lines.map((line, i) => (
          <div key={i} className="text-gray-300 whitespace-pre-wrap break-all">
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}
