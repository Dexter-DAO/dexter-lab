/**
 * Reown AppKit — Global Initialization
 *
 * Configures wallet connection for Dexter Lab.
 * Supports Solana mainnet via Phantom, Solflare, Backpack, WalletConnect QR, etc.
 *
 * This module runs once at import time (outside React).
 * Import it in root.tsx to bootstrap the wallet system.
 */

import { createAppKit } from '@reown/appkit/react';
import { SolanaAdapter } from '@reown/appkit-adapter-solana/react';
import { solana } from '@reown/appkit/networks';

const projectId = import.meta.env.VITE_REOWN_PROJECT_ID || '';

const solanaAdapter = new SolanaAdapter();

export const appKit = projectId
  ? createAppKit({
      adapters: [solanaAdapter],
      networks: [solana],
      projectId,
      metadata: {
        name: 'Dexter Lab',
        description: 'Build and deploy paid APIs with AI',
        url: 'https://lab.dexter.cash',
        icons: ['https://lab.dexter.cash/logo-dark.png'],
      },
      features: {
        analytics: true,
        email: false,
        socials: [],
      },
      themeMode: 'dark',
    })
  : null;
