/* eslint-disable @blitz/lines-around-comment */
import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform, type Variants } from 'framer-motion';
import { useStore } from '@nanostores/react';
import { toast } from 'react-toastify';
import { workbenchStore } from '~/lib/stores/workbench';
import { logStore } from '~/lib/stores/logs';
import { classNames } from '~/utils/classNames';
import { cubicEasingFn } from '~/utils/easings';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Mood = 'frustrated' | 'confused' | 'minor';

interface BugFormData {
  description: string;
  mood: Mood;
  contactEmail: string;
}

const MOOD_OPTIONS: { value: Mood; emoji: string; label: string }[] = [
  { value: 'frustrated', emoji: '\u{1F624}', label: 'Frustrated' },
  { value: 'confused', emoji: '\u{1F615}', label: 'Confused' },
  { value: 'minor', emoji: '\u{1F914}', label: 'Minor' },
];

const MOOD_TO_SEVERITY: Record<Mood, string> = {
  frustrated: 'Critical',
  confused: 'Medium',
  minor: 'Low',
};

const SESSION_KEY = 'dexter_bug_report_draft';

/* ------------------------------------------------------------------ */
/*  Animation variants                                                 */
/* ------------------------------------------------------------------ */

const transition = { duration: 0.2, ease: cubicEasingFn };

const pillVariants: Variants = {
  idle: { scale: 1, opacity: 0.85 },
  hover: { scale: 1.04, opacity: 1 },
  tap: { scale: 0.96 },
};

const cardContentVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.04, delayChildren: 0.1 },
  },
  exit: { opacity: 0, transition: { duration: 0.1 } },
};

const fieldVariant: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition },
  exit: { opacity: 0, y: -4, transition: { duration: 0.08 } },
};

const successVariants: Variants = {
  hidden: { scale: 0, opacity: 0 },
  visible: {
    scale: 1,
    opacity: 1,
    transition: { type: 'spring', stiffness: 420, damping: 14 },
  },
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getEnvironmentInfo() {
  return {
    browser: navigator.userAgent,
    os: navigator.platform,
    screenResolution: `${window.innerWidth}x${window.innerHeight}`,
    url: window.location.href,
  };
}

function getRecentLogs(count = 5) {
  try {
    const logs = logStore.getLogs();
    return logs
      .slice(-count)
      .map((l) => `[${l.category}] ${l.message}`)
      .join('\n');
  } catch {
    return '';
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function BugReportFab() {
  const [isOpen, setIsOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [form, setForm] = useState<BugFormData>(() => {
    try {
      const saved = sessionStorage.getItem(SESSION_KEY);
      return saved ? JSON.parse(saved) : { description: '', mood: 'confused' as Mood, contactEmail: '' };
    } catch {
      return { description: '', mood: 'confused' as Mood, contactEmail: '' };
    }
  });

  const showWorkbench = useStore(workbenchStore.showWorkbench);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Drag-to-dismiss (mobile bottom sheet)
  const dragY = useMotionValue(0);
  const cardOpacity = useTransform(dragY, [0, 200], [1, 0.3]);

  // Persist draft to sessionStorage
  useEffect(() => {
    if (!submitted) {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(form));
    }
  }, [form, submitted]);

  // Keyboard shortcut: Ctrl+Shift+B
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'B') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    }
    window.addEventListener('keydown', handleKey);

    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  // Focus textarea on open
  useEffect(() => {
    if (isOpen && !submitted) {
      const t = setTimeout(() => textareaRef.current?.focus(), 200);
      return () => clearTimeout(t);
    }

    return undefined;
  }, [isOpen, submitted]);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const resetForm = useCallback(() => {
    setForm({ description: '', mood: 'confused', contactEmail: '' });
    setSubmitted(false);
    sessionStorage.removeItem(SESSION_KEY);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!form.description.trim() || form.description.trim().length < 10) {
      toast.error('Please describe the issue (at least 10 characters)');
      return;
    }

    setIsSubmitting(true);

    try {
      const envInfo = getEnvironmentInfo();
      const recentLogs = getRecentLogs();
      const severity = MOOD_TO_SEVERITY[form.mood];

      const title = `[${severity}] ${form.description.slice(0, 80)}${form.description.length > 80 ? '...' : ''}`;

      const description = [
        form.description,
        '',
        '---',
        `**Severity:** ${severity} (user mood: ${form.mood})`,
        recentLogs ? `\n**Recent logs:**\n\`\`\`\n${recentLogs}\n\`\`\`` : '',
      ]
        .filter(Boolean)
        .join('\n');

      const formData = new FormData();
      formData.append('title', title);
      formData.append('description', description);
      formData.append('contactEmail', form.contactEmail);
      formData.append('includeEnvironmentInfo', 'true');
      formData.append('environmentInfo', JSON.stringify(envInfo));

      const res = await fetch('/api/bug-report', { method: 'POST', body: formData });
      const data = (await res.json()) as { error?: string };

      if (!res.ok) {
        throw new Error(data.error || 'Submission failed');
      }

      setSubmitted(true);
      sessionStorage.removeItem(SESSION_KEY);

      // Collapse back to pill after showing success
      setTimeout(() => {
        close();
        setTimeout(resetForm, 300);
      }, 1800);
    } catch (err: any) {
      toast.error(err.message || 'Failed to submit report. Try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [form, close, resetForm]);

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;

  return (
    <div
      className={classNames(
        'fixed bottom-4 z-[998]',

        // Nudge left when workbench is open on desktop
        showWorkbench ? 'right-[calc(50%+1rem)] sm:right-[calc(50%+1rem)]' : 'right-4',
      )}
      style={{ transition: 'right 0.3s ease' }}
    >
      <AnimatePresence mode="wait">
        {!isOpen ? (
          /* ---- Pill ---- */
          <motion.button
            key="pill"
            layoutId="bug-fab"
            className={classNames(
              'flex items-center gap-2',
              'px-4 py-2.5 rounded-full',
              'bg-gradient-to-r from-orange-500/90 to-orange-600/90',
              'text-white text-sm font-medium',
              'shadow-lg shadow-orange-500/20',
              'backdrop-blur-sm',
              'border border-white/10',
              'cursor-pointer select-none',
              'outline-none focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent',
            )}
            variants={pillVariants}
            initial="idle"
            animate="idle"
            whileHover="hover"
            whileTap="tap"
            onClick={() => setIsOpen(true)}
            title="Report a bug (Ctrl+Shift+B)"
          >
            <div className="i-ph:bug text-lg" />
            <span className="hidden sm:inline">Report Bug</span>
          </motion.button>
        ) : (
          /* ---- Expanded card ---- */
          <motion.div
            key="card"
            layoutId="bug-fab"
            className={classNames(
              'rounded-2xl overflow-hidden',
              'bg-white dark:bg-[#141418]',
              'border border-gray-200/60 dark:border-gray-700/40',
              'shadow-2xl shadow-black/20',

              // Mobile: full-width bottom sheet
              isMobile ? 'fixed inset-x-3 bottom-3' : 'w-[340px]',
            )}
            style={{ opacity: isMobile ? cardOpacity : 1 }}
            drag={isMobile ? 'y' : false}
            dragConstraints={{ top: 0 }}
            dragElastic={0.15}
            onDragEnd={(_, info) => {
              if (info.offset.y > 100) {
                close();
              }
            }}
            transition={{ layout: { duration: 0.25, ease: cubicEasingFn } }}
          >
            <AnimatePresence mode="wait">
              {submitted ? (
                /* ---- Success state ---- */
                <motion.div
                  key="success"
                  className="flex flex-col items-center justify-center py-12 px-6"
                  variants={successVariants}
                  initial="hidden"
                  animate="visible"
                  exit="hidden"
                >
                  <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mb-4">
                    <div className="i-ph:check-circle-fill text-green-500 text-4xl" />
                  </div>
                  <p className="text-base font-medium text-gray-900 dark:text-white">Thanks for the report!</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">We&apos;ll look into it.</p>
                </motion.div>
              ) : (
                /* ---- Form ---- */
                <motion.div
                  key="form"
                  variants={cardContentVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  className="flex flex-col"
                >
                  {/* Drag handle (mobile) */}
                  {isMobile && (
                    <div className="flex justify-center pt-2 pb-1">
                      <div className="w-8 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
                    </div>
                  )}

                  {/* Header */}
                  <motion.div variants={fieldVariant} className="flex items-center justify-between px-4 pt-3 pb-2">
                    <div className="flex items-center gap-2">
                      <div className="i-ph:bug text-orange-500 text-lg" />
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Report a Bug</h3>
                    </div>
                    <button
                      onClick={close}
                      className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                    >
                      <div className="i-ph:x text-base" />
                    </button>
                  </motion.div>

                  <div className="px-4 pb-4 flex flex-col gap-3">
                    {/* Mood selector */}
                    <motion.div variants={fieldVariant}>
                      <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block">
                        How are you feeling?
                      </label>
                      <div className="flex gap-2">
                        {MOOD_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            onClick={() => setForm((f) => ({ ...f, mood: opt.value }))}
                            className={classNames(
                              'flex-1 flex flex-col items-center gap-1 py-2 rounded-xl text-xs font-medium transition-all duration-150',
                              form.mood === opt.value
                                ? 'bg-orange-500/10 dark:bg-orange-500/15 text-orange-600 dark:text-orange-400 ring-1 ring-orange-500/30'
                                : 'bg-gray-50 dark:bg-gray-800/60 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/60',
                            )}
                          >
                            <span className="text-xl leading-none">{opt.emoji}</span>
                            <span>{opt.label}</span>
                          </button>
                        ))}
                      </div>
                    </motion.div>

                    {/* Description */}
                    <motion.div variants={fieldVariant}>
                      <label
                        htmlFor="bug-desc"
                        className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block"
                      >
                        What went wrong?
                      </label>
                      <textarea
                        ref={textareaRef}
                        id="bug-desc"
                        value={form.description}
                        onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                        placeholder="Describe what happened..."
                        rows={3}
                        maxLength={2000}
                        className={classNames(
                          'w-full rounded-xl px-3 py-2.5 text-sm resize-none',
                          'bg-gray-50 dark:bg-gray-800/60',
                          'border border-gray-200 dark:border-gray-700/50',
                          'text-gray-900 dark:text-gray-100',
                          'placeholder:text-gray-400 dark:placeholder:text-gray-500',
                          'focus:outline-none focus:ring-2 focus:ring-orange-500/40 focus:border-orange-500/40',
                          'transition-shadow',
                        )}
                      />
                      <div className="flex justify-end mt-0.5">
                        <span className="text-[10px] text-gray-400 dark:text-gray-500">
                          {form.description.length}/2000
                        </span>
                      </div>
                    </motion.div>

                    {/* Email (optional) */}
                    <motion.div variants={fieldVariant}>
                      <label
                        htmlFor="bug-email"
                        className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block"
                      >
                        Email <span className="text-gray-400 dark:text-gray-500 font-normal">(optional)</span>
                      </label>
                      <input
                        id="bug-email"
                        type="email"
                        value={form.contactEmail}
                        onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))}
                        placeholder="you@example.com"
                        className={classNames(
                          'w-full rounded-xl px-3 py-2 text-sm',
                          'bg-gray-50 dark:bg-gray-800/60',
                          'border border-gray-200 dark:border-gray-700/50',
                          'text-gray-900 dark:text-gray-100',
                          'placeholder:text-gray-400 dark:placeholder:text-gray-500',
                          'focus:outline-none focus:ring-2 focus:ring-orange-500/40 focus:border-orange-500/40',
                          'transition-shadow',
                        )}
                      />
                    </motion.div>

                    {/* Footer: context badge + submit */}
                    <motion.div variants={fieldVariant} className="flex items-center justify-between pt-1">
                      <span className="text-[10px] text-gray-400 dark:text-gray-500 flex items-center gap-1">
                        <div className="i-ph:info text-xs" />
                        Page context auto-attached
                      </span>
                      <button
                        onClick={handleSubmit}
                        disabled={isSubmitting || form.description.trim().length < 10}
                        className={classNames(
                          'px-4 py-2 rounded-xl text-sm font-medium',
                          'bg-gradient-to-r from-orange-500 to-orange-600',
                          'text-white',
                          'shadow-md shadow-orange-500/20',
                          'hover:shadow-lg hover:shadow-orange-500/30',
                          'disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none',
                          'transition-all duration-150',
                          'flex items-center gap-2',
                        )}
                      >
                        {isSubmitting ? (
                          <>
                            <div className="i-ph:spinner-gap-bold animate-spin text-sm" />
                            Sending...
                          </>
                        ) : (
                          <>
                            <div className="i-ph:paper-plane-tilt text-sm" />
                            Send
                          </>
                        )}
                      </button>
                    </motion.div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
