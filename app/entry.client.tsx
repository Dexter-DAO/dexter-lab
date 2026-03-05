// Sentry client init MUST come before anything else
import * as Sentry from '@sentry/remix';
import { useEffect } from 'react';
import { useLocation, useMatches } from '@remix-run/react';

Sentry.init({
  dsn: import.meta.env.SENTRY_DSN || '',
  environment: import.meta.env.MODE || 'production',
  sendDefaultPii: true,
  integrations: [
    Sentry.browserTracingIntegration({
      useEffect,
      useLocation,
      useMatches,
    }),
    Sentry.replayIntegration({
      maskAllText: false,
      blockAllMedia: false,
    }),
  ],
  tracesSampleRate: 1.0,
  tracePropagationTargets: ['localhost', /^https:\/\/lab\.dexter\.cash/, /^https:\/\/api\.dexter\.cash/],
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
});

import { RemixBrowser } from '@remix-run/react';
import { startTransition } from 'react';
import { hydrateRoot } from 'react-dom/client';

startTransition(() => {
  hydrateRoot(document.getElementById('root')!, <RemixBrowser />);
});
