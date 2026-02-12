/**
 * Sentry Server-Side Instrumentation
 *
 * MUST be imported before any other module in server.js.
 * Initializes Sentry for the Node.js/Express runtime, capturing:
 *  - Unhandled exceptions and promise rejections
 *  - Express request/response performance spans
 *  - Remix loader/action errors and performance
 */

// Load .env BEFORE Sentry.init() so DSN is available
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __inst_filename = fileURLToPath(import.meta.url);
const __inst_dirname = dirname(__inst_filename);
dotenv.config({ path: join(__inst_dirname, '.env.local') });
dotenv.config({ path: join(__inst_dirname, '.env') });
dotenv.config();

import * as Sentry from '@sentry/remix';

Sentry.init({
  dsn: process.env.SENTRY_DSN || '',

  environment: process.env.NODE_ENV || 'production',

  // Capture 100% of transactions for tracing.
  // At current traffic levels this is fine; dial down if volume grows.
  tracesSampleRate: 1.0,

  // Send request headers and IP (useful for debugging per-user issues)
  sendDefaultPii: true,

  // Auto-instrument Remix loaders, actions, and server rendering
  autoInstrumentRemix: true,

  // Ignore noisy errors from vulnerability scanners
  ignoreErrors: [
    'No route matches URL "/wp-',
    'No route matches URL "/wordpress',
    'No route matches URL "/xmlrpc',
    /No route matches URL ".*\.php/,
  ],

  // Filter out health check transactions from performance monitoring
  ignoreTransactions: [
    'GET /api/health',
  ],

  beforeSend(event) {
    // Drop events when DSN is not configured
    if (!process.env.SENTRY_DSN) {
      return null;
    }

    return event;
  },
});

// ─── Console Monkey-Patch ───────────────────────────────────────────────────
// Intercept console.error AND console.warn calls and forward them to Sentry.
// This captures caught-and-logged errors across the entire codebase
// that would otherwise be invisible to Sentry.

function patchConsoleMethod(method, sentryLevel) {
  const original = console[method];
  console[method] = function (...args) {
    original.apply(console, args);

    if (!process.env.SENTRY_DSN) return;

    try {
      const firstArg = args[0];

      if (firstArg instanceof Error) {
        Sentry.captureException(firstArg, {
          level: sentryLevel,
          extra: { source: `console.${method}`, args: args.slice(1).map(String) },
        });
      } else {
        const message = args.map(a => {
          if (a instanceof Error) return `${a.message}`;
          if (typeof a === 'object') {
            try { return JSON.stringify(a); } catch { return String(a); }
          }
          return String(a);
        }).join(' ');

        // Skip noisy/expected messages
        if (message.includes('Missing Api Key configuration')) return;
        if (message.includes('deprecated')) return;

        Sentry.captureMessage(message, {
          level: sentryLevel,
          extra: { source: `console.${method}`, rawArgs: args.length },
        });
      }
    } catch {
      // Never let the patch itself break logging
    }
  };
}

patchConsoleMethod('error', 'error');
patchConsoleMethod('warn', 'warning');
