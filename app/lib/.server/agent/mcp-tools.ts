/**
 * Dexter Lab Agent - Custom MCP Tools
 *
 * Custom tools for building x402 resources:
 * - proxy_api: Access external APIs through Dexter's proxy layer
 * - validate_x402: Validate x402 resource structure
 * - test_x402: Test an x402 resource locally
 * - deploy_x402: Deploy an x402 resource to the Dexter platform
 */

import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { ProxyApiRequest, X402ResourceValidation } from './types';
import {
  tracer,
  traceProxyCall,
  traceProxyResult,
  traceX402CreateStart,
  traceX402DeployStep,
  traceX402DeployComplete,
} from '~/lib/.server/tracing';

/*
 * Deployment API URL - must be a full URL for server-side fetch
 * Uses lab.dexter.cash since that's where the deploy API lives
 */
const DEPLOY_API_URL = process.env.DEPLOY_API_URL || 'https://lab.dexter.cash/api/deploy';

// Get trace context from current execution (simplified - could be passed through)
function getTraceContext() {
  return {
    traceId: tracer.generateTraceId(),
    sessionId: 'mcp-tool',
  };
}

// Proxy base URL - uses environment or defaults to production
const PROXY_BASE_URL = process.env.DEXTER_PROXY_URL || 'https://x402.dexter.cash/proxy';

/**
 * Make a proxied API request
 */
async function makeProxyRequest(
  request: ProxyApiRequest,
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const { traceId, sessionId } = getTraceContext();
  const url = `${PROXY_BASE_URL}/${request.provider}${request.endpoint}`;
  const startTime = Date.now();

  traceProxyCall(traceId, sessionId, request.provider, request.endpoint, request.method);

  try {
    const response = await fetch(url, {
      method: request.method,
      headers: {
        'Content-Type': 'application/json',
        ...request.headers,
      },
      body: request.body ? JSON.stringify(request.body) : undefined,
    });

    const durationMs = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      traceProxyResult(traceId, sessionId, request.provider, false, response.status, durationMs);

      return {
        success: false,
        error: `HTTP ${response.status}: ${errorText}`,
      };
    }

    const data = await response.json();
    traceProxyResult(traceId, sessionId, request.provider, true, response.status, durationMs);

    return { success: true, data };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    tracer.error('PROXY_API', `Proxy request failed: ${request.provider}`, {
      traceId,
      sessionId,
      error: error instanceof Error ? error : new Error(String(error)),
      durationMs,
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Validate x402 resource structure
 * @internal - Will be used when filesystem validation is implemented
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function validateX402Resource(_resourcePath: string): X402ResourceValidation {
  /*
   * This would normally check the filesystem
   * For now, return a placeholder that the agent can use
   */
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
          provider: z
            .enum(['openai', 'anthropic', 'gemini', 'helius', 'jupiter', 'solscan', 'birdeye'])
            .describe('The API provider to call'),
          endpoint: z.string().describe('The API endpoint path (e.g., "/v1/chat/completions" for OpenAI)'),
          method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).describe('HTTP method'),
          body: z.any().optional().describe('Request body for POST/PUT requests'),
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
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify(result.data, null, 2),
                },
              ],
            };
          } else {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `API Error: ${result.error}`,
                },
              ],
              isError: true,
            };
          }
        },
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
          resourcePath: z.string().describe('Path to the x402 resource directory'),
        },
        async (args) => {
          /*
           * For now, provide guidance since we can't directly access filesystem
           * The agent should use Read/Glob tools to check files
           */
          return {
            content: [
              {
                type: 'text' as const,
                text: `To validate the x402 resource at "${args.resourcePath}", check:

1. **package.json** - Must contain:
   - "dependencies": { "@dexterai/x402": "^1.4.0" }
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
              },
            ],
          };
        },
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
          topic: z.enum(['pricing', 'middleware', 'verification', 'all']).describe('Documentation topic to retrieve'),
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
              content: [
                {
                  type: 'text' as const,
                  text: Object.values(docs).join('\n\n---\n\n'),
                },
              ],
            };
          }

          return {
            content: [
              {
                type: 'text' as const,
                text: docs[args.topic] || 'Documentation not found',
              },
            ],
          };
        },
      ),

      // Deploy x402 resource
      tool(
        'deploy_x402',
        `Deploy an x402 resource to the Dexter platform.
        
This tool takes the resource files and configuration, builds a Docker image,
deploys it to Dexter's infrastructure, and returns the public URL.

Requirements before deploying:
1. index.ts/index.js - Express app with x402 middleware
2. package.json - With @dexterai/x402 dependency

NOTE: Do NOT include a Dockerfile - the deployment service generates it automatically.

The resource will be deployed at: https://{resourceId}.dexter.cash`,
        {
          name: z.string().describe('Resource name (e.g., "cover-letter-generator")'),
          description: z.string().describe('Brief description of what the resource does'),
          creatorWallet: z.string().describe('Solana wallet address to receive payments'),
          type: z.enum(['api', 'webhook', 'stream']).describe('Resource type'),
          basePriceUsdc: z.number().describe('Base price in USDC (e.g., 0.05 for $0.05)'),
          pricingModel: z
            .enum(['per-request', 'per-token', 'per-minute', 'flat'])
            .describe('How pricing is calculated'),
          tags: z.array(z.string()).describe('Tags for discovery (e.g., ["ai", "writing"])'),
          endpoints: z
            .array(
              z.object({
                path: z.string().describe('Endpoint path (e.g., "/generate")'),
                method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).describe('HTTP method'),
                description: z.string().describe('What this endpoint does'),
                priceUsdc: z.number().optional().describe('Override price for this endpoint'),
              }),
            )
            .describe('List of endpoints exposed by the resource'),
          files: z
            .record(z.string(), z.string())
            .describe('Map of filename to file content (e.g., {"index.ts": "...", "package.json": "..."})'),
          envVars: z.record(z.string(), z.string()).optional().describe('Optional environment variables'),
        },
        async (args) => {
          const { traceId, sessionId } = getTraceContext();
          const startTime = Date.now();

          // Trace the start of x402 resource creation
          traceX402CreateStart(traceId, sessionId, {
            name: args.name,
            type: args.type,
            pricingModel: args.pricingModel,
            basePriceUsdc: args.basePriceUsdc,
            endpoints: args.endpoints.map((e) => ({ path: e.path, method: e.method })),
          });

          try {
            // Build the deployment request
            const deployRequest = {
              name: args.name,
              description: args.description,
              creatorWallet: args.creatorWallet,
              type: args.type,
              basePriceUsdc: args.basePriceUsdc,
              pricingModel: args.pricingModel,
              tags: args.tags,
              endpoints: args.endpoints,
              files: args.files,
              envVars: args.envVars || {},
            };

            traceX402DeployStep(traceId, sessionId, 'Sending to deployment API', 'start', {
              fileCount: Object.keys(args.files).length,
              fileNames: Object.keys(args.files),
            });

            // Call the deployment API
            const response = await fetch(DEPLOY_API_URL, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(deployRequest),
            });

            const result = (await response.json()) as {
              success?: boolean;
              error?: string;
              resourceId?: string;
              publicUrl?: string;
              containerId?: string;
              testResults?: {
                allPassed: boolean;
                totalDurationMs: number;
                summary: string;
                tests: Array<{
                  testType: string;
                  passed: boolean;
                  durationMs: number;
                  errorMessage?: string;
                }>;
              } | null;
            };

            const durationMs = Date.now() - startTime;

            if (!response.ok || !result.success) {
              traceX402DeployComplete(traceId, sessionId, {
                success: false,
                error: result.error || `HTTP ${response.status}`,
                durationMs,
              });

              /*
               * Special handling for wallet_required: guide the user to connect
               * instead of showing a generic deployment error.
               */
              if (result.error === 'wallet_required') {
                return {
                  content: [
                    {
                      type: 'text' as const,
                      text: `Your resource is ready to deploy, but you need to connect your wallet first.\n\nClick the **Connect** button in the top-right corner of the page to link your Solana wallet, then I'll deploy it for you.`,
                    },
                  ],
                  isError: true,
                };
              }

              return {
                content: [
                  {
                    type: 'text' as const,
                    text: `Deployment failed: ${result.error || 'Unknown error'}\n\nPlease check:\n1. All required files are included\n2. package.json has @dexterai/x402 dependency\n3. index.ts exports an Express app on port 3000`,
                  },
                ],
                isError: true,
              };
            }

            traceX402DeployComplete(traceId, sessionId, {
              success: true,
              resourceId: result.resourceId,
              publicUrl: result.publicUrl,
              durationMs,
            });

            // Build response with deployment info + test results
            let responseText = `🚀 Deployment successful!\n\n**Resource ID:** ${result.resourceId}\n**Public URL:** ${result.publicUrl}\n**Container ID:** ${result.containerId || 'N/A'}\n`;

            if (result.testResults) {
              responseText += `\n---\n\n${result.testResults.summary}\n`;

              if (!result.testResults.allPassed) {
                responseText += `\n⚠️ Some tests failed. The resource is deployed but may need fixes.\n`;
              }
            } else {
              responseText += `\nYour x402 resource is now live and accepting USDC payments.\n`;
            }

            responseText += `\nTest it with:\n\`\`\`bash\ncurl ${result.publicUrl}\n\`\`\`\n\nThe first request will return a 402 Payment Required response with payment details.`;

            return {
              content: [
                {
                  type: 'text' as const,
                  text: responseText,
                },
              ],
            };
          } catch (error) {
            const durationMs = Date.now() - startTime;
            tracer.error('X402_DEPLOY', 'Deployment threw exception', {
              traceId,
              sessionId,
              error: error instanceof Error ? error : new Error(String(error)),
              durationMs,
            });

            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Deployment error: ${error instanceof Error ? error.message : 'Unknown error'}`,
                },
              ],
              isError: true,
            };
          }
        },
      ),

      // Update an existing x402 resource with new code
      tool(
        'update_x402',
        `Update an existing deployed x402 resource with new code.

Use this when the user wants to change, fix, or improve a resource that was already deployed.
This keeps the same resource ID, URL, managed wallet, and revenue history.

Requirements:
1. You must have the resource ID from a previous deploy_x402 call
2. Provide the complete updated source files (all files, not just changed ones)

The resource will be redeployed at the same URL with zero downtime goal.`,
        {
          resourceId: z.string().describe('The resource ID to update (e.g., "res-abc123-xyz")'),
          name: z.string().describe('Resource name'),
          description: z.string().describe('Brief description of what changed'),
          creatorWallet: z.string().describe('Solana wallet address (use {{USER_WALLET}} placeholder)'),
          type: z.enum(['api', 'webhook', 'stream']).describe('Resource type'),
          basePriceUsdc: z.number().describe('Base price in USDC'),
          pricingModel: z
            .enum(['per-request', 'per-token', 'per-minute', 'flat'])
            .describe('Pricing model'),
          tags: z.array(z.string()).describe('Tags for discovery'),
          endpoints: z
            .array(
              z.object({
                path: z.string().describe('Endpoint path'),
                method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).describe('HTTP method'),
                description: z.string().describe('What this endpoint does'),
                priceUsdc: z.number().optional().describe('Override price for this endpoint'),
              }),
            )
            .describe('List of endpoints'),
          files: z
            .record(z.string(), z.string())
            .describe('Complete map of filename to file content (all files, not just changes)'),
          envVars: z.record(z.string(), z.string()).optional().describe('Optional environment variables'),
        },
        async (args) => {
          const startTime = Date.now();

          try {
            const updateRequest = {
              name: args.name,
              description: args.description,
              creatorWallet: args.creatorWallet,
              type: args.type,
              basePriceUsdc: args.basePriceUsdc,
              pricingModel: args.pricingModel,
              tags: args.tags,
              endpoints: args.endpoints,
              files: args.files,
              envVars: args.envVars || {},
            };

            const response = await fetch(`${DEPLOY_API_URL}?id=${args.resourceId}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(updateRequest),
            });

            const result = (await response.json()) as {
              success?: boolean;
              error?: string;
              resourceId?: string;
              publicUrl?: string;
              containerId?: string;
              testResults?: {
                allPassed: boolean;
                totalDurationMs: number;
                summary: string;
                tests: Array<{
                  testType: string;
                  passed: boolean;
                  durationMs: number;
                  errorMessage?: string;
                }>;
              } | null;
            };

            const durationMs = Date.now() - startTime;

            if (!response.ok || !result.success) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: `Update failed: ${result.error || 'Unknown error'}\n\nThe existing resource is still running with the previous code.`,
                  },
                ],
                isError: true,
              };
            }

            let responseText = `🔄 Resource updated successfully!\n\n**Resource ID:** ${result.resourceId}\n**Public URL:** ${result.publicUrl}\n`;

            if (result.testResults) {
              responseText += `\n---\n\n${result.testResults.summary}\n`;

              if (!result.testResults.allPassed) {
                responseText += `\n⚠️ Some tests failed after the update.\n`;
              }
            }

            responseText += `\nThe resource is live with the updated code at the same URL.`;

            return {
              content: [
                {
                  type: 'text' as const,
                  text: responseText,
                },
              ],
            };
          } catch (error) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Update error: ${error instanceof Error ? error.message : 'Unknown error'}`,
                },
              ],
              isError: true,
            };
          }
        },
      ),

      // Get deployment status
      tool(
        'deployment_status',
        `Check the status of a deployed x402 resource.
        
Returns the resource status, health, request count, revenue, and logs.`,
        {
          resourceId: z.string().describe('The resource ID to check (e.g., "res-abc123-xyz")'),
          includeLogs: z.boolean().optional().describe('Include recent container logs'),
        },
        async (args) => {
          try {
            const url = `${DEPLOY_API_URL}?id=${args.resourceId}`;

            const response = await fetch(url);
            const resource = (await response.json()) as {
              error?: string;
              config?: { name?: string };
              status?: string;
              healthy?: boolean;
              publicUrl?: string;
              requestCount?: number;
              revenueUsdc?: number;
              deployedAt?: string;
              containerId?: string;
            };

            if (!response.ok || resource.error) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: `Resource not found: ${args.resourceId}`,
                  },
                ],
                isError: true,
              };
            }

            let statusText = `**Resource:** ${resource.config?.name || args.resourceId}\n`;
            statusText += `**Status:** ${resource.status}\n`;
            statusText += `**Healthy:** ${resource.healthy ? '✅ Yes' : '❌ No'}\n`;
            statusText += `**URL:** ${resource.publicUrl}\n`;
            statusText += `**Requests:** ${resource.requestCount || 0}\n`;
            statusText += `**Revenue:** $${(resource.revenueUsdc || 0).toFixed(4)} USDC\n`;
            statusText += `**Deployed:** ${resource.deployedAt}\n`;

            // Get logs if requested
            if (args.includeLogs && resource.containerId) {
              try {
                const logsResponse = await fetch(`${DEPLOY_API_URL}?id=${args.resourceId}&action=logs&tail=20`, {
                  method: 'POST',
                });
                const logsResult = (await logsResponse.json()) as { logs?: string };

                if (logsResult.logs) {
                  statusText += `\n**Recent Logs:**\n\`\`\`\n${logsResult.logs}\n\`\`\``;
                }
              } catch {
                statusText += '\n**Logs:** Unable to retrieve';
              }
            }

            return {
              content: [
                {
                  type: 'text' as const,
                  text: statusText,
                },
              ],
            };
          } catch (error) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Error checking status: ${error instanceof Error ? error.message : 'Unknown error'}`,
                },
              ],
              isError: true,
            };
          }
        },
      ),
    ],
  });
}
