/**
 * Deployment Service
 *
 * Orchestrates x402 resource deployment and lifecycle management.
 * Integrates with Dexter Facilitator for payment registration.
 */

import type {
  ResourceConfig,
  DeployedResource,
  DeploymentStatus,
  DeploymentResult,
  BuildContext,
  ResourceMetrics,
} from './types';
import {
  deployResource,
  stopContainer,
  removeContainer,
  getContainerStatus,
  getContainerLogs,
  listResourceContainers,
  removeImage,
  imageExists,
  getImageLabel,
  startContainer,
} from './docker-client';
import { resourceRegistry } from './redis-client';
import { persistResourceUpdateToApi } from './api-client';

// Base domain for resources (wildcard *.dexter.cash)
const RESOURCE_BASE_DOMAIN = process.env.RESOURCE_BASE_DOMAIN || 'dexter.cash';

/**
 * Generate a unique resource ID
 */
function generateResourceId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);

  return `res-${timestamp}-${random}`;
}

// Base image name for x402 resources
const BASE_IMAGE = 'dexter-x402-base:latest';

// Max build context size (5MB) to prevent abuse
const MAX_BUILD_CONTEXT_BYTES = 5 * 1024 * 1024;

/**
 * Check if the base image is available and log staleness warnings
 */
async function checkBaseImage(): Promise<boolean> {
  const exists = await imageExists(BASE_IMAGE);

  if (!exists) {
    console.error(`[Deploy] Base image ${BASE_IMAGE} not found! Run: ./infrastructure/build-base-image.sh`);
    return false;
  }

  // Check SDK version staleness (non-blocking warning)
  const imageVersion = await getImageLabel(BASE_IMAGE, 'dexter.x402.sdk.version');
  const builtDate = await getImageLabel(BASE_IMAGE, 'dexter.x402.base.built');

  if (imageVersion) {
    console.log(`[Deploy] Base image: SDK v${imageVersion}, built ${builtDate || 'unknown'}`);
  }

  return true;
}

/**
 * Generate Dockerfile for an x402 resource
 * Uses pre-built base image with all standard deps already installed.
 */
function generateDockerfile(_resourceType: 'api' | 'webhook' | 'stream'): string {
  return `# Auto-generated Dockerfile for x402 resource
# Uses pre-built base with @dexterai/x402 + express + typescript
FROM ${BASE_IMAGE}

# Copy source files (deps are already in base image)
COPY . .

# Install any additional dependencies not in base image
RUN npm install --prefer-offline 2>/dev/null; true

# Build TypeScript if present
RUN if [ -f "tsconfig.json" ]; then npx tsc 2>/dev/null || true; fi

# Health check (curl already in base image)
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \\
  CMD curl -f http://localhost:3000/health || exit 1

# Run
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["sh", "-c", "if [ -f dist/index.js ]; then node dist/index.js; else node index.js; fi"]
`;
}

/**
 * Default tsconfig.json for x402 resources
 */
const DEFAULT_TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      target: 'ES2020',
      module: 'ESNext',
      moduleResolution: 'node',
      esModuleInterop: true,
      strict: true,
      skipLibCheck: true,
      outDir: './dist',
      rootDir: '.',
      declaration: false,
    },
    include: ['*.ts'],
    exclude: ['node_modules'],
  },
  null,
  2,
);

/**
 * Find the main entry file key in the files map.
 * Agents may place the entry at index.ts, src/index.ts, or .js equivalents.
 */
function findMainFileKey(files: Map<string, string>): string | null {
  for (const key of ['src/index.ts', 'index.ts', 'src/index.js', 'index.js']) {
    if (files.has(key)) {
      return key;
    }
  }
  return null;
}

/* USDC coin icon SVG for platform-injected pages */
const USDC_ICON = `<svg width="18" height="18" viewBox="0 0 2000 2000" xmlns="http://www.w3.org/2000/svg"><path d="M1000 2000c554.17 0 1000-445.83 1000-1000S1554.17 0 1000 0 0 445.83 0 1000s445.83 1000 1000 1000z" fill="#2775ca"/><path d="M1275 1158.33c0-145.83-87.5-195.83-262.5-216.66-125-16.67-150-50-150-108.34s41.67-95.83 125-95.83c75 0 116.67 25 137.5 87.5 4.17 12.5 16.67 20.83 29.17 20.83h66.66c16.67 0 29.17-12.5 29.17-29.16v-4.17c-16.67-91.67-91.67-162.5-187.5-170.83v-100c0-16.67-12.5-29.17-33.33-33.34h-62.5c-16.67 0-29.17 12.5-33.34 33.34v95.83c-125 16.67-204.16 100-204.16 204.17 0 137.5 83.33 191.66 258.33 212.5 116.67 20.83 154.17 45.83 154.17 112.5s-58.34 112.5-137.5 112.5c-108.34 0-145.84-45.84-158.34-108.34-4.16-16.66-16.66-25-29.16-25h-70.84c-16.66 0-29.16 12.5-29.16 29.17v4.17c16.66 104.16 83.33 179.16 220.83 200v100c0 16.66 12.5 29.16 33.33 33.33h62.5c16.67 0 29.17-12.5 33.34-33.33v-100c125-20.84 208.33-108.34 208.33-220.84z" fill="#fff"/><path d="M787.5 1595.83c-325-116.66-491.67-479.16-370.83-800 62.5-175 200-308.33 370.83-370.83 16.67-8.33 25-20.83 25-41.67V325c0-16.67-8.33-29.17-25-33.33-4.17 0-12.5 0-16.67 4.16-395.83 125-612.5 545.84-487.5 941.67 75 233.33 254.17 412.5 487.5 487.5 16.67 8.33 33.34 0 37.5-16.67 4.17-4.16 4.17-8.33 4.17-16.66v-58.34c0-12.5-12.5-29.16-25-37.5zM1229.17 295.83c-16.67-8.33-33.34 0-37.5 16.67-4.17 4.17-4.17 8.33-4.17 16.67v58.33c0 16.67 12.5 33.33 25 41.67 325 116.66 491.67 479.16 370.83 800-62.5 175-200 308.33-370.83 370.83-16.67 8.33-25 20.83-25 41.67V1700c0 16.67 8.33 29.17 25 33.33 4.17 0 12.5 0 16.67-4.16 395.83-125 612.5-545.84 487.5-941.67-75-237.5-258.34-416.67-487.5-491.67z" fill="#fff"/></svg>`;

/* Dexter crest SVG for platform-injected pages */
const DEXTER_CREST = `<svg width="36" height="36" viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg"><g><path fill="#F2681A" d="m324.93,313.11c-115.5,0-231,0-350,0l350,0z"/><path fill="#FDFAF5" d="m230.43,50.62c1.1.85 2.19 1.7 3.32 2.57 6.02 4.8 11.77 9.88 17.46 15.07.92.84.92.84 1.86 1.69 1.82 1.69 3.59 3.42 5.35 5.16.61.56 1.22 1.13 1.84 1.71 5.66 5.76 6.18 10.43 6.13 18.3.02 1.16.04 2.32.06 3.52.06 3.83.06 7.65.07 11.48.02 2.68.05 5.35.08 8.03.05 5.6.09 11.21.1 16.81.02 7.15.09 14.31.17 21.46.06 5.53.1 11.05.13 16.58.02 2.64.04 5.27.07 7.91.18 17.58.12 32.82-11.24 47.32-7.35 7.27-16.54 12.06-25.42 17.22-1.97 1.16-3.94 2.33-5.91 3.49-7.16 4.24-14.34 8.44-21.53 12.62-4.8 2.79-9.59 5.6-14.38 8.42-1.25.73-2.5 1.47-3.79 2.23-2.32 1.36-4.64 2.73-6.96 4.1-27.47 16.09-27.47 16.09-42.16 12.93-8.06-2.28-14.94-5.82-22.16-10.02-1.17-.67-2.34-1.34-3.54-2.04-24.55-14.25-43.58-27.03-51.9-55.58-1.07-4.58-1.54-8.92-1.52-13.61.28-9.5.28-9.5-3.3-17.97-1.81-1.49-3.68-2.92-5.59-4.28-9.19-7.06-12.7-20.03-14.18-31.06-.54-5.77-.55-11.56-.6-17.35-.03-1.32-.07-2.63-.1-3.99-.01-1.26-.02-2.53-.03-3.83-.02-1.15-.03-2.29-.05-3.47.72-4.02 1.94-5.36 5.21-7.74 2.89-.53 2.89-.53 6.07-.46 1.71.02 1.71.02 3.46.05 1.19.04 2.37.08 3.59.12 1.2.02 2.41.04 3.65.06 2.97.05 5.93.13 8.9.23.14-1.35.29-2.7.43-4.08.63-5 1.78-9.74 3.14-14.58.22-.79.43-1.59.66-2.4.53-1.92 1.06-3.84 1.6-5.76-1.55-.45-1.55-.45-3.13-.9-9.52-3.52-17.1-10.95-21.37-20.1-3.81-9.26-3.87-20.34-.29-29.68 6.49-13.99 16.36-23.23 30.66-29.01 49.81-17.69 115.79 8.35 155.13 38.85z"/><path fill="#F2671A" d="m142.93,22.62c.86.19 1.73.39 2.62.59 36.12 8.21 68.79 24.98 95.38 50.75 1.02.98 2.03 1.97 3.08 2.98 10.84 10.66 10.84 10.66 11.05 14.62-2.06 3.55-5.44 4.18-9.17 5.3-.79.25-1.59.49-2.41.75-28.13 8.43-60.95 6.37-87.13-7.16-.86-.49-1.71-.97-2.6-1.48-7.37-4.05-12.59-3.36-20.59-1.54-22.76 4-48.47 1.53-68.69-9.74-4.88-3.88-8.23-8.29-10.21-14.22-.93-10.38-.67-18.44 5.83-26.83 19.57-23.38 55.99-20.36 82.83-14z"/><path fill="#F16619" d="m44.93,129.12c27.36-.03 54.72-.05 82.08-.06 12.7-.01 25.41-.01 38.11-.03 11.07-.01 22.14-.02 33.2-.02 5.86 0 11.73-.01 17.59-.01 5.51-.01 11.03-.01 16.54-.01 2.03 0 4.06 0 6.09-.01 2.76-.01 5.52 0 8.28 0 .81 0 1.63-.01 2.47-.01 5.51.02 5.51.02 6.81 1.32.22 3.43.22 3.43 0 7-2.75 2.75-3.42 2.66-7.15 2.82-1.41.07-1.41.07-2.85.14-1.47.05-1.47.05-2.98.11-1.49.07-1.49.07-3 .14-2.45.11-4.9.21-7.35.3-.2 1.3-.4 2.59-.6 3.93-2.57 16.08-5.93 29.89-18.89 40.86-10.35 7.28-21.87 8.49-34.17 7.71-13.11-2.33-22.52-9.19-30.33-19.83-4.49-7.64-4.8-17.05-5.83-25.67-4.24.39-8.47.77-12.83 1.17-.28 1.84-.28 1.84-.56 3.71-2.32 14.39-5.63 23.35-16.95 33.11-2.32 1.67-2.32 1.67-4.65 1.67 4 4.67 9.06 6.59 14.87 8.24 3.79 1.09 3.79 1.09 6.12 3.43-.65 5.31-.65 5.31-2.33 7-8.42-.27-15.13-2.29-22.17-7-1.09-1.21-2.17-2.43-3.25-3.65-2.72-2.81-4.45-3.84-8.36-4.16-1.67-.02-3.34-.02-5.01.01-1.77-.04-3.54-.09-5.3-.15-1.27-.04-1.27-.04-2.56-.08-9.26-.54-17.6-4.56-24.51-10.64-9.58-11.11-11.03-22.56-10.72-36.82.02-1.4.03-2.8.05-4.24.04-3.42.1-6.85.17-10.27z"/><path fill="#F26117" d="m172.68,203.08c7.27.09 13.23 1.97 18.87 6.65 2.88 3.07 3.86 5.12 4.25 9.32-.12 1.01-.24 2.02-.36 3.06-2.55.95-2.55.95-5.83 1.17-3.28-2.84-3.28-2.84-5.83-5.83-.36.58-.71 1.16-1.08 1.75-7.6 11.29-20.06 17.74-33.05 21.09-20.36 3.1-36.81-1.66-53.37-13.73-2.33-2.11-2.33-2.11-4.67-5.61.42-3.45.99-4.49 3.5-7 4.07.37 5.95 2.13 8.75 4.96 9.81 8.93 22.53 11.87 35.51 11.69 11.74-1.05 22.38-5.85 31.57-13.15 2.06-2.45 2.06-2.45 3.5-4.67-1.66.07-1.66.07-3.35.15-3.65-.15-3.65-.15-5.98-2.48.75-6.18 1.46-7.19 7.58-7.36z"/></g></svg>`;

/* Shared Dexter-brand CSS for platform-injected pages */
const PLATFORM_STYLES = `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Orbitron:wght@500;700&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',system-ui,-apple-system,sans-serif;background:#0a0a0a;color:#e2e8f0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1rem}
.card{max-width:500px;width:100%;background:rgba(20,20,20,.85);border:1px solid rgba(242,107,26,.12);border-radius:8px;padding:2rem 2rem 1.75rem;text-align:center;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
.crest{margin:0 auto .75rem}
h1{font-family:'Orbitron',sans-serif;font-size:1.15rem;font-weight:700;color:#f1f5f9;letter-spacing:.04em;margin-bottom:.35rem}
.desc{color:#94a3b8;font-size:.9rem;margin-bottom:1.25rem;line-height:1.5}
.price{font-family:'Orbitron',sans-serif;font-size:1.5rem;font-weight:700;color:#F26B1A;margin:.5rem 0 .25rem;display:inline-flex;align-items:center;gap:.35rem}
.price svg{width:1.3em;height:1.3em;flex-shrink:0}
.model{color:#525252;font-size:.75rem;margin-bottom:1.25rem;letter-spacing:.03em}
.stats{font-size:.78rem;color:#525252;margin-bottom:1rem;display:flex;align-items:center;justify-content:center;gap:.75rem}
.stats span.val{color:#a3a3a3;font-weight:600}
.endpoints{background:rgba(242,107,26,.04);border:1px solid rgba(242,107,26,.1);border-radius:6px;padding:.85rem 1rem;text-align:left;margin-bottom:1.25rem}
.endpoints h3{font-size:.75rem;color:#737373;margin-bottom:.6rem;text-transform:uppercase;letter-spacing:.06em;font-weight:600}
.ep{display:flex;align-items:center;gap:.5rem;padding:.35rem 0;font-size:.82rem;cursor:pointer;transition:opacity .1s}
.ep:hover{opacity:.8}
.method{font-family:'SF Mono',Monaco,Consolas,monospace;font-size:.68rem;font-weight:700;padding:2px 5px;border-radius:3px;min-width:2.75rem;text-align:center}
.method.get{background:rgba(74,222,128,.1);color:#4ade80}
.method.post{background:rgba(96,165,250,.1);color:#60a5fa}
.method.put{background:rgba(250,204,21,.1);color:#facc15}
.method.delete{background:rgba(248,113,113,.1);color:#f87171}
.ep code{color:#e2e8f0;font-family:'SF Mono',Monaco,Consolas,monospace;font-size:.82rem}
.ep-desc{color:#525252;font-size:.75rem;flex:1}
.try-tag{font-size:.65rem;color:#F26B1A;border:1px solid rgba(242,107,26,.2);padding:1px 6px;border-radius:3px;margin-left:auto;flex-shrink:0}
.try-panel{margin-top:.5rem;padding:.75rem;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.06);border-radius:6px;display:none}
.try-input{width:100%;min-height:50px;background:rgba(0,0,0,.4);border:1px solid rgba(255,255,255,.1);border-radius:4px;color:#e2e8f0;font-family:'SF Mono',Monaco,Consolas,monospace;font-size:.78rem;padding:.5rem;resize:vertical;margin-bottom:.5rem}
.try-btn{display:inline-flex;align-items:center;gap:.4rem;background:linear-gradient(135deg,#F26B1A,#D13F00);color:#fff;border:none;padding:.5rem 1.25rem;border-radius:5px;font-family:'Inter',sans-serif;font-size:.82rem;font-weight:600;cursor:pointer;transition:opacity .15s}
.try-btn:hover:not(:disabled){opacity:.9}
.try-btn:disabled{opacity:.5;cursor:not-allowed}
.try-btn .spinner{width:14px;height:14px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .6s linear infinite;display:inline-block}
@keyframes spin{to{transform:rotate(360deg)}}
.try-status{font-size:.75rem;color:#737373;margin-top:.35rem;min-height:1em}
.try-status.error{color:#ef4444}
.try-status.success{color:#22c55e}
.try-result{margin-top:.5rem;background:rgba(34,197,94,.05);border:1px solid rgba(34,197,94,.12);border-radius:4px;padding:.5rem;max-height:180px;overflow:auto}
.try-result pre{color:#94a3b8;font-family:'SF Mono',Monaco,Consolas,monospace;font-size:.72rem;white-space:pre-wrap;word-break:break-all;margin:0}
.no-wallet-msg{font-size:.75rem;color:#737373;margin-top:.35rem}
.info{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:6px;padding:.85rem 1rem;font-size:.82rem;color:#737373;line-height:1.6;text-align:left}
.info strong{color:#a3a3a3}
.info code{background:rgba(242,107,26,.08);padding:2px 5px;border-radius:3px;font-size:.78rem;color:#F26B1A;font-family:'SF Mono',Monaco,Consolas,monospace}
.info a{color:#F26B1A;text-decoration:none;font-weight:600}
.info a:hover{text-decoration:underline}
.health{display:inline-block;margin-top:.75rem;font-size:.78rem;color:#F26B1A;text-decoration:none}
.health:hover{text-decoration:underline}
.footer{margin-top:1.25rem;display:flex;align-items:center;justify-content:center;gap:.75rem;font-size:.7rem;color:#404040}
.footer a{color:#525252;text-decoration:none}
.footer a:hover{color:#737373}
.sep{width:3px;height:3px;border-radius:50%;background:#333}`;

/**
 * Generate a Dexter-branded landing page for GET /.
 * Includes clickable "Try" panels for each endpoint with inline wallet payment.
 */
function generateLandingPageHtml(config: ResourceConfig): string {
  const priceNum = config.basePriceUsdc < 0.01 ? `${config.basePriceUsdc}` : `${config.basePriceUsdc.toFixed(2)}`;

  const endpointRows = config.endpoints
    .map((e, i) => {
      const body = e.exampleBody ? e.exampleBody.replace(/'/g, '&#39;').replace(/"/g, '&quot;') : '{}';
      return `<div class="ep-row">
      <div class="ep" onclick="toggleTry(${i})">
        <span class="method ${e.method.toLowerCase()}">${e.method}</span>
        <code>${e.path}</code>
        <span class="ep-desc">${e.description || ''}</span>
        <span class="try-tag">Try</span>
      </div>
      <div class="try-panel" id="try-${i}">
        <textarea class="try-input" id="try-input-${i}">${body}</textarea>
        <button class="try-btn" id="try-btn-${i}" onclick="payAndExecute(${i},'${e.method}','${e.path}')">Pay &amp; Execute</button>
        <div class="try-status" id="try-status-${i}"></div>
        <div class="try-result" id="try-result-${i}" style="display:none"></div>
      </div>
    </div>`;
    })
    .join('\n      ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${config.name}</title>
<style>${PLATFORM_STYLES}</style>
</head>
<body>
<div class="card">
  <div class="crest">${DEXTER_CREST}</div>
  <h1>${config.name}</h1>
  <p class="desc">${config.description}</p>
  <div class="price">${USDC_ICON} ${priceNum}</div>
  <div class="model">${config.pricingModel} pricing</div>
  <div class="stats" id="stats" style="display:none">
    <span><span class="val" id="stat-reqs">0</span> requests</span>
    <span class="sep"></span>
    <span><span class="val" id="stat-earn">0</span> USDC earned</span>
  </div>
  <div class="endpoints">
    <h3>Endpoints <span style="font-weight:400;text-transform:none;color:#525252">(click to try)</span></h3>
    ${endpointRows}
  </div>
  <div class="info">
    <strong>Programmatic access:</strong><br><br>
    <code>npm install @dexterai/x402</code><br><br>
    <a href="https://docs.dexter.cash/docs/sdk/">x402 SDK docs &rarr;</a>
  </div>
  <a class="health" href="/health">Health check &rarr;</a>
  <div class="footer">
    <a href="https://docs.dexter.cash/docs/sdk/">x402</a>
    <span class="sep"></span>
    <a href="https://dexter.cash">Dexter</a>
  </div>
</div>
<script>
// === Stats ===
(function(){
  var rid = '${config.id}';
  function loadStats(){
    fetch('https://x402.dexter.cash/api/dexter-lab/resources/'+rid)
      .then(function(r){return r.json()})
      .then(function(d){
        var el=document.getElementById('stats');
        if(d.request_count!=null){
          document.getElementById('stat-reqs').textContent=Number(d.request_count).toLocaleString();
          document.getElementById('stat-earn').textContent=Number(d.creator_earnings_usdc||0).toFixed(4);
          el.style.display='flex';
        }
      }).catch(function(){});
  }
  loadStats();
  setInterval(loadStats,60000);
})();

// === Try panel toggle ===
function toggleTry(i){
  var p=document.getElementById('try-'+i);
  p.style.display=p.style.display==='none'?'block':'none';
}

// === Wallet detection ===
function getWallet(){
  if(window.phantom&&window.phantom.solana&&window.phantom.solana.isPhantom)return{name:'Phantom',p:window.phantom.solana};
  if(window.solflare&&window.solflare.isSolflare)return{name:'Solflare',p:window.solflare};
  if(window.backpack)return{name:'Backpack',p:window.backpack};
  if(window.solana)return{name:'Wallet',p:window.solana};
  return null;
}

// === Preload Solana libs ===
var solLibs=null;
var solPreload=(function(){
  return Promise.all([
    import('https://esm.sh/@solana/web3.js@1.98.0'),
    import('https://esm.sh/@solana/spl-token@0.4.9')
  ]).then(function(r){solLibs={web3:r[0],spl:r[1]};}).catch(function(){});
})();

// === Pay & Execute ===
async function payAndExecute(i,method,path){
  var btn=document.getElementById('try-btn-'+i);
  var status=document.getElementById('try-status-'+i);
  var result=document.getElementById('try-result-'+i);
  var input=document.getElementById('try-input-'+i);
  function setStatus(m,t){status.textContent=m;status.className='try-status'+(t?' '+t:'');}
  function setBtn(t,d,l){btn.disabled=d;btn.innerHTML=l?'<span class="spinner"></span> '+t:t;}

  var w=getWallet();
  if(!w){setStatus('No Solana wallet detected. Install Phantom, Solflare, or Backpack.','error');return;}

  try{
    setBtn('Connecting...',true,true);setStatus('');
    await w.p.connect();
    if(!w.p.publicKey)throw new Error('Wallet did not connect');

    // 1. Probe endpoint to get 402 requirements
    setBtn('Probing...',true,true);
    var body=input.value||'{}';
    var probeRes=await fetch(path,{method:method,headers:{'Content-Type':'application/json','Accept':'application/json'},body:method!=='GET'?body:undefined});
    if(probeRes.status!==402)throw new Error('Expected 402, got '+probeRes.status);
    var payReqHeader=probeRes.headers.get('PAYMENT-REQUIRED')||probeRes.headers.get('payment-required');
    if(!payReqHeader)throw new Error('No PAYMENT-REQUIRED header');
    var requirements=JSON.parse(atob(payReqHeader));
    var accept=requirements.accepts[0];
    if(!accept)throw new Error('No payment method');

    // 2. Load Solana libs
    setBtn('Preparing...',true,true);
    await solPreload;
    if(!solLibs){
      var r=await Promise.all([import('https://esm.sh/@solana/web3.js@1.98.0'),import('https://esm.sh/@solana/spl-token@0.4.9')]);
      solLibs={web3:r[0],spl:r[1]};
    }
    var W=solLibs.web3,S=solLibs.spl;

    // 3. Build transaction
    setBtn('Building tx...',true,true);
    var payTo=new W.PublicKey(accept.payTo);
    var amount=BigInt(accept.amount||accept.maxAmountRequired);
    var mint=new W.PublicKey(accept.asset);
    var feePayer=accept.extra&&accept.extra.feePayer?new W.PublicKey(accept.extra.feePayer):w.p.publicKey;
    var conn=new W.Connection('https://api.dexter.cash/api/solana/rpc','confirmed');

    var ixs=[];
    ixs.push(W.ComputeBudgetProgram.setComputeUnitLimit({units:12000}));
    ixs.push(W.ComputeBudgetProgram.setComputeUnitPrice({microLamports:1}));
    var mintInfo=await conn.getAccountInfo(mint,'confirmed');
    if(!mintInfo)throw new Error('Token mint not found');
    var progId=mintInfo.owner.toBase58()===S.TOKEN_2022_PROGRAM_ID.toBase58()?S.TOKEN_2022_PROGRAM_ID:S.TOKEN_PROGRAM_ID;
    var mintData=await S.getMint(conn,mint,undefined,progId);
    var srcAta=await S.getAssociatedTokenAddress(mint,w.p.publicKey,false,progId);
    var dstAta=await S.getAssociatedTokenAddress(mint,payTo,false,progId);
    var srcInfo=await conn.getAccountInfo(srcAta,'confirmed');
    if(!srcInfo)throw new Error('No USDC account found in wallet');
    ixs.push(S.createTransferCheckedInstruction(srcAta,mint,dstAta,w.p.publicKey,amount,mintData.decimals,[],progId));
    var bh=(await conn.getLatestBlockhash('confirmed')).blockhash;
    var msg=new W.TransactionMessage({payerKey:feePayer,recentBlockhash:bh,instructions:ixs}).compileToV0Message();
    var tx=new W.VersionedTransaction(msg);

    // 4. Sign
    setBtn('Sign in wallet...',true,true);setStatus('Approve in your wallet');
    var signed=await w.p.signTransaction(tx);
    var ser=signed.serialize();
    var payload='';var bytes=new Uint8Array(ser);
    for(var c=0;c<bytes.length;c+=8192)payload+=String.fromCharCode.apply(null,bytes.slice(c,c+8192));
    payload=btoa(payload);

    // 5. Build payment header
    var pSig={x402Version:accept.x402Version||2,resource:requirements.resource,accepted:accept,payload:payload};
    var pHeader=btoa(JSON.stringify(pSig));

    // 6. Execute paid request
    setBtn('Executing...',true,true);setStatus('Payment submitted...');
    var paidRes=await fetch(path,{method:method,headers:{'Content-Type':'application/json','PAYMENT-SIGNATURE':pHeader},body:method!=='GET'?body:undefined});
    if(paidRes.ok){
      var data=await paidRes.json();
      setBtn('Done',true,false);setStatus('Payment successful','success');
      result.style.display='block';
      result.innerHTML='<pre>'+JSON.stringify(data,null,2).replace(/</g,'&lt;')+'</pre>';
    }else{
      var err=await paidRes.json().catch(function(){return{error:'Request failed'};});
      throw new Error(err.error||err.reason||'Payment failed: '+paidRes.status);
    }
  }catch(e){
    console.error('[x402]',e);
    setBtn('Pay &amp; Execute',false,false);
    setStatus(e.message||'Failed','error');
  }
}
</script>
</body>
</html>`;
}

/**
 * Generate a Dexter-branded 404 page for unmatched routes.
 */
function generate404Html(resourceName: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Not Found — ${resourceName}</title>
<style>${PLATFORM_STYLES}
h1{color:#F26B1A}
a.back{display:inline-block;margin-top:1rem;color:#F26B1A;text-decoration:none;font-size:.85rem;font-weight:500}
a.back:hover{text-decoration:underline}
</style>
</head>
<body>
<div class="card" style="max-width:420px">
  <div class="crest">${DEXTER_CREST}</div>
  <h1>404 — Not Found</h1>
  <p class="desc">This endpoint does not exist on <strong>${resourceName}</strong>.</p>
  <div class="info">
    This is an x402-protected API. Paid endpoints require an x402-compatible client or a browser with a Solana wallet extension.<br><br>
    <code>npm install @dexterai/x402</code><br><br>
    <a href="https://docs.dexter.cash/docs/sdk/">x402 SDK docs &rarr;</a>
  </div>
  <a class="back" href="/">View API details &rarr;</a>
  <div class="footer">
    <a href="https://docs.dexter.cash/docs/sdk/">x402</a>
    <span class="sep"></span>
    <a href="https://dexter.cash">Dexter</a>
  </div>
</div>
</body>
</html>`;
}

/**
 * Inject platform-level middleware into the resource source code.
 *
 * This adds four things to every deployed resource:
 *   1. x402BrowserSupport import + middleware — renders HTML paywall for browsers on 402
 *   2. Health endpoint (if missing) — /health for Docker HEALTHCHECK and monitoring
 *   3. Landing page (if no GET / exists) — branded info page at root
 *   4. 404 catch-all — browser-friendly "not found" instead of Express default
 *
 * Also ensures @dexterai/x402 dependency is at >=1.6.0 for x402BrowserSupport.
 */
function injectPlatformCode(files: Map<string, string>, config: ResourceConfig): void {
  const mainKey = findMainFileKey(files);

  if (!mainKey) {
    return;
  }

  let content = files.get(mainKey)!;

  /*
   * 1. Add x402BrowserSupport import (if not already present)
   */
  if (!content.includes('x402BrowserSupport')) {
    if (content.includes("from '@dexterai/x402/server'") || content.includes('from "@dexterai/x402/server"')) {
      // Extend existing import: { x402Middleware } -> { x402Middleware, x402BrowserSupport }
      content = content.replace(/import\s*\{([^}]*)\}\s*from\s*['"]@dexterai\/x402\/server['"]/, (match, imports) => {
        const trimmed = imports.trim().replace(/,\s*$/, '');
        return `import { ${trimmed}, x402BrowserSupport } from '@dexterai/x402/server'`;
      });
    } else {
      // No existing x402 import — add one at the top after other imports
      const lastImportIdx = content.lastIndexOf('import ');

      if (lastImportIdx !== -1) {
        const lineEnd = content.indexOf('\n', lastImportIdx);
        content =
          content.slice(0, lineEnd + 1) +
          "import { x402BrowserSupport } from '@dexterai/x402/server';\n" +
          content.slice(lineEnd + 1);
      } else {
        content = "import { x402BrowserSupport } from '@dexterai/x402/server';\n" + content;
      }
    }
  }

  /*
   * 2. Add app.use(x402BrowserSupport()) after express.json() middleware
   */
  if (!content.includes('x402BrowserSupport()')) {
    if (content.includes('app.use(express.json())')) {
      content = content.replace('app.use(express.json());', 'app.use(express.json());\napp.use(x402BrowserSupport());');
    } else {
      // If no express.json() found, add after the app = express() line
      content = content.replace(/const app = express\(\);/, 'const app = express();\napp.use(x402BrowserSupport());');
    }
  }

  /*
   * 3. Add health endpoint if missing (before app.listen)
   */
  if (!content.includes('/health')) {
    const healthCode = `\n// Health check (auto-added by Dexter Lab)\napp.get('/health', (req: any, res: any) => {\n  res.json({ status: 'ok', resourceId: '${config.id}', timestamp: Date.now() });\n});\n`;
    content = content.replace(/app\.listen\(/, `${healthCode}\napp.listen(`);
  }

  /*
   * 4. Add landing page at GET / if no existing root handler
   */
  const hasRootGet =
    content.includes("app.get('/'") || content.includes('app.get("/') || content.includes('app.get(`/`');

  if (!hasRootGet) {
    const landingHtml = generateLandingPageHtml(config);
    const escapedHtml = JSON.stringify(landingHtml);
    const landingCode = `\n// Landing page (auto-added by Dexter Lab)\napp.get('/', (req: any, res: any) => {\n  if (req.accepts('html')) {\n    res.type('html').send(${escapedHtml});\n  } else {\n    res.json({ name: ${JSON.stringify(config.name)}, description: ${JSON.stringify(config.description)}, status: 'running', endpoints: ${JSON.stringify(config.endpoints.map((e) => ({ method: e.method, path: e.path, description: e.description })))}, documentation: 'https://docs.dexter.cash/docs/sdk/' });\n  }\n});\n`;
    content = content.replace(/app\.listen\(/, `${landingCode}\napp.listen(`);
  }

  /*
   * 5. Add browser-friendly 404 catch-all (must be the last middleware before listen)
   */
  if (!content.includes('// Browser-friendly 404')) {
    const notFoundHtml = generate404Html(config.name);
    const escaped404 = JSON.stringify(notFoundHtml);
    const catchAllCode = `\n// Browser-friendly 404 (auto-added by Dexter Lab)\napp.use((req: any, res: any) => {\n  if (req.accepts('html') && !req.headers['payment-signature']) {\n    res.status(404).type('html').send(${escaped404});\n  } else {\n    res.status(404).json({ error: 'Not found', path: req.path, message: 'This endpoint does not exist. Check the API documentation at /' });\n  }\n});\n`;
    content = content.replace(/app\.listen\(/, `${catchAllCode}\napp.listen(`);
  }

  files.set(mainKey, content);

  /*
   * 6. Ensure @dexterai/x402 is at ^1.6.0 in package.json
   *    (base image may cache older version; ^1.6.0 forces npm to fetch the new one)
   */
  const pkgJson = files.get('package.json');

  if (pkgJson) {
    const updated = pkgJson.replace(/"@dexterai\/x402"\s*:\s*"[^"]*"/, '"@dexterai/x402": "^1.6.0"');
    files.set('package.json', updated);
  }
}

/* ------------------------------------------------------------------ */
/*  AI Test Data Generation (gpt-5.2-codex)                           */
/*  Same model and prompt structure as dexter-api verifier             */
/* ------------------------------------------------------------------ */
const CRYPTO_DEFAULTS = {
  DEXTER_TOKEN: 'EfPoo4wWgxKVToit7yX5VtXXBrhao4G8L7vrbKy6pump',
  SOL_MINT: 'So11111111111111111111111111111111111111112',
  USDC_SOL: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  SAMPLE_SOL_WALLET: 'DevFFyNWxZPtYLpEjzUnN1PFc9Po6PH7eZCi9f3tTkTw',
  USDC_BASE: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  SAMPLE_ETH_WALLET: '0x96836Ea66Be939c36fd4d211Be665b3F2F8d22CC',
};

async function generateTestDataForEndpoints(config: ResourceConfig): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    console.warn('[test-data] No OPENAI_API_KEY, skipping AI test data generation');
    return;
  }

  for (const ep of config.endpoints) {
    if (ep.exampleBody) {
      continue;
    } // Already has test data

    if (ep.method === 'GET') {
      continue;
    } // GET endpoints don't need body data

    const prompt = `You are generating a realistic test input for an API endpoint.

ENDPOINT: ${ep.path}
NAME: ${config.name}
DESCRIPTION: ${config.description}
ENDPOINT DESCRIPTION: ${ep.description || 'No description'}
METHOD: ${ep.method}

CRYPTO DEFAULTS (use these for any token/wallet fields):
- Solana token to test with: ${CRYPTO_DEFAULTS.DEXTER_TOKEN} (Dexter token)
- SOL mint: ${CRYPTO_DEFAULTS.SOL_MINT}
- USDC on Solana: ${CRYPTO_DEFAULTS.USDC_SOL}
- Sample Solana wallet: ${CRYPTO_DEFAULTS.SAMPLE_SOL_WALLET}
- USDC on Base: ${CRYPTO_DEFAULTS.USDC_BASE}
- Sample EVM wallet: ${CRYPTO_DEFAULTS.SAMPLE_ETH_WALLET}

INSTRUCTIONS:
1. Generate a realistic, SPECIFIC input that a real paying user would send
2. If the endpoint is about crypto/trading, use the Dexter token or provided defaults
3. Be specific - don't say "test" or "example", give real-sounding values
4. Match the endpoint's claimed purpose exactly

Return a JSON object with:
- "input": The request body as a JSON object (NOT a string)
- "reasoning": Brief one-line explanation`;

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-5.2-codex',
          messages: [
            { role: 'system', content: 'Generate realistic test input for API verification. Return valid JSON only.' },
            { role: 'user', content: prompt },
          ],
          max_completion_tokens: 500,
          response_format: { type: 'json_object' },
        }),
      });

      if (response.ok) {
        const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
        const content = data.choices?.[0]?.message?.content;

        if (content) {
          const parsed = JSON.parse(content);
          const input = parsed.input || parsed;
          ep.exampleBody = JSON.stringify(input, null, 2);
          console.log(`[test-data] Generated for ${ep.method} ${ep.path}: ${parsed.reasoning || 'ok'}`);
        }
      } else {
        console.warn(`[test-data] OpenAI returned ${response.status} for ${ep.path}`);
      }
    } catch (err) {
      console.warn(`[test-data] Failed for ${ep.path}:`, err);
    }
  }
}

/**
 * Create build context from resource files
 */
function createBuildContext(files: Map<string, string>, config: ResourceConfig): BuildContext {
  /*
   * Remove any agent-provided Dockerfile - we always generate our own
   * This ensures consistent containerization and prevents outdated templates
   */
  files.delete('Dockerfile');
  files.delete('dockerfile');

  /*
   * Substitute {{USER_WALLET}} placeholder with the actual creator wallet.
   * The AI always writes {{USER_WALLET}} in the source code; the real address
   * is provided via config.creatorWallet from the deployment request.
   */
  if (config.creatorWallet && config.creatorWallet !== '{{USER_WALLET}}') {
    for (const [filename, content] of files.entries()) {
      if (content.includes('{{USER_WALLET}}')) {
        files.set(filename, content.replace(/\{\{USER_WALLET\}\}/g, config.creatorWallet));
      }
    }
  }

  // Auto-generate tsconfig.json if TypeScript files exist but no tsconfig
  const hasTypeScript = Array.from(files.keys()).some((f) => f.endsWith('.ts'));
  const hasTsConfig = files.has('tsconfig.json');

  if (hasTypeScript && !hasTsConfig) {
    files.set('tsconfig.json', DEFAULT_TSCONFIG);
  }

  /*
   * Platform injection: adds x402BrowserSupport, health endpoint,
   * landing page, and 404 catch-all to every resource.
   */
  injectPlatformCode(files, config);

  return {
    files,
    dockerfile: generateDockerfile(config.type),
    buildArgs: {
      RESOURCE_ID: config.id,
      CREATOR_WALLET: config.creatorWallet,
    },
  };
}

/*
 * Facilitator registration removed — the endpoint /api/x402/resources/register
 * never existed. Resources are persisted to dexter-api via persistResourceToApi()
 * in api.deploy.ts, and the facilitator discovers them when processing x402 transactions.
 */

/**
 * Deploy a new x402 resource
 */
export async function deploy(
  files: Map<string, string>,
  config: Omit<ResourceConfig, 'id'>,
): Promise<DeploymentResult> {
  const resourceId = generateResourceId();
  const fullConfig: ResourceConfig = {
    ...config,
    id: resourceId,
  };

  // Check base image is available
  const baseReady = await checkBaseImage();

  if (!baseReady) {
    return {
      success: false,
      resourceId,
      error: `Base image ${BASE_IMAGE} not found. Run: ./infrastructure/build-base-image.sh`,
    };
  }

  // Check build context size
  let totalBytes = 0;

  for (const content of files.values()) {
    totalBytes += Buffer.byteLength(content, 'utf8');
  }

  if (totalBytes > MAX_BUILD_CONTEXT_BYTES) {
    return {
      success: false,
      resourceId,
      error: `Build context too large: ${(totalBytes / 1024 / 1024).toFixed(1)}MB exceeds ${MAX_BUILD_CONTEXT_BYTES / 1024 / 1024}MB limit`,
    };
  }

  // Store source files for rebuild capability
  const sourceFiles = JSON.stringify(Object.fromEntries(files));

  // Create initial registry entry
  const resource: DeployedResource = {
    config: fullConfig,
    status: 'pending',
    containerId: null,
    internalPort: 3000,
    publicUrl: `https://${resourceId}.${RESOURCE_BASE_DOMAIN}`,
    deployedAt: new Date(),
    updatedAt: new Date(),
    healthy: false,
    requestCount: 0,
    revenueUsdc: 0,
    sourceFiles,
  };

  await resourceRegistry.set(resourceId, resource);

  try {
    // Update status to building
    resource.status = 'building';
    resource.updatedAt = new Date();
    await resourceRegistry.set(resourceId, resource);

    // Generate AI test data for endpoint "Try" panels (non-blocking, best-effort)
    try {
      await generateTestDataForEndpoints(fullConfig);
    } catch (e) {
      console.warn('[deploy] AI test data generation failed, continuing:', e);
    }

    // Create build context
    const context = createBuildContext(files, fullConfig);

    // Update status to deploying
    resource.status = 'deploying';
    resource.updatedAt = new Date();
    await resourceRegistry.set(resourceId, resource);

    // Deploy the resource
    const result = await deployResource(resourceId, context, {
      RESOURCE_ID: resourceId,
      CREATOR_WALLET: config.creatorWallet,
      BASE_PRICE_USDC: String(config.basePriceUsdc),
      ...config.envVars,
    });

    if (!result.success) {
      resource.status = 'failed';
      resource.error = result.error;
      resource.updatedAt = new Date();
      await resourceRegistry.set(resourceId, resource);

      return result;
    }

    // Update registry with deployment info
    resource.status = 'running';
    resource.containerId = result.containerId || null;
    resource.publicUrl = result.publicUrl || resource.publicUrl;
    resource.healthy = true;
    resource.updatedAt = new Date();
    await resourceRegistry.set(resourceId, resource);

    return {
      success: true,
      resourceId,
      containerId: result.containerId,
      publicUrl: resource.publicUrl,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Deployment failed';
    resource.status = 'failed';
    resource.error = errorMessage;
    resource.updatedAt = new Date();
    await resourceRegistry.set(resourceId, resource);

    return {
      success: false,
      resourceId,
      error: errorMessage,
    };
  }
}

/**
 * Stop a deployed resource
 */
export async function stop(resourceId: string): Promise<boolean> {
  const resource = await resourceRegistry.get(resourceId);

  if (!resource) {
    throw new Error(`Resource not found: ${resourceId}`);
  }

  if (!resource.containerId) {
    throw new Error(`Resource has no container: ${resourceId}`);
  }

  try {
    await stopContainer(resource.containerId);
    resource.status = 'stopped';
    resource.healthy = false;
    resource.updatedAt = new Date();
    await resourceRegistry.set(resourceId, resource);

    return true;
  } catch (error) {
    console.error(`[Stop] Failed to stop ${resourceId}:`, error);
    return false;
  }
}

/**
 * Remove a deployed resource completely
 */
export async function remove(resourceId: string): Promise<boolean> {
  const resource = await resourceRegistry.get(resourceId);

  if (!resource) {
    throw new Error(`Resource not found: ${resourceId}`);
  }

  try {
    // 1. Stop and remove the Docker container
    if (resource.containerId) {
      await removeContainer(resource.containerId, true);
    }

    // 2. Clean up the Docker image
    const imageName = `dexter-resource-${resourceId}:latest`;
    await removeImage(imageName);

    // 3. Remove from Redis registry
    await resourceRegistry.delete(resourceId);

    // 4. Sync deletion to dexter-api DB so frontend reflects it immediately
    persistResourceUpdateToApi(resourceId, {
      status: 'stopped',
      healthy: false,
    }).catch((e) => console.warn(`[Remove] ${resourceId}: API sync failed:`, e));

    console.log(`[Remove] ${resourceId}: fully removed (container + image + Redis + API)`);

    return true;
  } catch (error) {
    console.error(`[Remove] Failed to remove ${resourceId}:`, error);
    return false;
  }
}

/**
 * Get resource status
 */
export async function getStatus(resourceId: string): Promise<DeployedResource | null> {
  const resource = await resourceRegistry.get(resourceId);

  if (!resource) {
    return null;
  }

  // Update live status from Docker
  if (resource.containerId) {
    try {
      const status = await getContainerStatus(resource.containerId);
      resource.healthy = status.healthy;

      if (!status.running && resource.status === 'running') {
        resource.status = status.exitCode === 0 ? 'stopped' : 'failed';
      }

      // Persist updated status
      await resourceRegistry.set(resourceId, resource);
    } catch {
      // Container may not exist anymore
      resource.healthy = false;
    }
  }

  return resource;
}

/**
 * Get logs for a resource
 */
export async function getLogs(resourceId: string, tail = 100): Promise<string> {
  const resource = await resourceRegistry.get(resourceId);

  if (!resource?.containerId) {
    throw new Error(`Resource has no container: ${resourceId}`);
  }

  return getContainerLogs(resource.containerId, tail);
}

/**
 * List all deployed resources
 */
export async function list(): Promise<DeployedResource[]> {
  // Sync with Docker to get actual container states
  const containers = await listResourceContainers();

  // Get all resources from registry
  const resources = await resourceRegistry.list();

  // Update registry with container states
  for (const container of containers) {
    const resource = resources.find((r) => r.config.id === container.resourceId);

    if (resource) {
      resource.containerId = container.id;

      const statusMap: Record<string, DeploymentStatus> = {
        running: 'running',
        exited: 'stopped',
        dead: 'failed',
        created: 'pending',
      };
      resource.status = statusMap[container.status] || 'stopped';

      // Persist the updated state
      await resourceRegistry.set(container.resourceId, resource);
    }
  }

  return resources;
}

/**
 * Get resource metrics
 */
export async function getMetrics(resourceId: string): Promise<ResourceMetrics | null> {
  const resource = await resourceRegistry.get(resourceId);

  if (!resource) {
    return null;
  }

  /*
   * In production, this would query Prometheus/InfluxDB
   * For now, return synthetic metrics from registry
   */
  return {
    resourceId,
    requestCount: resource.requestCount,
    errorCount: 0,
    avgResponseTimeMs: 150,
    p99ResponseTimeMs: 500,
    revenueUsdc: resource.revenueUsdc,
    cpuUsagePercent: 5,
    memoryUsageMb: 128,
    timestamp: new Date(),
  };
}

/**
 * Update resource metrics (called by payment webhook)
 */
export async function updateMetrics(resourceId: string, requests: number, revenueUsdc: number): Promise<void> {
  const resource = await resourceRegistry.get(resourceId);

  if (resource) {
    resource.requestCount += requests;
    resource.revenueUsdc += revenueUsdc;
    resource.updatedAt = new Date();
    await resourceRegistry.set(resourceId, resource);
  }
}

/**
 * Restart a resource
 */
export async function restart(resourceId: string): Promise<boolean> {
  const resource = await resourceRegistry.get(resourceId);

  if (!resource?.containerId) {
    throw new Error(`Resource has no container: ${resourceId}`);
  }

  try {
    await stopContainer(resource.containerId);

    // Wait a moment before starting
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const { startContainer } = await import('./docker-client');
    await startContainer(resource.containerId);

    resource.status = 'running';
    resource.updatedAt = new Date();
    await resourceRegistry.set(resourceId, resource);

    return true;
  } catch (error) {
    console.error(`[Restart] Failed to restart ${resourceId}:`, error);
    resource.status = 'failed';
    resource.error = error instanceof Error ? error.message : 'Restart failed';
    await resourceRegistry.set(resourceId, resource);

    return false;
  }
}

/**
 * Reconcile Redis state with Docker reality
 *
 * Detects ghost entries (Redis says running, Docker has no container),
 * recovers lost containers from stored source files, and cleans up
 * stale failed/stopped resources.
 *
 * Runs on server startup and every 5 minutes.
 */
export async function reconcileState(): Promise<{
  total: number;
  healthy: number;
  recovered: number;
  lost: number;
  cleaned: number;
  errors: number;
}> {
  const stats = { total: 0, healthy: 0, recovered: 0, lost: 0, cleaned: 0, errors: 0 };

  try {
    const resources = await resourceRegistry.list();
    stats.total = resources.length;

    console.log(`[Reconcile] Checking ${resources.length} resources against Docker...`);

    for (const resource of resources) {
      const resourceId = resource.config.id;

      try {
        // Check if container exists in Docker
        if (resource.containerId) {
          try {
            const status = await getContainerStatus(resource.containerId);

            if (status.running) {
              // Container is running -- update Redis to match
              resource.healthy = status.healthy;
              resource.status = 'running';
              resource.updatedAt = new Date();
              await resourceRegistry.set(resourceId, resource);
              stats.healthy++;

              /*
               * Always sync to dexter-api DB so it reflects Docker reality.
               * ~19 lightweight PATCHes every 5 min is negligible; guarantees
               * the API never drifts from actual container state.
               */
              persistResourceUpdateToApi(resourceId, {
                healthy: status.healthy,
                status: 'running',
              }).catch((e) => console.warn(`[Reconcile] ${resourceId}: API health sync failed:`, e));
            } else {
              // Container exists but stopped -- try to restart if it was supposed to be running
              if (resource.status === 'running') {
                console.log(`[Reconcile] ${resourceId}: container stopped unexpectedly, restarting...`);

                try {
                  await startContainer(resource.containerId);
                  resource.status = 'running';
                  resource.updatedAt = new Date();
                  await resourceRegistry.set(resourceId, resource);
                  stats.recovered++;
                  console.log(`[Reconcile] ${resourceId}: restarted successfully`);

                  // Sync recovered status to API
                  persistResourceUpdateToApi(resourceId, {
                    healthy: true,
                    status: 'running',
                  }).catch((e) => console.warn(`[Reconcile] ${resourceId}: API recovery sync failed:`, e));
                } catch (restartErr) {
                  console.warn(`[Reconcile] ${resourceId}: restart failed:`, restartErr);
                  resource.status = 'failed';
                  resource.error = 'Container restart failed';
                  resource.healthy = false;
                  resource.updatedAt = new Date();
                  await resourceRegistry.set(resourceId, resource);
                  stats.errors++;

                  // Sync failure status to API
                  persistResourceUpdateToApi(resourceId, {
                    healthy: false,
                    status: 'failed',
                  }).catch((e) => console.warn(`[Reconcile] ${resourceId}: API failure sync failed:`, e));
                }
              }
            }
          } catch {
            // Docker doesn't know about this container -- it's a ghost
            console.warn(
              `[Reconcile] ${resourceId}: container ${resource.containerId.slice(0, 12)} not found in Docker`,
            );
            await handleLostContainer(resource, resourceId, stats);
          }
        } else if (resource.status === 'running' || resource.status === 'deploying') {
          // No container ID but marked as running -- also a ghost
          console.warn(`[Reconcile] ${resourceId}: marked as ${resource.status} but has no container ID`);
          await handleLostContainer(resource, resourceId, stats);
        }

        // Clean up stale resources (failed/stopped/lost for >48h since deployment)
        if (
          (resource.status === 'failed' || resource.status === 'stopped' || resource.status === 'lost') &&
          resource.deployedAt
        ) {
          const ageMs = Date.now() - new Date(resource.deployedAt).getTime();
          const ageHours = ageMs / (1000 * 60 * 60);

          if (ageHours > 48) {
            console.log(
              `[Reconcile] ${resourceId}: stale (${resource.status} for ${ageHours.toFixed(0)}h), cleaning up`,
            );

            try {
              if (resource.containerId) {
                await removeContainer(resource.containerId, true).catch(() => {});
              }

              await removeImage(`dexter-resource-${resourceId}:latest`);
              await resourceRegistry.delete(resourceId);
              stats.cleaned++;
            } catch (cleanErr) {
              console.warn(`[Reconcile] ${resourceId}: cleanup failed:`, cleanErr);
              stats.errors++;
            }
          }
        }
      } catch (err) {
        console.error(`[Reconcile] ${resourceId}: unexpected error:`, err);
        stats.errors++;
      }
    }

    /*
     * ── Orphan cleanup ──────────────────────────────────────────────────
     * Find Docker containers that exist but have NO matching Redis entry.
     * This prevents "zombie" containers from surviving across restarts.
     */
    try {
      const dockerContainers = await listResourceContainers();
      const redisIds = new Set(resources.map((r) => r.config.id));
      let orphansRemoved = 0;

      for (const container of dockerContainers) {
        if (!redisIds.has(container.resourceId)) {
          console.warn(
            `[Reconcile] ORPHAN: container ${container.id.slice(0, 12)} (${container.resourceId}) exists in Docker but not in Redis -- removing`,
          );

          try {
            await removeContainer(container.id, true);
            await removeImage(`dexter-resource-${container.resourceId}:latest`).catch(() => {});

            // Also mark as stopped in API DB so frontend doesn't show it
            persistResourceUpdateToApi(container.resourceId, {
              status: 'stopped',
              healthy: false,
            }).catch(() => {});
            orphansRemoved++;
          } catch (orphanErr) {
            console.warn(`[Reconcile] Failed to remove orphan ${container.resourceId}:`, orphanErr);
          }
        }
      }

      if (orphansRemoved > 0) {
        console.log(`[Reconcile] Removed ${orphansRemoved} orphaned containers`);
      }
    } catch (orphanScanErr) {
      console.warn('[Reconcile] Orphan scan failed:', orphanScanErr);
    }

    console.log(
      `[Reconcile] Done: ${stats.total} total, ${stats.healthy} healthy, ${stats.recovered} recovered, ${stats.lost} lost, ${stats.cleaned} cleaned, ${stats.errors} errors`,
    );
  } catch (err) {
    console.error('[Reconcile] Fatal error:', err);
  }

  return stats;
}

/**
 * Handle a container that Docker has lost
 * Attempts rebuild from stored source files, or marks as lost
 */
async function handleLostContainer(
  resource: DeployedResource,
  resourceId: string,
  stats: { recovered: number; lost: number; errors: number },
): Promise<void> {
  if (resource.sourceFiles) {
    // We have the source -- attempt rebuild
    console.log(`[Reconcile] ${resourceId}: attempting rebuild from stored source...`);

    try {
      const filesObj = JSON.parse(resource.sourceFiles) as Record<string, string>;
      const files = new Map<string, string>(Object.entries(filesObj));

      const context = createBuildContext(files, resource.config);
      const result = await deployResource(resourceId, context, {
        RESOURCE_ID: resourceId,
        CREATOR_WALLET: resource.config.creatorWallet,
        BASE_PRICE_USDC: String(resource.config.basePriceUsdc),
        PROXY_BASE_URL: process.env.DEXTER_PROXY_URL || 'https://x402.dexter.cash/proxy',
        ...resource.config.envVars,
      });

      if (result.success) {
        resource.status = 'running';
        resource.containerId = result.containerId || null;
        resource.healthy = true;
        resource.error = undefined;
        resource.updatedAt = new Date();
        await resourceRegistry.set(resourceId, resource);
        stats.recovered++;
        console.log(`[Reconcile] ${resourceId}: rebuilt and redeployed successfully`);
      } else {
        resource.status = 'failed';
        resource.error = `Rebuild failed: ${result.error}`;
        resource.healthy = false;
        resource.containerId = null;
        resource.updatedAt = new Date();
        await resourceRegistry.set(resourceId, resource);
        stats.errors++;
        console.error(`[Reconcile] ${resourceId}: rebuild failed: ${result.error}`);
      }
    } catch (err) {
      resource.status = 'failed';
      resource.error = `Rebuild threw: ${err instanceof Error ? err.message : String(err)}`;
      resource.healthy = false;
      resource.containerId = null;
      resource.updatedAt = new Date();
      await resourceRegistry.set(resourceId, resource);
      stats.errors++;
      console.error(`[Reconcile] ${resourceId}: rebuild threw:`, err);
    }
  } else {
    // No source files -- can't recover
    (resource as DeployedResource & { status: string }).status = 'lost';
    resource.healthy = false;
    resource.containerId = null;
    resource.error = 'Container lost and no source files stored for rebuild';
    resource.updatedAt = new Date();
    await resourceRegistry.set(resourceId, resource);
    stats.lost++;
    console.warn(`[Reconcile] ${resourceId}: LOST -- no stored source files for rebuild`);
  }
}

/**
 * Redeploy updated code to an existing resource.
 * Stops the old container, builds a new one with the same resourceId,
 * preserving the URL, managed wallet, and revenue history.
 */
export async function redeploy(
  resourceId: string,
  files: Map<string, string>,
  config: Omit<ResourceConfig, 'id'>,
): Promise<DeploymentResult & { version?: number }> {
  const existing = await resourceRegistry.get(resourceId);

  if (!existing) {
    return { success: false, resourceId, error: `Resource not found: ${resourceId}` };
  }

  console.log(
    `[Redeploy] Starting redeploy for ${resourceId} (current version: ${existing.config.id === resourceId ? 'v1+' : 'unknown'})`,
  );

  // Check base image
  const baseReady = await checkBaseImage();

  if (!baseReady) {
    return {
      success: false,
      resourceId,
      error: `Base image ${BASE_IMAGE} not found. Run: ./infrastructure/build-base-image.sh`,
    };
  }

  // Check build context size
  let totalBytes = 0;

  for (const content of files.values()) {
    totalBytes += Buffer.byteLength(content, 'utf8');
  }

  if (totalBytes > MAX_BUILD_CONTEXT_BYTES) {
    return {
      success: false,
      resourceId,
      error: `Build context too large: ${(totalBytes / 1024 / 1024).toFixed(1)}MB exceeds ${MAX_BUILD_CONTEXT_BYTES / 1024 / 1024}MB limit`,
    };
  }

  const fullConfig: ResourceConfig = { ...config, id: resourceId };
  const sourceFiles = JSON.stringify(Object.fromEntries(files));

  // Update status to updating
  existing.status = 'updating';
  existing.updatedAt = new Date();
  await resourceRegistry.set(resourceId, existing);

  try {
    // Stop and remove the old container
    if (existing.containerId) {
      console.log(`[Redeploy] Stopping old container ${existing.containerId.slice(0, 12)}...`);

      try {
        await stopContainer(existing.containerId);
      } catch {
        console.warn(`[Redeploy] Old container stop failed (may already be stopped)`);
      }

      try {
        await removeContainer(existing.containerId, true);
      } catch {
        console.warn(`[Redeploy] Old container removal failed (may already be gone)`);
      }
    }

    // Remove old image
    const oldImageName = `dexter-resource-${resourceId}:latest`;

    try {
      await removeImage(oldImageName);
    } catch {
      /* image may not exist */
    }

    // Generate AI test data for endpoint "Try" panels (non-blocking, best-effort)
    try {
      await generateTestDataForEndpoints(fullConfig);
    } catch (e) {
      console.warn('[redeploy] AI test data generation failed, continuing:', e);
    }

    // Build and deploy with updated files
    const context = createBuildContext(files, fullConfig);

    const result = await deployResource(resourceId, context, {
      RESOURCE_ID: resourceId,
      CREATOR_WALLET: config.creatorWallet,
      BASE_PRICE_USDC: String(config.basePriceUsdc),
      ...config.envVars,
    });

    if (!result.success) {
      existing.status = 'failed';
      existing.error = result.error;
      existing.updatedAt = new Date();
      await resourceRegistry.set(resourceId, existing);

      return result;
    }

    // Update registry -- preserve revenue, bump state
    existing.status = 'running';
    existing.containerId = result.containerId || null;
    existing.healthy = true;
    existing.error = undefined;
    existing.sourceFiles = sourceFiles;
    existing.updatedAt = new Date();
    await resourceRegistry.set(resourceId, existing);

    console.log(`[Redeploy] Resource ${resourceId} redeployed successfully`);

    return {
      success: true,
      resourceId,
      containerId: result.containerId,
      publicUrl: existing.publicUrl,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Redeploy failed';
    existing.status = 'failed';
    existing.error = errorMessage;
    existing.updatedAt = new Date();
    await resourceRegistry.set(resourceId, existing);

    return { success: false, resourceId, error: errorMessage };
  }
}

// Export the deployment service
export const deploymentService = {
  deploy,
  redeploy,
  stop,
  remove,
  restart,
  getStatus,
  getLogs,
  list,
  getMetrics,
  updateMetrics,
  reconcileState,
};

// Also export as DeploymentService for backward compatibility
export { deploymentService as DeploymentService };

export default deploymentService;
