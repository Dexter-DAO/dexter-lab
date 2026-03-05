<p align="center">
  <img src="./public/dexter-wordmark.svg" alt="Dexter Lab wordmark" width="420">
</p>

<p align="center">
  <strong>Build, deploy, and monetize paid APIs from your browser.</strong>
</p>

<p align="center">
  <a href="https://lab.dexter.cash"><img src="https://img.shields.io/badge/live-lab.dexter.cash-16a34a?style=for-the-badge" alt="Live app"></a>
  <a href="https://docs.dexter.cash"><img src="https://img.shields.io/badge/docs-docs.dexter.cash-0ea5e9?style=for-the-badge" alt="Docs"></a>
  <a href="https://www.npmjs.com/package/@dexterai/x402"><img src="https://img.shields.io/npm/v/@dexterai/x402?style=for-the-badge" alt="x402 npm"></a>
  <a href="https://github.com/Dexter-DAO/dexter-lab/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-2563eb?style=for-the-badge" alt="MIT license"></a>
</p>

<p align="center">
  <a href="https://lab.dexter.cash">Live App</a> ·
  <a href="https://dexter.cash/sdk">x402 SDK</a> ·
  <a href="https://docs.dexter.cash">Docs</a> ·
  <a href="https://x.com/dexteraisol">Twitter</a> ·
  <a href="https://t.me/dexterdao">Telegram</a>
</p>

Dexter Lab is an AI-powered environment for building x402 resources: paid API endpoints that settle in USDC on Solana. You describe what you want, Dexter generates the service, deploys it, validates it, and publishes it with marketplace-ready metadata.

## Features

- AI-assisted resource generation and iterative editing
- One-click deploy pipeline (Docker + wildcard subdomains)
- Automated post-deploy verification and health tracking
- Wallet-based monetization and payout flows
- ERC-8004 identity minting integrated into deploy lifecycle
- Marketplace publishing and resource management UI

## How It Works

```text
Prompt -> AI generates resource -> Deploy -> Verify -> Publish -> Paid usage via x402
```

Every paid request follows the x402 flow:

1. Client hits paid endpoint
2. API returns `402 Payment Required`
3. Client signs payment transaction
4. Client retries with payment signature
5. API verifies and returns response + receipt metadata

## Architecture

Core runtime layers:

- Frontend: Remix + React + TypeScript
- AI runtime: Claude Agent SDK orchestration
- Deploy runtime: Docker + Traefik + health/reconcile loop
- Settlement layer: `@dexterai/x402` (Solana USDC)
- Data/control integrations: dexter-api + wallet/session services

## Quick Start

### Prerequisites

- Node.js 22+
- pnpm
- Docker

### Setup

```bash
git clone https://github.com/Dexter-DAO/dexter-lab.git
cd dexter-lab
pnpm install
cp .env.example .env.local
pnpm run dev
```

## Environment

See `.env.example` for the full matrix. Common keys include:

- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `DEFAULT_MODEL`
- API/wallet/deploy integration settings consumed by dexter-api and infra

## Repository Structure

- `app/` - Remix app, API routes, deployment and runtime logic
- `public/` - static assets
- `infrastructure/` - infra and deployment scripts
- `docs/` - project docs, architecture notes, and archived materials
- `skills/` - AI skill/context artifacts used by the project

## Development Scripts

- `pnpm run dev` - start development server
- `pnpm run build` - production build
- `pnpm run start` - run built app
- `pnpm run lint` - lint project files
- `pnpm run test` - run test suite

## Related Projects

- `dexter-api` - backend APIs, auth, wallet, and integrations
- `dexter-fe` - broader frontend surfaces
- `dexter-mcp` - MCP server/tooling layer

## Security

- Never commit real secrets or production credentials
- Keep local secrets in `.env`/`.env.local` (gitignored)
- Review payment/wallet changes with extra care

## Contributing

Please open issues/PRs with clear scope and reproduction details for bugs.

## License

MIT - see `LICENSE`.
