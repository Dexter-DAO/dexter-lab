# Best Practices

## 1. Always Validate Inputs

```typescript
if (!req.body.text || typeof req.body.text !== 'string') {
  return res.status(400).json({ error: 'text is required' });
}
```

## 2. Handle Errors Gracefully

```typescript
try {
  const result = await someOperation();
  res.json(result);
} catch (error) {
  console.error('Operation failed:', error);
  res.status(500).json({ error: 'Internal error' });
}
```

## 3. Set Reasonable Price Limits

```typescript
const pricing = createDynamicPricing({
  // ...
  minUsd: 0.01,   // Don't go below $0.01
  maxUsd: 10.00,  // Cap at $10
});
```

## 4. Include Transaction in Response

```typescript
res.json({
  data: result,
  transaction: paymentResult.transaction,  // So user can verify on-chain
});
```

## 5. Use Descriptive Payment Descriptions

```typescript
const requirements = await server.buildRequirements({
  // ...
  description: `Analyze ${text.length} chars of text for sentiment`,
});
```

## 6. Set PAYMENT-RESPONSE Header on Manual Settle

When using `createX402Server` with manual settlement (not `x402Middleware` which does this automatically), always set the `PAYMENT-RESPONSE` header:

```typescript
const result = await server.settlePayment(paymentSig);
if (result.success) {
  const paymentResponseData = {
    success: true,
    transaction: result.transaction,
    network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    payer: result.payer || '',
  };
  res.setHeader('PAYMENT-RESPONSE', btoa(JSON.stringify(paymentResponseData)));
}
```

## 7. Paid Endpoints Should Accept POST

All endpoints that accept x402 payments should use POST (not GET). The SDK client sends payment signatures via POST requests. Free endpoints can use GET.

```typescript
// Good: paid endpoint on POST
app.post('/api/data', x402Middleware({...}), handler);

// Good: free endpoint on GET
app.get('/api/catalog', catalogHandler);

// Bad: paid endpoint on GET — payment signatures may not work correctly
app.get('/api/data', x402Middleware({...}), handler);
```

---

## Common Patterns

### Freemium (Free + Paid Tiers)

```typescript
app.post('/api/analyze', async (req, res) => {
  const { text, premium } = req.body;

  if (!premium) {
    // Free tier — limited functionality
    return res.json({ sentiment: 'positive', confidence: 0.8 });
  }

  // Premium tier — full analysis with payment
  const paymentSig = req.headers['payment-signature'];
  if (!paymentSig) {
    // Return 402 with requirements...
  }
  // Full analysis after payment...
});
```

### Multiple Endpoints with Different Prices

```typescript
// Cheap lookup
app.post('/api/lookup', x402Middleware({ payTo: '{{USER_WALLET}}', amount: '0.005' }), lookupHandler);

// Expensive analysis
app.post('/api/analyze', x402Middleware({ payTo: '{{USER_WALLET}}', amount: '0.10' }), analyzeHandler);

// Premium export
app.post('/api/export', x402Middleware({ payTo: '{{USER_WALLET}}', amount: '0.50' }), exportHandler);
```

### Access Pass with Protected Endpoints

```typescript
import { x402AccessPass } from '@dexterai/x402/server';

// All /api routes protected by access pass
app.use('/api', x402AccessPass({
  payTo: '{{USER_WALLET}}',
  tiers: { '1h': '0.50', '24h': '2.00' },
}));

// These all require a valid pass — no per-request payment
app.get('/api/prices', pricesHandler);
app.get('/api/history', historyHandler);
app.post('/api/query', queryHandler);
```

---

## Complete Example: AI Writing Assistant

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

app.post('/api/write', async (req, res) => {
  const { prompt, style } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  const systemPrompt = `You are a writing assistant. Write in a ${style || 'professional'} style.`;
  const paymentSig = req.headers['payment-signature'] as string;

  if (!paymentSig) {
    const quote = pricing.calculate(prompt, systemPrompt);
    const requirements = await server.buildRequirements({
      amountAtomic: quote.amountAtomic,
      resourceUrl: '/api/write',
      description: `Write content: ${quote.inputTokens} input tokens`,
    });
    res.setHeader('PAYMENT-REQUIRED', server.encodeRequirements(requirements));
    res.setHeader('X-Quote-Hash', quote.quoteHash);
    return res.status(402).json({ inputTokens: quote.inputTokens, usdAmount: quote.usdAmount });
  }

  const quoteHash = req.headers['x-quote-hash'] as string;
  if (!pricing.validateQuote(prompt, quoteHash)) {
    return res.status(400).json({ error: 'Prompt changed' });
  }

  const result = await server.settlePayment(paymentSig);
  if (!result.success) return res.status(402).json({ error: result.errorReason });

  // Set PAYMENT-RESPONSE header
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

  const llmData = await llmResponse.json();
  res.json({
    content: llmData.choices[0].message.content,
    tokensUsed: llmData.usage.total_tokens,
    transaction: result.transaction,
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`x402 resource running on port ${PORT}`));
```
