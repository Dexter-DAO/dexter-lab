import { useStore } from '@nanostores/react';
import type { LinksFunction } from '@remix-run/cloudflare';
import { Links, Meta, Outlet, Scripts, ScrollRestoration, useRouteError, isRouteErrorResponse } from '@remix-run/react';
import { captureRemixErrorBoundaryError } from '@sentry/remix';
import tailwindReset from '@unocss/reset/tailwind-compat.css?url';
import { themeStore } from './lib/stores/theme';
import { stripIndents } from './utils/stripIndent';
import { createHead } from 'remix-island';
import { useEffect } from 'react';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { ClientOnly } from 'remix-utils/client-only';
import { cssTransition, ToastContainer } from 'react-toastify';

import reactToastifyStyles from 'react-toastify/dist/ReactToastify.css?url';
import globalStyles from './styles/index.scss?url';
import xtermStyles from '@xterm/xterm/css/xterm.css?url';

import 'virtual:uno.css';

// Initialize Reown AppKit (wallet connection)
import '~/lib/wallet/appkit';

const toastAnimation = cssTransition({
  enter: 'animated fadeInRight',
  exit: 'animated fadeOutRight',
});

export const links: LinksFunction = () => [
  {
    rel: 'icon',
    href: '/favicon.svg',
    type: 'image/svg+xml',
  },
  { rel: 'stylesheet', href: reactToastifyStyles },
  { rel: 'stylesheet', href: tailwindReset },
  { rel: 'stylesheet', href: globalStyles },
  { rel: 'stylesheet', href: xtermStyles },
  {
    rel: 'preconnect',
    href: 'https://fonts.googleapis.com',
  },
  {
    rel: 'preconnect',
    href: 'https://fonts.gstatic.com',
    crossOrigin: 'anonymous',
  },
  {
    rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Orbitron:wght@400;500;600;700;800;900&display=swap',
  },
];

const inlineThemeCode = stripIndents`
  setTutorialKitTheme();

  function setTutorialKitTheme() {
    let theme = localStorage.getItem('bolt_theme');

    if (!theme) {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    document.querySelector('html')?.setAttribute('data-theme', theme);
  }
`;

export const Head = createHead(() => (
  <>
    <meta charSet="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <Meta />
    <Links />
    <script dangerouslySetInnerHTML={{ __html: inlineThemeCode }} />
  </>
));

export function Layout({ children }: { children: React.ReactNode }) {
  const theme = useStore(themeStore);

  useEffect(() => {
    document.querySelector('html')?.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <>
      <ClientOnly>{() => <DndProvider backend={HTML5Backend}>{children}</DndProvider>}</ClientOnly>
      <ToastContainer
        closeButton={({ closeToast }) => {
          return (
            <button className="Toastify__close-button" onClick={closeToast}>
              <div className="i-ph:x text-lg" />
            </button>
          );
        }}
        icon={({ type }) => {
          switch (type) {
            case 'success': {
              return <div className="i-ph:check-bold text-bolt-elements-icon-success text-2xl" />;
            }
            case 'error': {
              return <div className="i-ph:warning-circle-bold text-bolt-elements-icon-error text-2xl" />;
            }
          }

          return undefined;
        }}
        position="bottom-right"
        pauseOnFocusLoss
        transition={toastAnimation}
        autoClose={3000}
      />
      <ScrollRestoration />
      <Scripts />
    </>
  );
}

import { logStore } from './lib/stores/logs';
import { useWalletSync } from './lib/hooks/useWalletSync';

/**
 * Isolated wallet sync component.
 * Renders nothing -- just syncs AppKit state with nanostore.
 * Separated so its re-renders don't cascade to the entire app tree.
 */
function WalletSync() {
  useWalletSync();

  return null;
}

export default function App() {
  const theme = useStore(themeStore);

  useEffect(() => {
    logStore.logSystem('Application initialized', {
      theme,
      platform: navigator.platform,
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString(),
    });

    // Initialize debug logging with improved error handling
    import('./utils/debugLogger')
      .then(({ debugLogger }) => {
        /*
         * The debug logger initializes itself and starts disabled by default
         * It will only start capturing when enableDebugMode() is called
         */
        const status = debugLogger.getStatus();
        logStore.logSystem('Debug logging ready', {
          initialized: status.initialized,
          capturing: status.capturing,
          enabled: status.enabled,
        });
      })
      .catch((error) => {
        logStore.logError('Failed to initialize debug logging', error);
      });
  }, []);

  return (
    <Layout>
      <ClientOnly>{() => <WalletSync />}</ClientOnly>
      <Outlet />
    </Layout>
  );
}

/**
 * Root ErrorBoundary — catches all unhandled React/Remix errors.
 * Sends the error to Sentry and renders a user-friendly fallback page.
 */
export function ErrorBoundary() {
  const error = useRouteError();
  captureRemixErrorBoundaryError(error);

  const isResponse = isRouteErrorResponse(error);
  const title = isResponse ? `${error.status} ${error.statusText}` : 'Something went wrong';
  const message = isResponse
    ? error.data?.message || 'The page you requested could not be loaded.'
    : error instanceof Error
      ? error.message
      : 'An unexpected error occurred. The team has been notified.';

  return (
    <html lang="en" data-theme="dark">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title} | Dexter Lab</title>
      </head>
      <body style={{ margin: 0, fontFamily: 'Inter, system-ui, sans-serif', background: '#0a0a0f', color: '#e4e4e7', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div style={{ textAlign: 'center', padding: '2rem', maxWidth: '480px' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '0.5rem' }}>{title}</h1>
          <p style={{ color: '#a1a1aa', lineHeight: 1.6 }}>{message}</p>
          <a href="/" style={{ display: 'inline-block', marginTop: '1.5rem', padding: '0.5rem 1.5rem', background: '#6d28d9', color: '#fff', borderRadius: '0.5rem', textDecoration: 'none', fontSize: '0.875rem' }}>
            Back to Dexter Lab
          </a>
        </div>
      </body>
    </html>
  );
}
