# Advanced Payment Patterns

Beyond basic per-request pricing, the SDK supports five additional payment patterns. Each is structurally different and serves a distinct use case.

---

## 1. Access Pass — Pay Once, Unlimited Requests

**Use when:** Buyers want session-based access instead of per-request payments. Ideal for RPC providers, data feeds, and any high-throughput API.

**How it works:** The buyer pays once and receives a time-limited JWT. All subsequent requests include the JWT as `Authorization: Bearer <token>` and bypass x402 entirely. The server validates the JWT locally (no facilitator call) for instant response.

**IMPORTANT:** The pass purchase endpoint MUST accept POST requests. The client SDK sends payment signatures via POST.

```typescript
import express from 'express';
import { x402AccessPass } from '@dexterai/x402/server';

const app = express();
app.use(express.json());

// Protect all /api routes with access pass
app.use('/api', x402AccessPass({
  payTo: '{{USER_WALLET}}',
  tiers: {
    '5m':  '0.05',   // $0.05 for 5 minutes
    '1h':  '0.50',   // $0.50 for 1 hour
    '24h': '2.00',   // $2.00 for 24 hours
  },
  ratePerHour: '0.50',  // also accept custom durations via ?duration=<seconds>
}));

// These only run with a valid access pass
app.get('/api/data', (req, res) => {
  res.json({ data: 'premium content', timestamp: Date.now() });
});

app.post('/api/query', (req, res) => {
  res.json({ result: 'query result', query: req.body.q });
});

app.listen(3000);
```

**Configuration options:**
- `tiers` — Named duration tiers with prices. Duration parsed from ID: `5m`, `1h`, `24h`, `7d`.
- `ratePerHour` — Rate for custom durations. Buyer sends `?duration=<seconds>`.
- Both can be used together: tiers for standard options, rate for flexibility.

**Server response headers:**
- `X-ACCESS-PASS-TIERS` — Base64 JSON with available tiers (on 402)
- `ACCESS-PASS` — The JWT token (on 200 after purchase)
- `PAYMENT-RESPONSE` — Settlement receipt (on 200 after purchase)

**Client usage:**
```typescript
import { wrapFetch } from '@dexterai/x402/client';

const x402Fetch = wrapFetch(fetch, {
  walletPrivateKey: process.env.SOLANA_KEY,
  accessPass: { preferTier: '1h', maxSpend: '1.00' },
});

// First call: auto-buys a 1-hour pass
const res1 = await x402Fetch('https://api.example.com/api/data');

// All subsequent calls for 1 hour: uses cached JWT, zero payment
const res2 = await x402Fetch('https://api.example.com/api/data');
```

---

## 2. API Gateway — Monetize Any Upstream API

**Use when:** You want to wrap an existing free or private API with x402 payments. The user provides an upstream URL and a price.

```typescript
import express from 'express';
import { x402Middleware } from '@dexterai/x402/server';

const app = express();
app.use(express.json());

const UPSTREAM_URL = process.env.UPSTREAM_URL || '';
const PRICE = process.env.PRICE_USD || '0.01';

if (!UPSTREAM_URL) {
  console.error('UPSTREAM_URL environment variable is required');
  process.exit(1);
}

// All /api/* routes: pay, then proxy to upstream
app.all('/api/*', x402Middleware({
  payTo: '{{USER_WALLET}}',
  amount: PRICE,
  description: 'API Gateway request',
}), async (req, res) => {
  const path = req.params[0] || '';
  const upstreamUrl = new URL(path, UPSTREAM_URL);
  upstreamUrl.search = new URL(req.url, 'http://localhost').search;

  const upstream = await fetch(upstreamUrl.toString(), {
    method: req.method,
    headers: { 'Content-Type': req.get('content-type') || 'application/json' },
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body),
  });

  const contentType = upstream.headers.get('content-type') || 'application/json';
  res.status(upstream.status).type(contentType).send(await upstream.text());
});

app.listen(3000);
```

---

## 3. File Server — Pay-Per-Download

**Use when:** Selling digital files — documents, data exports, media, reports.

```typescript
import express from 'express';
import { x402Middleware } from '@dexterai/x402/server';

const app = express();
app.use(express.json());

const FILES: Record<string, { content: string; mimeType: string; price: string; description: string }> = {
  'report.txt': {
    content: 'Full report content here...',
    mimeType: 'text/plain',
    price: '0.01',
    description: 'Market report',
  },
  'data.json': {
    content: JSON.stringify({ tokens: [{ symbol: 'SOL', price: 245.67 }] }, null, 2),
    mimeType: 'application/json',
    price: '0.005',
    description: 'Token price data',
  },
};

// Free catalog
app.get('/api/catalog', (_req, res) => {
  res.json({ files: Object.entries(FILES).map(([name, f]) => ({ name, price: f.price, description: f.description })) });
});

// Paid download — per-file pricing
app.post('/files/:filename', (req, res) => {
  const file = FILES[req.params.filename];
  if (!file) return res.status(404).json({ error: 'File not found', available: Object.keys(FILES) });

  x402Middleware({
    payTo: '{{USER_WALLET}}',
    amount: file.price,
    description: `Download ${req.params.filename}`,
  })(req, res, () => {
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.filename}"`);
    res.send(file.content);
  });
});

app.listen(3000);
```

---

## 4. Webhook Receiver — Sender Pays to Deliver

**Use when:** You want to receive inbound data and charge the sender per delivery. The payment flow is reversed — the sender pays, not the consumer.

```typescript
import express from 'express';
import { x402Middleware } from '@dexterai/x402/server';
import crypto from 'crypto';

const app = express();
app.use(express.json());

const FORWARD_URL = process.env.FORWARD_URL || '';
const PRICE = process.env.PRICE_USD || '0.01';

const recentWebhooks: Array<{ id: string; timestamp: string; body: unknown }> = [];

// Free: view recent webhooks
app.get('/api/recent', (_req, res) => {
  res.json({ webhooks: recentWebhooks, total: recentWebhooks.length });
});

// Paid: sender pays to deliver webhook
app.post('/api/webhook', x402Middleware({
  payTo: '{{USER_WALLET}}',
  amount: PRICE,
  description: 'Deliver webhook',
}), async (req, res) => {
  const entry = { id: crypto.randomUUID(), timestamp: new Date().toISOString(), body: req.body };
  recentWebhooks.unshift(entry);
  if (recentWebhooks.length > 50) recentWebhooks.pop();

  // Optional: forward to downstream URL
  if (FORWARD_URL) {
    try {
      await fetch(FORWARD_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body) });
    } catch (err) {
      console.error('Forward failed:', err);
    }
  }

  res.json({ received: true, webhookId: entry.id, transaction: (req as any).x402?.transaction });
});

app.listen(3000);
```

---

## 5. SSE + WebSocket Stream — Pay for Time-Limited Streams

**Use when:** Selling real-time data feeds — prices, alerts, events. Buyer pays for a duration and receives a continuous stream.

**IMPORTANT:** The stream template requires the `ws` package for WebSocket support. Add it to dependencies.

```typescript
import express from 'express';
import { x402Middleware } from '@dexterai/x402/server';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import crypto from 'crypto';

const app = express();
app.use(express.json());

const TIERS: Record<string, { label: string; seconds: number; price: string }> = {
  '5m':  { label: '5 minutes',  seconds: 300,   price: '0.05' },
  '30m': { label: '30 minutes', seconds: 1800,  price: '0.25' },
  '1h':  { label: '1 hour',     seconds: 3600,  price: '0.50' },
};

function generateEvent() {
  return { timestamp: new Date().toISOString(), price: (200 + Math.random() * 50).toFixed(2), volume: Math.floor(Math.random() * 100000) };
}

// Free 10-second demo
app.get('/api/stream/demo', (_req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const start = Date.now();
  const interval = setInterval(() => {
    if (Date.now() - start > 10000) {
      res.write(`event: expired\ndata: ${JSON.stringify({ reason: 'demo_ended' })}\n\n`);
      res.end();
      clearInterval(interval);
      return;
    }
    res.write(`data: ${JSON.stringify(generateEvent())}\n\n`);
  }, 2000);
  _req.on('close', () => clearInterval(interval));
});

// Paid SSE stream
app.post('/api/stream', x402Middleware({
  payTo: '{{USER_WALLET}}',
  amount: TIERS['5m'].price,
  description: 'Data stream access',
}), (req, res) => {
  const tierId = (req.query.tier as string) || '5m';
  const tier = TIERS[tierId] || TIERS['5m'];

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const start = Date.now();
  const durationMs = tier.seconds * 1000;

  const interval = setInterval(() => {
    const elapsed = Date.now() - start;
    if (elapsed > durationMs) {
      res.write(`event: expired\ndata: ${JSON.stringify({ reason: 'time_up' })}\n\n`);
      res.end();
      clearInterval(interval);
      return;
    }
    res.write(`data: ${JSON.stringify({ ...generateEvent(), remainingSeconds: Math.round((durationMs - elapsed) / 1000) })}\n\n`);
  }, 3000);
  req.on('close', () => clearInterval(interval));
});

// WebSocket: auth via x402, then connect
const WS_SECRET = crypto.randomBytes(32);
const wsTokens = new Map<string, { tier: string; expiresAt: number }>();

app.post('/api/ws/auth', x402Middleware({
  payTo: '{{USER_WALLET}}',
  amount: TIERS['5m'].price,
  description: 'WebSocket stream access',
}), (req, res) => {
  const tierId = (req.query.tier as string) || '5m';
  const tier = TIERS[tierId] || TIERS['5m'];
  const token = crypto.randomBytes(24).toString('hex');
  wsTokens.set(token, { tier: tierId, expiresAt: Date.now() + tier.seconds * 1000 });
  res.json({ token, wsUrl: `ws://${req.get('host')}/ws?token=${token}`, tier: tierId });
});

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const token = url.searchParams.get('token');
  if (!token || !wsTokens.has(token)) {
    ws.send(JSON.stringify({ error: 'Invalid token' }));
    ws.close(1008);
    return;
  }
  const session = wsTokens.get(token)!;
  wsTokens.delete(token);
  const tier = TIERS[session.tier] || TIERS['5m'];
  const start = Date.now();

  const interval = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) { clearInterval(interval); return; }
    if (Date.now() - start > tier.seconds * 1000) {
      ws.send(JSON.stringify({ event: 'expired' }));
      ws.close(1000);
      clearInterval(interval);
      return;
    }
    ws.send(JSON.stringify(generateEvent()));
  }, 3000);
  ws.on('close', () => clearInterval(interval));
});

httpServer.listen(3000);
```

**Dependencies for stream template:**
```json
{
  "dependencies": {
    "@dexterai/x402": "^1.5.1",
    "express": "^4.18.0",
    "ws": "^8.0.0"
  }
}
```
