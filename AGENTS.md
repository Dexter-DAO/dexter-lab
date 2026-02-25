# Dexter Lab - Agent Instructions

## Cursor Cloud specific instructions

### Overview

Dexter Lab is an AI-powered development environment (fork of bolt.diy) for creating x402 resources — paid API endpoints that accept USDC micropayments on Solana. Built with Remix v2 + React 18, Vite 5, Express, and the Claude Agent SDK.

### Running the application

- **Build + run (recommended for cloud agents):** `pnpm run build && NODE_ENV=development node server.js` — runs the Express server on port 5173. This avoids a known Vite dev SSR issue where `stream-browserify` (CJS) fails in Vite's ESM SSR context.
- **Vite dev mode:** `pnpm run dev` — uses `remix vite:dev` with Cloudflare dev proxy. Currently throws `module is not defined` in `stream-browserify` during SSR evaluation. The production build + Express server is the reliable way to test the full app locally.
- The app starts on **port 5173** by default (configurable via `PORT` env var).

### Key commands

See `package.json` scripts. The most relevant:

| Task | Command |
|------|---------|
| Install deps | `pnpm install` |
| Lint | `pnpm lint` |
| Lint + fix | `pnpm lint:fix` |
| Type check | `pnpm typecheck` |
| Tests | `pnpm test` |
| Build | `pnpm run build` |
| Start server | `node server.js` |

### Environment setup

- Copy `.env.example` → `.env.local` and populate API keys. At minimum, `ANTHROPIC_API_KEY` is needed for AI functionality.
- Secrets injected via environment variables are automatically available. The app reads from `.env.local` via dotenv.

### Infrastructure notes

- **Redis**: Optional. The app has an in-memory fallback when Redis is unavailable. Expect `[Redis] Connection error` logs — these are harmless.
- **Docker**: Only needed for deploying x402 resource containers. Not required for running the main app. Without Docker, `/api/health` returns 503 and the client continuously polls it — this is cosmetic noise, not a functional blocker.
- **Traefik**: Only needed for wildcard subdomain routing of deployed resources.

### Known cloud environment limitations

- **Chat send-to-view transition**: In the production Express build (`node server.js`), after sending a chat message from the homepage, the URL changes to `/chat/:id` but the chat content may not visually render. Navigating to the chat via the sidebar **does** work and shows the full AI building experience (code generation, workbench, WebContainer terminal). This is likely related to the Cloudflare dev proxy not being present in Express mode and the framer-motion animation scope not properly hiding the landing page elements.
- **`/api/llmcall` endpoint**: Returns 500 in Express mode because `context.cloudflare?.env` is undefined. The API key resolution falls back to `process.env` but template selection may fail. The main chat still functions because `selectStarterTemplate` catches errors and falls through.

### Pre-commit hooks

Husky runs `pnpm typecheck` and `pnpm lint` before every commit. Both must pass.

### Testing

- Unit tests use Vitest: `pnpm test` (3 test files, 52 tests).
- The `indexedDB is not available` warning during tests is expected (JSDOM environment).
