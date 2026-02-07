/**
 * useWalletSync
 *
 * Syncs Reown AppKit connection state with the wallet nanostore.
 * Call this once in a top-level client component (e.g., root layout).
 */

import { useEffect } from 'react';
import { useAppKitAccount } from '@reown/appkit/react';
import { setWalletAddress, initWalletFromStorage } from '~/lib/stores/wallet';

export function useWalletSync(): void {
  const { address, isConnected } = useAppKitAccount();

  // Initialize from localStorage on first mount
  useEffect(() => {
    initWalletFromStorage();
  }, []);

  // Sync AppKit state → nanostore whenever connection changes
  useEffect(() => {
    if (isConnected && address) {
      setWalletAddress(address);
    } else if (!isConnected) {
      setWalletAddress(null);
    }
  }, [address, isConnected]);
}
