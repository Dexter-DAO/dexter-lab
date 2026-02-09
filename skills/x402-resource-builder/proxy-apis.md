# Available Proxy APIs

Your resource can call these APIs without managing keys. All requests go through Dexter's proxy.

**IMPORTANT:** Always define the proxy base URL from the environment variable:
```typescript
const PROXY = process.env.PROXY_BASE_URL || 'https://x402.dexter.cash/proxy';
```

---

## AI/LLM APIs

### OpenAI (via `/proxy/openai/*`)

```typescript
const PROXY = process.env.PROXY_BASE_URL || 'https://x402.dexter.cash/proxy';

const response = await fetch(`${PROXY}/openai/v1/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'gpt-5.2',  // or gpt-5-mini, gpt-5-nano
    messages: [{ role: 'user', content: 'Hello' }],
  }),
});
```

### Anthropic Claude (via `/proxy/anthropic/*`)

```typescript
const response = await fetch(`${PROXY}/anthropic/v1/messages`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'claude-opus-4-6',
    max_tokens: 4096,
    messages: [{ role: 'user', content: 'Hello' }],
  }),
});
```

### Google Gemini (via `/proxy/gemini/*`)

```typescript
const response = await fetch(`${PROXY}/gemini/v1/models/gemini-3-pro-preview:generateContent`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    contents: [{ parts: [{ text: 'Hello' }] }],
  }),
});
```

---

## Blockchain APIs

### Helius — Solana RPC + DAS API

```typescript
// RPC call
const response = await fetch(`${PROXY}/helius/rpc`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'getBalance',
    params: ['YourPublicKey...'],
  }),
});

// Token metadata
const response = await fetch(`${PROXY}/helius/token/${mintAddress}`);
```

### Jupiter — Token Prices + Swap Quotes

```typescript
// Quote
const quoteUrl = `${PROXY}/jupiter/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}`;
const response = await fetch(quoteUrl);

// Swap
const response = await fetch(`${PROXY}/jupiter/swap`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ quoteResponse, userPublicKey }),
});
```

### External APIs (via proxy)

```typescript
// Any external API
const response = await fetch(`${PROXY}/external/api.example.com/data`, {
  method: 'GET',
});
```

---

## Model Selection Guide

Choose the right model for your resource's quality and cost needs.

### Recommended Models

| Use Case | Model | Cost | Notes |
|----------|-------|------|-------|
| Fast, cheap responses | `gpt-5-nano` | Lowest | Best for simple lookups, classification |
| General purpose | `gpt-5-mini` | Low | Good balance of quality and cost |
| High quality writing | `gpt-5.2` | Medium | Best for content generation, analysis |
| Premium, complex tasks | `gpt-5.2-pro` | High | Deep reasoning, complex analysis |
| Reasoning tasks | `o4-mini` | Medium | Math, logic, step-by-step reasoning |
| Anthropic premium | `claude-opus-4-6` | High | Excellent for nuanced writing, code |
| Google best | `gemini-3-pro-preview` | Medium | Latest and best Gemini model |

### Models to Avoid

- `gpt-4o-mini` — Superseded by `gpt-5-mini` in every way
- `claude-3-5-sonnet` — Old, use `claude-opus-4-6` instead
- `gemini-1.5-pro`, `gemini-2.5-pro` — Old, use `gemini-3-pro-preview`
- `o1`, `o1-mini`, `o1-pro` — Old reasoning models, use `o4-mini` or `o3`

### Pricing with Model Registry

```typescript
import { MODEL_PRICING, getAvailableModels } from '@dexterai/x402/server';

// Get all models sorted by tier and price
const models = getAvailableModels();

// Check pricing for a specific model
MODEL_PRICING['gpt-5.2'];
// → { input: X, output: Y, maxTokens: 4096, tier: 'standard' }
```

**Tiers:** `fast` (nano/mini), `standard` (5/5.1/5.2), `reasoning` (o3/o4-mini), `premium` (pro variants)
