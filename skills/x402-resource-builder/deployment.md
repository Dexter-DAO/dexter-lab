# Resource Structure & Deployment

## File Structure

Every x402 resource has this structure:

```
x402-resources/
└── my-resource/
    ├── package.json      # Must include @dexterai/x402
    ├── index.ts          # Express app with x402 payment handling
    └── README.md         # What the resource does (optional)
```

**IMPORTANT:** Always create resource files inside the `x402-resources/` directory, using the resource name as a subdirectory. NEVER create at the workspace root.

**Do NOT create a Dockerfile.** The deployment service generates the correct one automatically using the `dexter-x402-base` image.

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
    "@dexterai/x402": "^1.5.1",
    "express": "^4.18.0"
  },
  "devDependencies": {
    "tsx": "^4.0.0",
    "@types/express": "^4.17.0",
    "typescript": "^5.0.0"
  }
}
```

For resources using WebSocket streams, add `"ws": "^8.0.0"` to dependencies.

---

## CRITICAL: Do NOT Run Locally

x402 resources are **NOT** meant to run inside the WebContainer. They must be deployed via the Dexter Lab deployment API.

**Why not `npm run dev`?**
- **Port conflicts** — Multiple users deploying resources would fight over ports
- **No persistence** — Resources die when the WebContainer session ends
- **No payment routing** — x402 payments need proper DNS routing
- **No discoverability** — Other users can't find or use your resource
- **No metrics** — Can't track usage, revenue, or health

**Always use the deployment API.**

---

## Deployment API

### Deploy a New Resource

```typescript
// POST /api/deploy
const response = await fetch('/api/deploy', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'my-x402-resource',
    description: 'Description of what this resource does',
    type: 'api',  // 'api' | 'webhook' | 'stream'
    creatorWallet: '{{USER_WALLET}}',
    basePriceUsdc: 0.01,
    pricingModel: 'fixed',  // 'fixed' | 'dynamic' | 'token'
    endpoints: [
      {
        path: '/api/data',
        method: 'POST',
        description: 'Get premium data',
        priceUsdc: 0.05,
        exampleBody: '{"query": "test"}',
      }
    ],
    tags: ['data', 'api'],
    files: {
      'index.ts': '... file contents ...',
      'package.json': '... file contents ...',
    },
  }),
});

const result = await response.json();
// {
//   success: true,
//   resourceId: 'res-abc123',
//   publicUrl: 'https://res-abc123.dexter.cash',
//   containerId: 'docker-id'
// }
```

### Update an Existing Resource

```typescript
// PUT /api/deploy/:resourceId
const response = await fetch(`/api/deploy/${resourceId}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    // Include ALL source files (complete set, not just changes)
    files: { ... },
    endpoints: [ ... ],
  }),
});
```

**CRITICAL:** When updating, use `update_x402` tool — NEVER call `deploy_x402` twice for the same resource.

### Resource Management

```typescript
// Check status
const status = await fetch(`/api/deploy/${resourceId}`);
// { status: 'running', publicUrl: '...', healthy: true, requestCount: 150, revenueUsdc: 12.50 }

// Stop/delete
await fetch(`/api/deploy/${resourceId}`, { method: 'DELETE' });

// Get logs
const logs = await fetch(`/api/deploy/${resourceId}/logs`);

// Restart
await fetch(`/api/deploy/${resourceId}/restart`, { method: 'POST' });
```

### After Deployment

Your resource will be:
- **Containerized** — Built into a Docker container with pre-installed SDK
- **Auto-routed** — Traefik automatically discovers and routes traffic
- **Live at a public URL** — `https://{resourceId}.dexter.cash`
- **Rate limited** — 100 req/s average, 200 burst
- **Health checked** — Every 10 seconds
- **Discoverable** — Listed in the Dexter marketplace

### exampleBody (Important)

For every POST/PUT/PATCH endpoint, ALWAYS include an `exampleBody` field with a minimal valid JSON string. This is used by the post-deploy test runner to make a real paid request through the x402 facilitator. If the test runner sends an invalid body, the resource fails its settlement test and enters the marketplace with a failing score.

```typescript
endpoints: [
  {
    path: '/api/generate',
    method: 'POST',
    description: 'Generate content',
    priceUsdc: 0.05,
    exampleBody: '{"prompt": "Write about the future of AI", "style": "professional"}',
  }
]
```
