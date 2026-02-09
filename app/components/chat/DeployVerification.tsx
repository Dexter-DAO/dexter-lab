/**
 * DeployVerification
 *
 * An inline chat card that shows deploy/test progress live.
 * Subscribes to the deploy progress SSE endpoint and renders
 * each step with staggered animations as it completes.
 */

import { memo, useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from 'framer-motion';
import { useStore } from '@nanostores/react';
import { $activeDeploys, type DeployProgressEvent } from '~/lib/stores/deployProgress';

// ─── Score Counter ────────────────────────────────────────────────────────────

function AnimatedScore({ value, duration = 1.5 }: { value: number; duration?: number }) {
  const motionValue = useMotionValue(0);
  const rounded = useTransform(motionValue, (v) => Math.round(v));
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const controls = animate(motionValue, value, {
      duration,
      ease: [0.25, 0.1, 0.25, 1],
    });

    const unsubscribe = rounded.on('change', (v) => setDisplay(v));

    return () => {
      controls.stop();
      unsubscribe();
    };
  }, [value, duration, motionValue, rounded]);

  const color =
    value >= 80
      ? 'text-emerald-400'
      : value >= 60
        ? 'text-yellow-400'
        : value >= 40
          ? 'text-orange-400'
          : 'text-red-400';

  return <span className={`font-mono text-3xl font-bold ${color}`}>{display}</span>;
}

// ─── Test Row ─────────────────────────────────────────────────────────────────

const TEST_LABELS: Record<string, string> = {
  health: 'Health Check',
  x402_response: 'x402 Payment Response',
  header_validation: 'Header Validation',
  paid_settlement: 'Paid Settlement',
};

const TEST_ICONS: Record<string, string> = {
  health: 'i-ph:heartbeat',
  x402_response: 'i-ph:lock-key',
  header_validation: 'i-ph:shield-check',
  paid_settlement: 'i-ph:credit-card',
};

function TestRow({ event, index }: { event: DeployProgressEvent; index: number }) {
  const test = event.test!;
  const label = TEST_LABELS[test.testType] || test.testType;
  const icon = TEST_ICONS[test.testType] || 'i-ph:check-circle';

  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.35, delay: index * 0.35, ease: [0.25, 0.1, 0.25, 1] }}
      className="flex items-center justify-between py-1.5 group"
    >
      <div className="flex items-center gap-2.5">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: [0, 1.15, 1] }}
          transition={{ duration: 0.3, delay: index * 0.35 + 0.15 }}
          className="flex-shrink-0"
        >
          {test.passed ? (
            <div className="w-5 h-5 rounded-full bg-emerald-500/15 flex items-center justify-center ring-1 ring-emerald-500/20">
              <div className={`${icon} text-emerald-400 text-[11px]`} />
            </div>
          ) : (
            <div className="w-5 h-5 rounded-full bg-red-500/15 flex items-center justify-center ring-1 ring-red-500/20">
              <div className="i-ph:x-bold text-red-400 text-[10px]" />
            </div>
          )}
        </motion.div>
        <span className="text-[13px] text-gray-300">{label}</span>
      </div>
      <div className="flex items-center gap-3">
        <span
          className={`text-[11px] font-semibold tracking-wide ${test.passed ? 'text-emerald-400' : 'text-red-400'}`}
        >
          {test.passed ? 'PASS' : 'FAIL'}
        </span>
        <span className="text-[11px] text-gray-600 font-mono w-14 text-right tabular-nums">
          {test.durationMs < 1000 ? `${test.durationMs}ms` : `${(test.durationMs / 1000).toFixed(1)}s`}
        </span>
      </div>
    </motion.div>
  );
}

// ─── Build Step ───────────────────────────────────────────────────────────────

function BuildStep({ label, done, spinning }: { label: string; done: boolean; spinning: boolean }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      {spinning && !done ? (
        <div className="w-3.5 h-3.5 border-[1.5px] border-accent-500/30 border-t-accent-500 rounded-full animate-spin" />
      ) : done ? (
        <motion.div initial={{ scale: 0 }} animate={{ scale: [0, 1.15, 1] }} transition={{ duration: 0.3 }}>
          <div className="i-ph:check-bold text-emerald-400 text-[11px]" />
        </motion.div>
      ) : (
        <div className="w-3.5 h-3.5" />
      )}
      <span className={`text-[11px] ${done ? 'text-gray-500' : spinning ? 'text-gray-300' : 'text-gray-700'}`}>
        {label}
      </span>
    </div>
  );
}

// ─── Copy Button ──────────────────────────────────────────────────────────────

function CopyableUrl({ url, method }: { url: string; method?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [url]);

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-2 group/copy cursor-pointer bg-transparent border-0 p-0 text-left w-full min-w-0"
      title="Click to copy URL"
    >
      {method && (
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent-500/15 text-accent-400 font-bold flex-shrink-0 uppercase">
          {method}
        </span>
      )}
      <span className="text-[12px] font-mono text-gray-400 group-hover/copy:text-gray-200 transition-colors truncate min-w-0">
        {url}
      </span>
      <span className="flex-shrink-0">
        {copied ? (
          <div className="i-ph:check text-emerald-400 text-[11px]" />
        ) : (
          <div className="i-ph:copy text-gray-600 group-hover/copy:text-gray-400 transition-colors text-[11px]" />
        )}
      </span>
    </button>
  );
}

// ─── Response Preview ─────────────────────────────────────────────────────────

function ResponsePreview({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);

  // Try to format as JSON
  let formatted = text;
  let isJson = false;

  try {
    const parsed = JSON.parse(text);
    formatted = JSON.stringify(parsed, null, 2);
    isJson = true;
  } catch {
    // not JSON, show raw
  }

  const lines = formatted.split('\n');
  const shouldCollapse = lines.length > 8;
  const displayText = shouldCollapse && !expanded ? lines.slice(0, 8).join('\n') + '\n...' : formatted;

  return (
    <div className="relative">
      <pre
        className={`text-[11px] font-mono leading-relaxed whitespace-pre-wrap break-all p-2.5 rounded-lg bg-gray-950/60 border border-gray-800/40 ${isJson ? 'text-emerald-300/70' : 'text-gray-400'} max-h-48 overflow-y-auto`}
      >
        {displayText}
      </pre>
      {shouldCollapse && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[10px] text-accent-400 hover:text-accent-300 mt-1 bg-transparent border-0 cursor-pointer p-0"
        >
          {expanded ? 'Collapse' : `Show all (${lines.length} lines)`}
        </button>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface DeployVerificationProps {
  resourceId: string;
}

export const DeployVerification = memo(({ resourceId }: DeployVerificationProps) => {
  const deploys = useStore($activeDeploys);
  const deploy = deploys.get(resourceId);

  if (!deploy || deploy.events.length === 0) {
    return null;
  }

  const testResults = deploy.events.filter((e) => e.type === 'test_result');
  const hasBuilding = deploy.events.some((e) => e.type === 'building');
  const hasContainerStarted = deploy.events.some((e) => e.type === 'container_started');
  const hasTesting = deploy.events.some((e) => e.type === 'testing');
  const isComplete = deploy.status === 'complete';
  const hasError = deploy.status === 'error';
  const allPassed = testResults.length > 0 && testResults.every((e) => e.test?.passed);

  // Find paid settlement for score, response, price, TX
  const settlementEvent = testResults.find((e) => e.test?.testType === 'paid_settlement');
  const aiScore = settlementEvent?.test?.aiScore;
  const aiNotes = settlementEvent?.test?.aiNotes;
  const txSignature = settlementEvent?.test?.txSignature;
  const priceUsdc = settlementEvent?.test?.priceUsdc;
  const responsePreview = settlementEvent?.test?.responsePreview;

  // Get endpoint info from complete event
  const completeEvent = deploy.events.find((e) => e.type === 'complete');
  const endpoints = completeEvent?.endpoints;
  const publicUrl = completeEvent?.publicUrl || deploy.events.find((e) => e.publicUrl)?.publicUrl;

  // Build the full endpoint URL for display
  const primaryEndpoint = endpoints?.find((ep) => ep.priceUsdc && ep.priceUsdc > 0);
  const endpointMethod = primaryEndpoint?.method || 'GET';
  const endpointUrl = primaryEndpoint ? `${publicUrl}${primaryEndpoint.path}` : publicUrl;

  // Border glow based on status
  const borderClass = isComplete
    ? allPassed
      ? 'border-emerald-500/30 shadow-[0_0_20px_rgba(16,185,129,0.1)]'
      : 'border-red-500/30 shadow-[0_0_20px_rgba(239,68,68,0.1)]'
    : 'border-gray-700/40';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className={`rounded-xl border ${borderClass} bg-gray-900/90 backdrop-blur-sm overflow-hidden my-3 max-w-lg transition-all duration-700`}
    >
      {/* ─── Header: Name + Status ─── */}
      <div className="px-4 pt-3.5 pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {isComplete ? (
              <div className="w-7 h-7 rounded-lg bg-accent-500/10 flex items-center justify-center ring-1 ring-accent-500/20">
                <div className="i-ph:rocket-launch text-accent-400 text-sm" />
              </div>
            ) : (
              <div className="w-7 h-7 rounded-lg bg-gray-800 flex items-center justify-center">
                <div className="w-3.5 h-3.5 border-[1.5px] border-accent-500/30 border-t-accent-500 rounded-full animate-spin" />
              </div>
            )}
            <div>
              <h3 className="text-sm font-bold text-gray-100 tracking-tight leading-none">
                {deploy.resourceName || resourceId}
              </h3>
            </div>
          </div>
          {isComplete && allPassed && (
            <motion.span
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: testResults.length * 0.35 + 0.5 }}
              className="text-[10px] px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold uppercase tracking-wider"
            >
              All Passed
            </motion.span>
          )}
          {isComplete && !allPassed && (
            <motion.span
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-[10px] px-2.5 py-1 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 font-semibold uppercase tracking-wider"
            >
              Issues Found
            </motion.span>
          )}
        </div>

        {/* ─── Endpoint URL: Right under the title ─── */}
        {isComplete && endpointUrl && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="mt-2">
            <CopyableUrl url={endpointUrl} method={endpointMethod} />
          </motion.div>
        )}

        {/* ─── Price ─── */}
        {isComplete && priceUsdc !== undefined && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="mt-1.5">
            <span className="text-[11px] text-gray-500">
              <span className="text-gray-400 font-medium">
                ${priceUsdc < 0.01 ? priceUsdc.toFixed(4) : priceUsdc.toFixed(2)}
              </span>{' '}
              USDC per request
            </span>
          </motion.div>
        )}
      </div>

      {/* ─── Build Steps ─── */}
      <div className="px-4 py-1.5 border-t border-gray-800/30">
        <BuildStep
          label="Building container"
          done={hasContainerStarted}
          spinning={hasBuilding && !hasContainerStarted}
        />
        <BuildStep label="Container started" done={hasTesting} spinning={hasContainerStarted && !hasTesting} />
      </div>

      {/* ─── Test Results ─── */}
      {testResults.length > 0 && (
        <div className="px-4 py-2 border-t border-gray-800/30">
          <div className="text-[10px] uppercase tracking-widest text-gray-600 mb-1.5 font-semibold">Verification</div>
          <AnimatePresence>
            {testResults.map((event, i) => (
              <TestRow key={event.test!.testType} event={event} index={i} />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* ─── AI Score + Notes ─── */}
      {aiScore !== undefined && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: testResults.length * 0.35 + 0.3 }}
          className="px-4 py-3 border-t border-gray-800/30"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] uppercase tracking-widest text-gray-600 font-semibold">AI Quality Score</span>
            <div className="flex items-baseline gap-0.5">
              <AnimatedScore value={aiScore} />
              <span className="text-xs text-gray-600 font-mono">/100</span>
            </div>
          </div>
          {aiNotes && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: testResults.length * 0.35 + 1.8 }}
              className="text-[12px] text-gray-500 italic leading-relaxed"
            >
              &ldquo;{aiNotes}&rdquo;
            </motion.p>
          )}
        </motion.div>
      )}

      {/* ─── Actual Response Preview ─── */}
      {responsePreview && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: testResults.length * 0.35 + 2.0 }}
          className="px-4 py-2.5 border-t border-gray-800/30"
        >
          <div className="text-[10px] uppercase tracking-widest text-gray-600 mb-1.5 font-semibold">Response</div>
          <ResponsePreview text={responsePreview} />
        </motion.div>
      )}

      {/* ─── Transaction Link ─── */}
      {txSignature && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: testResults.length * 0.35 + 2.3 }}
          className="px-4 py-2.5 border-t border-gray-800/30"
        >
          <div className="text-[10px] uppercase tracking-widest text-gray-600 mb-1 font-semibold">Transaction</div>
          <a
            href={`https://solscan.io/tx/${txSignature}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 group/tx"
          >
            <div className="i-ph:arrow-square-out text-gray-600 group-hover/tx:text-accent-400 text-[11px] flex-shrink-0 transition-colors" />
            <span className="text-[11px] font-mono text-gray-500 group-hover/tx:text-accent-400 transition-colors break-all leading-relaxed">
              {txSignature}
            </span>
          </a>
        </motion.div>
      )}

      {/* ─── Error State ─── */}
      {hasError && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="px-4 py-3 bg-red-500/5">
          <span className="text-xs text-red-400">
            {deploy.events.find((e) => e.type === 'error')?.error || 'Deployment failed'}
          </span>
        </motion.div>
      )}
    </motion.div>
  );
});

/**
 * Renders all active deploy verifications.
 * Place this in the chat message area to show live deploy progress.
 */
export function ActiveDeployVerifications() {
  const deploys = useStore($activeDeploys);
  const activeIds = Array.from(deploys.keys());

  if (activeIds.length === 0) {
    return null;
  }

  return (
    <AnimatePresence>
      {activeIds.map((id) => (
        <DeployVerification key={id} resourceId={id} />
      ))}
    </AnimatePresence>
  );
}
