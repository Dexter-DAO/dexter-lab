/**
 * x402 Agent Template
 *
 * Wraps a standard API in a conversational AI agent layer.
 * The agent accepts natural language via POST /api/chat and uses the
 * underlying API endpoints as tools to answer questions.
 *
 * This is the "agent wrapper" — it turns a dumb API into an intelligent
 * agent that can be discovered and hired by other agents via A2A.
 */

import type { Template } from '~/types/template';
import { packageJson, dockerfile, tsconfig } from './shared';

const indexTs = `import express from 'express';
import { createX402Server, createTokenPricing } from '@dexterai/x402/server';

const app = express();
app.use(express.json());

const PROXY = process.env.PROXY_BASE_URL || 'https://x402.dexter.cash/proxy';
const SELF_URL = process.env.SELF_URL || \`http://localhost:\${process.env.PORT || 3000}\`;

const server = createX402Server({
  payTo: '{{USER_WALLET}}',
  network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
});

const pricing = createTokenPricing({ model: 'gpt-5.2-mini', minUsd: 0.005, maxUsd: 5.0 });

// ============================================================
// TOOL DEFINITIONS
// Define what the AI agent can do by describing the underlying API.
// The AI will call these endpoints internally when a user asks
// a relevant question.
// ============================================================

interface Tool {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description: string; required?: boolean }>;
  method: string;
  path: string;
}

const TOOLS: Tool[] = [
  {
    name: 'get_data',
    description: 'Fetch data from the main API endpoint. Use this when the user asks for information.',
    parameters: {
      query: { type: 'string', description: 'The search query or data request', required: true },
    },
    method: 'GET',
    path: '/api/data',
  },
  // Add more tools here for each endpoint your API provides.
  // The AI agent will automatically decide which tool to use
  // based on the user's natural language request.
];

// Build OpenAI-compatible function definitions from tools
function toolsToFunctions() {
  return TOOLS.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(tool.parameters).map(([key, val]) => [key, { type: val.type, description: val.description }])
        ),
        required: Object.entries(tool.parameters).filter(([, v]) => v.required).map(([k]) => k),
      },
    },
  }));
}

// Execute a tool call by calling the underlying API endpoint
async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  const tool = TOOLS.find(t => t.name === name);
  if (!tool) return JSON.stringify({ error: \`Unknown tool: \${name}\` });

  try {
    let url = \`\${SELF_URL}\${tool.path}\`;
    const options: RequestInit = { headers: { 'Content-Type': 'application/json' } };

    if (tool.method === 'GET') {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(args)) params.set(k, String(v));
      url += '?' + params.toString();
    } else {
      options.method = tool.method;
      options.body = JSON.stringify(args);
    }

    const res = await fetch(url, options);
    const data = await res.text();
    return data;
  } catch (err) {
    return JSON.stringify({ error: \`Tool execution failed: \${err}\` });
  }
}

// ============================================================
// SYSTEM PROMPT
// Defines the agent's personality and behavior
// ============================================================

const SYSTEM_PROMPT = \`You are an intelligent API agent. You have access to tools that query an underlying data service.

When a user asks a question:
1. Determine which tool(s) can answer it
2. Call the appropriate tool(s)
3. Synthesize the results into a clear, helpful natural language response

Be concise but thorough. If the tools can't answer something, say so honestly.
Always provide the data-backed answer, not just your own knowledge.\`;

// ============================================================
// FREE: Info endpoint
// ============================================================

app.get('/', (req, res) => {
  if (req.accepts('html') && !req.accepts('json')) {
    return res.type('html').send(\`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>x402 AI Agent</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;padding:2rem}
.card{max-width:640px;margin:0 auto;background:#1e293b;border-radius:12px;padding:2rem;box-shadow:0 4px 6px rgba(0,0,0,.3)}
h1{font-size:1.5rem;margin-bottom:.25rem;color:#f8fafc}
.badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:.7rem;font-weight:700;background:#7c3aed;color:#fff;margin-bottom:1rem}
p{color:#94a3b8;margin-bottom:1rem;line-height:1.6}
.endpoint{background:#0f172a;border-radius:8px;padding:1rem;margin-top:1rem}
.method{color:#22c55e;font-weight:700;font-family:monospace}
.price{color:#f59e0b;font-size:.85rem}</style></head>
<body><div class="card"><h1>x402 AI Agent</h1><span class="badge">AGENT</span>
<p>This is an AI-powered agent. Talk to it in natural language via the chat endpoint. It uses tools to fetch real data and synthesize intelligent responses.</p>
<div class="endpoint"><span class="method">POST</span> /api/chat<br><span class="price">Token-based pricing (from $0.005)</span>
<p style="margin-top:.5rem;font-size:.85rem">Send: { "message": "your question here" }</p></div>
<div class="endpoint"><span class="method">GET</span> /api/data<br><span class="price">Free (used internally by agent)</span></div>
</div></body></html>\`);
  }
  res.json({
    service: 'x402 AI Agent', version: '1.0.0', type: 'agent',
    endpoints: [
      { path: '/api/chat', method: 'POST', price: 'token-based', description: 'Chat with this agent in natural language' },
      { path: '/api/data', method: 'GET', price: 'free', description: 'Raw data endpoint (used internally by agent)' },
    ],
    tools: TOOLS.map(t => ({ name: t.name, description: t.description })),
  });
});

// ============================================================
// FREE: Raw data endpoint (the underlying API)
// This is what the AI agent calls internally as a "tool"
// ============================================================

app.get('/api/data', (req, res) => {
  const query = req.query.query as string || '';
  // Replace this with your actual data logic
  res.json({
    results: [
      { id: 1, title: 'Sample result', value: 42, query },
    ],
    total: 1,
    query,
  });
});

// ============================================================
// PAID: Chat endpoint — the conversational agent interface
// ============================================================

async function settleAndRespond(paymentSig: string, res: express.Response) {
  const result = await server.settlePayment(paymentSig);
  if (!result.success) return { success: false, error: result.errorReason };
  const paymentResponseData = { success: true, transaction: result.transaction, network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', payer: result.payer || '' };
  res.setHeader('PAYMENT-RESPONSE', btoa(JSON.stringify(paymentResponseData)));
  return { success: true, transaction: result.transaction };
}

app.post('/api/chat', async (req, res) => {
  const { message, history = [] } = req.body;
  if (!message) return res.status(400).json({ error: 'message is required' });

  const paymentSig = req.headers['payment-signature'] as string;

  // If no payment, return a quote
  if (!paymentSig) {
    const quote = pricing.calculate(message, SYSTEM_PROMPT);
    const requirements = await server.buildRequirements({
      amountAtomic: quote.amountAtomic, resourceUrl: '/api/chat',
      description: \`Agent chat: \${quote.inputTokens.toLocaleString()} tokens\`,
    });
    res.setHeader('PAYMENT-REQUIRED', server.encodeRequirements(requirements));
    res.setHeader('X-Quote-Hash', quote.quoteHash);
    return res.status(402).json({ inputTokens: quote.inputTokens, usdAmount: quote.usdAmount, model: quote.model });
  }

  // Validate and settle payment
  const quoteHash = req.headers['x-quote-hash'] as string;
  if (!pricing.validateQuote(message, quoteHash)) return res.status(400).json({ error: 'Message changed, re-quote required' });

  const settle = await settleAndRespond(paymentSig, res);
  if (!settle.success) return res.status(402).json({ error: settle.error });

  // Build conversation messages
  const messages: Array<{ role: string; content: string; tool_calls?: any; tool_call_id?: string }> = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.slice(-10), // Keep last 10 messages for context
    { role: 'user', content: message },
  ];

  try {
    // First LLM call — may include tool calls
    let llmRes = await fetch(\`\${PROXY}/openai/v1/chat/completions\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-5.2-mini',
        messages,
        tools: toolsToFunctions(),
        tool_choice: 'auto',
      }),
    });

    if (!llmRes.ok) throw new Error(\`LLM error: \${llmRes.status}\`);
    let data = await llmRes.json() as any;
    let assistantMsg = data.choices[0].message;

    // Handle tool calls (up to 3 rounds to prevent infinite loops)
    let rounds = 0;
    while (assistantMsg.tool_calls && rounds < 3) {
      rounds++;
      messages.push(assistantMsg);

      // Execute each tool call
      for (const toolCall of assistantMsg.tool_calls) {
        const args = JSON.parse(toolCall.function.arguments || '{}');
        const result = await executeTool(toolCall.function.name, args);
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result,
        });
      }

      // Follow-up LLM call with tool results
      llmRes = await fetch(\`\${PROXY}/openai/v1/chat/completions\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-5.2-mini', messages }),
      });

      if (!llmRes.ok) throw new Error(\`LLM follow-up error: \${llmRes.status}\`);
      data = await llmRes.json();
      assistantMsg = data.choices[0].message;
    }

    res.json({
      response: assistantMsg.content,
      toolsUsed: rounds > 0,
      tokensUsed: data.usage?.total_tokens,
      transaction: settle.transaction,
    });
  } catch (error) {
    console.error('Agent chat error:', error);
    res.status(500).json({ error: 'Agent processing failed' });
  }
});

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(\`x402 AI Agent running on port \${PORT}\`));
`;

export const agentTemplate: Template = {
  name: 'x402 AI Agent',
  label: 'x402 AI Agent',
  description:
    'Deploy an AI agent that wraps your API in a conversational interface. Users chat in natural language; the agent calls your endpoints as tools and synthesizes intelligent responses. Includes A2A discovery.',
  githubRepo: '',
  tags: ['agent', 'ai', 'chat', 'conversational', 'a2a', 'tools', 'natural-language', 'wrapper'],
  icon: 'i-ph:robot',
  files: {
    'index.ts': indexTs,
    'package.json': packageJson('x402-ai-agent'),
    Dockerfile: dockerfile,
    'tsconfig.json': tsconfig,
  },
};
