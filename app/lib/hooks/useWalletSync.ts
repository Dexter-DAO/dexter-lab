/**
 * useWalletSync
 *
 * Syncs Reown AppKit connection state with the wallet nanostore.
 * Call this once in a top-level client component (e.g., root layout).
 *
 * Handles the AppKit initialization race condition:
 * - On page load, AppKit briefly reports isConnected:false before
 *   reconnecting a previous session. We must NOT clear the wallet
 *   during this window.
 * - We track whether AppKit was ever connected in this session.
 *   Only transitions from connected → disconnected (explicit user
 *   disconnect via the AppKit modal) trigger a full wallet clear.
 *   Starting as disconnected (initialization) does nothing.
 */

import { useEffect, useRef } from 'react';
import { useAppKitAccount } from '@reown/appkit/react';
import { setWalletAddress, disconnectWallet, initWalletFromStorage } from '~/lib/stores/wallet';

export function useWalletSync(): void {
  const { address, isConnected } = useAppKitAccount();
  const wasConnected = useRef(false);

  // Initialize from localStorage on first mount
  useEffect(() => {
    initWalletFromStorage();
  }, []);

  useEffect(() => {
    if (isConnected && address) {
      // AppKit connected — update the store and mark that we've been connected
      setWalletAddress(address);
      wasConnected.current = true;
    } else if (!isConnected && wasConnected.current) {
      /*
       * AppKit was connected in this session, now disconnected.
       * This is an explicit user disconnect (via AppKit modal) — clear everything.
       */
      disconnectWallet();
      wasConnected.current = false;
    }

    /*
     * If !isConnected && !wasConnected.current → AppKit is initializing.
     * Do nothing. The address from localStorage (set by initWalletFromStorage)
     * stays in the nanostore until AppKit reconnects or the user disconnects.
     */
  }, [address, isConnected]);
}
