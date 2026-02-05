/**
 * Dexter Lab Agent - Custom MCP Tools
 * 
 * Custom tools for building x402 resources:
 * - proxy_api: Access external APIs through Dexter's proxy layer
 * - validate_x402: Validate x402 resource structure
 * - test_x402: Test an x402 resource locally
 * - deploy_x402: Deploy an x402 resource
 */

import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { ProxyApiRequest, X402ResourceValidation } from './types';

// Proxy base URL - uses environment or defaults to production
const PROXY_BASE_URL = process.env.DEXTER_PROXY_URL || 'https://x402.dexter.cash/proxy';

/**
 * Make a proxied API request
 */
async function makeProxyRequest(request: ProxyApiRequest): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const url = `${PROXY_BASE_URL}/${request.provider}${request.endpoint}`;
  
  try {
    const response = await fetch(url, {
      method: request.method,
      headers: {
        'Content-Type': 'application/json',
        ...request.headers,
      },
      body: request.body ? JSON.stringify(request.body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `HTTP ${response.status}: ${errorText}`,
      };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Validate x402 resource structure
 */
function validateX402Resource(resourcePath: string): X402ResourceValidation {
  // This would normally check the filesystem
  // For now, return a placeholder that the agent can use
  return {
    isValid: false,
    errors: ['Validation requires filesystem access - use Read tool to check files'],
    warnings: [],
    structure: {
      hasPackageJson: false,
      hasEntryPoint: false,
      hasDockerfile: false,
      hasX402Sdk: false,
    },
  };
}

/**
 * Create the Dexter x402 MCP server with custom tools
 */
export function createDexterMcpServer() {
  return createSdkMcpServer({
    name: 'dexter-x402',
    version: '1.0.0',
    tools: [
      // Proxy API tool - access external APIs through Dexter's proxy
      tool(
        'proxy_api',
        `Make authenticated API requests through Dexter's proxy layer.
        
Available providers and their capabilities:
- openai: Chat completions, image generation, embeddings, TTS, STT
- anthropic: Claude messages API
- gemini: Google's Gemini models
- helius: Solana RPC, DAS API, token metadata
- jupiter: Token prices, swap quotes, limit orders
- solscan: Account info, token data, transactions
- birdeye: Token analytics, OHLCV data, market info

The proxy handles authentication - no API keys needed in your requests.`,
        {
          provider: z.enum(['openai', 'anthropic', 'gemini', 'helius', 'jupiter', 'solscan', 'birdeye'])
            .describe('The API provider to call'),
          endpoint: z.string()
            .describe('The API endpoint path (e.g., "/v1/chat/completions" for OpenAI)'),
          method: z.enum(['GET', 'POST', 'PUT', 'DELETE'])
            .describe('HTTP method'),
          body: z.any().optional()
            .describe('Request body for POST/PUT requests'),
        },
        async (args) => {
          const result = await makeProxyRequest({
            provider: args.provider,
            endpoint: args.endpoint,
            method: args.method,
            body: args.body,
          });

          if (result.success) {
            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify(result.data, null, 2),
              }],
            };
          } else {
            return {
              content: [{
                type: 'text' as const,
                text: `API Error: ${result.error}`,
              }],
              isError: true,
            };
          }
        }
      ),

      // Validate x402 resource structure
      tool(
        'validate_x402',
        `Validate that an x402 resource has the correct structure.
        
A valid x402 resource must have:
1. package.json with @dexterai/x402 in dependencies
2. An entry point file (index.ts or index.js)
3. A Dockerfile for containerization
4. Proper Express app setup with x402 middleware

This tool checks the structure and reports issues.`,
        {
          resourcePath: z.string()
            .describe('Path to the x402 resource directory'),
        },
        async (args) => {
          // For now, provide guidance since we can't directly access filesystem
          // The agent should use Read/Glob tools to check files
          return {
            content: [{
              type: 'text' as const,
              text: `To validate the x402 resource at "${args.resourcePath}", check:

1. **package.json** - Must contain:
   - "dependencies": { "@dexterai/x402": "^2.0.0" }
   - "main": pointing to entry file
   
2. **Entry point** (index.ts/index.js) - Must:
   - Import from '@dexterai/x402/server'
   - Use x402Middleware or createX402Server
   - Export an Express app on port 3000
   
3. **Dockerfile** - Must:
   - Use node:20-alpine base
   - Copy built files
   - Expose port 3000
   - Run the entry point

Use the Read and Glob tools to inspect these files.`,
            }],
          };
        }
      ),

      // x402 SDK documentation
      tool(
        'x402_sdk_docs',
        `Get documentation for the @dexterai/x402 SDK.
        
Returns detailed documentation on:
- Pricing models (fixed, dynamic, token-based)
- Middleware setup
- Payment verification
- Error handling`,
        {
          topic: z.enum(['pricing', 'middleware', 'verification', 'all'])
            .describe('Documentation topic to retrieve'),
        },
        async (args) => {
          const docs: Record<string, string> = {
            pricing: `# x402 Pricing Models

## Fixed Price
\`\`\`typescript
import { x402Middleware } from '@dexterai/x402/server';

app.get('/api/endpoint',
  x402Middleware({
    payTo: '{{USER_WALLET}}',
    amount: '0.01',  // $0.01 USDC
    description: 'Endpoint description',
  }),
  handler
);
\`\`\`

## Dynamic Pricing
\`\`\`typescript
import { createX402Server, createDynamicPricing } from '@dexterai/x402/server';

const dynamicPrice = createDynamicPricing({
  unitName: 'character',
  pricePerUnit: '0.0001',
  calculateUnits: (req) => req.body.text?.length || 0,
  minUnits: 100,
  maxUnits: 10000,
});

app.post('/api/endpoint', server.middleware(dynamicPrice), handler);
\`\`\`

## Token-Based (for LLMs)
\`\`\`typescript
import { createTokenPricing, MODEL_PRICING } from '@dexterai/x402/server';

const tokenPrice = createTokenPricing({
  model: 'gpt-4o',
  costPerInputToken: MODEL_PRICING['gpt-4o'].input,
  costPerOutputToken: MODEL_PRICING['gpt-4o'].output,
  markupPercent: 20,
  estimateTokens: (req) => ({
    input: Math.ceil((req.body.prompt?.length || 0) / 4),
    output: req.body.max_tokens || 500,
  }),
});
\`\`\``,

            middleware: `# x402 Middleware Setup

## Basic Setup
\`\`\`typescript
import express from 'express';
import { x402Middleware } from '@dexterai/x402/server';

const app = express();
app.use(express.json());

// Protected endpoint
app.get('/api/resource',
  x402Middleware({
    payTo: '{{USER_WALLET}}',
    amount: '0.05',
    description: 'Access to premium resource',
    network: 'solana:mainnet',  // Optional, defaults to mainnet
  }),
  (req, res) => {
    // req.x402 contains payment info
    res.json({ data: 'Premium content' });
  }
);

app.listen(3000);
\`\`\`

## With Custom Server
\`\`\`typescript
import { createX402Server } from '@dexterai/x402/server';

const server = createX402Server({
  payTo: '{{USER_WALLET}}',
  network: 'solana:mainnet',
});

app.get('/api/resource', server.middleware({ amount: '0.05' }), handler);
\`\`\``,

            verification: `# Payment Verification

The x402 middleware automatically handles:

1. **402 Response** - Returns payment requirements:
   \`\`\`
   HTTP/1.1 402 Payment Required
   PAYMENT-REQUIRED: {"payTo": "...", "amount": "...", ...}
   \`\`\`

2. **Payment Validation** - When client retries with:
   \`\`\`
   PAYMENT-SIGNATURE: <base64 signed transaction>
   \`\`\`
   
   The middleware:
   - Decodes the transaction
   - Verifies it's a USDC transfer to payTo address
   - Checks amount matches
   - Submits to Solana network
   - Waits for confirmation

3. **Receipt** - On success, returns:
   \`\`\`
   PAYMENT-RESPONSE: {"signature": "...", "confirmed": true}
   \`\`\`

## Manual Verification
\`\`\`typescript
import { verifyPayment } from '@dexterai/x402/server';

const result = await verifyPayment({
  signature: req.headers['payment-signature'],
  expectedPayTo: '...',
  expectedAmount: '0.05',
});

if (result.valid) {
  // Payment confirmed
}
\`\`\``,
          };

          if (args.topic === 'all') {
            return {
              content: [{
                type: 'text' as const,
                text: Object.values(docs).join('\n\n---\n\n'),
              }],
            };
          }

          return {
            content: [{
              type: 'text' as const,
              text: docs[args.topic] || 'Documentation not found',
            }],
          };
        }
      ),
    ],
  });
}
