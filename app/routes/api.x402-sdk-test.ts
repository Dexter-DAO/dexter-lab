/**
 * x402 SDK Test Endpoint
 *
 * A simple paid resource powered by @dexterai/x402 server helpers.
 * Used to validate SDK v2 spec compliance against real facilitators
 * via the debug page at dexter.cash/sdk/debug.
 *
 * GET  /api/x402-sdk-test → 402 with PAYMENT-REQUIRED header
 * POST /api/x402-sdk-test → 402 (no payment) or 200 (with payment)
 *
 * Tests three SDK fixes:
 *   1. 402 accepts array includes both `amount` and `maxAmountRequired`
 *   2. Facilitator requests include top-level `x402Version: 2`
 *   3. 200 response includes `PAYMENT-RESPONSE` header
 */

import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { createX402Server } from '@dexterai/x402/server';

const PAY_TO = process.env.X402_PAY_TO || 'DevFFyNWxZPtYLpEjzUnN1PFc9Po6PH7eZCi9f3tTkTw';
const NETWORK = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const FACILITATOR_URL = process.env.X402_FACILITATOR_URL || 'https://x402.dexter.cash';
const AMOUNT_ATOMIC = '10000'; // $0.01 USDC

// Lazily initialized server instance (reused across requests)
let serverInstance: ReturnType<typeof createX402Server> | null = null;

function getServer() {
  if (!serverInstance) {
    serverInstance = createX402Server({
      payTo: PAY_TO,
      network: NETWORK,
      facilitatorUrl: FACILITATOR_URL,
    });
  }

  return serverInstance;
}

/**
 * Build and return a 402 Payment Required response
 */
async function build402Response(request: Request) {
  const server = getServer();
  const url = new URL(request.url);

  const requirements = await server.buildRequirements({
    amountAtomic: AMOUNT_ATOMIC,
    resourceUrl: url.pathname,
    description: 'SDK v2 spec compliance test endpoint',
    mimeType: 'application/json',
  });

  const encoded = server.encodeRequirements(requirements);

  return json(
    {
      error: 'Payment required',
      accepts: requirements.accepts,
      resource: requirements.resource,
    },
    {
      status: 402,
      headers: {
        'PAYMENT-REQUIRED': encoded,
        'Cache-Control': 'no-store',
      },
    },
  );
}

/**
 * Handle a paid request — verify, settle, return 200 with PAYMENT-RESPONSE header
 */
async function handlePaidRequest(request: Request, paymentSignature: string) {
  const server = getServer();

  // Verify
  const verifyResult = await server.verifyPayment(paymentSignature);

  if (!verifyResult.isValid) {
    return json(
      { error: 'Payment verification failed', reason: verifyResult.invalidReason },
      {
        status: 402,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }

  // Settle
  const settleResult = await server.settlePayment(paymentSignature);

  if (!settleResult.success) {
    return json(
      { error: 'Payment settlement failed', reason: settleResult.errorReason },
      {
        status: 402,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }

  // Build PAYMENT-RESPONSE header (Fix #3 — the middleware fix we're validating)
  const paymentResponseData = {
    success: true,
    transaction: settleResult.transaction,
    network: NETWORK,
    payer: verifyResult.payer ?? '',
  };
  const paymentResponseHeader = btoa(JSON.stringify(paymentResponseData));

  return json(
    {
      ok: true,
      message: 'x402 SDK test — payment settled successfully',
      sdkVersion: '1.5.5',
      fixes: {
        amountField: 'accepts[].amount is set alongside maxAmountRequired',
        paymentResponse: 'PAYMENT-RESPONSE header is set on this 200 response',
        x402Version: 'facilitator requests include x402Version: 2 at top level',
      },
      settlement: {
        transaction: settleResult.transaction,
        network: NETWORK,
        payer: verifyResult.payer,
      },
    },
    {
      status: 200,
      headers: {
        'PAYMENT-RESPONSE': paymentResponseHeader,
        'Cache-Control': 'no-store',
      },
    },
  );
}

/**
 * GET requests always return 402 (no payment header possible on GET)
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  return build402Response(request);
};

/**
 * POST requests: 402 if no payment, 200 if payment provided
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const paymentSignature = request.headers.get('payment-signature');

  if (!paymentSignature) {
    return build402Response(request);
  }

  return handlePaidRequest(request, paymentSignature);
};
