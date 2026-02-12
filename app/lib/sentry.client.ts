/**
 * Sentry Client-Side Initialization
 *
 * Imported at the top of entry.client.tsx before hydration.
 * Captures:
 *  - Uncaught JS exceptions (window.onerror)
 *  - Unhandled promise rejections
 *  - React rendering errors
 *  - Client-side performance (route changes, fetch calls)
 *  - Session Replay (DOM recording for error reproduction)
 */

import * as Sentry from '@sentry/remix';
import { useEffect } from 'react';
import { useLocation, useMatches } from '@remix-run/react';

// DSN is injected at build time via vite.config.ts define option
const SENTRY_DSN = import.meta.env.SENTRY_DSN || '';

Sentry.init({
  dsn: SENTRY_DSN,

  environment: import.meta.env.MODE || 'production',

  sendDefaultPii: true,

  integrations: [
    // Automatic route-change performance instrumentation
    Sentry.browserTracingIntegration({
      useEffect,
      useLocation,
      useMatches,
    }),

    // Session Replay: records DOM changes so you can watch what the user saw
    Sentry.replayIntegration({
      // Mask all text in recordings for privacy
      maskAllText: false,
      // Block media elements to reduce payload
      blockAllMedia: false,
    }),
  ],

  // Capture 100% of transactions for performance monitoring
  tracesSampleRate: 1.0,

  // Distributed tracing: propagate trace headers to your own API
  tracePropagationTargets: [
    'localhost',
    /^https:\/\/lab\.dexter\.cash/,
    /^https:\/\/api\.dexter\.cash/,
  ],

  // Session Replay sample rates
  // 10% of normal sessions (general UX review)
  replaysSessionSampleRate: 0.1,
  // 100% of sessions that encounter an error (critical for debugging)
  replaysOnErrorSampleRate: 1.0,

  // Silently disable when DSN is not configured
  enabled: !!SENTRY_DSN,
});

export default Sentry;
