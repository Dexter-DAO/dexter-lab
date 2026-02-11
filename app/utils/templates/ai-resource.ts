/**
 * x402 AI Resource Template
 *
 * Token-based dynamic pricing using createTokenPricing.
 * Manual quote/settle flow for POST endpoints that call LLMs via proxy.
 */

import type { Template } from '~/types/template';
import { packageJson, dockerfile, tsconfig } from './shared';

const indexTs = `import express from 'express';
import { createX402Server, createTokenPricing } from '@dexterai/x402/server';

const app = express();
app.use(express.json());

const PROXY = process.env.PROXY_BASE_URL || 'https://x402.dexter.cash/proxy';

const server = createX402Server({
  payTo: '{{USER_WALLET}}',
  network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
});

const pricing = createTokenPricing({ model: 'claude-sonnet-4-5', minUsd: 0.01, maxUsd: 10.0 });

// ============================================================
// FREE ENDPOINTS
// ============================================================

app.get('/', (req, res) => {
  if (req.accepts('html') && !req.accepts('json')) {
    return res.type('html').send(\`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>x402 AI Resource</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#f8fafc;color:#1e293b;padding:2rem}
.card{max-width:640px;margin:0 auto;background:#fff;border-radius:12px;padding:2rem;box-shadow:0 1px 3px rgba(0,0,0,.1)}
h1{font-size:1.5rem;margin-bottom:.5rem}p{color:#64748b;margin-bottom:1.5rem}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:.5rem;border-bottom:1px solid #e2e8f0}
th{font-size:.75rem;text-transform:uppercase;color:#94a3b8}.price{color:#16a34a;font-weight:600}
.tag{display:inline-block;padding:2px 8px;border-radius:4px;font-size:.7rem;font-weight:600;background:#dcfce7;color:#166534}</style></head>
<body><div class="card"><h1>x402 AI Resource</h1>
<p>Token-based AI generation with dynamic pricing. Price scales with prompt length. No API keys needed.</p>
<table><thead><tr><th>Endpoint</th><th>Method</th><th>Pricing</th></tr></thead><tbody>
<tr><td>/api/generate</td><td><span class="tag">POST</span></td><td class="price">Token-based (from $0.01)</td></tr>
<tr><td>/api/analyze</td><td><span class="tag">POST</span></td><td class="price">Token-based (from $0.01)</td></tr>
</tbody></table></div></body></html>\`);
  }
  res.json({
    service: 'x402 AI Resource', version: '1.0.0',
    endpoints: [
      { path: '/api/generate', method: 'POST', price: 'token-based', description: 'Generate content with AI' },
      { path: '/api/analyze', method: 'POST', price: 'token-based', description: 'Analyze text with AI' },
    ],
  });
});

// Helper: settle and set PAYMENT-RESPONSE header per x402 v2 spec
async function settleAndRespond(paymentSig: string, res: express.Response) {
  const result = await server.settlePayment(paymentSig);
  if (!result.success) return { success: false, error: result.errorReason };
  const paymentResponseData = { success: true, transaction: result.transaction, network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', payer: result.payer || '' };
  res.setHeader('PAYMENT-RESPONSE', btoa(JSON.stringify(paymentResponseData)));
  return { success: true, transaction: result.transaction };
}

// ============================================================
// PAID ENDPOINTS — manual quote/settle for token-based pricing
// ============================================================

app.post('/api/generate', async (req, res) => {
  const { prompt, style = 'professional' } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  const systemPrompt = \`You are a helpful assistant. Write in a \${style} style.\`;
  const paymentSig = req.headers['payment-signature'] as string;

  if (!paymentSig) {
    const quote = pricing.calculate(prompt, systemPrompt);
    const requirements = await server.buildRequirements({
      amountAtomic: quote.amountAtomic, resourceUrl: '/api/generate',
      description: \`Generate: \${quote.inputTokens.toLocaleString()} tokens\`,
    });
    res.setHeader('PAYMENT-REQUIRED', server.encodeRequirements(requirements));
    res.setHeader('X-Quote-Hash', quote.quoteHash);
    return res.status(402).json({ inputTokens: quote.inputTokens, usdAmount: quote.usdAmount, model: quote.model });
  }

  const quoteHash = req.headers['x-quote-hash'] as string;
  if (!pricing.validateQuote(prompt, quoteHash)) return res.status(400).json({ error: 'Prompt changed, re-quote required' });

  const settle = await settleAndRespond(paymentSig, res);
  if (!settle.success) return res.status(402).json({ error: settle.error });

  try {
    const llmRes = await fetch(\`\${PROXY}/anthropic/v1/messages\`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 4096, system: systemPrompt, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!llmRes.ok) throw new Error(\`LLM error: \${llmRes.status}\`);
    const data = await llmRes.json();
    res.json({ content: data.content[0].text, tokensUsed: data.usage.input_tokens + data.usage.output_tokens, transaction: settle.transaction });
  } catch (error) {
    console.error('Generation error:', error);
    res.status(500).json({ error: 'Generation failed' });
  }
});

app.post('/api/analyze', async (req, res) => {
  const { text, analysisType = 'summary' } = req.body;
  if (!text) return res.status(400).json({ error: 'text is required' });

  const systemPrompt = \`You are an expert analyst. Provide a concise \${analysisType} of the given text.\`;
  const paymentSig = req.headers['payment-signature'] as string;

  if (!paymentSig) {
    const quote = pricing.calculate(text, systemPrompt);
    const requirements = await server.buildRequirements({
      amountAtomic: quote.amountAtomic, resourceUrl: '/api/analyze',
      description: \`Analyze: \${quote.inputTokens.toLocaleString()} tokens\`,
    });
    res.setHeader('PAYMENT-REQUIRED', server.encodeRequirements(requirements));
    res.setHeader('X-Quote-Hash', quote.quoteHash);
    return res.status(402).json({ inputTokens: quote.inputTokens, usdAmount: quote.usdAmount });
  }

  const quoteHash = req.headers['x-quote-hash'] as string;
  if (!pricing.validateQuote(text, quoteHash)) return res.status(400).json({ error: 'Input changed, re-quote required' });

  const settle = await settleAndRespond(paymentSig, res);
  if (!settle.success) return res.status(402).json({ error: settle.error });

  try {
    const llmRes = await fetch(\`\${PROXY}/anthropic/v1/messages\`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 4096, system: systemPrompt, messages: [{ role: 'user', content: text }] }),
    });
    if (!llmRes.ok) throw new Error(\`LLM error: \${llmRes.status}\`);
    const data = await llmRes.json();
    res.json({ analysis: data.content[0].text, analysisType, tokensUsed: data.usage.input_tokens + data.usage.output_tokens, transaction: settle.transaction });
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ error: 'Analysis failed' });
  }
});

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(\`x402 AI Resource running on port \${PORT}\`));
`;

export const aiResourceTemplate: Template = {
  name: 'x402 AI Resource',
  label: 'x402 AI Resource',
  description:
    'Wrap AI models with token-based pricing. Uses createTokenPricing for POST endpoints that call OpenAI/Anthropic/Gemini via proxy.',
  githubRepo: '',
  tags: ['ai', 'llm', 'proxy', 'token-pricing', 'generation', 'analysis', 'chat', 'writing', 'code'],
  icon: 'i-ph:brain',
  files: {
    'index.ts': indexTs,
    'package.json': packageJson('x402-ai-resource'),
    Dockerfile: dockerfile,
    'tsconfig.json': tsconfig,
  },
};
