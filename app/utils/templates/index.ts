/**
 * x402 Resource Templates
 *
 * Eight architecturally distinct scaffolds covering all x402 payment patterns.
 * Each template is in its own file for maintainability.
 *
 * Templates:
 *   1. Data API          — Fixed-price GET/POST endpoints (x402Middleware)
 *   2. AI Resource       — Token-based dynamic pricing (createTokenPricing)
 *   3. API Gateway       — Proxy upstream APIs with x402 payment layer
 *   4. File Server       — Pay-per-download with per-file pricing
 *   5. Webhook Recv      — Paid inbound webhooks (sender pays)
 *   6. Access Pass       — Pay once, get time-limited JWT for unlimited requests
 *   7. Stream            — Pay for time-limited SSE + WebSocket data streams
 *   8. Content Paywall   — Pay-per-article with free previews (micropayments)
 */

import type { Template } from '~/types/template';
import { dataApiTemplate } from './data-api';
import { aiResourceTemplate } from './ai-resource';
import { gatewayTemplate } from './gateway';
import { fileServerTemplate } from './file-server';
import { webhookTemplate } from './webhook';
import { accessPassTemplate } from './access-pass';
import { streamTemplate } from './stream';
import { contentPaywallTemplate } from './content-paywall';
import { agentTemplate } from './agent';

/*
 * Platform-level browser support (x402BrowserSupport, landing page, 404 catch-all)
 * is now injected by createBuildContext() in deployment-service.ts.
 * This applies to ALL resources — both templates and agent-generated code.
 * The old injectPaywall() template wrapper has been removed.
 */

export const STARTER_TEMPLATES: Template[] = [
  agentTemplate,
  dataApiTemplate,
  aiResourceTemplate,
  gatewayTemplate,
  fileServerTemplate,
  webhookTemplate,
  accessPassTemplate,
  streamTemplate,
  contentPaywallTemplate,
];
