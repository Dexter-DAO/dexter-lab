import { json } from '@remix-run/cloudflare';
import type { ActionFunctionArgs } from '@remix-run/cloudflare';
import { withSecurity } from '~/lib/security';
import { resolveDexterHolderStatus } from '~/lib/.server/auth/holder-status';
import { issueWalletSessionCookie, validateWalletAddress, verifyWalletChallenge } from '~/lib/.server/auth/wallet-auth';

async function walletAuthVerifyAction({ request }: ActionFunctionArgs) {
  try {
    const body = (await request.json()) as {
      challengeId?: string;
      walletAddress?: string;
      signature?: string;
    };

    if (!body?.challengeId || typeof body.challengeId !== 'string') {
      return json({ ok: false, error: 'invalid_challenge_id' }, { status: 400 });
    }

    if (!validateWalletAddress(body.walletAddress)) {
      return json({ ok: false, error: 'invalid_wallet_address' }, { status: 400 });
    }

    if (!body.signature || typeof body.signature !== 'string') {
      return json({ ok: false, error: 'invalid_signature' }, { status: 400 });
    }

    const verified = verifyWalletChallenge({
      challengeId: body.challengeId,
      walletAddress: body.walletAddress,
      signatureBase58: body.signature,
    });

    if (!verified.ok) {
      console.warn('[wallet-gating] challenge_verify_rejected', {
        reason: verified.reason,
        walletPrefix: `${body.walletAddress.slice(0, 6)}...${body.walletAddress.slice(-4)}`,
      });
      return json({ ok: false, error: verified.reason }, { status: 401 });
    }

    const { cookie, session } = issueWalletSessionCookie(body.walletAddress);

    let tier: 'verified_non_holder' | 'verified_holder' = 'verified_non_holder';

    try {
      const holder = await resolveDexterHolderStatus(body.walletAddress);
      tier = holder.isHolder ? 'verified_holder' : 'verified_non_holder';
    } catch (error) {
      console.warn('[wallet-gating] holder_check_on_verify_failed', error);
    }

    console.info('[wallet-gating] challenge_verified', {
      walletPrefix: `${body.walletAddress.slice(0, 6)}...${body.walletAddress.slice(-4)}`,
      tier,
      sessionId: session.sessionId,
    });

    return json(
      {
        ok: true,
        walletAddress: body.walletAddress,
        tier,
        sessionId: session.sessionId,
        expiresAtMs: session.expiresAtMs,
      },
      {
        headers: {
          'Set-Cookie': cookie,
        },
      },
    );
  } catch (error) {
    console.error('[wallet-gating] verify_error', error);
    return json({ ok: false, error: 'verify_failed' }, { status: 500 });
  }
}

export const action = withSecurity(walletAuthVerifyAction, {
  rateLimit: true,
  allowedMethods: ['POST'],
});
