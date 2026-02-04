---
name: dexter-proxy-apis
description: Documentation for all APIs available through Dexter's proxy layer. Use these in x402 resources without managing API keys.
version: 1.0.0
author: Dexter
license: MIT
tags:
  - api
  - proxy
  - openai
  - helius
  - jupiter
  - solana
  - dexter
---

# Dexter Proxy APIs

x402 resources have access to powerful APIs through Dexter's proxy layer. You don't need API keys - just call the proxy endpoints and Dexter handles authentication.

## Base URL

In local development (WebContainer): `http://localhost:3001/proxy`
In production: `https://api.dexter.cash/proxy`

For simplicity, use relative paths: `/proxy/...`

---

## AI / LLM APIs

### OpenAI (`/proxy/openai/*`)

Full access to OpenAI's API.

**Chat Completions**
```typescript
const response = await fetch('/proxy/openai/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'gpt-5.2',  // or gpt-5, o3, o4-mini (for reasoning)
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello!' }
    ],
    max_completion_tokens: 4096,  // GPT-5 family uses max_completion_tokens
  }),
});
const data = await response.json();
// data.choices[0].message.content
```

**Embeddings**
```typescript
const response = await fetch('/proxy/openai/v1/embeddings', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'text-embedding-3-small',
    input: 'Text to embed',
  }),
});
const data = await response.json();
// data.data[0].embedding (array of floats)
```

**Image Generation**
```typescript
const response = await fetch('/proxy/openai/v1/images/generations', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'dall-e-3',
    prompt: 'A sunset over mountains',
    size: '1024x1024',
    n: 1,
  }),
});
const data = await response.json();
// data.data[0].url
```

**Available Models (2026):**

*Standard Chat:*
- `gpt-5.2` - Latest, best all-around ($1.75/$14 per 1M)
- `gpt-5.1` - Improved instruction following
- `gpt-5` - Base GPT-5, excellent
- `gpt-5-mini` - Small but capable, great value ($0.25/$2 per 1M)
- `gpt-5-nano` - Cheapest, extremely fast ($0.05/$0.40 per 1M)
- `gpt-4.1` - 1M context window specialist
- `gpt-4o` - Previous flagship with vision

*Reasoning (o-series):*
- `o4-mini` - Best reasoning per dollar ($1.10/$4.40 per 1M)
- `o3` - Full reasoning, excellent for complex problems
- `o3-mini` - Improved mini reasoner
- `o1` - Original reasoning model

*Premium:*
- `gpt-5.2-pro` - Maximum capability ($21/$168 per 1M)
- `o3-pro` - Extended reasoning time
- `o1-pro` - Most capable reasoning

*Specialized:*
- `o3-deep-research` - Extended research sessions
- `computer-use-preview` - Can control computer interfaces
- `gpt-realtime` - Real-time audio conversation

*Embeddings:*
- `text-embedding-3-small` - Fast embeddings
- `text-embedding-3-large` - Higher quality embeddings

*Image Generation:*
- `dall-e-3` - Image generation

---

### Anthropic Claude (`/proxy/anthropic/*`)

Access to Claude models.

**Messages**
```typescript
const response = await fetch('/proxy/anthropic/v1/messages', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'claude-3-sonnet-20240229',
    max_tokens: 1024,
    messages: [
      { role: 'user', content: 'Explain quantum computing' }
    ],
  }),
});
const data = await response.json();
// data.content[0].text
```

**Available Models:**
- `claude-3-opus-20240229` - Most capable
- `claude-3-sonnet-20240229` - Balanced (recommended)
- `claude-3-haiku-20240307` - Fast and cheap

---

### Google Gemini (`/proxy/gemini/*`)

Access to Gemini models.

**Generate Content**
```typescript
const response = await fetch('/proxy/gemini/v1beta/models/gemini-pro:generateContent', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    contents: [
      { parts: [{ text: 'Write a haiku about coding' }] }
    ],
  }),
});
const data = await response.json();
// data.candidates[0].content.parts[0].text
```

**Available Models:**
- `gemini-pro` - Text generation
- `gemini-pro-vision` - Multimodal (text + images)

---

## Solana / Blockchain APIs

### Helius (`/proxy/helius/*`)

Solana RPC and enhanced APIs.

**RPC Calls**
```typescript
// Get balance
const response = await fetch('/proxy/helius/rpc', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'getBalance',
    params: ['YourWalletAddress...'],
  }),
});
const data = await response.json();
// data.result.value (lamports)

// Get token accounts
const response = await fetch('/proxy/helius/rpc', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'getTokenAccountsByOwner',
    params: [
      'WalletAddress...',
      { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
      { encoding: 'jsonParsed' }
    ],
  }),
});
```

**Token Metadata**
```typescript
// Get token info by mint address
const response = await fetch('/proxy/helius/token/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const data = await response.json();
// { name, symbol, decimals, logoURI, ... }
```

**Transaction History**
```typescript
const response = await fetch('/proxy/helius/transactions/WalletAddress...');
const data = await response.json();
// Array of parsed transactions
```

**DAS (Digital Asset Standard)**
```typescript
// Get NFTs/assets for a wallet
const response = await fetch('/proxy/helius/das/getAssetsByOwner', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    ownerAddress: 'WalletAddress...',
    page: 1,
    limit: 100,
  }),
});
```

---

### Jupiter (`/proxy/jupiter/*`)

Solana DEX aggregator for swaps.

**Get Quote**
```typescript
const inputMint = 'So11111111111111111111111111111111111111112';  // SOL
const outputMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC
const amount = '1000000000'; // 1 SOL in lamports

const response = await fetch(
  `/proxy/jupiter/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=50`
);
const quote = await response.json();
// { inAmount, outAmount, priceImpactPct, routePlan, ... }
```

**Execute Swap**
```typescript
const response = await fetch('/proxy/jupiter/swap', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    quoteResponse: quote,
    userPublicKey: 'UserWalletAddress...',
    // Optional: wrapUnwrapSOL, feeAccount, etc.
  }),
});
const swapResult = await response.json();
// { swapTransaction } - base64 encoded transaction to sign
```

**Token List**
```typescript
const response = await fetch('/proxy/jupiter/tokens');
const tokens = await response.json();
// Array of { address, symbol, name, decimals, logoURI, ... }
```

**Price**
```typescript
const response = await fetch('/proxy/jupiter/price?ids=So11111111111111111111111111111111111111112');
const prices = await response.json();
// { data: { SOL: { price: 123.45, ... } } }
```

---

### Birdeye (`/proxy/birdeye/*`)

Token analytics and market data.

**Token Overview**
```typescript
const response = await fetch('/proxy/birdeye/token/overview?address=TokenMintAddress...');
const data = await response.json();
// { price, priceChange24h, volume24h, marketCap, ... }
```

**Token Security**
```typescript
const response = await fetch('/proxy/birdeye/token/security?address=TokenMintAddress...');
const data = await response.json();
// { isHoneypot, isMintable, top10HolderPercent, ... }
```

**OHLCV (Candlestick Data)**
```typescript
const response = await fetch(
  '/proxy/birdeye/ohlcv?address=TokenMintAddress...&type=15m&time_from=1704067200&time_to=1704153600'
);
const data = await response.json();
// Array of { o, h, l, c, v, unixTime }
```

---

## External APIs

### General Proxy (`/proxy/external/*`)

For any external API not explicitly supported.

```typescript
// Example: Call any REST API
const response = await fetch('/proxy/external/api.example.com/endpoint', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ data: 'your data' }),
});
```

**Note:** External API calls are rate-limited and monitored. Some domains may be blocked for security.

---

## Rate Limits

| API | Requests/Minute | Notes |
|-----|-----------------|-------|
| OpenAI | 100 | Per session |
| Anthropic | 60 | Per session |
| Gemini | 60 | Per session |
| Helius | 100 | Per session |
| Jupiter | 60 | Per session |
| Birdeye | 30 | Per session |
| External | 30 | Per domain |

If you hit rate limits, you'll receive a `429 Too Many Requests` response. Implement backoff in your resource.

---

## Error Handling

All proxy responses preserve the original API's error format. Common patterns:

```typescript
const response = await fetch('/proxy/openai/v1/chat/completions', { ... });

if (!response.ok) {
  const error = await response.json();
  
  if (response.status === 429) {
    // Rate limited - wait and retry
    await sleep(1000);
    return retry();
  }
  
  if (response.status === 401) {
    // Auth error - this shouldn't happen with proxy
    console.error('Proxy auth error:', error);
  }
  
  throw new Error(error.error?.message || 'API call failed');
}

const data = await response.json();
```

---

## Best Practices

### 1. Use Appropriate Models

```typescript
// For simple tasks, use cheaper models
const model = taskComplexity === 'simple' ? 'gpt-4o-mini' : 'gpt-4o';
```

### 2. Cache When Possible

```typescript
// Cache token metadata, prices, etc.
const tokenCache = new Map();

async function getTokenInfo(mint) {
  if (tokenCache.has(mint)) {
    return tokenCache.get(mint);
  }
  const info = await fetch(`/proxy/helius/token/${mint}`).then(r => r.json());
  tokenCache.set(mint, info);
  return info;
}
```

### 3. Handle Failures Gracefully

```typescript
async function callWithRetry(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}
```

### 4. Stream Long Responses

```typescript
// For long LLM responses, use streaming
const response = await fetch('/proxy/openai/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'gpt-4o-mini',
    messages: [...],
    stream: true,
  }),
});

const reader = response.body.getReader();
// Process chunks...
```

---

## Security Notes

- **No API keys needed** - Dexter handles authentication
- **Rate limited** - Prevents abuse
- **Logged** - Usage is tracked for billing/monitoring
- **Filtered** - Some dangerous operations may be blocked
- **Isolated** - Your requests don't leak to other users

---

## Quick Reference

```typescript
// OpenAI Chat
await fetch('/proxy/openai/v1/chat/completions', { method: 'POST', body: {...} });

// Claude
await fetch('/proxy/anthropic/v1/messages', { method: 'POST', body: {...} });

// Gemini
await fetch('/proxy/gemini/v1beta/models/gemini-pro:generateContent', { method: 'POST', body: {...} });

// Solana Balance
await fetch('/proxy/helius/rpc', { method: 'POST', body: { method: 'getBalance', params: [...] } });

// Token Info
await fetch('/proxy/helius/token/MINT_ADDRESS');

// Swap Quote
await fetch('/proxy/jupiter/quote?inputMint=...&outputMint=...&amount=...');

// Token Price
await fetch('/proxy/birdeye/token/overview?address=MINT_ADDRESS');

// External API
await fetch('/proxy/external/api.example.com/path', { method: 'POST', body: {...} });
```
