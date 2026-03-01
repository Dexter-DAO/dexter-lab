import { describe, expect, it } from 'vitest';
import { clampRequestedLimits, getTierCaps } from './tier-policy';

describe('tier-policy', () => {
  it('returns increasing caps by tier', () => {
    const unverified = getTierCaps('unverified');
    const verifiedNonHolder = getTierCaps('verified_non_holder');
    const verifiedHolder = getTierCaps('verified_holder');

    expect(unverified.maxTurns).toBeLessThanOrEqual(verifiedNonHolder.maxTurns);
    expect(verifiedNonHolder.maxTurns).toBeLessThanOrEqual(verifiedHolder.maxTurns);
    expect(unverified.maxBudgetUsd).toBeLessThanOrEqual(verifiedNonHolder.maxBudgetUsd);
    expect(verifiedNonHolder.maxBudgetUsd).toBeLessThanOrEqual(verifiedHolder.maxBudgetUsd);
  });

  it('clamps requested limits to tier caps', () => {
    const caps = getTierCaps('unverified');
    const clamped = clampRequestedLimits(
      {
        maxTurns: caps.maxTurns + 100,
        maxBudgetUsd: caps.maxBudgetUsd + 100,
      },
      caps,
    );

    expect(clamped.maxTurns).toBe(caps.maxTurns);
    expect(clamped.maxBudgetUsd).toBe(caps.maxBudgetUsd);
  });
});
