import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-toastify';

const WALLET_STORAGE_KEY = 'dexter_creator_wallet';

/** Validate a Solana wallet address (base58, 32-44 chars) */
function isValidSolanaAddress(address: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
}

/** Read wallet from localStorage */
export function getStoredWallet(): string {
  if (typeof window === 'undefined') {
    return '';
  }

  return localStorage.getItem(WALLET_STORAGE_KEY) || '';
}

/** Store wallet in localStorage and cookie (cookie for server-side access) */
export function setStoredWallet(wallet: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  if (wallet) {
    localStorage.setItem(WALLET_STORAGE_KEY, wallet);
    document.cookie = `dexter_creator_wallet=${encodeURIComponent(wallet)}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
  } else {
    localStorage.removeItem(WALLET_STORAGE_KEY);
    document.cookie = 'dexter_creator_wallet=; path=/; max-age=0';
  }
}

interface WalletInputProps {
  chatStarted: boolean;
}

export function WalletInput({ chatStarted }: WalletInputProps) {
  const [wallet, setWallet] = useState('');
  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    const stored = getStoredWallet();

    if (stored) {
      setWallet(stored);
      setIsSaved(true);
    }
  }, []);

  const handleSave = useCallback((address: string) => {
    const trimmed = address.trim();

    if (!trimmed) {
      setStoredWallet('');
      setWallet('');
      setIsSaved(false);

      return;
    }

    if (!isValidSolanaAddress(trimmed)) {
      toast.error('Invalid Solana wallet address');
      return;
    }

    setStoredWallet(trimmed);
    setWallet(trimmed);
    setIsSaved(true);
    toast.success('Wallet saved');
  }, []);

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      const trimmed = text.trim();

      if (isValidSolanaAddress(trimmed)) {
        handleSave(trimmed);
      } else {
        toast.error('Clipboard does not contain a valid Solana address');
      }
    } catch {
      toast.error('Could not read clipboard');
    }
  }, [handleSave]);

  // Don't show once chat has started
  if (chatStarted) {
    return null;
  }

  // Compact saved state -- just show truncated address with edit option
  if (isSaved && wallet) {
    return (
      <div className="flex items-center justify-center gap-2 mb-2 max-w-chat mx-auto w-full px-2">
        <div className="flex items-center gap-1.5 text-xs text-bolt-elements-textTertiary">
          <div className="i-ph:wallet text-sm text-accent-500" />
          <span className="font-mono">
            {wallet.slice(0, 4)}...{wallet.slice(-4)}
          </span>
        </div>
        <button
          onClick={() => {
            setIsSaved(false);
          }}
          className="text-xs text-bolt-elements-textTertiary hover:text-bolt-elements-textSecondary transition-colors"
        >
          edit
        </button>
      </div>
    );
  }

  // Input state
  return (
    <div className="flex items-center gap-2 mb-3 max-w-chat mx-auto w-full px-2">
      <div className="flex-1 flex items-center gap-2 border border-bolt-elements-borderColor rounded-lg bg-bolt-elements-background-depth-2 px-3 py-1.5">
        <div className="i-ph:wallet text-sm text-bolt-elements-textTertiary shrink-0" />
        <input
          type="text"
          value={wallet}
          onChange={(e) => setWallet(e.target.value)}
          onBlur={() => {
            if (wallet.trim()) {
              handleSave(wallet);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && wallet.trim()) {
              handleSave(wallet);
            }
          }}
          placeholder="Your Solana wallet address"
          className="flex-1 bg-transparent text-xs text-bolt-elements-textPrimary placeholder-bolt-elements-textTertiary outline-none font-mono min-w-0"
        />
        <button
          onClick={handlePaste}
          className="text-xs text-bolt-elements-textTertiary hover:text-accent-500 transition-colors shrink-0"
          title="Paste from clipboard"
        >
          <div className="i-ph:clipboard text-sm" />
        </button>
      </div>
    </div>
  );
}
