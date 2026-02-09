# Pricing Models

## 1. Fixed Price (Simplest)

Use when the price is always the same regardless of input.

```typescript
import express from 'express';
import { x402Middleware } from '@dexterai/x402/server';

const app = express();
app.use(express.json());

app.post('/api/joke',
  x402Middleware({
    payTo: '{{USER_WALLET}}',
    amount: '0.01',            // $0.01 USDC
    description: 'Get a random joke',
  }),
  (req, res) => {
    res.json({ joke: "Why do programmers prefer dark mode? Because light attracts bugs!" });
  }
);

app.listen(3000);
```

## 2. Dynamic Pricing (Scales with Input)

Use when cost depends on input size — characters, bytes, records, pixels, API calls, etc.

```typescript
import express from 'express';
import { createX402Server, createDynamicPricing } from '@dexterai/x402/server';

const app = express();
app.use(express.json());

const server = createX402Server({
  payTo: '{{USER_WALLET}}',
  network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
});

const pricing = createDynamicPricing({
  unitSize: 1000,      // chars per unit
  ratePerUnit: 0.01,   // $0.01 per unit
  minUsd: 0.01,        // floor
  maxUsd: 10.00,       // ceiling
});

app.post('/api/process', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text is required' });

  const paymentSig = req.headers['payment-signature'] as string;

  if (!paymentSig) {
    const quote = pricing.calculate(text);
    const requirements = await server.buildRequirements({
      amountAtomic: quote.amountAtomic,
      resourceUrl: '/api/process',
      description: `Process ${text.length} characters`,
    });
    res.setHeader('PAYMENT-REQUIRED', server.encodeRequirements(requirements));
    res.setHeader('X-Quote-Hash', quote.quoteHash);
    return res.status(402).json({ usdAmount: quote.usdAmount });
  }

  const quoteHash = req.headers['x-quote-hash'] as string;
  if (!pricing.validateQuote(text, quoteHash)) {
    return res.status(400).json({ error: 'Input changed, re-quote required' });
  }

  const result = await server.settlePayment(paymentSig);
  if (!result.success) return res.status(402).json({ error: result.errorReason });

  res.json({ processed: text.toUpperCase(), transaction: result.transaction });
});

app.listen(3000);
```

The client SDK automatically forwards `X-Quote-Hash` on retry.

## 3. Token Pricing (LLM-Accurate)

Use for AI/LLM endpoints. Uses tiktoken for accurate token counting. Supports OpenAI models out of the box, plus custom rates for Anthropic, Gemini, Mistral, or any model.

```typescript
import express from 'express';
import { createX402Server, createTokenPricing } from '@dexterai/x402/server';

const app = express();
app.use(express.json());

const PROXY = process.env.PROXY_BASE_URL || 'https://x402.dexter.cash/proxy';

const server = createX402Server({
  payTo: '{{USER_WALLET}}',
  network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
});

const pricing = createTokenPricing({
  model: 'gpt-5.2',
  minUsd: 0.01,
  maxUsd: 5.00,
});

app.post('/api/generate', async (req, res) => {
  const { prompt, style = 'professional' } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  const systemPrompt = `You are a helpful assistant. Write in a ${style} style.`;
  const paymentSig = req.headers['payment-signature'] as string;

  if (!paymentSig) {
    const quote = pricing.calculate(prompt, systemPrompt);
    const requirements = await server.buildRequirements({
      amountAtomic: quote.amountAtomic,
      resourceUrl: '/api/generate',
      description: `Generate: ${quote.inputTokens.toLocaleString()} tokens`,
    });
    res.setHeader('PAYMENT-REQUIRED', server.encodeRequirements(requirements));
    res.setHeader('X-Quote-Hash', quote.quoteHash);
    return res.status(402).json({
      inputTokens: quote.inputTokens,
      usdAmount: quote.usdAmount,
      model: quote.model,
    });
  }

  const quoteHash = req.headers['x-quote-hash'] as string;
  if (!pricing.validateQuote(prompt, quoteHash)) {
    return res.status(400).json({ error: 'Prompt changed, re-quote required' });
  }

  const result = await server.settlePayment(paymentSig);
  if (!result.success) return res.status(402).json({ error: result.errorReason });

  // Set PAYMENT-RESPONSE header per v2 spec
  const paymentResponseData = { success: true, transaction: result.transaction, network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', payer: result.payer || '' };
  res.setHeader('PAYMENT-RESPONSE', btoa(JSON.stringify(paymentResponseData)));

  const llmResponse = await fetch(`${PROXY}/openai/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-5.2',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
    }),
  });

  if (!llmResponse.ok) throw new Error(`LLM error: ${llmResponse.status}`);
  const data = await llmResponse.json();

  res.json({
    content: data.choices[0].message.content,
    tokensUsed: data.usage.total_tokens,
    transaction: result.transaction,
  });
});

app.listen(3000);
```

### Custom Models (Anthropic, Gemini, etc.)

```typescript
// Anthropic Claude Opus 4.6 (latest, Feb 2026)
const pricing = createTokenPricing({
  model: 'claude-opus-4-6',
  inputRate: 15.0,   // $15.00 per 1M input tokens
  outputRate: 75.0,  // $75.00 per 1M output tokens
  maxTokens: 16384,
});

// Google Gemini 3 Pro (latest, best quality)
const pricing = createTokenPricing({
  model: 'gemini-3-pro-preview',
  inputRate: 2.50,
  outputRate: 15.0,
});
```

### Pricing Guidance

| Use Case | Model | Approach | Typical Price Range |
|----------|-------|----------|---------------------|
| Simple endpoints | Fixed | `x402Middleware` | $0.001 - $0.01 |
| Premium content | Fixed | `x402Middleware` | $0.05 - $0.50 |
| Text processing | Dynamic | `createDynamicPricing` | $0.01 - $1.00 |
| AI generation | Token | `createTokenPricing` | $0.01 - $5.00 |
| Subscriptions | Access Pass | `x402AccessPass` | $0.05 - $10.00 |

Always use `{{USER_WALLET}}` for payTo — it's replaced at deploy time.
