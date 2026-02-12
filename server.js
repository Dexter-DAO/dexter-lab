/**
 * Dexter Lab - Node.js Server
 * 
 * This runs Remix as a traditional Node.js Express server,
 * which provides full Node.js API access required by the Claude Agent SDK.
 */

// Sentry MUST be imported before everything else
import './instrument.server.mjs';
import * as Sentry from '@sentry/remix';

import { createRequestHandler } from '@remix-run/express';
import { installGlobals } from '@remix-run/node';
import express from 'express';
import morgan from 'morgan';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as dotenv from 'dotenv';

// Load environment variables from .env files
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '.env.local') });
dotenv.config({ path: join(__dirname, '.env') });
dotenv.config();

installGlobals();

const app = express();
const PORT = process.env.PORT || 5173;

// ─── Scanner Noise Filter ──────────────────────────────────────────────────────
// Drop requests from WordPress/PHP vulnerability scanners before they
// pollute logs, hit Remix routing, or get sent to Sentry.
const SCANNER_PATHS = /^\/(wp-|wordpress|xmlrpc|\.env|cgi-bin|admin|phpmyadmin|\.git|\.well-known\/security)/i;
const SCANNER_EXTENSIONS = /\.(php|asp|aspx|jsp|cgi)$/i;

app.use((req, res, next) => {
  if (SCANNER_PATHS.test(req.path) || SCANNER_EXTENSIONS.test(req.path)) {
    res.status(404).end();
    return;
  }
  next();
});

// ─── Request Logging (Morgan) ──────────────────────────────────────────────────
// Apache combined format: IP, timestamp, method, path, status, size, referer, UA
// Output goes to stdout → captured by PM2 in dexter-lab-out.log
app.use(morgan('[:date[iso]] :method :url :status :res[content-length] - :response-time ms ":user-agent"', {
  // Skip health check requests to keep logs clean
  skip: (req) => req.url === '/api/health',
}));

// Serve static files from the client build
app.use(express.static(join(__dirname, 'build/client'), {
  maxAge: '1y',
  immutable: true,
}));

// Handle all other requests with Remix
app.all(
  '*',
  createRequestHandler({
    build: await import('./build/server/index.js'),
    mode: process.env.NODE_ENV || 'production',
  })
);

// ─── Sentry Error Handler ──────────────────────────────────────────────────────
// MUST be after all routes/middleware. Captures unhandled errors and sends to Sentry.
Sentry.setupExpressErrorHandler(app);

app.listen(PORT, () => {
  console.log(`🚀 Dexter Lab server running at http://localhost:${PORT}`);
  if (process.env.SENTRY_DSN) {
    console.log('[Sentry] Server-side error tracking active');
  } else {
    console.log('[Sentry] No SENTRY_DSN configured — error tracking disabled');
  }

  // Container lifecycle management
  // Call the reconcile endpoint on startup to sync Redis with Docker,
  // then schedule periodic checks every 5 minutes
  setTimeout(async () => {
    try {
      console.log('[Server] Running initial container reconciliation...');
      const res = await fetch(`http://localhost:${PORT}/api/deploy?action=reconcile`, { method: 'POST' });
      const data = await res.json();
      console.log(`[Server] Reconciliation: ${data.total} total, ${data.healthy} healthy, ${data.recovered} recovered, ${data.lost} lost, ${data.cleaned} cleaned`);
      
      // Schedule periodic reconciliation
      setInterval(async () => {
        try {
          const r = await fetch(`http://localhost:${PORT}/api/deploy?action=reconcile`, { method: 'POST' });
          const d = await r.json();
          if (d.recovered > 0 || d.lost > 0 || d.cleaned > 0) {
            console.log(`[Server] Reconciliation: ${d.recovered} recovered, ${d.lost} lost, ${d.cleaned} cleaned`);
          }
        } catch (err) {
          console.error('[Server] Periodic reconciliation error:', err.message);
        }
      }, 5 * 60 * 1000);
      
      console.log('[Server] Container reconciliation scheduled (every 5 min)');
    } catch (err) {
      console.warn('[Server] Could not start container reconciliation:', err.message);
    }
  }, 5000);
});
