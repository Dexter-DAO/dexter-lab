/**
 * x402 Access Pass Template
 *
 * Pay once, get a time-limited JWT for unlimited requests.
 * Uses built-in crypto for JWT — no external dependencies.
 */

import type { Template } from '~/types/template';
import { packageJson, dockerfile, tsconfig } from './shared';

const indexTs = `import express from 'express';
import { x402Middleware } from '@dexterai/x402/server';
import crypto from 'crypto';

const app = express();
app.use(express.json());

const SECRET = crypto.randomBytes(32);

// Duration tiers: amount (USD) -> duration (seconds)
const TIERS: Record<string, { label: string; seconds: number; price: string }> = {
  '5m':  { label: '5 minutes',  seconds: 300,    price: '0.05' },
  '30m': { label: '30 minutes', seconds: 1800,   price: '0.25' },
  '1h':  { label: '1 hour',     seconds: 3600,   price: '0.50' },
  '24h': { label: '24 hours',   seconds: 86400,  price: '2.00' },
};

const DEFAULT_TIER = '5m';

// Minimal JWT implementation using built-in crypto (no external deps)
function signToken(payload: Record<string, any>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(\`\${header}.\${body}\`).digest('base64url');
  return \`\${header}.\${body}.\${sig}\`;
}

function verifyToken(token: string): Record<string, any> | null {
  try {
    const [header, body, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', SECRET).update(\`\${header}.\${body}\`).digest('base64url');
    if (sig !== expected) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch { return null; }
}

// Middleware: check for valid access pass
function requirePass(req: express.Request, res: express.Response, next: express.NextFunction) {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    const payload = verifyToken(auth.slice(7));
    if (payload) {
      (req as any).pass = payload;
      return next();
    }
  }
  return res.status(401).json({
    error: 'Access pass required',
    message: 'Purchase an access pass via POST /api/pass, then include it as: Authorization: Bearer <token>',
    tiers: Object.entries(TIERS).map(([id, t]) => ({ id, ...t })),
  });
}

// ============================================================
// FREE ENDPOINTS
// ============================================================

app.get('/', (req, res) => {
  const tierRows = Object.entries(TIERS).map(([id, t]) => \`<tr><td><code>\${id}</code></td><td>\${t.label}</td><td class="price">$\${t.price}</td></tr>\`).join('');
  if (req.accepts('html') && !req.accepts('json')) {
    return res.type('html').send(\`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>x402 Access Pass</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#f8fafc;color:#1e293b;padding:2rem}
.card{max-width:640px;margin:0 auto;background:#fff;border-radius:12px;padding:2rem;box-shadow:0 1px 3px rgba(0,0,0,.1)}
h1{font-size:1.5rem;margin-bottom:.5rem}p{color:#64748b;margin-bottom:1rem}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:.5rem;border-bottom:1px solid #e2e8f0}
th{font-size:.75rem;text-transform:uppercase;color:#94a3b8}.price{color:#16a34a;font-weight:600}
code{background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:.85rem}
.step{margin:1rem 0;padding:.75rem;background:#f8fafc;border-radius:8px;border-left:3px solid #3b82f6}</style></head>
<body><div class="card"><h1>x402 Access Pass</h1>
<p>Pay once, get unlimited API access for a time window. No API keys, no accounts.</p>
<h3 style="font-size:.9rem;margin-bottom:.5rem">Pricing Tiers</h3>
<table><thead><tr><th>Tier</th><th>Duration</th><th>Price</th></tr></thead><tbody>\${tierRows}</tbody></table>
<h3 style="font-size:.9rem;margin:1.5rem 0 .5rem">How It Works</h3>
<div class="step"><strong>1.</strong> POST to <code>/api/pass?tier=30m</code> with x402 payment</div>
<div class="step"><strong>2.</strong> Receive a JWT access token in the response</div>
<div class="step"><strong>3.</strong> Use <code>Authorization: Bearer &lt;token&gt;</code> on all requests to <code>/api/data</code></div>
</div></body></html>\`);
  }
  res.json({
    service: 'x402 Access Pass', version: '1.0.0',
    tiers: Object.entries(TIERS).map(([id, t]) => ({ id, ...t })),
    endpoints: [
      { path: '/api/pass', method: 'POST', price: 'tier-based', description: 'Purchase an access pass' },
      { path: '/api/pass/status', method: 'GET', price: 'free', description: 'Check pass validity' },
      { path: '/api/data', method: 'GET', price: 'pass-required', description: 'Protected data endpoint' },
    ],
  });
});

// ============================================================
// PASS PURCHASE — pay once via x402, receive JWT
// ============================================================

app.post('/api/pass', x402Middleware({
  payTo: '{{USER_WALLET}}',
  amount: TIERS[DEFAULT_TIER].price,
  description: 'Purchase access pass',
}), (req, res) => {
  const tierId = (req.query.tier as string) || DEFAULT_TIER;
  const tier = TIERS[tierId] || TIERS[DEFAULT_TIER];

  const now = Math.floor(Date.now() / 1000);
  const token = signToken({ sub: 'access-pass', tier: tierId, iat: now, exp: now + tier.seconds });

  res.json({
    token, tier: tierId, duration: tier.label,
    expiresAt: new Date((now + tier.seconds) * 1000).toISOString(),
    usage: 'Include as: Authorization: Bearer <token>',
    transaction: (req as any).x402?.transaction,
  });
});

app.get('/api/pass/status', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.json({ valid: false, reason: 'No token provided' });
  const payload = verifyToken(auth.slice(7));
  if (!payload) return res.json({ valid: false, reason: 'Token expired or invalid' });
  const remaining = payload.exp - Math.floor(Date.now() / 1000);
  res.json({ valid: true, tier: payload.tier, remainingSeconds: remaining, expiresAt: new Date(payload.exp * 1000).toISOString() });
});

// ============================================================
// PROTECTED ENDPOINTS — require valid access pass
// ============================================================

app.get('/api/data', requirePass, (_req, res) => {
  res.json({
    message: 'This is protected data accessible with your access pass.',
    timestamp: new Date().toISOString(),
    sample: { temperature: 22.5, humidity: 65, pressure: 1013.25 },
  });
});

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(\`x402 Access Pass running on port \${PORT}\`));
`;

export const accessPassTemplate: Template = {
  name: 'x402 Access Pass',
  label: 'x402 Access Pass',
  description:
    'Pay once, get a time-limited token for unlimited API access. Duration tiers from 5 minutes to 24 hours. Like a subscription without accounts.',
  githubRepo: '',
  tags: ['access-pass', 'session', 'subscription', 'unlimited', 'jwt', 'time-limited', 'rpc', 'throughput'],
  icon: 'i-ph:key',
  files: {
    'index.ts': indexTs,
    'package.json': packageJson('x402-access-pass'),
    Dockerfile: dockerfile,
    'tsconfig.json': tsconfig,
  },
};
