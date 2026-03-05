import { json } from '@remix-run/cloudflare';
import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { withSecurity } from '~/lib/security';
import { resolveDexterHolderStatus } from '~/lib/.server/auth/holder-status';
import { maybeRefreshWalletSessionCookie, readWalletSessionFromRequest } from '~/lib/.server/auth/wallet-auth';

async function walletAuthSessionLoader({ request }: LoaderFunctionArgs) {
  try {
    const session = readWalletSessionFromRequest(request);

    if (!session) {
      return json({ ok: true, authenticated: false, tier: 'unverified' });
    }

    let tier: 'verified_non_holder' | 'verified_holder' = 'verified_non_holder';

    try {
      const holder = await resolveDexterHolderStatus(session.walletAddress);
      tier = holder.isHolder ? 'verified_holder' : 'verified_non_holder';
    } catch (error) {
      console.warn('[wallet-gating] session_holder_check_failed', error);
    }

    const refreshedCookie = maybeRefreshWalletSessionCookie(session);
    const headers = refreshedCookie ? { 'Set-Cookie': refreshedCookie } : undefined;

    return json(
      {
        ok: true,
        authenticated: true,
        walletAddress: session.walletAddress,
        tier,
        sessionId: session.sessionId,
        expiresAtMs: session.expiresAtMs,
      },
      headers ? { headers } : undefined,
    );
  } catch (error) {
    console.error('[wallet-gating] session_error', error);
    return json({ ok: false, error: 'session_failed' }, { status: 500 });
  }
}

export const loader = withSecurity(walletAuthSessionLoader, {
  rateLimit: true,
  allowedMethods: ['GET'],
});
