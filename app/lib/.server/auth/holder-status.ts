import { validateWalletAddress } from './wallet-auth';

export interface HolderStatus {
  walletAddress: string;
  mint: string;
  balanceRaw: string;
  balanceUi: number;
  isHolder: boolean;
  thresholdRaw: string;
  checkedAtMs: number;
}

const DEFAULT_DEXTER_MINT = 'EfPoo4wWgxKVToit7yX5VtXXBrhao4G8L7vrbKy6pump';
const DEFAULT_DECIMALS = 6;
const DEFAULT_THRESHOLD_RAW = BigInt(1_000_000); // 1 DEXTER by default
const DEFAULT_CACHE_TTL_MS = 45_000;
const DEFAULT_RPC_TIMEOUT_MS = 8_000;

const cache = new Map<string, { expiresAtMs: number; value: HolderStatus }>();

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function dexterMint(): string {
  return process.env.DEXTER_TOKEN_MINT?.trim() || DEFAULT_DEXTER_MINT;
}

function dexterDecimals(): number {
  return readPositiveInt(process.env.DEXTER_TOKEN_DECIMALS, DEFAULT_DECIMALS);
}

function holderThresholdRaw(): bigint {
  try {
    const raw = process.env.DEXTER_MIN_HOLDER_BALANCE_RAW?.trim();

    if (!raw) {
      return DEFAULT_THRESHOLD_RAW;
    }

    const parsed = BigInt(raw);

    return parsed > 0n ? parsed : DEFAULT_THRESHOLD_RAW;
  } catch {
    return DEFAULT_THRESHOLD_RAW;
  }
}

function holderCacheTtlMs(): number {
  return readPositiveInt(process.env.DEXTER_HOLDER_CACHE_TTL_MS, DEFAULT_CACHE_TTL_MS);
}

function rpcTimeoutMs(): number {
  return readPositiveInt(process.env.DEXTER_HOLDER_RPC_TIMEOUT_MS, DEFAULT_RPC_TIMEOUT_MS);
}

function resolveRpcUrl(): string {
  const explicit = process.env.SOLANA_RPC_URL?.trim() || process.env.SOLANA_MAINNET_RPC_URL?.trim();

  if (explicit) {
    return explicit;
  }

  const heliusKey = process.env.HELIUS_API_KEY?.trim();

  if (heliusKey) {
    return `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`;
  }

  return 'https://api.mainnet-beta.solana.com';
}

function toUiAmount(raw: bigint, decimals: number): number {
  return Number(raw) / 10 ** decimals;
}

async function fetchTokenBalanceRaw(walletAddress: string, mint: string): Promise<bigint> {
  const rpcUrl = resolveRpcUrl();
  const timeout = rpcTimeoutMs();
  const body = {
    jsonrpc: '2.0',
    id: `holder-${walletAddress}`,
    method: 'getTokenAccountsByOwner',
    params: [walletAddress, { mint }, { encoding: 'jsonParsed' }],
  };

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      });

      if (!response.ok) {
        throw new Error(`RPC ${response.status}`);
      }

      const payload = (await response.json()) as {
        result?: {
          value?: Array<{
            account?: { data?: { parsed?: { info?: { tokenAmount?: { amount?: string } } } } };
          }>;
        };
      };

      const accounts = payload.result?.value || [];
      let total = 0n;

      for (const account of accounts) {
        const rawAmount = account.account?.data?.parsed?.info?.tokenAmount?.amount;

        if (!rawAmount) {
          continue;
        }

        total += BigInt(rawAmount);
      }

      return total;
    } catch (error) {
      if (attempt === 2) {
        throw error;
      }
    }
  }

  return 0n;
}

export async function resolveDexterHolderStatus(
  walletAddress: string,
  options: { forceRefresh?: boolean } = {},
): Promise<HolderStatus> {
  if (!validateWalletAddress(walletAddress)) {
    throw new Error('Invalid wallet address');
  }

  const nowMs = Date.now();
  const cached = cache.get(walletAddress);

  if (!options.forceRefresh && cached && cached.expiresAtMs > nowMs) {
    return cached.value;
  }

  const mint = dexterMint();
  const decimals = dexterDecimals();
  const thresholdRaw = holderThresholdRaw();
  const balanceRaw = await fetchTokenBalanceRaw(walletAddress, mint);

  const result: HolderStatus = {
    walletAddress,
    mint,
    balanceRaw: balanceRaw.toString(),
    balanceUi: toUiAmount(balanceRaw, decimals),
    isHolder: balanceRaw >= thresholdRaw,
    thresholdRaw: thresholdRaw.toString(),
    checkedAtMs: nowMs,
  };

  cache.set(walletAddress, {
    expiresAtMs: nowMs + holderCacheTtlMs(),
    value: result,
  });

  return result;
}
