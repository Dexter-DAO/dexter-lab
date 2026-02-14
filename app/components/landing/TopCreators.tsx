/**
 * TopCreators — Leaderboard of the top 5 Lab creators by revenue
 *
 * Fetches all public resources, aggregates gross_revenue_usdc by creator_wallet,
 * and displays a ranked leaderboard with both "generated" (100%) and "earned" (70%) figures.
 *
 * Features:
 *  - Hero stat: aggregate total earned across all creators
 *  - Top resource name per creator (their highest-earning API)
 *  - Proportional revenue bars (relative to #1)
 *  - Animated count-up on scroll into view
 *  - Responsive: stacks revenue columns on mobile, shows only "Earned"
 */

import { useEffect, useState, useRef, useCallback } from 'react';

const DEXTER_API_BASE = 'https://api.dexter.cash';
const CREATOR_TAKE = 0.7;
const COUNTUP_DURATION_MS = 1200;

interface PublicResource {
  id: string;
  name: string;
  creator_wallet?: string;
  gross_revenue_usdc?: number;
}

interface CreatorStats {
  wallet: string;
  displayName: string;
  resourceCount: number;
  topResourceName: string; // name of their highest-earning resource
  revenueGenerated: number; // 100% — total gross
  revenueEarned: number; // 70% — creator cut
}

// ─── Name resolution ─────────────────────────────────────────────────────────

function useCreatorNames(wallets: string[]): Map<string, string> {
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const resolvedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const toResolve = wallets.filter((w) => w && !resolvedRef.current.has(w));

    if (toResolve.length === 0) {
      return;
    }

    let cancelled = false;

    const resolve = async () => {
      const results = new Map<string, string>();

      await Promise.all(
        toResolve.map(async (wallet) => {
          try {
            const res = await fetch(`${DEXTER_API_BASE}/api/dexter-lab/resolve-name/${wallet}`);

            if (res.ok) {
              const data = (await res.json()) as { wallet: string; display: string };
              results.set(wallet, data.display);
            }
          } catch {
            results.set(wallet, `${wallet.slice(0, 4)}...${wallet.slice(-4)}`);
          }

          resolvedRef.current.add(wallet);
        }),
      );

      if (!cancelled) {
        setNames((prev) => {
          const next = new Map(prev);

          for (const [k, v] of results) {
            next.set(k, v);
          }

          return next;
        });
      }
    };

    resolve();

    return () => {
      cancelled = true;
    };
  }, [wallets.join(',')]);

  return names;
}

// ─── Animated count-up hook ──────────────────────────────────────────────────

function useCountUp(target: number, isVisible: boolean, duration = COUNTUP_DURATION_MS): number {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number>();

  useEffect(() => {
    if (!isVisible || target <= 0) {
      return;
    }

    const start = performance.now();

    const tick = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);

      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(target * eased);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setValue(target);
      }
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [target, isVisible, duration]);

  return value;
}

// ─── Intersection observer hook ──────────────────────────────────────────────

function useInView(threshold = 0.2): [React.RefObject<HTMLElement | null>, boolean] {
  const ref = useRef<HTMLElement | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;

    if (!el) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect(); // only trigger once
        }
      },
      { threshold },
    );

    observer.observe(el);

    return () => observer.disconnect();
  }, [threshold]);

  return [ref, inView];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatUsd(amount: number): string {
  if (amount >= 1000) {
    return `$${(amount / 1000).toFixed(1)}k`;
  }

  if (amount >= 1) {
    return `$${amount.toFixed(2)}`;
  }

  if (amount > 0) {
    return `$${amount.toFixed(4).replace(/0+$/, '').replace(/\.$/, '.00')}`;
  }

  return '$0.00';
}

const GRADIENT_STYLE = {
  background: 'linear-gradient(130deg, #d13f00 0%, #ff6b00 42%, #ffb42c 100%)',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  backgroundClip: 'text',
} as const;

const RANK_STYLES: Record<number, { ring: string; badge: string; glow: string }> = {
  1: {
    ring: 'border-amber-400/60',
    badge: 'bg-gradient-to-br from-amber-400 to-amber-600 text-gray-950',
    glow: 'shadow-[0_0_12px_rgba(251,191,36,0.15)]',
  },
  2: {
    ring: 'border-gray-300/40 dark:border-gray-400/30',
    badge: 'bg-gradient-to-br from-gray-300 to-gray-400 text-gray-800',
    glow: '',
  },
  3: {
    ring: 'border-amber-600/30',
    badge: 'bg-gradient-to-br from-amber-600 to-amber-800 text-amber-100',
    glow: '',
  },
  4: {
    ring: 'border-gray-700/20',
    badge: 'bg-gray-800/60 text-gray-400',
    glow: '',
  },
  5: {
    ring: 'border-gray-700/20',
    badge: 'bg-gray-800/60 text-gray-400',
    glow: '',
  },
};

// ─── Leaderboard Row ─────────────────────────────────────────────────────────

function CreatorRow({
  creator,
  rank,
  maxRevenue,
  isVisible,
}: {
  creator: CreatorStats;
  rank: number;
  maxRevenue: number;
  isVisible: boolean;
}) {
  const style = RANK_STYLES[rank] || RANK_STYLES[5];
  const barPercent = maxRevenue > 0 ? (creator.revenueGenerated / maxRevenue) * 100 : 0;

  const animatedGenerated = useCountUp(creator.revenueGenerated, isVisible);
  const animatedEarned = useCountUp(creator.revenueEarned, isVisible);

  return (
    <div
      className={`group relative overflow-hidden flex items-center gap-3 md:gap-4 px-3 md:px-4 py-3 rounded-lg border ${style.ring} ${style.glow} bg-white/[0.02] dark:bg-gray-900/20 hover:bg-white/[0.04] dark:hover:bg-gray-900/40 transition-all duration-200`}
    >
      {/* Revenue proportion bar (background) */}
      <div
        className="absolute inset-y-0 left-0 bg-accent-500/[0.04] transition-all duration-1000 ease-out"
        style={{ width: isVisible ? `${barPercent}%` : '0%' }}
      />

      {/* Rank badge */}
      <div
        className={`relative shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${style.badge}`}
      >
        {rank}
      </div>

      {/* Creator info */}
      <div className="relative flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-bolt-elements-textPrimary truncate">{creator.displayName}</span>
          {rank === 1 && <span className="i-ph:crown-simple-fill text-amber-400 text-sm shrink-0" />}
        </div>
        <div className="text-[10px] text-bolt-elements-textTertiary mt-0.5 truncate">
          <span className="text-accent-500/70">{creator.topResourceName}</span>
          {creator.resourceCount > 1 && <span> +{creator.resourceCount - 1} more</span>}
        </div>
      </div>

      {/* Revenue — desktop: two columns, mobile: earned only */}
      <div className="relative hidden md:block shrink-0 text-right">
        <div className="text-[10px] text-bolt-elements-textTertiary mb-0.5">Generated</div>
        <div className="text-sm font-semibold text-bolt-elements-textPrimary font-mono">
          {formatUsd(animatedGenerated)}
        </div>
      </div>

      <div className="relative hidden md:block shrink-0 w-px h-8 bg-gray-700/20" />

      <div className="relative shrink-0 text-right">
        <div className="text-[10px] text-bolt-elements-textTertiary mb-0.5">
          <span className="hidden md:inline">Earned</span>
          <span className="md:hidden">Earned (70%)</span>
        </div>
        <div className="text-sm font-bold font-mono text-emerald-500">{formatUsd(animatedEarned)}</div>
      </div>
    </div>
  );
}

// ─── Hero Stat ───────────────────────────────────────────────────────────────

function HeroStat({ totalEarned, isVisible }: { totalEarned: number; isVisible: boolean }) {
  const animated = useCountUp(totalEarned, isVisible, 1600);

  return (
    <div className="text-center mb-10">
      <div className="font-display text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight" style={GRADIENT_STYLE}>
        {formatUsd(animated)}
      </div>
      <div className="text-sm text-bolt-elements-textSecondary mt-2">earned by creators</div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function TopCreators() {
  const [creators, setCreators] = useState<CreatorStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [sectionRef, isVisible] = useInView(0.15);

  // Extract wallets for name resolution
  const wallets = creators.map((c) => c.wallet);
  const creatorNames = useCreatorNames(wallets);

  // Once names resolve, update display names
  useEffect(() => {
    if (creatorNames.size > 0 && creators.length > 0) {
      setCreators((prev) =>
        prev.map((c) => ({
          ...c,
          displayName: creatorNames.get(c.wallet) || c.displayName,
        })),
      );
    }
  }, [creatorNames.size]);

  useEffect(() => {
    let cancelled = false;

    const fetchAndAggregate = async () => {
      try {
        const res = await fetch(`${DEXTER_API_BASE}/api/dexter-lab/resources/public?sort=popular&limit=100`);

        if (!res.ok || cancelled) {
          return;
        }

        const data = (await res.json()) as { resources: PublicResource[] };

        // Aggregate by creator wallet, track top resource per creator
        const byCreator = new Map<
          string,
          { revenue: number; count: number; topResource: string; topResourceRevenue: number }
        >();

        for (const resource of data.resources) {
          const wallet = resource.creator_wallet;
          const revenue = Number(resource.gross_revenue_usdc) || 0;

          if (!wallet || revenue <= 0) {
            continue;
          }

          const existing = byCreator.get(wallet) || {
            revenue: 0,
            count: 0,
            topResource: resource.name,
            topResourceRevenue: 0,
          };
          existing.revenue += revenue;
          existing.count += 1;

          if (revenue > existing.topResourceRevenue) {
            existing.topResource = resource.name;
            existing.topResourceRevenue = revenue;
          }

          byCreator.set(wallet, existing);
        }

        // Sort by revenue descending, take top 5
        const sorted = Array.from(byCreator.entries())
          .sort(([, a], [, b]) => b.revenue - a.revenue)
          .slice(0, 5)
          .map(
            ([wallet, stats]): CreatorStats => ({
              wallet,
              displayName: `${wallet.slice(0, 4)}...${wallet.slice(-4)}`,
              resourceCount: stats.count,
              topResourceName: stats.topResource,
              revenueGenerated: stats.revenue,
              revenueEarned: stats.revenue * CREATOR_TAKE,
            }),
          );

        if (!cancelled) {
          setCreators(sorted);
        }
      } catch {
        /* silent */
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchAndAggregate();

    return () => {
      cancelled = true;
    };
  }, []);

  // Derived stats
  const totalEarned = creators.reduce((sum, c) => sum + c.revenueEarned, 0);
  const maxRevenue = creators.length > 0 ? creators[0].revenueGenerated : 0;

  // Don't render if no creators with revenue
  if (!loading && creators.length === 0) {
    return null;
  }

  // Loading state
  if (loading) {
    return (
      <section className="max-w-2xl mx-auto px-6 mb-28">
        <div className="text-center">
          <div className="inline-block w-5 h-5 border-2 border-accent-500/30 border-t-accent-500 rounded-full animate-spin" />
        </div>
      </section>
    );
  }

  return (
    <section ref={sectionRef as React.RefObject<HTMLElement>} className="max-w-2xl mx-auto px-6 mb-28">
      {/* Hero stat */}
      <HeroStat totalEarned={totalEarned} isVisible={isVisible} />

      {/* Header */}
      <div className="text-center mb-8">
        <h2 className="font-display text-lg lg:text-xl font-semibold tracking-wide mb-2" style={GRADIENT_STYLE}>
          Top Lab Creators
        </h2>
        <p className="text-xs text-bolt-elements-textTertiary max-w-md mx-auto">
          The builders earning the most from their x402 APIs.
          <span className="hidden md:inline">
            {' '}
            Generated is total revenue &mdash; earned is the creator&rsquo;s 70% cut.
          </span>
        </p>
      </div>

      {/* Leaderboard */}
      <div className="space-y-2">
        {creators.map((creator, i) => (
          <CreatorRow
            key={creator.wallet}
            creator={creator}
            rank={i + 1}
            maxRevenue={maxRevenue}
            isVisible={isVisible}
          />
        ))}
      </div>

      {/* Footer hint */}
      <div className="text-center mt-6">
        <p className="text-[10px] text-bolt-elements-textTertiary">
          Build a resource and start climbing the leaderboard
        </p>
      </div>
    </section>
  );
}
