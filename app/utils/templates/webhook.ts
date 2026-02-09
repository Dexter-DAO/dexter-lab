/**
 * x402 Webhook Receiver Template
 *
 * Paid inbound webhooks — the sender pays to deliver data.
 * Optional forwarding to a downstream URL.
 */

import type { Template } from '~/types/template';
import { packageJson, dockerfile, tsconfig } from './shared';

const indexTs = `import express from 'express';
import { x402Middleware } from '@dexterai/x402/server';
import crypto from 'crypto';

const app = express();
app.use(express.json());

const FORWARD_URL = process.env.FORWARD_URL || '';
const PRICE = process.env.PRICE_USD || '0.01';

// In-memory ring buffer for recent webhooks
const recentWebhooks: Array<{ id: string; timestamp: string; body: any; forwarded: boolean }> = [];
const MAX_WEBHOOKS = 50;

function storeWebhook(body: any, forwarded: boolean) {
  const entry = { id: crypto.randomUUID(), timestamp: new Date().toISOString(), body, forwarded };
  recentWebhooks.unshift(entry);
  if (recentWebhooks.length > MAX_WEBHOOKS) recentWebhooks.pop();
  return entry;
}

// ============================================================
// FREE ENDPOINTS
// ============================================================

app.get('/', (req, res) => {
  if (req.accepts('html') && !req.accepts('json')) {
    return res.type('html').send(\`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>x402 Webhook Receiver</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#f8fafc;color:#1e293b;padding:2rem}
.card{max-width:640px;margin:0 auto;background:#fff;border-radius:12px;padding:2rem;box-shadow:0 1px 3px rgba(0,0,0,.1)}
h1{font-size:1.5rem;margin-bottom:.5rem}p{color:#64748b;margin-bottom:1rem}
code{background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:.85rem}
pre{background:#1e293b;color:#e2e8f0;padding:1rem;border-radius:8px;overflow-x:auto;font-size:.8rem;margin:1rem 0}
.price{color:#16a34a;font-weight:700;font-size:1.25rem}</style></head>
<body><div class="card"><h1>x402 Webhook Receiver</h1>
<p>Accept paid inbound webhooks. The sender pays to deliver data to you.</p>
<div class="price">$\${PRICE} per webhook</div>
<p><strong>Send webhooks to:</strong> <code>POST /api/webhook</code></p>
<p><strong>View recent:</strong> <code>GET /api/recent</code> (free)</p>
\${FORWARD_URL ? '<p><strong>Forwarding to:</strong> <code>' + new URL(FORWARD_URL).hostname + '</code></p>' : ''}
<pre>curl -X POST \\\\
  -H "Content-Type: application/json" \\\\
  -H "PAYMENT-SIGNATURE: &lt;base64-payment&gt;" \\\\
  -d '{"event":"test","data":"hello"}' \\\\
  https://your-resource.dexter.cash/api/webhook</pre>
</div></body></html>\`);
  }
  res.json({
    service: 'x402 Webhook Receiver', version: '1.0.0',
    price: \`$\${PRICE} per webhook\`,
    endpoints: [
      { path: '/api/webhook', method: 'POST', price: \`$\${PRICE}\`, description: 'Send a paid webhook' },
      { path: '/api/recent', method: 'GET', price: 'free', description: 'View recent webhooks' },
    ],
    forwarding: FORWARD_URL ? 'enabled' : 'disabled',
  });
});

app.get('/api/recent', (_req, res) => {
  res.json({ webhooks: recentWebhooks, total: recentWebhooks.length });
});

// ============================================================
// PAID WEBHOOK ENDPOINT — sender pays to deliver
// ============================================================

app.post('/api/webhook', x402Middleware({
  payTo: '{{USER_WALLET}}',
  amount: PRICE,
  description: 'Deliver webhook',
}), async (req, res) => {
  let forwarded = false;

  if (FORWARD_URL) {
    try {
      await fetch(FORWARD_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
      });
      forwarded = true;
    } catch (err: any) {
      console.error('Forward failed:', err.message);
    }
  }

  const entry = storeWebhook(req.body, forwarded);
  res.json({ received: true, webhookId: entry.id, forwarded, transaction: (req as any).x402?.transaction });
});

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(\`x402 Webhook Receiver running on port \${PORT}\`));
`;

export const webhookTemplate: Template = {
  name: 'x402 Webhook Receiver',
  label: 'x402 Webhook Receiver',
  description:
    'Accept paid inbound webhooks. The sender pays to deliver data to you. Optional forwarding to a downstream URL.',
  githubRepo: '',
  tags: ['webhook', 'receiver', 'notification', 'events', 'inbound', 'callback', 'alerts'],
  icon: 'i-ph:webhooks-logo',
  files: {
    'index.ts': indexTs,
    'package.json': packageJson('x402-webhook-receiver'),
    Dockerfile: dockerfile,
    'tsconfig.json': tsconfig,
  },
};
