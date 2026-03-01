import { createHmac, createPublicKey, randomBytes, timingSafeEqual, verify as verifySignature } from 'node:crypto';
import { parseCookies } from '~/lib/api/cookies';
import { base58Decode } from '~/lib/wallet/base58';

export type WalletAccessTier = 'unverified' | 'verified_non_holder' | 'verified_holder';

interface WalletChallenge {
  id: string;
  nonce: string;
  walletAddress: string;
  message: string;
  issuedAtMs: number;
  expiresAtMs: number;
  used: boolean;
}

export interface WalletSession {
  sessionId: string;
  walletAddress: string;
  authenticatedAtMs: number;
  expiresAtMs: number;
}

const SESSION_COOKIE_NAME = 'dexter_wallet_session';
const DEFAULT_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

const challengeStore = new Map<string, WalletChallenge>();
const fallbackSecret = randomBytes(32).toString('hex');

function toPositiveMs(value: string | undefined, fallbackMs: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallbackMs;
}

function challengeTtlMs(): number {
  return toPositiveMs(process.env.WALLET_AUTH_CHALLENGE_TTL_MS, DEFAULT_CHALLENGE_TTL_MS);
}

function sessionTtlMs(): number {
  return toPositiveMs(process.env.WALLET_AUTH_SESSION_TTL_MS, DEFAULT_SESSION_TTL_MS);
}

function getCookieSecret(): string {
  const configured = process.env.WALLET_AUTH_SECRET?.trim();
  if (configured) return configured;
  return fallbackSecret;
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function signValue(value: string): string {
  return createHmac('sha256', getCookieSecret()).update(value).digest('base64url');
}

function cleanupChallenges(nowMs = Date.now()): void {
  for (const [challengeId, challenge] of challengeStore.entries()) {
    if (challenge.expiresAtMs <= nowMs || (challenge.used && nowMs - challenge.issuedAtMs > challengeTtlMs())) {
      challengeStore.delete(challengeId);
    }
  }
}

function isLikelySolanaAddress(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return false;

  try {
    const decoded = base58Decode(value);
    return decoded.length === 32;
  } catch {
    return false;
  }
}

function buildChallengeMessage(walletAddress: string, requestUrl: URL, nonce: string, expiresAtMs: number): string {
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(expiresAtMs).toISOString();

  return [
    'Dexter Lab Wallet Verification',
    `Domain: ${requestUrl.host}`,
    `Origin: ${requestUrl.origin}`,
    `Address: ${walletAddress}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    `Expiration Time: ${expiresAt}`,
    'Statement: Sign this message to verify wallet ownership for Dexter Lab chat tiering.',
  ].join('\n');
}

function createEd25519PublicKey(pubkeyBytes: Uint8Array) {
  if (pubkeyBytes.length !== 32) {
    throw new Error('Invalid Solana public key length');
  }
  const keyDer = Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(pubkeyBytes)]);
  return createPublicKey({ key: keyDer, format: 'der', type: 'spki' });
}

function verifyDetachedSignature(walletAddress: string, message: string, signatureBase58: string): boolean {
  const publicKeyBytes = base58Decode(walletAddress);
  const signatureBytes = base58Decode(signatureBase58);

  if (signatureBytes.length !== 64) return false;

  const publicKey = createEd25519PublicKey(publicKeyBytes);
  return verifySignature(
    null,
    Buffer.from(message, 'utf8'),
    publicKey,
    Buffer.from(signatureBytes),
  );
}

function serializeCookie(name: string, value: string, maxAgeSeconds: number): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (process.env.NODE_ENV === 'production') {
    parts.push('Secure');
  }
  return parts.join('; ');
}

function buildSessionCookie(session: WalletSession): string {
  const payload = base64UrlEncode(JSON.stringify(session));
  const signature = signValue(payload);
  return serializeCookie(SESSION_COOKIE_NAME, `${payload}.${signature}`, Math.max(1, Math.floor((session.expiresAtMs - Date.now()) / 1000)));
}

export function clearWalletSessionCookie(): string {
  return serializeCookie(SESSION_COOKIE_NAME, '', 0);
}

export function issueWalletSessionCookie(walletAddress: string): { cookie: string; session: WalletSession } {
  const nowMs = Date.now();
  const session: WalletSession = {
    sessionId: randomBytes(16).toString('hex'),
    walletAddress,
    authenticatedAtMs: nowMs,
    expiresAtMs: nowMs + sessionTtlMs(),
  };
  return { session, cookie: buildSessionCookie(session) };
}

export function maybeRefreshWalletSessionCookie(session: WalletSession): string | null {
  const ttl = session.expiresAtMs - Date.now();
  if (ttl > sessionTtlMs() / 2) return null;
  return issueWalletSessionCookie(session.walletAddress).cookie;
}

export function readWalletSessionFromRequest(request: Request): WalletSession | null {
  try {
    const cookies = parseCookies(request.headers.get('Cookie'));
    const rawCookie = cookies[SESSION_COOKIE_NAME];
    if (!rawCookie) return null;

    const [payload, providedSig] = rawCookie.split('.');
    if (!payload || !providedSig) return null;

    const expectedSig = signValue(payload);
    const expectedBuffer = Buffer.from(expectedSig, 'utf8');
    const providedBuffer = Buffer.from(providedSig, 'utf8');
    if (expectedBuffer.length !== providedBuffer.length) return null;
    if (!timingSafeEqual(expectedBuffer, providedBuffer)) return null;

    const parsed = JSON.parse(base64UrlDecode(payload)) as WalletSession;
    if (!parsed || !isLikelySolanaAddress(parsed.walletAddress)) return null;
    if (!Number.isFinite(parsed.expiresAtMs) || parsed.expiresAtMs <= Date.now()) return null;
    if (!parsed.sessionId) return null;

    return parsed;
  } catch {
    return null;
  }
}

export function createWalletChallenge(walletAddress: string, request: Request) {
  if (!isLikelySolanaAddress(walletAddress)) {
    throw new Error('Invalid wallet address');
  }

  cleanupChallenges();

  const nowMs = Date.now();
  const expiresAtMs = nowMs + challengeTtlMs();
  const challengeId = randomBytes(12).toString('hex');
  const nonce = randomBytes(16).toString('hex');
  const requestUrl = new URL(request.url);
  const message = buildChallengeMessage(walletAddress, requestUrl, nonce, expiresAtMs);

  const challenge: WalletChallenge = {
    id: challengeId,
    nonce,
    walletAddress,
    message,
    issuedAtMs: nowMs,
    expiresAtMs,
    used: false,
  };
  challengeStore.set(challengeId, challenge);

  return {
    challengeId,
    walletAddress,
    nonce,
    message,
    expiresAtMs,
  };
}

export function verifyWalletChallenge(input: {
  challengeId: string;
  walletAddress: string;
  signatureBase58: string;
}) {
  cleanupChallenges();
  const challenge = challengeStore.get(input.challengeId);

  if (!challenge) {
    return { ok: false as const, reason: 'challenge_not_found' };
  }
  if (challenge.used) {
    return { ok: false as const, reason: 'challenge_used' };
  }
  if (challenge.expiresAtMs <= Date.now()) {
    return { ok: false as const, reason: 'challenge_expired' };
  }
  if (challenge.walletAddress !== input.walletAddress) {
    return { ok: false as const, reason: 'wallet_mismatch' };
  }

  let verified = false;
  try {
    verified = verifyDetachedSignature(input.walletAddress, challenge.message, input.signatureBase58);
  } catch {
    verified = false;
  }

  if (!verified) {
    return { ok: false as const, reason: 'invalid_signature' };
  }

  challenge.used = true;
  challengeStore.set(challenge.id, challenge);
  return { ok: true as const, challenge };
}

export function getWalletGatingMode(): 'off' | 'shadow' | 'enforce' {
  const raw = process.env.WALLET_GATING_MODE?.trim().toLowerCase();
  if (raw === 'off' || raw === 'shadow' || raw === 'enforce') return raw;
  return 'shadow';
}

export function validateWalletAddress(walletAddress: unknown): walletAddress is string {
  return isLikelySolanaAddress(walletAddress);
}
