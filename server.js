/**
 * Dexter Lab - Node.js Server
 * 
 * This runs Remix as a traditional Node.js Express server,
 * which provides full Node.js API access required by the Claude Agent SDK.
 */

import { createRequestHandler } from '@remix-run/express';
import { installGlobals } from '@remix-run/node';
import express from 'express';
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

// Serve static files from the client build
app.use(express.static(join(__dirname, 'build/client'), {
  maxAge: '1y',
  immutable: true,
}));

// Handle all other requests with Remix, with cache-control on HTML responses
const remixHandler = createRequestHandler({
  build: await import('./build/server/index.js'),
  mode: process.env.NODE_ENV || 'production',
});

app.all('*', (req, res, next) => {
  // Prevent browsers from caching HTML pages (JS/CSS have content hashes and are immutable via static middleware above)
  const origEnd = res.end.bind(res);
  res.end = function(...args) {
    const ct = res.getHeader('content-type');
    if (typeof ct === 'string' && ct.includes('text/html') && !res.getHeader('cache-control')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
    return origEnd(...args);
  };
  remixHandler(req, res, next);
});

app.listen(PORT, () => {
  console.log(`🚀 Dexter Lab server running at http://localhost:${PORT}`);

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
