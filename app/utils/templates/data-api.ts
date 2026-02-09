/**
 * x402 Data API Template
 *
 * Fixed-price GET/POST endpoints using x402Middleware.
 * The simplest x402 pattern — middleware handles the entire payment flow.
 */

import type { Template } from '~/types/template';
import { packageJson, dockerfile, tsconfig } from './shared';

const indexTs = `import express from 'express';
import { x402Middleware } from '@dexterai/x402/server';

const app = express();
app.use(express.json());

// ============================================================
// YOUR DATA — Replace with your actual content
// ============================================================
const items = [
  { id: 1, category: 'science', title: 'Neutron Stars', content: 'A teaspoon of neutron star material weighs about 6 billion tons.' },
  { id: 2, category: 'science', title: 'Speed of Light', content: 'Light takes 8 minutes and 20 seconds to travel from the Sun to Earth.' },
  { id: 3, category: 'history', title: 'Great Wall', content: 'The Great Wall of China is not visible from space with the naked eye.' },
  { id: 4, category: 'history', title: 'Cleopatra', content: 'Cleopatra lived closer in time to the Moon landing than to the building of the Great Pyramid.' },
  { id: 5, category: 'nature', title: 'Octopus Hearts', content: 'An octopus has three hearts and blue blood.' },
  { id: 6, category: 'nature', title: 'Honey', content: 'Honey never spoils. Archaeologists have found 3,000-year-old honey that was still edible.' },
];

const categories = [...new Set(items.map((i) => i.category))];

// ============================================================
// FREE ENDPOINTS
// ============================================================

app.get('/', (req, res) => {
  if (req.accepts('html') && !req.accepts('json')) {
    return res.type('html').send(\`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>x402 Data API</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#f8fafc;color:#1e293b;padding:2rem}
.card{max-width:640px;margin:0 auto;background:#fff;border-radius:12px;padding:2rem;box-shadow:0 1px 3px rgba(0,0,0,.1)}
h1{font-size:1.5rem;margin-bottom:.5rem}p{color:#64748b;margin-bottom:1.5rem}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:.5rem;border-bottom:1px solid #e2e8f0}
th{font-size:.75rem;text-transform:uppercase;color:#94a3b8}.price{color:#16a34a;font-weight:600}
.free{color:#64748b}.tag{display:inline-block;padding:2px 8px;border-radius:4px;font-size:.7rem;font-weight:600}
.get{background:#dbeafe;color:#1d4ed8}.post{background:#dcfce7;color:#166534}</style></head>
<body><div class="card"><h1>x402 Data API</h1>
<p>Pay-per-request data endpoints powered by the x402 protocol. No API keys needed.</p>
<table><thead><tr><th>Endpoint</th><th>Method</th><th>Price</th></tr></thead><tbody>
<tr><td>/api/categories</td><td><span class="tag get">GET</span></td><td class="free">Free</td></tr>
<tr><td>/api/item</td><td><span class="tag post">POST</span></td><td class="price">$0.005</td></tr>
<tr><td>/api/item/:category</td><td><span class="tag post">POST</span></td><td class="price">$0.005</td></tr>
<tr><td>/api/collection</td><td><span class="tag post">POST</span></td><td class="price">$0.02</td></tr>
</tbody></table></div></body></html>\`);
  }
  res.json({
    service: 'x402 Data API',
    version: '1.0.0',
    endpoints: [
      { path: '/api/categories', method: 'GET', price: 'free', description: 'List available categories' },
      { path: '/api/item', method: 'POST', price: '$0.005', description: 'Get a random item' },
      { path: '/api/item/:category', method: 'POST', price: '$0.005', description: 'Get item from a category' },
      { path: '/api/collection', method: 'POST', price: '$0.02', description: 'Get the full collection' },
    ],
  });
});

app.get('/api/categories', (req, res) => {
  res.json({ categories, total: items.length });
});

// ============================================================
// PAID ENDPOINTS — x402 middleware handles payment automatically
// ============================================================

const itemMiddleware = x402Middleware({
  payTo: '{{USER_WALLET}}',
  amount: '0.005',
  description: 'Get a random item',
});

app.post('/api/item', itemMiddleware, (req, res) => {
  const item = items[Math.floor(Math.random() * items.length)];
  res.json(item);
});

app.post('/api/item/:category', x402Middleware({
  payTo: '{{USER_WALLET}}',
  amount: '0.005',
  description: 'Get an item from a specific category',
}), (req, res) => {
  const categoryItems = items.filter((i) => i.category === req.params.category);
  if (categoryItems.length === 0) {
    return res.status(404).json({ error: 'Category not found', available: categories });
  }
  res.json(categoryItems[Math.floor(Math.random() * categoryItems.length)]);
});

app.post('/api/collection', x402Middleware({
  payTo: '{{USER_WALLET}}',
  amount: '0.02',
  description: 'Get the full collection',
}), (req, res) => {
  res.json({ items, total: items.length });
});

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(\`x402 Data API running on port \${PORT}\`));
`;

export const dataApiTemplate: Template = {
  name: 'x402 Data API',
  label: 'x402 Data API',
  description:
    'Serve content and data at a fixed price per request. Uses x402Middleware for simple endpoints with automatic payment handling.',
  githubRepo: '',
  tags: ['data', 'api', 'content', 'simple', 'fixed-price', 'quotes', 'trivia', 'lookup', 'facts'],
  icon: 'i-ph:database',
  files: {
    'index.ts': indexTs,
    'package.json': packageJson('x402-data-api'),
    Dockerfile: dockerfile,
    'tsconfig.json': tsconfig,
  },
};
