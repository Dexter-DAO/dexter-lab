---
name: x402-resource-builder
description: Build x402 paid API resources using @dexterai/x402 SDK. Creates monetized endpoints that accept USDC payments on Solana.
version: 1.0.0
author: Dexter
license: MIT
tags:
  - x402
  - payments
  - solana
  - api
  - monetization
  - dexter
---

# x402 Resource Builder

You are an expert at building **x402 paid API resources** using the `@dexterai/x402` SDK. Every resource you create is a monetized HTTP endpoint that accepts USDC payments on Solana before serving content.

## What is x402?

x402 is an HTTP-native payment protocol. When a client requests a paid endpoint:
1. Server returns **402 Payment Required** with payment details in `PAYMENT-REQUIRED` header
2. Client signs a payment transaction
3. Client retries with `PAYMENT-SIGNATURE` header
4. Server verifies payment, returns content + `PAYMENT-RESPONSE` receipt

The `@dexterai/x402` SDK handles all of this automatically.

---

## Quick Reference

### Installation

```bash
npm install @dexterai/x402 express
```

### Package Exports

```typescript
// Server middleware and pricing
import { 
  x402Middleware,           // Express middleware for fixed pricing
  createX402Server,         // Manual control
  createDynamicPricing,     // Price by units (chars, bytes, etc.)
  createTokenPricing,       // Price by LLM tokens
  MODEL_PRICING,            // Built-in model rates
} from '@dexterai/x402/server';

// Utilities
import { toAtomicUnits, fromAtomicUnits } from '@dexterai/x402/utils';
```

---

## Pricing Models

### 1. Fixed Price (Simplest)

Use when the price is always the same regardless of input.

```typescript
import express from 'express';
import { x402Middleware } from '@dexterai/x402/server';

const app = express();
app.use(express.json());

app.get('/api/joke',
  x402Middleware({
    payTo: '{{USER_WALLET}}',  // User's Solana wallet - replaced at deploy
    amount: '0.01',            // $0.01 USDC
    description: 'Get a random joke',
  }),
  (req, res) => {
    res.json({ 
      joke: "Why do programmers prefer dark mode? Because light attracts bugs!" 
    });
  }
);

app.listen(3000);
```

### 2. Dynamic Pricing (Scales with Input)

Use when cost depends on input size - characters, bytes, records, pixels, API calls, etc.

```typescript
import express from 'express';
import { createX402Server, createDynamicPricing } from '@dexterai/x402/server';

const app = express();
app.use(express.json());

const server = createX402Server({
  payTo: '{{USER_WALLET}}',
  network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',  // Solana mainnet
});

const pricing = createDynamicPricing({
  unitSize: 1000,      // Price per 1000 characters
  ratePerUnit: 0.001,  // $0.001 per 1000 chars
  minUsd: 0.01,        // Minimum $0.01
  maxUsd: 5.00,        // Maximum $5.00
});

app.post('/api/summarize', async (req, res) => {
  const { text } = req.body;
  const paymentSig = req.headers['payment-signature'];

  if (!paymentSig) {
    // Calculate price based on input length
    const quote = pricing.calculate(text);
    const requirements = await server.buildRequirements({
      amountAtomic: quote.amountAtomic,
      resourceUrl: req.originalUrl,
      description: `Summarize ${text.length} characters`,
    });
    
    res.setHeader('PAYMENT-REQUIRED', server.encodeRequirements(requirements));
    res.setHeader('X-Quote-Hash', quote.quoteHash);
    return res.status(402).json({ 
      usdAmount: quote.usdAmount,
      units: quote.units,
    });
  }

  // Validate quote hasn't changed (prevents manipulation)
  const quoteHash = req.headers['x-quote-hash'];
  if (!pricing.validateQuote(text, quoteHash)) {
    return res.status(400).json({ error: 'Input changed, re-quote required' });
  }

  // Verify and settle payment
  const result = await server.settlePayment(paymentSig);
  if (!result.success) {
    return res.status(402).json({ error: result.errorReason });
  }

  // Process the request
  const summary = await generateSummary(text);
  res.json({ summary, transaction: result.transaction });
});

app.listen(3000);
```

### 3. Token Pricing (LLM-Accurate)

Use for AI/LLM endpoints where cost should match actual token usage.

```typescript
import express from 'express';
import { createX402Server, createTokenPricing } from '@dexterai/x402/server';

const app = express();
app.use(express.json());

const server = createX402Server({
  payTo: '{{USER_WALLET}}',
  network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
});

// Use built-in OpenAI rates
const pricing = createTokenPricing({
  model: 'gpt-4o-mini',
  // Or custom rates for other models:
  // model: 'claude-3-sonnet',
  // inputRate: 3.0,    // $3.00 per 1M input tokens
  // outputRate: 15.0,  // $15.00 per 1M output tokens
});

app.post('/api/chat', async (req, res) => {
  const { prompt, systemPrompt } = req.body;
  const paymentSig = req.headers['payment-signature'];

  if (!paymentSig) {
    const quote = pricing.calculate(prompt, systemPrompt);
    const requirements = await server.buildRequirements({
      amountAtomic: quote.amountAtomic,
      resourceUrl: req.originalUrl,
      description: `${quote.model}: ${quote.inputTokens.toLocaleString()} tokens`,
    });
    
    res.setHeader('PAYMENT-REQUIRED', server.encodeRequirements(requirements));
    res.setHeader('X-Quote-Hash', quote.quoteHash);
    return res.status(402).json({
      inputTokens: quote.inputTokens,
      usdAmount: quote.usdAmount,
      model: quote.model,
    });
  }

  const quoteHash = req.headers['x-quote-hash'];
  if (!pricing.validateQuote(prompt, quoteHash)) {
    return res.status(400).json({ error: 'Prompt changed, re-quote required' });
  }

  const result = await server.settlePayment(paymentSig);
  if (!result.success) {
    return res.status(402).json({ error: result.errorReason });
  }

  // Call the LLM
  const response = await callLLM(prompt, systemPrompt);
  res.json({ response, transaction: result.transaction });
});

app.listen(3000);
```

### 4. Markup Pricing (Cost + Profit)

Use when you're reselling something with a fixed markup (like ordering pizza).

```typescript
import express from 'express';
import { createX402Server } from '@dexterai/x402/server';
import { toAtomicUnits } from '@dexterai/x402/utils';

const app = express();
app.use(express.json());

const server = createX402Server({
  payTo: '{{USER_WALLET}}',
  network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
});

const MARKUP_USD = 1.00;  // $1 profit per order

app.post('/api/order-pizza', async (req, res) => {
  const { pizzaType, address } = req.body;
  const paymentSig = req.headers['payment-signature'];

  if (!paymentSig) {
    // Get the actual pizza price from Dominos
    const pizzaPrice = await getPizzaPrice(pizzaType);  // e.g., $12.99
    const totalPrice = pizzaPrice + MARKUP_USD;          // $13.99
    
    const requirements = await server.buildRequirements({
      amountAtomic: toAtomicUnits(totalPrice, 6),  // Convert to USDC atomic units
      resourceUrl: req.originalUrl,
      description: `Order ${pizzaType} pizza ($${pizzaPrice} + $${MARKUP_USD} fee)`,
    });
    
    res.setHeader('PAYMENT-REQUIRED', server.encodeRequirements(requirements));
    return res.status(402).json({ 
      pizzaPrice,
      fee: MARKUP_USD,
      total: totalPrice,
    });
  }

  const result = await server.settlePayment(paymentSig);
  if (!result.success) {
    return res.status(402).json({ error: result.errorReason });
  }

  // Actually order the pizza
  const order = await orderPizza(pizzaType, address);
  res.json({ 
    orderId: order.id,
    estimatedDelivery: order.eta,
    transaction: result.transaction,
  });
});

app.listen(3000);
```

---

## Available Proxy APIs

Your resource can call these APIs without managing keys. All requests go through Dexter's proxy.

### AI/LLM APIs

```typescript
// OpenAI
const response = await fetch('/proxy/openai/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
  }),
});

// Anthropic Claude
const response = await fetch('/proxy/anthropic/v1/messages', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'claude-3-sonnet-20240229',
    messages: [{ role: 'user', content: prompt }],
  }),
});

// Google Gemini
const response = await fetch('/proxy/gemini/v1/models/gemini-pro:generateContent', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
  }),
});
```

### Solana/Blockchain APIs

```typescript
// Helius RPC
const response = await fetch('/proxy/helius/rpc', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'getBalance',
    params: [walletAddress],
  }),
});

// Helius Token Metadata
const response = await fetch(`/proxy/helius/token/${mintAddress}`);

// Jupiter Quote
const response = await fetch(
  `/proxy/jupiter/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}`
);

// Jupiter Swap
const response = await fetch('/proxy/jupiter/swap', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ quoteResponse, userPublicKey }),
});
```

### External APIs

```typescript
// Any external API via proxy
const response = await fetch('/proxy/external/api.dominos.com/order', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(orderData),
});
```

---

## Resource Structure

Every x402 resource you create should have this structure:

```
my-resource/
├── package.json
├── index.ts          # Main entry point
├── Dockerfile        # For containerized deployment
└── README.md         # What the resource does
```

### package.json

```json
{
  "name": "my-x402-resource",
  "version": "1.0.0",
  "type": "module",
  "main": "index.ts",
  "scripts": {
    "start": "tsx index.ts",
    "dev": "tsx watch index.ts"
  },
  "dependencies": {
    "@dexterai/x402": "^1.4.0",
    "express": "^4.18.0"
  },
  "devDependencies": {
    "tsx": "^4.0.0",
    "@types/express": "^4.17.0",
    "typescript": "^5.0.0"
  }
}
```

### Dockerfile

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

---

## Best Practices

### 1. Always Validate Inputs

```typescript
if (!req.body.text || typeof req.body.text !== 'string') {
  return res.status(400).json({ error: 'text is required' });
}
```

### 2. Handle Errors Gracefully

```typescript
try {
  const result = await someOperation();
  res.json(result);
} catch (error) {
  console.error('Operation failed:', error);
  res.status(500).json({ error: 'Internal error' });
}
```

### 3. Set Reasonable Limits

```typescript
const pricing = createDynamicPricing({
  // ...
  minUsd: 0.01,   // Don't go below $0.01
  maxUsd: 10.00,  // Cap at $10
});
```

### 4. Include Transaction in Response

```typescript
res.json({ 
  data: result,
  transaction: paymentResult.transaction,  // So user can verify
});
```

### 5. Use Descriptive Payment Descriptions

```typescript
const requirements = await server.buildRequirements({
  // ...
  description: `Analyze ${text.length} chars of text for sentiment`,
});
```

---

## Common Patterns

### Freemium (Free Tier + Paid)

```typescript
app.post('/api/analyze', async (req, res) => {
  const { text, premium } = req.body;
  
  if (!premium) {
    // Free tier - limited functionality
    return res.json({ sentiment: 'positive' });
  }
  
  // Premium tier - full analysis with payment
  const paymentSig = req.headers['payment-signature'];
  if (!paymentSig) {
    // Return 402...
  }
  // Full analysis...
});
```

### Subscription Check (Future)

```typescript
// Check if user has active subscription before requiring payment
const hasSubscription = await checkSubscription(req.headers['x-user-id']);
if (hasSubscription) {
  // Skip payment, serve directly
}
```

---

## Deployment

When your resource is ready:

1. Ensure `{{USER_WALLET}}` is used for the `payTo` address
2. Test locally with the preview
3. Click Deploy
4. Your resource will be:
   - Packaged into a container
   - Deployed to Dexter infrastructure
   - Registered in the Dexter Bazaar
   - Accessible at a live URL

The user's wallet will receive all payments automatically via the x402 protocol.

---

## Example: Complete AI Writing Assistant

```typescript
import express from 'express';
import { createX402Server, createTokenPricing } from '@dexterai/x402/server';

const app = express();
app.use(express.json());

const server = createX402Server({
  payTo: '{{USER_WALLET}}',
  network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
});

const pricing = createTokenPricing({
  model: 'gpt-4o-mini',
  minUsd: 0.001,
  maxUsd: 1.00,
});

app.post('/api/write', async (req, res) => {
  const { prompt, style } = req.body;
  
  if (!prompt) {
    return res.status(400).json({ error: 'prompt is required' });
  }
  
  const systemPrompt = `You are a writing assistant. Write in a ${style || 'professional'} style.`;
  const paymentSig = req.headers['payment-signature'];

  if (!paymentSig) {
    const quote = pricing.calculate(prompt, systemPrompt);
    const requirements = await server.buildRequirements({
      amountAtomic: quote.amountAtomic,
      resourceUrl: '/api/write',
      description: `Write content: ${quote.inputTokens} input tokens`,
    });
    
    res.setHeader('PAYMENT-REQUIRED', server.encodeRequirements(requirements));
    res.setHeader('X-Quote-Hash', quote.quoteHash);
    return res.status(402).json({
      inputTokens: quote.inputTokens,
      usdAmount: quote.usdAmount,
    });
  }

  const quoteHash = req.headers['x-quote-hash'];
  if (!pricing.validateQuote(prompt, quoteHash)) {
    return res.status(400).json({ error: 'Prompt changed' });
  }

  const result = await server.settlePayment(paymentSig);
  if (!result.success) {
    return res.status(402).json({ error: result.errorReason });
  }

  // Call OpenAI via proxy
  const llmResponse = await fetch('/proxy/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
    }),
  });
  
  const llmData = await llmResponse.json();
  const content = llmData.choices[0].message.content;

  res.json({ 
    content,
    tokensUsed: llmData.usage.total_tokens,
    transaction: result.transaction,
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`x402 resource running on port ${PORT}`);
});
```

---

## Remember

- **`{{USER_WALLET}}`** - Always use this placeholder for the payTo address
- **Proxy APIs** - Use `/proxy/*` endpoints, never hardcode API keys
- **Payment verification** - Always validate and settle before serving content
- **Quote hashes** - Prevent manipulation on dynamic pricing
- **Error handling** - Return clear errors, log issues
- **Test locally** - Use the preview before deploying
