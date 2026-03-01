import { atom } from 'nanostores';

export type WalletTier = 'unverified' | 'verified_non_holder' | 'verified_holder';
export type WalletAuthStatus = 'guest' | 'verifying' | 'verified' | 'error';

export interface WalletAuthState {
  status: WalletAuthStatus;
  walletAddress: string | null;
  tier: WalletTier;
  sessionId?: string;
  expiresAtMs?: number;
  error?: string;
}

export const $walletAuth = atom<WalletAuthState>({
  status: 'guest',
  walletAddress: null,
  tier: 'unverified',
});

export function setWalletAuthState(next: WalletAuthState): void {
  $walletAuth.set(next);
}
