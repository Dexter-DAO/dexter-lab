/**
 * x402 File Server Template
 *
 * Pay-per-download with per-file pricing.
 * Serves files behind x402 payments with proper Content-Disposition headers.
 */

import type { Template } from '~/types/template';
import { packageJson, dockerfile, tsconfig } from './shared';

const indexTs = `import express from 'express';
import { x402Middleware } from '@dexterai/x402/server';

const app = express();
app.use(express.json());

// ============================================================
// YOUR FILES — Replace with your actual content
// ============================================================
const FILES: Record<string, { content: string; mimeType: string; price: string; description: string }> = {
  'report.txt': {
    content: 'Annual Market Report 2026\\n\\nKey findings:\\n1. DeFi TVL surpassed $500B\\n2. Stablecoin market cap reached $300B\\n3. AI agent transactions grew 4,000% YoY\\n\\nFull analysis follows...',
    mimeType: 'text/plain',
    price: '0.01',
    description: 'Annual market report (text)',
  },
  'data.json': {
    content: JSON.stringify({ tokens: [{ symbol: 'SOL', price: 245.67, change24h: 3.2 }, { symbol: 'ETH', price: 4521.89, change24h: -1.1 }, { symbol: 'USDC', price: 1.0, change24h: 0 }], updatedAt: new Date().toISOString() }, null, 2),
    mimeType: 'application/json',
    price: '0.005',
    description: 'Token price snapshot (JSON)',
  },
  'contacts.csv': {
    content: 'name,email,company,role\\nAlice Chen,alice@example.com,Solana Labs,Engineer\\nBob Smith,bob@example.com,Coinbase,PM\\nCarol Davis,carol@example.com,Dexter,Founder',
    mimeType: 'text/csv',
    price: '0.02',
    description: 'Business contacts directory (CSV)',
  },
};

// ============================================================
// FREE ENDPOINTS
// ============================================================

app.get('/', (req, res) => {
  const catalog = Object.entries(FILES).map(([name, f]) => ({ name, price: \`$\${f.price}\`, type: f.mimeType, description: f.description }));
  if (req.accepts('html') && !req.accepts('json')) {
    const rows = catalog.map(f => \`<tr><td><code>\${f.name}</code></td><td>\${f.description}</td><td class="price">\${f.price}</td></tr>\`).join('');
    return res.type('html').send(\`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>x402 File Server</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#f8fafc;color:#1e293b;padding:2rem}
.card{max-width:640px;margin:0 auto;background:#fff;border-radius:12px;padding:2rem;box-shadow:0 1px 3px rgba(0,0,0,.1)}
h1{font-size:1.5rem;margin-bottom:.5rem}p{color:#64748b;margin-bottom:1.5rem}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:.5rem;border-bottom:1px solid #e2e8f0}
th{font-size:.75rem;text-transform:uppercase;color:#94a3b8}.price{color:#16a34a;font-weight:600}
code{background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:.85rem}</style></head>
<body><div class="card"><h1>x402 File Server</h1>
<p>Pay-per-download file server. Purchase individual files with USDC via x402.</p>
<table><thead><tr><th>File</th><th>Description</th><th>Price</th></tr></thead><tbody>\${rows}</tbody></table>
<p style="margin-top:1rem;font-size:.85rem;color:#94a3b8">Download via POST to <code>/files/&lt;filename&gt;</code></p>
</div></body></html>\`);
  }
  res.json({ service: 'x402 File Server', version: '1.0.0', files: catalog });
});

app.get('/api/catalog', (_req, res) => {
  res.json({ files: Object.entries(FILES).map(([name, f]) => ({ name, price: f.price, mimeType: f.mimeType, description: f.description })) });
});

// ============================================================
// PAID DOWNLOADS — per-file pricing
// ============================================================

app.post('/files/:filename', (req, res, next) => {
  const file = FILES[req.params.filename];
  if (!file) return res.status(404).json({ error: 'File not found', available: Object.keys(FILES) });

  x402Middleware({
    payTo: '{{USER_WALLET}}',
    amount: file.price,
    description: \`Download \${req.params.filename}\`,
  })(req, res, () => {
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', \`attachment; filename="\${req.params.filename}"\`);
    res.send(file.content);
  });
});

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(\`x402 File Server running on port \${PORT}\`));
`;

export const fileServerTemplate: Template = {
  name: 'x402 File Server',
  label: 'x402 File Server',
  description:
    'Pay-per-download file server with per-file pricing. Serve documents, data exports, media, and digital goods.',
  githubRepo: '',
  tags: ['files', 'media', 'download', 'pdf', 'images', 'documents', 'content', 'digital-goods'],
  icon: 'i-ph:file-arrow-down',
  files: {
    'index.ts': indexTs,
    'package.json': packageJson('x402-file-server'),
    Dockerfile: dockerfile,
    'tsconfig.json': tsconfig,
  },
};
