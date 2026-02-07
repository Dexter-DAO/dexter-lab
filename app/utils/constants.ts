import { LLMManager } from '~/lib/modules/llm/manager';
import type { Template } from '~/types/template';

export const WORK_DIR_NAME = 'project';
export const WORK_DIR = `/home/${WORK_DIR_NAME}`;
export const MODIFICATIONS_TAG_NAME = 'bolt_file_modifications';
export const MODEL_REGEX = /^\[Model: (.*?)\]\n\n/;
export const PROVIDER_REGEX = /\[Provider: (.*?)\]\n\n/;
export const DEFAULT_MODEL = 'claude-opus-4-5-20251101';
export const PROMPT_COOKIE_KEY = 'cachedPrompt';
export const TOOL_EXECUTION_APPROVAL = {
  APPROVE: 'Yes, approved.',
  REJECT: 'No, rejected.',
} as const;
export const TOOL_NO_EXECUTE_FUNCTION = 'Error: No execute function found on tool';
export const TOOL_EXECUTION_DENIED = 'Error: User denied access to tool execution';
export const TOOL_EXECUTION_ERROR = 'Error: An error occured while calling tool';

const llmManager = LLMManager.getInstance(import.meta.env);

export const PROVIDER_LIST = llmManager.getAllProviders();
export const DEFAULT_PROVIDER = llmManager.getDefaultProvider();

export const providerBaseUrlEnvKeys: Record<string, { baseUrlKey?: string; apiTokenKey?: string }> = {};
PROVIDER_LIST.forEach((provider) => {
  providerBaseUrlEnvKeys[provider.name] = {
    baseUrlKey: provider.config.baseUrlKey,
    apiTokenKey: provider.config.apiTokenKey,
  };
});

/*
 * x402 Resource Templates
 *
 * Two architecturally different scaffolds for the two main types of x402 resources.
 * Templates use inline `files` so they load instantly without GitHub API calls.
 * The LLM template selector picks between them based on the user's message.
 */

const DATA_API_INDEX = `import express from 'express';
import { x402Middleware } from '@dexterai/x402/server';

const app = express();
app.use(express.json());

// ============================================================
// YOUR DATA - Replace this with your actual content
// ============================================================
const items = [
  { id: 1, category: 'example', content: 'This is a placeholder item. Replace with your data!' },
  { id: 2, category: 'example', content: 'Add your real content here - quotes, facts, recipes, etc.' },
];

const categories = [...new Set(items.map((i) => i.category))];

// ============================================================
// FREE ENDPOINTS
// ============================================================

// Health check & endpoint listing
app.get('/', (req, res) => {
  res.json({
    service: 'x402 Data API',
    version: '1.0.0',
    endpoints: [
      { path: '/api/categories', method: 'GET', price: 'free', description: 'List available categories' },
      { path: '/api/item', method: 'GET', price: '$0.005', description: 'Get a random item' },
      { path: '/api/item/:category', method: 'GET', price: '$0.005', description: 'Get item from a category' },
      { path: '/api/collection', method: 'GET', price: '$0.02', description: 'Get the full collection' },
    ],
  });
});

// List categories (free)
app.get('/api/categories', (req, res) => {
  res.json({ categories, total: items.length });
});

// ============================================================
// PAID ENDPOINTS - x402 middleware handles payment automatically
// ============================================================

// Random item ($0.005)
app.get(
  '/api/item',
  x402Middleware({
    payTo: '{{USER_WALLET}}',
    amount: '0.005',
    description: 'Get a random item',
  }),
  (req, res) => {
    const item = items[Math.floor(Math.random() * items.length)];
    res.json(item);
  },
);

// Item by category ($0.005)
app.get(
  '/api/item/:category',
  x402Middleware({
    payTo: '{{USER_WALLET}}',
    amount: '0.005',
    description: 'Get an item from a specific category',
  }),
  (req, res) => {
    const categoryItems = items.filter((i) => i.category === req.params.category);

    if (categoryItems.length === 0) {
      return res.status(404).json({ error: 'Category not found', available: categories });
    }

    const item = categoryItems[Math.floor(Math.random() * categoryItems.length)];
    res.json(item);
  },
);

// Full collection ($0.02)
app.get(
  '/api/collection',
  x402Middleware({
    payTo: '{{USER_WALLET}}',
    amount: '0.02',
    description: 'Get the full collection',
  }),
  (req, res) => {
    res.json({ items, total: items.length });
  },
);

// Error handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(\`x402 Data API running on port \${PORT}\`);
});
`;

const AI_RESOURCE_INDEX = `import express from 'express';
import { createX402Server, createTokenPricing } from '@dexterai/x402/server';

const app = express();
app.use(express.json());

// Proxy URL from environment (injected by deployment service)
const PROXY = process.env.PROXY_BASE_URL || 'https://x402.dexter.cash/proxy';

// Initialize x402 server
const server = createX402Server({
  payTo: '{{USER_WALLET}}',
  network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
});

// Token pricing - matches actual LLM costs
const pricing = createTokenPricing({
  model: 'gpt-5.2',
  minUsd: 0.01,
  maxUsd: 10.0,
});

// ============================================================
// FREE ENDPOINTS
// ============================================================

app.get('/', (req, res) => {
  res.json({
    service: 'x402 AI Resource',
    version: '1.0.0',
    endpoints: [
      { path: '/api/generate', method: 'POST', price: 'token-based', description: 'Generate content with AI' },
      { path: '/api/analyze', method: 'POST', price: 'token-based', description: 'Analyze text with AI' },
    ],
  });
});

// ============================================================
// PAID ENDPOINTS - manual quote/settle for token-based pricing
// ============================================================

// Text generation
app.post('/api/generate', async (req, res) => {
  const { prompt, style = 'professional' } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'prompt is required' });
  }

  const systemPrompt = \`You are a helpful assistant. Write in a \${style} style.\`;
  const paymentSig = req.headers['payment-signature'] as string;

  // Step 1: No payment yet - return price quote
  if (!paymentSig) {
    const quote = pricing.calculate(prompt, systemPrompt);
    const requirements = await server.buildRequirements({
      amountAtomic: quote.amountAtomic,
      resourceUrl: '/api/generate',
      description: \`Generate: \${quote.inputTokens.toLocaleString()} tokens\`,
    });

    res.setHeader('PAYMENT-REQUIRED', server.encodeRequirements(requirements));
    res.setHeader('X-Quote-Hash', quote.quoteHash);

    return res.status(402).json({
      inputTokens: quote.inputTokens,
      usdAmount: quote.usdAmount,
      model: quote.model,
    });
  }

  // Step 2: Payment received - validate and settle
  const quoteHash = req.headers['x-quote-hash'] as string;

  if (!pricing.validateQuote(prompt, quoteHash)) {
    return res.status(400).json({ error: 'Prompt changed, re-quote required' });
  }

  const result = await server.settlePayment(paymentSig);

  if (!result.success) {
    return res.status(402).json({ error: result.errorReason });
  }

  // Step 3: Payment verified - call AI via proxy
  try {
    const llmResponse = await fetch(\`\${PROXY}/openai/v1/chat/completions\`, {
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

    if (!llmResponse.ok) {
      throw new Error(\`LLM error: \${llmResponse.status}\`);
    }

    const data = await llmResponse.json();

    res.json({
      content: data.choices[0].message.content,
      tokensUsed: data.usage.total_tokens,
      transaction: result.transaction,
    });
  } catch (error) {
    console.error('Generation error:', error);
    res.status(500).json({ error: 'Generation failed' });
  }
});

// Text analysis
app.post('/api/analyze', async (req, res) => {
  const { text, analysisType = 'summary' } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'text is required' });
  }

  const systemPrompt = \`You are an expert analyst. Provide a concise \${analysisType} of the given text.\`;
  const paymentSig = req.headers['payment-signature'] as string;

  if (!paymentSig) {
    const quote = pricing.calculate(text, systemPrompt);
    const requirements = await server.buildRequirements({
      amountAtomic: quote.amountAtomic,
      resourceUrl: '/api/analyze',
      description: \`Analyze: \${quote.inputTokens.toLocaleString()} tokens\`,
    });

    res.setHeader('PAYMENT-REQUIRED', server.encodeRequirements(requirements));
    res.setHeader('X-Quote-Hash', quote.quoteHash);

    return res.status(402).json({
      inputTokens: quote.inputTokens,
      usdAmount: quote.usdAmount,
    });
  }

  const quoteHash = req.headers['x-quote-hash'] as string;

  if (!pricing.validateQuote(text, quoteHash)) {
    return res.status(400).json({ error: 'Input changed, re-quote required' });
  }

  const result = await server.settlePayment(paymentSig);

  if (!result.success) {
    return res.status(402).json({ error: result.errorReason });
  }

  try {
    const llmResponse = await fetch(\`\${PROXY}/openai/v1/chat/completions\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-5.2',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text },
        ],
      }),
    });

    if (!llmResponse.ok) {
      throw new Error(\`LLM error: \${llmResponse.status}\`);
    }

    const data = await llmResponse.json();

    res.json({
      analysis: data.choices[0].message.content,
      analysisType,
      tokensUsed: data.usage.total_tokens,
      transaction: result.transaction,
    });
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ error: 'Analysis failed' });
  }
});

// Error handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(\`x402 AI Resource running on port \${PORT}\`);
});
`;

const SHARED_PACKAGE_JSON = (name: string) => `{
  "name": "${name}",
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
`;

const SHARED_DOCKERFILE = `FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
`;

const SHARED_TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["*.ts"]
}
`;

export const STARTER_TEMPLATES: Template[] = [
  {
    name: 'x402 Data API',
    label: 'x402 Data API',
    description: 'Serve content and data at a fixed price per request. Uses x402Middleware for simple GET endpoints.',
    githubRepo: '',
    tags: ['data', 'api', 'content', 'simple', 'fixed-price', 'quotes', 'trivia', 'lookup'],
    icon: 'i-ph:database',
    files: {
      'index.ts': DATA_API_INDEX,
      'package.json': SHARED_PACKAGE_JSON('x402-data-api'),
      Dockerfile: SHARED_DOCKERFILE,
      'tsconfig.json': SHARED_TSCONFIG,
    },
  },
  {
    name: 'x402 AI Resource',
    label: 'x402 AI Resource',
    description:
      'Wrap AI models with token-based pricing. Uses createTokenPricing for POST endpoints that call OpenAI/Anthropic/Gemini via proxy.',
    githubRepo: '',
    tags: ['ai', 'llm', 'proxy', 'token-pricing', 'generation', 'analysis', 'chat', 'writing', 'code'],
    icon: 'i-ph:brain',
    files: {
      'index.ts': AI_RESOURCE_INDEX,
      'package.json': SHARED_PACKAGE_JSON('x402-ai-resource'),
      Dockerfile: SHARED_DOCKERFILE,
      'tsconfig.json': SHARED_TSCONFIG,
    },
  },
];
