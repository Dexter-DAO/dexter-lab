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
import { $walletAddress, setWalletAddress, disconnectWallet, initWalletFromStorage } from '~/lib/stores/wallet';

const STALE_WALLET_GRACE_MS = 8_000;

export function useWalletSync(): void {
  const { address, isConnected } = useAppKitAccount();
  const wasConnected = useRef(false);
  const hydratedAtMs = useRef<number>(Date.now());

  // Initialize from localStorage on first mount
  useEffect(() => {
    hydratedAtMs.current = Date.now();
    initWalletFromStorage();
  }, []);

  useEffect(() => {
    if (isConnected && address) {
      // AppKit connected — update the store and mark that we've been connected
      setWalletAddress(address);

      if (!wasConnected.current) {
        // GA: track wallet connected (first time this session)
        import('~/lib/analytics')
          .then(({ trackEvent }) => {
            trackEvent('wallet_connected', { wallet_prefix: address.slice(0, 8) });
          })
          .catch(() => {
            /* ignore */
          });
      }

      wasConnected.current = true;
    } else if (!isConnected && wasConnected.current) {
      /*
       * AppKit was connected in this session, now disconnected.
       * This is an explicit user disconnect (via AppKit modal) — clear everything.
       */
      // GA: track wallet disconnected
      import('~/lib/analytics')
        .then(({ trackEvent }) => {
          trackEvent('wallet_disconnected');
        })
        .catch(() => {
          /* ignore */
        });

      disconnectWallet();
      wasConnected.current = false;
    } else if (!isConnected && !wasConnected.current && !address) {
      /*
       * If AppKit never re-established a session and we still show a persisted
       * wallet address, we can end up in a stale "connected-looking" UI where
       * the modal cannot actually disconnect anything.
       *
       * Give AppKit a small grace window, then clear stale persisted wallet
       * state so UI and wallet modal are consistent.
       */
      const persistedWallet = $walletAddress.get();
      const isPastGraceWindow = Date.now() - hydratedAtMs.current >= STALE_WALLET_GRACE_MS;

      if (persistedWallet && isPastGraceWindow) {
        disconnectWallet();
      }
    }

    /*
     * If !isConnected && !wasConnected.current → AppKit is initializing.
     * Do nothing. The address from localStorage (set by initWalletFromStorage)
     * stays in the nanostore until AppKit reconnects or the user disconnects.
     */
  }, [address, isConnected]);

  useEffect(() => {
    const handleVisibilityOrFocus = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }

      const persistedWallet = $walletAddress.get();
      const isPastGraceWindow = Date.now() - hydratedAtMs.current >= STALE_WALLET_GRACE_MS;

      if (!isConnected && !address && !wasConnected.current && persistedWallet && isPastGraceWindow) {
        disconnectWallet();
      }
    };

    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    return () => {
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, [address, isConnected]);
}
