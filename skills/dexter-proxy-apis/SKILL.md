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
// Latest image model with text rendering
const response = await fetch('/proxy/openai/v1/images/generations', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'gpt-image-1.5',  // or dall-e-3, gpt-image-1
    prompt: 'A sunset over mountains with "Hello World" text',
    size: '1024x1024',
    n: 1,
  }),
});
const data = await response.json();
// data.data[0].url
```

**Video Generation (Sora)**
```typescript
const response = await fetch('/proxy/openai/v1/videos/generations', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'sora-2',  // or sora-2-pro for extended capabilities
    prompt: 'A cat walking on a beach at sunset, cinematic quality',
  }),
});
const data = await response.json();
// data.id - video generation job ID
// Poll /proxy/openai/v1/videos/{id} for completion
```

**Text-to-Speech**
```typescript
const response = await fetch('/proxy/openai/v1/audio/speech', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'tts-1-hd',  // or tts-1 for real-time
    input: 'Hello, welcome to Dexter Lab!',
    voice: 'alloy',  // alloy, echo, fable, onyx, nova, shimmer
  }),
});
// Response is audio/mpeg binary
const audioBlob = await response.blob();
```

**Speech-to-Text**
```typescript
const formData = new FormData();
formData.append('file', audioFile);
formData.append('model', 'gpt-4o-transcribe');  // or whisper-1

const response = await fetch('/proxy/openai/v1/audio/transcriptions', {
  method: 'POST',
  body: formData,
});
const data = await response.json();
// data.text - transcribed text
```

**Available Models (2026):**

*Codex (FOR ALL CODE GENERATION):*
- `gpt-5.2-codex` - **USE THIS FOR CODE** - Best agentic coding model, state-of-the-art on SWE-Bench

*Standard Chat:*
- `gpt-5.2` - Latest, best all-around ($1.75/$14 per 1M)
- `gpt-5.1` - Improved instruction following
- `gpt-5` - Base GPT-5, excellent ($1.25/$10 per 1M)
- `gpt-5-mini` - Small but capable, great value ($0.25/$2 per 1M)
- `gpt-5-nano` - Cheapest, extremely fast ($0.05/$0.40 per 1M)
- `gpt-4.1` - 1M context window specialist ($2/$8 per 1M)
- `gpt-4o` - Previous flagship with vision ($2.50/$10 per 1M)
- `gpt-4o-mini` - Fast and cheap legacy ($0.15/$0.60 per 1M)

*Reasoning (o-series):*
- `o4-mini` - Best reasoning per dollar ($1.10/$4.40 per 1M)
- `o3` - Full reasoning, excellent for complex problems ($2/$8 per 1M)
- `o3-mini` - Improved mini reasoner ($1.10/$4.40 per 1M)
- `o1` - Original reasoning model ($15/$60 per 1M)
- `o1-mini` - Fast reasoning ($1.10/$4.40 per 1M)

*Premium:*
- `gpt-5.2-pro` - Maximum capability ($21/$168 per 1M)
- `gpt-5-pro` - Enhanced GPT-5 ($15/$120 per 1M)
- `o3-pro` - Extended reasoning time ($20/$80 per 1M)
- `o1-pro` - Most capable reasoning ($150/$600 per 1M)

*Specialized/Research:*
- `o3-deep-research` - Extended research sessions with web access ($10/$40 per 1M)
- `o4-mini-deep-research` - Affordable deep research ($2/$8 per 1M)
- `computer-use-preview` - Can control computer interfaces ($3/$12 per 1M)

*Realtime Audio:*
- `gpt-realtime` - Real-time audio conversation ($4/$16 per 1M)
- `gpt-realtime-mini` - Affordable realtime ($0.60/$2.40 per 1M)

*Speech-to-Text:*
- `gpt-4o-transcribe` - Best transcription, improved accuracy
- `gpt-4o-mini-transcribe` - Fast transcription
- `whisper-1` - Legacy transcription

*Text-to-Speech:*
- `tts-1` - Optimized for real-time ($0.015/1K chars)
- `tts-1-hd` - High quality audio ($0.030/1K chars)

*Embeddings:*
- `text-embedding-3-small` - Fast embeddings, 1536 dimensions
- `text-embedding-3-large` - Higher quality, 3072 dimensions
- `text-embedding-ada-002` - Legacy embeddings

*Image Generation:*
- `gpt-image-1.5` - Latest image generation with text rendering
- `gpt-image-1` - Previous generation
- `dall-e-3` - High quality, 1024x1024 to 1792x1024
- `dall-e-2` - Lower cost, editing/variations support

*Video Generation:*
- `sora-2` - Video generation from text prompts
- `sora-2-pro` - Extended video generation capabilities

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

*Claude 4.5 Family (Latest):*
- `claude-opus-4-5` - **USE THIS FOR CODE** - Flagship, 1M context, 64K output ($5/$25 per 1M)
- `claude-sonnet-4-5` - Balanced reasoning/cost, 200K context, 64K output ($3/$15 per 1M)
- `claude-haiku-4-5` - Fast, cost-efficient, matches Sonnet 4 performance ($1/$5 per 1M)

*Claude 3 Family (Legacy):*
- `claude-3-opus-20240229` - Previous flagship, 200K context ($15/$75 per 1M)
- `claude-3-sonnet-20240229` - Balanced ($3/$15 per 1M)
- `claude-3-haiku-20240307` - Fast and cheap ($0.25/$1.25 per 1M)

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

*Gemini 3 Family (Latest):*
- `gemini-3-pro-preview` - Most intelligent, advanced reasoning
- `gemini-3-flash-preview` - Fast frontier-class performance
- `gemini-3-pro-image-preview` - Text + image generation

*Gemini 2.0 Family:*
- `gemini-2.0-flash` - GA workhorse, 1M context, optimized for speed/agentic tasks
- `gemini-2.0-flash-lite` - Most cost-efficient
- `gemini-2.0-pro-experimental` - Best for coding and complex prompts

*Legacy:*
- `gemini-1.5-pro` - Long context (up to 1M tokens)
- `gemini-pro` - Text generation
- `gemini-pro-vision` - Multimodal (text + images)

---

## Solana / Blockchain APIs

### Helius (`/proxy/helius/*`)

Premium Solana RPC, DAS API, webhooks, and enhanced transaction parsing.

**Standard RPC**
```typescript
// Get balance
const response = await fetch('/proxy/helius/rpc', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'getBalance',
    params: ['WalletAddress...'],
  }),
});
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

// Get recent transactions (enhanced - includes token account txs)
const response = await fetch('/proxy/helius/rpc', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'getSignaturesForAddress',
    params: ['WalletAddress...', { limit: 100 }],
  }),
});
```

**DAS API (Digital Asset Standard) - NFTs & Compressed Assets**
```typescript
// Get single asset
const response = await fetch('/proxy/helius/das', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'getAsset',
    params: { id: 'AssetMintAddress...' },
  }),
});

// Get all assets by owner (NFTs, compressed NFTs, tokens)
const response = await fetch('/proxy/helius/das', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'getAssetsByOwner',
    params: {
      ownerAddress: 'WalletAddress...',
      page: 1,
      limit: 1000,
      displayOptions: { showFungible: true, showNativeBalance: true },
    },
  }),
});

// Search assets with filters
const response = await fetch('/proxy/helius/das', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'searchAssets',
    params: {
      ownerAddress: 'WalletAddress...',
      grouping: ['collection', 'CollectionAddress...'],
      page: 1,
      limit: 100,
    },
  }),
});

// Get assets by creator
const response = await fetch('/proxy/helius/das', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'getAssetsByCreator',
    params: { creatorAddress: 'CreatorAddress...', page: 1, limit: 100 },
  }),
});

// Get proof for compressed NFT
const response = await fetch('/proxy/helius/das', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'getAssetProof',
    params: { id: 'CompressedAssetId...' },
  }),
});
```

**Enhanced Transaction Parsing**
```typescript
// Parse transactions with human-readable data
const response = await fetch('/proxy/helius/transactions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    transactions: ['TxSignature1...', 'TxSignature2...'],
  }),
});
// Returns parsed: type, description, fee, accounts involved, token transfers
```

**Available DAS Methods:**
- `getAsset` - Single asset by ID
- `getAssetBatch` - Multiple assets
- `getAssetProof` / `getAssetProofBatch` - Merkle proofs for compressed
- `getAssetsByOwner` - All assets for wallet
- `getAssetsByCreator` - Assets by creator
- `getAssetsByAuthority` - Assets by authority
- `getAssetsByGroup` - Assets by collection/group
- `searchAssets` - Advanced search with filters
- `getTokenAccounts` - Token accounts for wallet
- `getNftEditions` - NFT edition info

---

### Jupiter (`/proxy/jupiter/*`)

Solana's leading DEX aggregator. Swap, limit orders, DCA, and price APIs.

**Get Quote**
```typescript
const inputMint = 'So11111111111111111111111111111111111111112';  // SOL
const outputMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC
const amount = '1000000000'; // 1 SOL in lamports

const response = await fetch('/proxy/jupiter/swap/v1/quote', {
  method: 'GET',
  params: new URLSearchParams({
    inputMint,
    outputMint,
    amount,
    slippageBps: '50',  // 0.5%
    // Optional:
    // swapMode: 'ExactIn' | 'ExactOut',
    // onlyDirectRoutes: 'true',
    // asLegacyTransaction: 'true',
  }),
});
const quote = await response.json();
// { inputMint, outputMint, inAmount, outAmount, priceImpactPct, routePlan, ... }
```

**Execute Swap**
```typescript
const response = await fetch('/proxy/jupiter/swap/v1/swap', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    quoteResponse: quote,
    userPublicKey: 'UserWalletAddress...',
    wrapAndUnwrapSol: true,
    // Optional:
    // feeAccount: 'FeeAccountAddress...',
    // computeUnitPriceMicroLamports: 1000,
    // prioritizationFeeLamports: 'auto',
  }),
});
const swapResult = await response.json();
// { swapTransaction } - base64 versioned transaction to sign
```

**Price API**
```typescript
// Get prices for multiple tokens
const response = await fetch('/proxy/jupiter/price/v2', {
  method: 'GET',
  params: new URLSearchParams({
    ids: 'So11111111111111111111111111111111111111112,EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    // Optional: vsToken, showExtraInfo
  }),
});
const prices = await response.json();
// { data: { 'So11...': { id, price, ... }, ... } }
```

**Limit Orders (Trigger API)**
```typescript
// Create limit order
const response = await fetch('/proxy/jupiter/trigger/v1/createOrder', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    inputMint: 'So11111111111111111111111111111111111111112',
    outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    maker: 'UserWalletAddress...',
    makingAmount: '1000000000',  // 1 SOL
    takingAmount: '150000000',   // 150 USDC (limit price)
    // Optional:
    // expiredAt: 1735689600,  // Unix timestamp
    // feeBps: 10,
  }),
});
// Returns transaction to sign

// Get open orders
const response = await fetch('/proxy/jupiter/trigger/v1/orders?wallet=WalletAddress...');

// Cancel order
const response = await fetch('/proxy/jupiter/trigger/v1/cancelOrder', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    maker: 'UserWalletAddress...',
    orderId: 'OrderId...',
  }),
});
```

**Token List**
```typescript
const response = await fetch('/proxy/jupiter/tokens/v1/all');
const tokens = await response.json();
// Array of { address, symbol, name, decimals, logoURI, tags, ... }

// Strict list (verified tokens only)
const response = await fetch('/proxy/jupiter/tokens/v1/strict');
```

---

### Solscan (`/proxy/solscan/*`)

Comprehensive Solana blockchain explorer API v2.

**Account Endpoints**
```typescript
// Account detail
const response = await fetch('/proxy/solscan/v2/account?address=WalletAddress...');
// { lamports, ownerProgram, type, ... }

// Account transactions
const response = await fetch('/proxy/solscan/v2/account/transactions?address=WalletAddress...&limit=20');
// Array of transactions with parsed data

// Account token accounts
const response = await fetch('/proxy/solscan/v2/account/token-accounts?address=WalletAddress...');
// All SPL token accounts

// Account transfers
const response = await fetch('/proxy/solscan/v2/account/transfer?address=WalletAddress...&limit=50');
// SOL and token transfers

// Account portfolio (balances)
const response = await fetch('/proxy/solscan/v2/account/portfolio?address=WalletAddress...');
// Total value, token breakdown

// Account DeFi activities
const response = await fetch('/proxy/solscan/v2/account/defi?address=WalletAddress...');
// Swaps, LP, staking activities

// Account staking
const response = await fetch('/proxy/solscan/v2/account/stake?address=WalletAddress...');
// Stake accounts and rewards
```

**Token Endpoints**
```typescript
// Token metadata
const response = await fetch('/proxy/solscan/v2/token/meta?address=TokenMintAddress...');
// { name, symbol, decimals, supply, holder, price, ... }

// Token price
const response = await fetch('/proxy/solscan/v2/token/price?address=TokenMintAddress...');
// { price, priceChange24h }

// Token holders
const response = await fetch('/proxy/solscan/v2/token/holders?address=TokenMintAddress...&limit=20');
// Top holders with amounts and percentages

// Token transfers
const response = await fetch('/proxy/solscan/v2/token/transfer?address=TokenMintAddress...&limit=50');
// Recent token transfers

// Token markets
const response = await fetch('/proxy/solscan/v2/token/markets?address=TokenMintAddress...');
// DEX pairs and liquidity

// Trending tokens
const response = await fetch('/proxy/solscan/v2/token/trending');
// Currently trending tokens

// Token search
const response = await fetch('/proxy/solscan/v2/token/search?keyword=BONK');
// Search tokens by name/symbol
```

**Transaction Endpoints**
```typescript
// Transaction detail
const response = await fetch('/proxy/solscan/v2/transaction?tx=TxSignature...');
// Full parsed transaction with all instructions

// Last transactions
const response = await fetch('/proxy/solscan/v2/transaction/last?limit=20');
// Recent network transactions
```

**Block Endpoints**
```typescript
// Block detail
const response = await fetch('/proxy/solscan/v2/block?block=123456789');
// Block info with transactions

// Last blocks
const response = await fetch('/proxy/solscan/v2/block/last?limit=10');
```

---

### Birdeye (`/proxy/birdeye/*`)

Token analytics, market data, and trading signals.

**Token Overview**
```typescript
const response = await fetch('/proxy/birdeye/defi/token_overview?address=TokenMintAddress...');
// { price, priceChange24h, volume24h, marketCap, liquidity, ... }
```

**Token Security**
```typescript
const response = await fetch('/proxy/birdeye/defi/token_security?address=TokenMintAddress...');
// { isHoneypot, isMintable, freezeable, top10HolderPercent, ... }
```

**Token Price History**
```typescript
const response = await fetch('/proxy/birdeye/defi/history_price?address=TokenMintAddress...&type=1H&time_from=1704067200&time_to=1704153600');
// Array of { value, unixTime }
```

**OHLCV (Candlestick Data)**
```typescript
const response = await fetch('/proxy/birdeye/defi/ohlcv?address=TokenMintAddress...&type=15m&time_from=1704067200&time_to=1704153600');
// Array of { o, h, l, c, v, unixTime }
```

**Token Trades**
```typescript
const response = await fetch('/proxy/birdeye/defi/txs/token?address=TokenMintAddress...&limit=50');
// Recent trades with price, size, side
```

**Wallet Portfolio**
```typescript
const response = await fetch('/proxy/birdeye/v1/wallet/token_list?wallet=WalletAddress...');
// All tokens with values
```

**Multi-Price**
```typescript
const response = await fetch('/proxy/birdeye/defi/multi_price?list_address=Token1,Token2,Token3');
// Batch price lookup
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
