/**
 * Aggregated MCP Server
 *
 * Single endpoint at /api/mcp that serves ALL running Lab resources as MCP tools.
 * Add this one URL to Claude Desktop, Cursor, or any MCP client and get access
 * to every paid API on the platform.
 */

import type { LoaderFunction, ActionFunction } from '@remix-run/cloudflare';

const DEXTER_API_BASE = process.env.DEXTER_API_URL || 'https://api.dexter.cash';
const LAB_SECRET = process.env.LAB_INTERNAL_SECRET || '';
const AUTH_HEADERS: Record<string, string> = LAB_SECRET
  ? { 'Content-Type': 'application/json', Authorization: `Bearer ${LAB_SECRET}` }
  : { 'Content-Type': 'application/json' };

interface ResourceEndpoint {
  path: string;
  method: string;
  description?: string;
  priceUsdc?: number;
}

interface Resource {
  id: string;
  name: string;
  description?: string;
  public_url?: string;
  base_price_usdc?: number;
  status: string;
  endpoints_json?: ResourceEndpoint[] | string | null;
}

async function fetchRunningResources(): Promise<Resource[]> {
  const res = await fetch(`${DEXTER_API_BASE}/api/dexter-lab/resources`, { headers: AUTH_HEADERS });

  if (!res.ok) return [];

  const data = (await res.json()) as Resource[] | { resources?: Resource[]; data?: Resource[] };
  const resources = Array.isArray(data) ? data : (data.resources || data.data || []);

  return resources.filter((r) => r.status === 'running' && r.public_url);
}

function parseEndpoints(r: Resource): ResourceEndpoint[] {
  if (!r.endpoints_json) return [];
  if (typeof r.endpoints_json === 'string') {
    try { return JSON.parse(r.endpoints_json); } catch { return []; }
  }
  return r.endpoints_json;
}

interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: () => Promise<{ content: Array<{ type: string; text: string }> }>;
}

function buildTools(resources: Resource[]): McpTool[] {
  const tools: McpTool[] = [];

  for (const r of resources) {
    const endpoints = parseEndpoints(r);
    const paidEndpoints = endpoints.filter((ep) => ep.priceUsdc && ep.priceUsdc > 0);
    const idSuffix = r.id.slice(-6);

    if (paidEndpoints.length === 0) {
      const price = r.base_price_usdc || 0;
      tools.push({
        name: `${r.name}_${idSuffix}`.replace(/[^a-zA-Z0-9_-]/g, '_'),
        description: `${r.description || r.name} ($${price} USDC per call via x402)`,
        inputSchema: { type: 'object', properties: {} },
        handler: async () => ({
          content: [{
            type: 'text',
            text: JSON.stringify({
              resource: r.name, url: r.public_url, price_usdc: price,
              payment_protocol: 'x402',
              instructions: `Send an HTTP request to ${r.public_url}. Returns 402 with PAYMENT-REQUIRED header. Use @dexterai/x402/client wrapFetch to handle payment.`,
            }),
          }],
        }),
      });
    } else {
      for (const ep of paidEndpoints) {
        const price = ep.priceUsdc || r.base_price_usdc || 0;
        tools.push({
          name: `${r.name}_${ep.method}_${ep.path}_${idSuffix}`.replace(/[^a-zA-Z0-9_-]/g, '_'),
          description: `${ep.description || ep.path} on ${r.name} ($${price} USDC via x402)`,
          inputSchema: { type: 'object', properties: {} },
          handler: async () => ({
            content: [{
              type: 'text',
              text: JSON.stringify({
                resource: r.name, endpoint: ep.path, method: ep.method,
                url: `${r.public_url}${ep.path}`, price_usdc: price,
                payment_protocol: 'x402',
                instructions: `Send an HTTP ${ep.method} request to ${r.public_url}${ep.path}. Returns 402 with PAYMENT-REQUIRED header. Use @dexterai/x402/client wrapFetch to handle payment.`,
              }),
            }],
          }),
        });
      }
    }
  }

  return tools;
}

export const action: ActionFunction = async ({ request }) => {
  const body = await request.json() as { jsonrpc?: string; method?: string; id?: unknown; params?: unknown };

  if (body.jsonrpc !== '2.0' || !body.method) {
    return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32600, message: 'Invalid JSON-RPC request' }, id: body.id ?? null }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const resources = await fetchRunningResources();
  const tools = buildTools(resources);
  const toolMap = new Map(tools.map((t) => [t.name, t]));

  if (body.method === 'initialize') {
    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      id: body.id,
      result: {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'Dexter Lab', version: '1.0.0' },
      },
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  if (body.method === 'tools/list') {
    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      id: body.id,
      result: {
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      },
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  if (body.method === 'tools/call') {
    const params = body.params as { name?: string; arguments?: Record<string, unknown> } | undefined;
    const toolName = params?.name;

    if (!toolName) {
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32602, message: 'Missing tool name' },
        id: body.id,
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const tool = toolMap.get(toolName);

    if (!tool) {
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32602, message: `Unknown tool: ${toolName}` },
        id: body.id,
      }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    const result = await tool.handler();

    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      id: body.id,
      result,
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({
    jsonrpc: '2.0',
    error: { code: -32601, message: `Method not found: ${body.method}` },
    id: body.id ?? null,
  }), { status: 404, headers: { 'Content-Type': 'application/json' } });
};

export const loader: LoaderFunction = async () => {
  const resources = await fetchRunningResources();

  return new Response(
    JSON.stringify({
      name: 'Dexter Lab MCP',
      protocol: 'mcp',
      version: '2025-03-26',
      description: 'Aggregated MCP server for all Dexter Lab paid APIs. Add this URL to your MCP client.',
      total_resources: resources.length,
      tools: resources.map((r) => r.name),
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
};
