/**
 * DeployVerification
 *
 * An inline chat card that shows deploy/test progress live.
 * Subscribes to the deploy progress SSE endpoint and renders
 * each step with staggered animations as it completes.
 */

import { memo, useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from 'framer-motion';
import { useStore } from '@nanostores/react';
import { $activeDeploys, type ActiveDeploy, type DeployProgressEvent } from '~/lib/stores/deployProgress';

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

  return <span className={`font-mono text-2xl font-bold ${color}`}>{display}</span>;
}

// ─── Test Row ─────────────────────────────────────────────────────────────────

const TEST_LABELS: Record<string, string> = {
  health: 'Health Check',
  x402_response: 'x402 Payment Response',
  header_validation: 'Header Validation',
  paid_settlement: 'Paid Settlement',
};

function TestRow({ event, index }: { event: DeployProgressEvent; index: number }) {
  const test = event.test!;
  const label = TEST_LABELS[test.testType] || test.testType;

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, delay: index * 0.4, ease: [0.25, 0.1, 0.25, 1] }}
      className="flex items-center justify-between py-1.5"
    >
      <div className="flex items-center gap-2">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: [0, 1.2, 1] }}
          transition={{ duration: 0.3, delay: index * 0.4 + 0.2 }}
        >
          {test.passed ? (
            <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <div className="i-ph:check-bold text-emerald-400 text-xs" />
            </div>
          ) : (
            <div className="w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center">
              <div className="i-ph:x-bold text-red-400 text-xs" />
            </div>
          )}
        </motion.div>
        <span className="text-sm text-gray-300">{label}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className={`text-xs font-medium ${test.passed ? 'text-emerald-400' : 'text-red-400'}`}>
          {test.passed ? 'PASS' : 'FAIL'}
        </span>
        <span className="text-xs text-gray-500 font-mono w-16 text-right">
          {test.durationMs < 1000 ? `${test.durationMs}ms` : `${(test.durationMs / 1000).toFixed(1)}s`}
        </span>
      </div>
    </motion.div>
  );
}

// ─── Build Step ───────────────────────────────────────────────────────────────

function BuildStep({ label, done, spinning }: { label: string; done: boolean; spinning: boolean }) {
  return (
    <div className="flex items-center gap-2 py-1">
      {spinning && !done ? (
        <div className="w-4 h-4 border-2 border-accent-500/30 border-t-accent-500 rounded-full animate-spin" />
      ) : done ? (
        <motion.div initial={{ scale: 0 }} animate={{ scale: [0, 1.2, 1] }} transition={{ duration: 0.3 }}>
          <div className="i-ph:check-bold text-emerald-400 text-sm" />
        </motion.div>
      ) : (
        <div className="w-4 h-4" />
      )}
      <span className={`text-xs ${done ? 'text-gray-400' : spinning ? 'text-gray-200' : 'text-gray-600'}`}>
        {label}
      </span>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface DeployVerificationProps {
  resourceId: string;
}

export const DeployVerification = memo(function DeployVerification({ resourceId }: DeployVerificationProps) {
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

  // Find paid settlement for score
  const settlementEvent = testResults.find((e) => e.test?.testType === 'paid_settlement');
  const aiScore = settlementEvent?.test?.aiScore;
  const aiNotes = settlementEvent?.test?.aiNotes;
  const txSignature = settlementEvent?.test?.txSignature;

  // Get endpoint info from complete event
  const completeEvent = deploy.events.find((e) => e.type === 'complete');
  const endpoints = completeEvent?.endpoints;
  const publicUrl = completeEvent?.publicUrl || deploy.events.find((e) => e.publicUrl)?.publicUrl;

  // Border glow based on status
  const borderClass = isComplete
    ? allPassed
      ? 'border-emerald-500/40 shadow-[0_0_15px_rgba(16,185,129,0.15)]'
      : 'border-red-500/40 shadow-[0_0_15px_rgba(239,68,68,0.15)]'
    : 'border-gray-700/50';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className={`rounded-xl border ${borderClass} bg-gray-900/80 backdrop-blur-sm overflow-hidden my-3 max-w-lg transition-all duration-700`}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-800/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isComplete ? (
            <div className="i-ph:rocket text-accent-500 text-lg" />
          ) : (
            <div className="w-4 h-4 border-2 border-accent-500/30 border-t-accent-500 rounded-full animate-spin" />
          )}
          <span className="text-sm font-semibold text-gray-200 uppercase tracking-wider">
            {isComplete ? 'Deployed' : 'Deploying'} {deploy.resourceName}
          </span>
        </div>
        {isComplete && allPassed && (
          <motion.span
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: testResults.length * 0.4 + 0.5 }}
            className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
          >
            All Passed
          </motion.span>
        )}
      </div>

      {/* Build Steps */}
      <div className="px-4 py-2 border-b border-gray-800/30">
        <BuildStep label="Building container" done={hasContainerStarted} spinning={hasBuilding && !hasContainerStarted} />
        <BuildStep label="Container started" done={hasTesting} spinning={hasContainerStarted && !hasTesting} />
      </div>

      {/* Test Results */}
      {testResults.length > 0 && (
        <div className="px-4 py-2 border-b border-gray-800/30">
          <div className="text-[10px] uppercase tracking-widest text-gray-600 mb-1 font-semibold">Verification</div>
          <AnimatePresence>
            {testResults.map((event, i) => (
              <TestRow key={event.test!.testType} event={event} index={i} />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* AI Score + Notes */}
      {aiScore !== undefined && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: testResults.length * 0.4 + 0.3 }}
          className="px-4 py-3 border-b border-gray-800/30"
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] uppercase tracking-widest text-gray-600 font-semibold">AI Quality Score</span>
            <div className="flex items-baseline gap-1">
              <AnimatedScore value={aiScore} />
              <span className="text-xs text-gray-600">/100</span>
            </div>
          </div>
          {aiNotes && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: testResults.length * 0.4 + 1.8 }}
              className="text-xs text-gray-500 italic leading-relaxed"
            >
              "{aiNotes}"
            </motion.p>
          )}
          {txSignature && (
            <motion.a
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: testResults.length * 0.4 + 2.2 }}
              href={`https://solscan.io/tx/${txSignature}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-gray-600 hover:text-accent-500 transition-colors mt-1 inline-block font-mono"
            >
              TX: {txSignature.substring(0, 12)}...{txSignature.substring(txSignature.length - 8)}
            </motion.a>
          )}
        </motion.div>
      )}

      {/* Endpoint + URL */}
      {isComplete && publicUrl && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: testResults.length * 0.4 + 1 }}
          className="px-4 py-3"
        >
          {endpoints && endpoints.length > 0 && (
            <div className="flex items-center gap-2 mb-1">
              {endpoints
                .filter((ep) => ep.priceUsdc && ep.priceUsdc > 0)
                .map((ep, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent-500/10 text-accent-400 font-bold">
                      {ep.method}
                    </span>
                    <span className="text-xs font-mono text-gray-300">
                      {publicUrl}
                      {ep.path}
                    </span>
                  </div>
                ))}
            </div>
          )}
          {!endpoints && (
            <span className="text-xs font-mono text-gray-400">{publicUrl}</span>
          )}
        </motion.div>
      )}

      {/* Error State */}
      {hasError && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="px-4 py-3 bg-red-500/5"
        >
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
