/**
 * Wallet Store
 *
 * Nanostore atoms for wallet connection state.
 * Synced with Reown AppKit via the useWalletSync hook.
 * Other components read from these stores without importing AppKit directly.
 */

import { atom, computed } from 'nanostores';

/** Connected wallet address (null when disconnected) */
export const $walletAddress = atom<string | null>(null);

/** Whether a wallet is currently connected */
export const $walletConnected = computed($walletAddress, (addr) => !!addr);

/** Truncated display address (e.g., "7xK3...9fPq") */
export const $walletDisplay = computed($walletAddress, (addr) => {
  if (!addr) {
    return null;
  }

  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
});

/**
 * Set the connected wallet address.
 * Also persists to localStorage and cookie for the deploy flow.
 */
export function setWalletAddress(address: string | null): void {
  $walletAddress.set(address);

  if (typeof window === 'undefined') {
    return;
  }

  if (address) {
    localStorage.setItem('dexter_creator_wallet', address);
    document.cookie = `dexter_creator_wallet=${encodeURIComponent(address)}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
  } else {
    localStorage.removeItem('dexter_creator_wallet');
    document.cookie = 'dexter_creator_wallet=; path=/; max-age=0';
  }
}

/**
 * Initialize wallet state from localStorage on mount.
 * Called once from the sync hook.
 */
export function initWalletFromStorage(): void {
  if (typeof window === 'undefined') {
    return;
  }

  const stored = localStorage.getItem('dexter_creator_wallet');

  if (stored) {
    $walletAddress.set(stored);
  }
}
