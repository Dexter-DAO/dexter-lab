import { json } from '@remix-run/cloudflare';
import type { ActionFunctionArgs } from '@remix-run/cloudflare';
import { withSecurity } from '~/lib/security';
import { clearWalletSessionCookie } from '~/lib/.server/auth/wallet-auth';

async function walletAuthLogoutAction(_: ActionFunctionArgs) {
  return json(
    { ok: true },
    {
      headers: {
        'Set-Cookie': clearWalletSessionCookie(),
      },
    },
  );
}

export const action = withSecurity(walletAuthLogoutAction, {
  rateLimit: true,
  allowedMethods: ['POST'],
});
