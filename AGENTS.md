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
- **Docker**: Only needed for deploying x402 resource containers. Not required for running the main app.
- **Traefik**: Only needed for wildcard subdomain routing of deployed resources.

### Pre-commit hooks

Husky runs `pnpm typecheck` and `pnpm lint` before every commit. Both must pass.

### Testing

- Unit tests use Vitest: `pnpm test` (3 test files, 52 tests).
- The `indexedDB is not available` warning during tests is expected (JSDOM environment).
