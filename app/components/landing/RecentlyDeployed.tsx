/**
 * RecentlyDeployed — Public feed of live x402 resources
 *
 * Fetched from the public API endpoint. Shows resources created by
 * everyone on the platform, sorted by popularity (request count).
 * Gives the landing page a sense of an active, growing network.
 */

import { useEffect, useState } from 'react';

const DEXTER_API_BASE = 'https://api.dexter.cash';

interface PublicResource {
  id: string;
  name: string;
  description: string | null;
  resource_type: string;
  base_price_usdc: number;
  public_url: string;
  healthy: boolean;
  request_count: number;
  created_at: string;
  tags: string[];
  endpoints_json: Array<{ path: string; method: string; priceUsdc?: number }> | null;
}

function formatPrice(usdc: number): string {
  if (usdc < 0.01) {
    return `$${usdc.toFixed(4).replace(/0+$/, '').replace(/\.$/, '.00')}`;
  }

  return `$${usdc.toFixed(2)}`;
}

function formatRequests(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }

  return count.toString();
}

function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();

  if (diff < 0 || isNaN(diff)) {
    return 'just now';
  }

  const minutes = Math.floor(diff / 60000);

  if (minutes < 1) {
    return 'just now';
  }

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);

  return `${days}d ago`;
}

function ResourceCard({ resource }: { resource: PublicResource }) {
  const primaryEndpoint = resource.endpoints_json?.find((ep) => ep.priceUsdc && ep.priceUsdc > 0);
  const method = primaryEndpoint?.method || 'GET';

  return (
    <div className="group relative rounded-lg border border-gray-200/60 dark:border-gray-800/60 hover:border-accent-500/30 bg-white/5 dark:bg-gray-900/30 backdrop-blur-sm transition-all duration-200 overflow-hidden">
      <div className="px-4 py-3.5">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="relative shrink-0">
              <div className={`w-2 h-2 rounded-full ${resource.healthy ? 'bg-emerald-500' : 'bg-gray-500'}`} />
              {resource.healthy && (
                <div className="absolute inset-0 w-2 h-2 rounded-full bg-emerald-500 animate-ping opacity-30" />
              )}
            </div>
            <h3 className="text-sm font-semibold text-bolt-elements-textPrimary truncate">{resource.name}</h3>
          </div>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent-500/10 text-accent-400 font-bold shrink-0 uppercase">
            {method}
          </span>
        </div>

        {/* Description */}
        {resource.description && (
          <p className="text-xs text-bolt-elements-textSecondary leading-relaxed mb-3 line-clamp-2">
            {resource.description}
          </p>
        )}

        {/* Tags */}
        {resource.tags && resource.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {resource.tags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800/60 text-bolt-elements-textTertiary"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Footer stats */}
        <div className="flex items-center justify-between text-[11px] text-bolt-elements-textTertiary">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <span className="i-ph:lightning text-accent-500/70 text-xs" />
              {formatRequests(resource.request_count)} calls
            </span>
            <span>{formatPrice(resource.base_price_usdc)}/req</span>
          </div>
          <span>{timeAgo(resource.created_at)}</span>
        </div>
      </div>
    </div>
  );
}

export function RecentlyDeployed() {
  const [resources, setResources] = useState<PublicResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<'popular' | 'recent'>('popular');

  useEffect(() => {
    let cancelled = false;

    const fetchResources = async () => {
      try {
        const res = await fetch(`${DEXTER_API_BASE}/api/dexter-lab/resources/public?sort=${sortBy}&limit=12`);

        if (res.ok && !cancelled) {
          const data = (await res.json()) as { resources: PublicResource[] };
          setResources(data.resources);
        }
      } catch {
        /* silent — feed is supplementary */
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    setLoading(true);
    fetchResources();

    return () => {
      cancelled = true;
    };
  }, [sortBy]);

  if (loading && resources.length === 0) {
    return (
      <section className="max-w-4xl mx-auto px-6 mb-20">
        <div className="text-center">
          <div className="inline-block w-5 h-5 border-2 border-accent-500/30 border-t-accent-500 rounded-full animate-spin" />
        </div>
      </section>
    );
  }

  if (resources.length === 0) {
    return null;
  }

  return (
    <section className="max-w-4xl mx-auto px-6 mb-20">
      <div className="flex items-center justify-between mb-8">
        <h2 className="font-display text-lg lg:text-xl font-semibold text-bolt-elements-textPrimary tracking-wide">
          Live on the network
        </h2>
        <div className="flex items-center gap-1 text-xs">
          <button
            onClick={() => setSortBy('popular')}
            style={{ background: 'none' }}
            className={`px-2.5 py-1 rounded-full transition-colors ${
              sortBy === 'popular'
                ? 'bg-accent-500/10 text-accent-400 font-medium'
                : 'text-bolt-elements-textTertiary hover:text-bolt-elements-textSecondary'
            }`}
          >
            Popular
          </button>
          <button
            onClick={() => setSortBy('recent')}
            style={{ background: 'none' }}
            className={`px-2.5 py-1 rounded-full transition-colors ${
              sortBy === 'recent'
                ? 'bg-accent-500/10 text-accent-400 font-medium'
                : 'text-bolt-elements-textTertiary hover:text-bolt-elements-textSecondary'
            }`}
          >
            Recent
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {resources.map((resource) => (
          <ResourceCard key={resource.id} resource={resource} />
        ))}
      </div>

      <div className="text-center mt-6">
        <span className="text-[11px] text-bolt-elements-textTertiary">
          {resources.length} resources live on dexter.cash
        </span>
      </div>
    </section>
  );
}
