---
name: x402-resource-builder
description: Build x402 paid API resources using @dexterai/x402 SDK v1.5.1. Creates monetized endpoints that accept USDC payments on Solana and Base.
version: 2.0.0
author: Dexter
license: MIT
tags:
  - x402
  - payments
  - solana
  - base
  - api
  - monetization
  - dexter
  - access-pass
---

# x402 Resource Builder

You are an expert at building **x402 paid API resources** using the `@dexterai/x402` SDK. Every resource you create is a monetized HTTP endpoint that accepts USDC payments on Solana or Base.

## What is x402?

x402 is an HTTP-native payment protocol. When a client requests a paid endpoint:
1. Server returns **402 Payment Required** with payment details in `PAYMENT-REQUIRED` header
2. Client signs a USDC transfer transaction
3. Client retries with `PAYMENT-SIGNATURE` header
4. Server verifies payment on-chain, returns content + `PAYMENT-RESPONSE` receipt

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
  x402AccessPass,          // Express middleware for time-limited access passes
  createX402Server,         // Manual control
  createDynamicPricing,     // Price by units (chars, bytes, etc.)
  createTokenPricing,       // Price by LLM tokens
  MODEL_PRICING,            // Built-in model rates
} from '@dexterai/x402/server';

// Utilities
import { toAtomicUnits, fromAtomicUnits } from '@dexterai/x402/utils';
```

---

## Payment Patterns

The SDK supports seven distinct payment patterns. Choose based on your use case.

### Pattern Details

Full documentation for each pattern is in the sub-files:

- **[pricing.md](pricing.md)** — Fixed, dynamic, and token-based pricing models
- **[patterns.md](patterns.md)** — Access pass, API gateway, file server, webhook receiver, SSE/WebSocket streams
- **[proxy-apis.md](proxy-apis.md)** — Available proxy APIs (OpenAI, Anthropic, Gemini, Helius, Jupiter) and model selection
- **[deployment.md](deployment.md)** — Resource structure, deployment API, management
- **[best-practices.md](best-practices.md)** — Validation, error handling, common patterns, rules

### Pattern Summary

| Pattern | Import | When to Use |
|---------|--------|-------------|
| Fixed Price | `x402Middleware` | Same price every request |
| Dynamic Price | `createDynamicPricing` | Price scales with input size |
| Token Price | `createTokenPricing` | LLM/AI token-based pricing |
| Access Pass | `x402AccessPass` | Pay once, unlimited requests for a time window |
| API Gateway | `x402Middleware` + proxy | Monetize any upstream API |
| File Server | `x402Middleware` per file | Pay-per-download with per-file pricing |
| Webhook Receiver | `x402Middleware` | Sender pays to deliver data |
| SSE/WS Stream | `x402Middleware` + SSE/WS | Pay for time-limited data streams |

---

## Remember

- **`{{USER_WALLET}}`** — Always use this placeholder for the payTo address. It is replaced with the real wallet at deploy time.
- **Proxy APIs** — Always use `process.env.PROXY_BASE_URL || 'https://x402.dexter.cash/proxy'` — NEVER use relative `/proxy/*` URLs (they fail in Node.js).
- **Payment verification** — Always validate and settle before serving content.
- **Quote hashes** — Prevent prompt manipulation on dynamic/token pricing.
- **Error handling** — Return clear errors, log issues.
- **Do NOT create a Dockerfile** — The deployment service generates the correct one automatically.
- **POST for payments** — Access pass purchases and all payment flows use POST. Ensure paid endpoints accept POST requests.
- **SDK version** — Always use `@dexterai/x402@^1.5.1` or later.
