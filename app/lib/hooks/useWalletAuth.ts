import { useStore } from '@nanostores/react';
import { useCallback } from 'react';
import { $walletAuth, setWalletAuthState, type WalletTier } from '~/lib/stores/walletAuth';
import { base58Encode } from '~/lib/wallet/base58';

interface WalletAuthSessionResponse {
  ok: boolean;
  authenticated?: boolean;
  walletAddress?: string;
  tier?: WalletTier;
  sessionId?: string;
  expiresAtMs?: number;
  error?: string;
}

function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

async function signWithInjectedWallet(walletAddress: string, message: string): Promise<string> {
  const candidates = [
    (window as any).solana,
    (window as any).phantom?.solana,
    (window as any).backpack,
    (window as any).solflare,
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (!candidate?.publicKey || typeof candidate.publicKey.toBase58 !== 'function') {
        continue;
      }

      const candidateAddress = candidate.publicKey.toBase58();

      if (candidateAddress !== walletAddress) {
        continue;
      }

      if (typeof candidate.signMessage !== 'function') {
        continue;
      }

      const signature = await candidate.signMessage(utf8Bytes(message), 'utf8');
      const signatureBytes = signature?.signature || signature;

      if (!(signatureBytes instanceof Uint8Array)) {
        throw new Error('Wallet returned an invalid signature payload');
      }

      return base58Encode(signatureBytes);
    } catch {
      // Try the next provider.
    }
  }

  throw new Error('No compatible connected wallet signer found for this address');
}

export function useWalletAuth() {
  const walletAuth = useStore($walletAuth);

  const refreshSession = useCallback(async (): Promise<WalletAuthSessionResponse> => {
    try {
      const response = await fetch('/api/wallet-auth/session', { method: 'GET' });
      const payload = (await response.json()) as WalletAuthSessionResponse;

      if (!response.ok || !payload.ok || !payload.authenticated) {
        setWalletAuthState({
          status: 'guest',
          walletAddress: null,
          tier: 'unverified',
        });
        return payload;
      }

      setWalletAuthState({
        status: 'verified',
        walletAddress: payload.walletAddress || null,
        tier: payload.tier || 'verified_non_holder',
        sessionId: payload.sessionId,
        expiresAtMs: payload.expiresAtMs,
      });

      return payload;
    } catch (error) {
      setWalletAuthState({
        status: 'error',
        walletAddress: null,
        tier: 'unverified',
        error: error instanceof Error ? error.message : String(error),
      });
      return { ok: false, error: 'session_refresh_failed' };
    }
  }, []);

  const verifyWallet = useCallback(
    async (walletAddress: string): Promise<boolean> => {
      if (!walletAddress) {
        return false;
      }

      if (
        walletAuth.status === 'verified' &&
        walletAuth.walletAddress === walletAddress &&
        walletAuth.tier !== 'unverified'
      ) {
        return true;
      }

      setWalletAuthState({
        status: 'verifying',
        walletAddress,
        tier: 'unverified',
      });

      try {
        const challengeRes = await fetch('/api/wallet-auth/challenge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ walletAddress }),
        });
        const challengeBody = (await challengeRes.json()) as {
          ok: boolean;
          challengeId?: string;
          message?: string;
          error?: string;
        };

        if (!challengeRes.ok || !challengeBody.ok || !challengeBody.challengeId || !challengeBody.message) {
          throw new Error(challengeBody.error || 'challenge_failed');
        }

        const signature = await signWithInjectedWallet(walletAddress, challengeBody.message);

        const verifyRes = await fetch('/api/wallet-auth/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            challengeId: challengeBody.challengeId,
            walletAddress,
            signature,
          }),
        });
        const verifyBody = (await verifyRes.json()) as WalletAuthSessionResponse;

        if (!verifyRes.ok || !verifyBody.ok) {
          throw new Error(verifyBody.error || 'verify_failed');
        }

        setWalletAuthState({
          status: 'verified',
          walletAddress,
          tier: verifyBody.tier || 'verified_non_holder',
          sessionId: verifyBody.sessionId,
          expiresAtMs: verifyBody.expiresAtMs,
        });

        return true;
      } catch (error) {
        setWalletAuthState({
          status: 'error',
          walletAddress,
          tier: 'unverified',
          error: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
    },
    [walletAuth.status, walletAuth.walletAddress, walletAuth.tier],
  );

  const logoutWalletSession = useCallback(async () => {
    try {
      await fetch('/api/wallet-auth/logout', { method: 'POST' });
    } finally {
      setWalletAuthState({
        status: 'guest',
        walletAddress: null,
        tier: 'unverified',
      });
    }
  }, []);

  return {
    walletAuth,
    refreshSession,
    verifyWallet,
    logoutWalletSession,
  };
}
