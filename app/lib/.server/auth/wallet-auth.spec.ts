import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { base58Encode } from '~/lib/wallet/base58';
import {
  createWalletChallenge,
  issueWalletSessionCookie,
  readWalletSessionFromRequest,
  verifyWalletChallenge,
} from './wallet-auth';

function getCookieValue(setCookie: string): string {
  return setCookie.split(';')[0];
}

describe('wallet-auth primitives', () => {
  it('verifies a valid signed challenge and blocks replay', () => {
    const keypair = generateKeyPairSync('ed25519');
    const pubkeyDer = keypair.publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
    const walletAddress = base58Encode(new Uint8Array(pubkeyDer.subarray(pubkeyDer.length - 32)));

    const request = new Request('https://lab.dexter.cash/api/wallet-auth/challenge');
    const challenge = createWalletChallenge(walletAddress, request);
    const signature = sign(null, Buffer.from(challenge.message, 'utf8'), keypair.privateKey);
    const signatureBase58 = base58Encode(new Uint8Array(signature));

    const firstAttempt = verifyWalletChallenge({
      challengeId: challenge.challengeId,
      walletAddress,
      signatureBase58,
    });
    expect(firstAttempt.ok).toBe(true);

    const replayAttempt = verifyWalletChallenge({
      challengeId: challenge.challengeId,
      walletAddress,
      signatureBase58,
    });
    expect(replayAttempt.ok).toBe(false);

    if (!replayAttempt.ok) {
      expect(replayAttempt.reason).toBe('challenge_used');
    }
  });

  it('rejects tampered wallet session cookies', () => {
    const keypair = generateKeyPairSync('ed25519');
    const pubkeyDer = keypair.publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
    const walletAddress = base58Encode(new Uint8Array(pubkeyDer.subarray(pubkeyDer.length - 32)));
    const { cookie } = issueWalletSessionCookie(walletAddress);
    const rawCookie = getCookieValue(cookie);
    const tamperedCookie = `${rawCookie}x`;

    const validRequest = new Request('https://lab.dexter.cash/api/agent-chat', {
      headers: { Cookie: rawCookie },
    });
    const tamperedRequest = new Request('https://lab.dexter.cash/api/agent-chat', {
      headers: { Cookie: tamperedCookie },
    });

    expect(readWalletSessionFromRequest(validRequest)).not.toBeNull();
    expect(readWalletSessionFromRequest(tamperedRequest)).toBeNull();
  });
});
