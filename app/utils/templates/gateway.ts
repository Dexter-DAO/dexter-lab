/**
 * x402 API Gateway Template
 *
 * Proxy any upstream API with x402 payments.
 * User provides UPSTREAM_URL, all requests are forwarded after payment.
 */

import type { Template } from '~/types/template';
import { packageJson, dockerfile, tsconfig } from './shared';

const indexTs = `import express from 'express';
import { x402Middleware } from '@dexterai/x402/server';

const app = express();
app.use(express.json());

const UPSTREAM_URL = process.env.UPSTREAM_URL || '';
const PRICE = process.env.PRICE_USD || '0.01';

if (!UPSTREAM_URL) {
  console.error('ERROR: UPSTREAM_URL environment variable is required.');
  console.error('Set it to the base URL of the API you want to monetize.');
  process.exit(1);
}

// ============================================================
// FREE ENDPOINTS
// ============================================================

app.get('/', (req, res) => {
  const upstream = new URL(UPSTREAM_URL);
  if (req.accepts('html') && !req.accepts('json')) {
    return res.type('html').send(\`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>x402 API Gateway</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#f8fafc;color:#1e293b;padding:2rem}
.card{max-width:640px;margin:0 auto;background:#fff;border-radius:12px;padding:2rem;box-shadow:0 1px 3px rgba(0,0,0,.1)}
h1{font-size:1.5rem;margin-bottom:.5rem}p{color:#64748b;margin-bottom:1.5rem}
code{background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:.85rem}
.price{color:#16a34a;font-weight:700;font-size:1.25rem;margin:1rem 0}</style></head>
<body><div class="card"><h1>x402 API Gateway</h1>
<p>This gateway proxies requests to <code>\${upstream.hostname}</code> and charges per request via x402. No API keys needed.</p>
<div class="price">$\${PRICE} per request</div>
<p>Send any request to <code>/api/&lt;path&gt;</code> — method, headers, query params, and body are forwarded to the upstream API.</p>
</div></body></html>\`);
  }
  res.json({
    service: 'x402 API Gateway', version: '1.0.0',
    upstream: upstream.hostname,
    price: \`$\${PRICE} per request\`,
    usage: 'Send requests to /api/<path> — all methods supported',
  });
});

// ============================================================
// PAID PROXY — all /api/* routes go through x402 then upstream
// ============================================================

app.all('/api/*', x402Middleware({
  payTo: '{{USER_WALLET}}',
  amount: PRICE,
  description: 'API Gateway request',
}), async (req, res) => {
  try {
    const path = req.params[0] || '';
    const upstreamUrl = new URL(path, UPSTREAM_URL);
    upstreamUrl.search = new URL(req.url, 'http://localhost').search;

    const headers: Record<string, string> = { 'Content-Type': req.get('content-type') || 'application/json' };
    const forwardHeaders = ['authorization', 'accept', 'user-agent'];
    for (const h of forwardHeaders) {
      const val = req.get(h);
      if (val) headers[h] = val;
    }

    const upstream = await fetch(upstreamUrl.toString(), {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body),
    });

    const contentType = upstream.headers.get('content-type') || 'application/json';
    res.status(upstream.status).type(contentType);
    const body = await upstream.text();
    res.send(body);
  } catch (error: any) {
    console.error('Proxy error:', error.message);
    res.status(502).json({ error: 'Upstream request failed', detail: error.message });
  }
});

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(\`x402 API Gateway running on port \${PORT} -> \${UPSTREAM_URL}\`));
`;

export const gatewayTemplate: Template = {
  name: 'x402 API Gateway',
  label: 'x402 API Gateway',
  description:
    'Monetize any existing API. Proxies all requests to an upstream URL after x402 payment. Set UPSTREAM_URL and a price.',
  githubRepo: '',
  tags: ['proxy', 'gateway', 'wrapper', 'monetize', 'upstream', 'api-gateway', 'reverse-proxy'],
  icon: 'i-ph:arrows-left-right',
  files: {
    'index.ts': indexTs,
    'package.json': packageJson('x402-api-gateway'),
    Dockerfile: dockerfile,
    'tsconfig.json': tsconfig,
  },
};
