import type { WalletAccessTier } from './wallet-auth';

export interface TierCaps {
  maxTurns: number;
  maxBudgetUsd: number;
}

function toPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function toPositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getUnverifiedCaps(): TierCaps {
  return {
    maxTurns: toPositiveInt(process.env.WALLET_GATING_UNVERIFIED_MAX_TURNS, 6),
    maxBudgetUsd: toPositiveNumber(process.env.WALLET_GATING_UNVERIFIED_MAX_BUDGET_USD, 1),
  };
}

function getVerifiedNonHolderCaps(): TierCaps {
  return {
    maxTurns: toPositiveInt(process.env.WALLET_GATING_VERIFIED_NON_HOLDER_MAX_TURNS, 8),
    maxBudgetUsd: toPositiveNumber(process.env.WALLET_GATING_VERIFIED_NON_HOLDER_MAX_BUDGET_USD, 3),
  };
}

function getVerifiedHolderCaps(): TierCaps {
  return {
    maxTurns: toPositiveInt(process.env.WALLET_GATING_VERIFIED_HOLDER_MAX_TURNS, 12),
    maxBudgetUsd: toPositiveNumber(process.env.WALLET_GATING_VERIFIED_HOLDER_MAX_BUDGET_USD, 10),
  };
}

export function getTierCaps(tier: WalletAccessTier): TierCaps {
  if (tier === 'verified_holder') {
    return getVerifiedHolderCaps();
  }

  if (tier === 'verified_non_holder') {
    return getVerifiedNonHolderCaps();
  }

  return getUnverifiedCaps();
}

export function clampRequestedLimits(
  requested: { maxTurns?: number; maxBudgetUsd?: number },
  caps: TierCaps,
): TierCaps {
  const normalizedTurns =
    Number.isFinite(requested.maxTurns) && (requested.maxTurns as number) > 0
      ? Math.floor(requested.maxTurns as number)
      : caps.maxTurns;
  const normalizedBudget =
    Number.isFinite(requested.maxBudgetUsd) && (requested.maxBudgetUsd as number) > 0
      ? (requested.maxBudgetUsd as number)
      : caps.maxBudgetUsd;

  return {
    maxTurns: Math.min(normalizedTurns, caps.maxTurns),
    maxBudgetUsd: Math.min(normalizedBudget, caps.maxBudgetUsd),
  };
}
