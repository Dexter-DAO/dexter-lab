import { json } from '@remix-run/cloudflare';
import type { ActionFunctionArgs } from '@remix-run/cloudflare';
import { withSecurity } from '~/lib/security';
import { createWalletChallenge, validateWalletAddress } from '~/lib/.server/auth/wallet-auth';

async function walletAuthChallengeAction({ request }: ActionFunctionArgs) {
  try {
    const body = (await request.json()) as { walletAddress?: string };

    if (!validateWalletAddress(body?.walletAddress)) {
      return json({ ok: false, error: 'invalid_wallet_address' }, { status: 400 });
    }

    const challenge = createWalletChallenge(body.walletAddress, request);
    console.info('[wallet-gating] challenge_issued', {
      walletPrefix: `${body.walletAddress.slice(0, 6)}...${body.walletAddress.slice(-4)}`,
      expiresAtMs: challenge.expiresAtMs,
    });

    return json({
      ok: true,
      challengeId: challenge.challengeId,
      walletAddress: challenge.walletAddress,
      message: challenge.message,
      nonce: challenge.nonce,
      expiresAtMs: challenge.expiresAtMs,
    });
  } catch (error) {
    console.error('[wallet-gating] challenge_error', error);
    return json({ ok: false, error: 'challenge_failed' }, { status: 500 });
  }
}

export const action = withSecurity(walletAuthChallengeAction, {
  rateLimit: true,
  allowedMethods: ['POST'],
});
