/**
 * x402 SSE + WebSocket Stream Template
 *
 * Pay for time-limited real-time data streams.
 * Supports both SSE and WebSocket delivery modes.
 */

import type { Template } from '~/types/template';
import { packageJson, dockerfile, tsconfig } from './shared';

const indexTs = `import express from 'express';
import { x402Middleware } from '@dexterai/x402/server';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import crypto from 'crypto';

const app = express();
app.use(express.json());

// Duration tiers
const TIERS: Record<string, { label: string; seconds: number; price: string }> = {
  '5m':  { label: '5 minutes',  seconds: 300,   price: '0.05' },
  '30m': { label: '30 minutes', seconds: 1800,  price: '0.25' },
  '1h':  { label: '1 hour',     seconds: 3600,  price: '0.50' },
};

const DEFAULT_TIER = '5m';

// Sample data generator — replace with your real data source
function generateEvent() {
  return {
    timestamp: new Date().toISOString(),
    price: (200 + Math.random() * 50).toFixed(2),
    volume: Math.floor(Math.random() * 100000),
    trend: Math.random() > 0.5 ? 'up' : 'down',
  };
}

// ============================================================
// FREE ENDPOINTS
// ============================================================

app.get('/', (req, res) => {
  const tierRows = Object.entries(TIERS).map(([id, t]) => \`<tr><td><code>\${id}</code></td><td>\${t.label}</td><td class="price">$\${t.price}</td></tr>\`).join('');
  if (req.accepts('html') && !req.accepts('json')) {
    return res.type('html').send(\`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>x402 Data Stream</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#f8fafc;color:#1e293b;padding:2rem}
.card{max-width:640px;margin:0 auto;background:#fff;border-radius:12px;padding:2rem;box-shadow:0 1px 3px rgba(0,0,0,.1)}
h1{font-size:1.5rem;margin-bottom:.5rem}p{color:#64748b;margin-bottom:1rem}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:.5rem;border-bottom:1px solid #e2e8f0}
th{font-size:.75rem;text-transform:uppercase;color:#94a3b8}.price{color:#16a34a;font-weight:600}
code{background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:.85rem}</style></head>
<body><div class="card"><h1>x402 Data Stream</h1>
<p>Pay for a time-limited real-time data stream. Supports SSE and WebSocket delivery.</p>
<table><thead><tr><th>Tier</th><th>Duration</th><th>Price</th></tr></thead><tbody>\${tierRows}</tbody></table>
<p style="margin-top:1.5rem"><strong>SSE:</strong> POST to <code>/api/stream</code> with x402 payment</p>
<p><strong>WebSocket:</strong> POST to <code>/api/ws/auth</code> to get a token, then connect to <code>ws://host/ws?token=...</code></p>
<p><strong>Free demo:</strong> GET <code>/api/stream/demo</code> (10 second preview)</p>
</div></body></html>\`);
  }
  res.json({
    service: 'x402 Data Stream', version: '1.0.0',
    tiers: Object.entries(TIERS).map(([id, t]) => ({ id, ...t })),
    endpoints: [
      { path: '/api/stream', method: 'POST', price: 'tier-based', description: 'SSE data stream' },
      { path: '/api/ws/auth', method: 'POST', price: 'tier-based', description: 'WebSocket auth token' },
      { path: '/api/stream/demo', method: 'GET', price: 'free', description: '10-second demo stream' },
    ],
  });
});

// Free demo stream (10 seconds)
app.get('/api/stream/demo', (_req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const start = Date.now();
  const interval = setInterval(() => {
    if (Date.now() - start > 10000) {
      res.write(\`event: expired\\ndata: \${JSON.stringify({ reason: 'demo_ended', message: 'Purchase a tier for longer streams' })}\\n\\n\`);
      res.end();
      clearInterval(interval);
      return;
    }
    res.write(\`data: \${JSON.stringify(generateEvent())}\\n\\n\`);
  }, 2000);

  _req.on('close', () => clearInterval(interval));
});

// ============================================================
// PAID SSE STREAM
// ============================================================

app.post('/api/stream', x402Middleware({
  payTo: '{{USER_WALLET}}',
  amount: TIERS[DEFAULT_TIER].price,
  description: 'Data stream access',
}), (req, res) => {
  const tierId = (req.query.tier as string) || DEFAULT_TIER;
  const tier = TIERS[tierId] || TIERS[DEFAULT_TIER];

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  res.write(\`event: connected\\ndata: \${JSON.stringify({ tier: tierId, duration: tier.label, expiresIn: tier.seconds })}\\n\\n\`);

  const start = Date.now();
  const durationMs = tier.seconds * 1000;

  const interval = setInterval(() => {
    const elapsed = Date.now() - start;
    if (elapsed > durationMs) {
      res.write(\`event: expired\\ndata: \${JSON.stringify({ reason: 'time_up', elapsed: Math.round(elapsed / 1000) })}\\n\\n\`);
      res.end();
      clearInterval(interval);
      return;
    }
    res.write(\`data: \${JSON.stringify({ ...generateEvent(), remainingSeconds: Math.round((durationMs - elapsed) / 1000) })}\\n\\n\`);
  }, 3000);

  req.on('close', () => clearInterval(interval));
});

// ============================================================
// WEBSOCKET AUTH — pay via x402, get token for WS connection
// ============================================================

const WS_SECRET = crypto.randomBytes(32);
const wsTokens = new Map<string, { tier: string; expiresAt: number }>();

app.post('/api/ws/auth', x402Middleware({
  payTo: '{{USER_WALLET}}',
  amount: TIERS[DEFAULT_TIER].price,
  description: 'WebSocket stream access',
}), (req, res) => {
  const tierId = (req.query.tier as string) || DEFAULT_TIER;
  const tier = TIERS[tierId] || TIERS[DEFAULT_TIER];

  const token = crypto.randomBytes(24).toString('hex');
  wsTokens.set(token, { tier: tierId, expiresAt: Date.now() + tier.seconds * 1000 });

  // Clean up expired tokens
  for (const [k, v] of wsTokens) { if (v.expiresAt < Date.now()) wsTokens.delete(k); }

  res.json({
    token,
    wsUrl: \`ws://\${req.get('host')}/ws?token=\${token}\`,
    tier: tierId, duration: tier.label,
    transaction: (req as any).x402?.transaction,
  });
});

// ============================================================
// WEBSOCKET SERVER
// ============================================================

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '', \`http://\${req.headers.host}\`);
  const token = url.searchParams.get('token');

  if (!token || !wsTokens.has(token)) {
    ws.send(JSON.stringify({ error: 'Invalid or expired token. Purchase via POST /api/ws/auth' }));
    ws.close(1008);
    return;
  }

  const session = wsTokens.get(token)!;
  wsTokens.delete(token);
  const tier = TIERS[session.tier] || TIERS[DEFAULT_TIER];
  const durationMs = tier.seconds * 1000;
  const start = Date.now();

  ws.send(JSON.stringify({ event: 'connected', tier: session.tier, duration: tier.label }));

  const interval = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) { clearInterval(interval); return; }
    const elapsed = Date.now() - start;
    if (elapsed > durationMs) {
      ws.send(JSON.stringify({ event: 'expired', reason: 'time_up' }));
      ws.close(1000);
      clearInterval(interval);
      return;
    }
    ws.send(JSON.stringify({ ...generateEvent(), remainingSeconds: Math.round((durationMs - elapsed) / 1000) }));
  }, 3000);

  ws.on('close', () => clearInterval(interval));
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(\`x402 Data Stream running on port \${PORT}\`));
`;

export const streamTemplate: Template = {
  name: 'x402 Stream',
  label: 'x402 Stream',
  description:
    'Pay for time-limited real-time data streams. Supports both SSE and WebSocket delivery with tiered duration pricing.',
  githubRepo: '',
  tags: ['stream', 'sse', 'websocket', 'real-time', 'live', 'feed', 'events', 'push', 'alerts'],
  icon: 'i-ph:broadcast',
  files: {
    'index.ts': indexTs,
    'package.json': packageJson('x402-stream', { ws: '^8.0.0' }),
    Dockerfile: dockerfile,
    'tsconfig.json': tsconfig,
  },
};
