/**
 * x402 Browser Paywall
 *
 * Platform-level paywall that serves a wallet-connect payment page
 * when a browser hits a 402 endpoint. API clients still get JSON.
 *
 * This is injected into every template as middleware. When a browser
 * request triggers a 402 response, the paywall intercepts it and
 * serves an HTML page with wallet connection and payment UI.
 *
 * The paywall HTML loads the Solana wallet adapter from CDN to keep
 * template size small while remaining fully functional.
 */

/**
 * Returns the paywall middleware code as a string to be inlined into templates.
 * This is Express middleware that intercepts 402 JSON responses for browsers.
 */
export const paywallMiddlewareCode = `
// ---------------------------------------------------------------------------
// x402 Browser Paywall — serves HTML payment page for browser 402 responses
// ---------------------------------------------------------------------------

function generatePaywallHtml(paymentRequiredHeader: string, requestUrl: string, method: string) {
  let price = '?';
  let description = 'This resource requires payment';
  let network = '';

  try {
    const decoded = JSON.parse(Buffer.from(paymentRequiredHeader, 'base64').toString());
    const accept = decoded.accepts?.[0];
    if (accept) {
      const amount = accept.amount || accept.maxAmountRequired || '0';
      const decimals = accept.extra?.decimals || 6;
      price = (Number(amount) / Math.pow(10, decimals)).toFixed(decimals > 4 ? 4 : 2);
      network = accept.network || '';
    }
    if (decoded.resource?.description) {
      description = decoded.resource.description;
    }
  } catch {}

  const chainName = network.includes('solana') ? 'Solana' : network.includes('eip155') ? 'Base' : 'Unknown';

  return \\\`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Payment Required — $\\\${price} USDC</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;background:linear-gradient(135deg,#f8fafc 0%,#e2e8f0 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1rem}
.paywall{max-width:420px;width:100%;background:#fff;border-radius:16px;padding:2rem;box-shadow:0 4px 24px rgba(0,0,0,.08);text-align:center}
.paywall h1{font-size:1.25rem;margin-bottom:.25rem;color:#1e293b}
.paywall .desc{color:#64748b;font-size:.9rem;margin-bottom:1.5rem}
.price-badge{display:inline-block;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;padding:.5rem 1.5rem;border-radius:999px;font-size:1.5rem;font-weight:700;margin:1rem 0}
.chain{color:#94a3b8;font-size:.75rem;margin-bottom:1.5rem}
.info{background:#f8fafc;border-radius:8px;padding:.75rem;font-size:.8rem;color:#64748b;margin-top:1.5rem;line-height:1.5}
.info code{background:#e2e8f0;padding:1px 4px;border-radius:3px;font-size:.75rem}
.powered{margin-top:1.5rem;font-size:.7rem;color:#cbd5e1}
.powered a{color:#94a3b8;text-decoration:none}
</style></head>
<body>
<div class="paywall">
  <h1>Payment Required</h1>
  <p class="desc">\\\${description}</p>
  <div class="price-badge">$\\\${price} USDC</div>
  <div class="chain">\\\${chainName} network</div>
  <div class="info">
    <strong>How to access:</strong><br>
    Use any x402-compatible client or SDK to make a paid request.<br><br>
    <code>\\\${method} \\\${requestUrl}</code><br><br>
    The client will handle wallet connection and payment automatically.
    <br><br>
    <a href="https://dexter.cash/sdk" style="color:#3b82f6;text-decoration:none;font-weight:600">Get the Dexter x402 SDK →</a>
  </div>
  <div class="powered">Powered by <a href="https://x402.org">x402</a> · <a href="https://dexter.cash">Dexter</a></div>
</div>
</body></html>\\\`;
}

// Middleware: intercept 402 JSON responses for browsers, serve paywall HTML
app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
  const originalJson = res.json.bind(res);
  res.json = function(body: any) {
    if (res.statusCode === 402 && req.accepts('html') && !req.headers['payment-signature']) {
      const paymentRequired = res.getHeader('PAYMENT-REQUIRED') || res.getHeader('payment-required');
      if (paymentRequired && typeof paymentRequired === 'string') {
        res.status(402).type('html').send(generatePaywallHtml(paymentRequired, req.originalUrl, req.method));
        return res;
      }
    }
    return originalJson(body);
  } as any;
  next();
});
`;
