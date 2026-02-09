/**
 * x402 Resource Templates
 *
 * Seven architecturally distinct scaffolds covering all x402 payment patterns.
 * Each template is in its own file for maintainability.
 *
 * Templates:
 *   1. Data API      — Fixed-price GET/POST endpoints (x402Middleware)
 *   2. AI Resource   — Token-based dynamic pricing (createTokenPricing)
 *   3. API Gateway   — Proxy upstream APIs with x402 payment layer
 *   4. File Server   — Pay-per-download with per-file pricing
 *   5. Webhook Recv  — Paid inbound webhooks (sender pays)
 *   6. Access Pass   — Pay once, get time-limited JWT for unlimited requests
 *   7. Stream        — Pay for time-limited SSE + WebSocket data streams
 */

import type { Template } from '~/types/template';
import { dataApiTemplate } from './data-api';
import { aiResourceTemplate } from './ai-resource';
import { gatewayTemplate } from './gateway';
import { fileServerTemplate } from './file-server';
import { webhookTemplate } from './webhook';
import { accessPassTemplate } from './access-pass';
import { streamTemplate } from './stream';
import { paywallMiddlewareCode } from './paywall';

/**
 * Inject the platform-level paywall middleware into a template's index.ts.
 * Adds the paywall code right after `app.use(express.json())` so it
 * intercepts 402 responses for browsers before they get raw JSON.
 */
function injectPaywall(template: Template): Template {
  if (!template.files) {
    return template;
  }

  const indexTs = template.files['index.ts'];

  if (!indexTs || !indexTs.includes('app.use(express.json())')) {
    return template;
  }

  const injected = indexTs.replace('app.use(express.json());', `app.use(express.json());\n${paywallMiddlewareCode}`);

  return {
    ...template,
    files: { ...template.files, 'index.ts': injected },
  };
}

export const STARTER_TEMPLATES: Template[] = [
  dataApiTemplate,
  aiResourceTemplate,
  gatewayTemplate,
  fileServerTemplate,
  webhookTemplate,
  accessPassTemplate,
  streamTemplate,
].map(injectPaywall);
