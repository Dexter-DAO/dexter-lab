/**
 * x402 Content Paywall Template
 *
 * Pay-per-article content paywall using x402Middleware.
 * Free previews (teaser + metadata), paid full articles.
 * The pattern Ryan Sean Adams described: "pay $0.25 to read this article."
 */

import type { Template } from '~/types/template';
import { packageJson, dockerfile, tsconfig } from './shared';

const indexTs = `import express from 'express';
import { x402Middleware } from '@dexterai/x402/server';

const app = express();
app.use(express.json());

// ============================================================
// YOUR ARTICLES — Replace with your actual content
// ============================================================
interface Article {
  slug: string;
  title: string;
  author: string;
  date: string;
  teaser: string;
  content: string;
  price: string;
  readTime: string;
  tags: string[];
}

const articles: Article[] = [
  {
    slug: 'future-of-micropayments',
    title: 'The Future of Micropayments',
    author: 'Alice Chen',
    date: '2026-02-10',
    teaser: 'The subscription model is broken. You don\\'t want 15 recurring charges for content you rarely read. Micropayments fix this by letting you pay only for what you actually consume.',
    content: \`The subscription model is broken. You don't want 15 recurring charges for content you rarely read. Micropayments fix this by letting you pay only for what you actually consume.

For decades, the internet has struggled with monetization. Advertising became the default, but it warped incentives — optimizing for clicks and engagement rather than quality. Paywalls emerged as an alternative, but they demand commitment before value is delivered.

Micropayments represent a third path. Pay 25 cents to read a single article. No account creation, no credit card on file, no subscription to forget about. Just a single tap and you're reading.

The economics finally work because crypto rails have near-zero transaction costs. A credit card charges \\$0.30 + 2.9% per transaction — making a \\$0.25 payment economically impossible. But a USDC transfer on Solana costs a fraction of a cent.

This isn't about replacing subscriptions entirely. Power readers will still subscribe. But the vast majority of readers — the ones who find an article through social media, read one piece, and leave — finally have a way to pay that makes sense for both sides.

The publisher gets 25 cents they would never have gotten otherwise. The reader gets the content without a commitment. Everyone wins.\`,
    price: '0.25',
    readTime: '4 min',
    tags: ['payments', 'crypto', 'web3'],
  },
  {
    slug: 'solana-2026-state-of-network',
    title: 'Solana in 2026: State of the Network',
    author: 'Bob Martinez',
    date: '2026-02-08',
    teaser: 'Solana processed over 50 billion transactions in 2025, more than all other L1s combined. But raw throughput is just the beginning of the story.',
    content: \`Solana processed over 50 billion transactions in 2025, more than all other L1s combined. But raw throughput is just the beginning of the story.

The network's real breakthrough wasn't speed — it was cost. The average transaction fee dropped below \\$0.001, making entire categories of applications viable for the first time. Micropayments, gaming, IoT data markets, and high-frequency DeFi strategies all found a home on Solana because the economics simply didn't work anywhere else.

Validator count crossed 4,000 this year, with geographic distribution improving significantly. The Firedancer client, now running on 30% of validators, delivered on its promise of client diversity and helped push theoretical throughput past 100,000 TPS.

DeFi TVL on Solana surpassed \\$80 billion, driven largely by institutional adoption. Traditional finance firms stopped asking "if" they should deploy on Solana and started asking "how fast."

The developer ecosystem grew 60% year-over-year, with Rust and TypeScript remaining the primary languages. New frameworks like Anchor 2.0 and Seahorse dramatically lowered the barrier to entry.

Looking ahead to the rest of 2026, all eyes are on token extensions, compressed NFTs at scale, and the emerging x402 payment protocol that's turning every API into a monetizable endpoint.\`,
    price: '0.10',
    readTime: '5 min',
    tags: ['solana', 'blockchain', 'infrastructure'],
  },
  {
    slug: 'ai-agents-need-wallets',
    title: 'Why Every AI Agent Needs a Wallet',
    author: 'Carol Davis',
    date: '2026-02-05',
    teaser: 'AI agents are the fastest-growing consumer of APIs on the internet. But they can\\'t use credit cards, and they shouldn\\'t need API keys. They need wallets.',
    content: \`AI agents are the fastest-growing consumer of APIs on the internet. But they can't use credit cards, and they shouldn't need API keys. They need wallets.

Consider what happens when an AI agent needs to access a paid API today. A human has to sign up for an account, enter a credit card, generate an API key, and configure the agent to use it. This is a manual bottleneck in an otherwise automated pipeline.

Now imagine a world where the agent has its own wallet with a USDC balance. It discovers an API, sees the price in the HTTP 402 response, signs a payment, and gets the data — all in milliseconds, with no human intervention.

This is the x402 vision: HTTP-native payments where any client (human or machine) can pay any server, per-request, with no accounts or API keys. The payment IS the authentication.

For AI agents, this unlocks composability at scale. An agent building a research report can pay for data from ten different providers, each charging fractions of a cent, without any pre-arrangement. The agent's wallet balance is its budget, and every request is a micro-negotiation.

The security model is elegant too. Instead of giving an agent an API key with unlimited access, you give it a wallet with a fixed balance. When the money runs out, the agent stops. No runaway costs, no surprise bills.

We're moving toward an internet where machines pay machines for services, and the protocol layer handles all the complexity. The human just sets the budget and reviews the results.\`,
    price: '0.15',
    readTime: '4 min',
    tags: ['ai', 'agents', 'wallets', 'x402'],
  },
];

// ============================================================
// FREE ENDPOINTS
// ============================================================

app.get('/', (req, res) => {
  if (req.accepts('html') && !req.accepts('json')) {
    const articleCards = articles.map(a => \`
      <div class="article">
        <div class="meta"><span>\${a.date}</span> · <span>\${a.readTime} read</span> · <span class="author">\${a.author}</span></div>
        <h2>\${a.title}</h2>
        <p class="teaser">\${a.teaser}</p>
        <div class="bottom"><span class="price">\${a.price} USDC</span>
        <span class="tags">\${a.tags.map(t => \`<span class="tag">\${t}</span>\`).join('')}</span></div>
      </div>\`).join('');
    return res.type('html').send(\`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>x402 Content Paywall</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;color:#1e293b;padding:2rem}
.container{max-width:720px;margin:0 auto}
header{margin-bottom:2rem}h1{font-size:1.75rem;margin-bottom:.25rem}
.subtitle{color:#64748b;margin-bottom:1rem}
.article{background:#fff;border-radius:12px;padding:1.5rem;margin-bottom:1rem;box-shadow:0 1px 3px rgba(0,0,0,.08);transition:box-shadow .2s}
.article:hover{box-shadow:0 4px 12px rgba(0,0,0,.1)}
.article h2{font-size:1.2rem;margin:.5rem 0}
.meta{font-size:.8rem;color:#94a3b8}.author{color:#475569;font-weight:500}
.teaser{color:#475569;font-size:.95rem;line-height:1.6;margin:.5rem 0}
.bottom{display:flex;justify-content:space-between;align-items:center;margin-top:.75rem}
.price{background:#dcfce7;color:#166534;padding:4px 10px;border-radius:6px;font-weight:600;font-size:.85rem}
.tags{display:flex;gap:4px}.tag{background:#f1f5f9;color:#64748b;padding:2px 8px;border-radius:4px;font-size:.7rem}
.how{background:#fff;border-radius:12px;padding:1.5rem;margin-top:1.5rem;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.how h3{font-size:1rem;margin-bottom:.75rem}
.step{padding:.5rem .75rem;background:#f8fafc;border-radius:8px;border-left:3px solid #3b82f6;margin-bottom:.5rem;font-size:.9rem}
code{background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:.8rem}</style></head>
<body><div class="container"><header><h1>x402 Content Paywall</h1>
<p class="subtitle">Pay-per-article. No subscriptions, no accounts. Just content.</p></header>
\${articleCards}
<div class="how"><h3>How It Works</h3>
<div class="step"><strong>1.</strong> Browse previews for free at <code>GET /articles/:slug</code></div>
<div class="step"><strong>2.</strong> Pay with USDC to read the full article via <code>POST /articles/:slug</code></div>
<div class="step"><strong>3.</strong> Payment is handled automatically by your wallet — no sign-up needed</div>
</div></div></body></html>\`);
  }
  res.json({
    service: 'x402 Content Paywall',
    version: '1.0.0',
    articles: articles.map(a => ({ slug: a.slug, title: a.title, author: a.author, date: a.date, price: \`$\${a.price}\`, readTime: a.readTime })),
    endpoints: [
      { path: '/articles', method: 'GET', price: 'free', description: 'List all articles with metadata' },
      { path: '/articles/:slug', method: 'GET', price: 'free', description: 'Preview an article (teaser + metadata)' },
      { path: '/articles/:slug', method: 'POST', price: 'per-article', description: 'Read the full article (paid)' },
    ],
  });
});

app.get('/articles', (_req, res) => {
  res.json({
    articles: articles.map(a => ({
      slug: a.slug, title: a.title, author: a.author, date: a.date,
      teaser: a.teaser, price: a.price, readTime: a.readTime, tags: a.tags,
    })),
    total: articles.length,
  });
});

// Free preview — teaser + metadata, no full content
app.get('/articles/:slug', (req, res) => {
  const article = articles.find(a => a.slug === req.params.slug);
  if (!article) return res.status(404).json({ error: 'Article not found', available: articles.map(a => a.slug) });
  res.json({
    slug: article.slug, title: article.title, author: article.author, date: article.date,
    teaser: article.teaser, price: article.price, readTime: article.readTime, tags: article.tags,
    fullArticle: \`Pay \${article.price} USDC via POST /articles/\${article.slug} to read the full article\`,
  });
});

// ============================================================
// PAID ENDPOINTS — full article behind x402 payment
// ============================================================

app.post('/articles/:slug', (req, res, next) => {
  const article = articles.find(a => a.slug === req.params.slug);
  if (!article) return res.status(404).json({ error: 'Article not found', available: articles.map(a => a.slug) });

  x402Middleware({
    payTo: '{{USER_WALLET}}',
    amount: article.price,
    description: \`Read: \${article.title}\`,
  })(req, res, () => {
    res.json({
      slug: article.slug,
      title: article.title,
      author: article.author,
      date: article.date,
      readTime: article.readTime,
      tags: article.tags,
      content: article.content,
      transaction: (req as any).x402?.transaction,
    });
  });
});

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(\`x402 Content Paywall running on port \${PORT}\`));
`;

export const contentPaywallTemplate: Template = {
  name: 'x402 Content Paywall',
  label: 'x402 Content Paywall',
  description:
    'Pay-per-article content paywall. Free previews with teasers, paid full articles. No subscriptions — readers pay per piece with USDC micropayments.',
  githubRepo: '',
  tags: [
    'content',
    'articles',
    'blog',
    'paywall',
    'news',
    'publishing',
    'writing',
    'reading',
    'pay-per-article',
    'micropayments',
  ],
  icon: 'i-ph:newspaper',
  files: {
    'index.ts': indexTs,
    'package.json': packageJson('x402-content-paywall'),
    Dockerfile: dockerfile,
    'tsconfig.json': tsconfig,
  },
};
