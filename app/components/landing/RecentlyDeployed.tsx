/**
 * RecentlyDeployed — Public feed of live x402 resources
 *
 * Shows all deployed resources sorted by popularity or recency.
 * Cards flip on click to reveal endpoint details + "Try it" button
 * that triggers an actual x402 payment flow.
 */

import { useEffect, useState, useCallback } from 'react';
import { useStore } from '@nanostores/react';
import { $walletAddress } from '~/lib/stores/wallet';

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
  endpoints_json: Array<{ path: string; method: string; priceUsdc?: number; description?: string }> | null;
  cover_image_url?: string | null;
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

  if (days === 1) {
    return 'yesterday';
  }

  return `${days}d ago`;
}

// ─── Card Component ───────────────────────────────────────────────────────────

function ResourceCard({ resource }: { resource: PublicResource }) {
  const [flipped, setFlipped] = useState(false);
  const [tryResult, setTryResult] = useState<{ status: 'idle' | 'loading' | 'success' | 'error'; data?: string }>({
    status: 'idle',
  });
  const walletAddress = useStore($walletAddress);

  const primaryEndpoint = resource.endpoints_json?.find((ep) => ep.priceUsdc && ep.priceUsdc > 0);
  const method = primaryEndpoint?.method || 'GET';
  const endpointPath = primaryEndpoint?.path || '/';
  const fullUrl = `${resource.public_url}${endpointPath}`;
  const coverUrl = (resource as any).cover_image_url as string | undefined;

  const handleFlip = useCallback(() => {
    setFlipped((prev) => !prev);
    setTryResult({ status: 'idle' });
  }, []);

  const handleTryIt = useCallback(async () => {
    setTryResult({ status: 'loading' });

    try {
      // Step 1: Hit the endpoint to get the 402 response
      const probeRes = await fetch(fullUrl, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(method !== 'GET' ? { body: '{}' } : {}),
      });

      if (probeRes.status === 402) {
        // Got the payment requirements — show them
        const paymentHeader = probeRes.headers.get('payment-required') || probeRes.headers.get('x-payment-required');

        if (paymentHeader) {
          let parsed: any;

          try {
            parsed = JSON.parse(atob(paymentHeader));
          } catch {
            try {
              parsed = JSON.parse(paymentHeader);
            } catch {
              parsed = null;
            }
          }

          const price = parsed?.accepts?.[0]?.maxAmountRequired || parsed?.accepts?.[0]?.amount;
          const network = parsed?.accepts?.[0]?.network;

          setTryResult({
            status: 'success',
            data: JSON.stringify(
              {
                status: 402,
                message: 'Payment Required',
                price: price ? `${(Number(price) / 1e6).toFixed(4)} USDC` : 'see header',
                network: network || 'solana',
                endpoint: fullUrl,
                method,
              },
              null,
              2,
            ),
          });
        } else {
          setTryResult({
            status: 'success',
            data: JSON.stringify({ status: 402, message: 'Payment Required (header not exposed via CORS)' }, null, 2),
          });
        }
      } else if (probeRes.ok) {
        const text = await probeRes.text();
        setTryResult({ status: 'success', data: text.substring(0, 500) });
      } else {
        setTryResult({ status: 'error', data: `HTTP ${probeRes.status}` });
      }
    } catch (err) {
      setTryResult({
        status: 'error',
        data: err instanceof Error ? err.message : 'Request failed',
      });
    }
  }, [fullUrl, method]);

  const handleCopyUrl = useCallback(() => {
    navigator.clipboard.writeText(fullUrl);
  }, [fullUrl]);

  const handleCopyCurl = useCallback(() => {
    const curl =
      method === 'GET' ? `curl ${fullUrl}` : `curl -X ${method} ${fullUrl} -H "Content-Type: application/json" -d '{}'`;
    navigator.clipboard.writeText(curl);
  }, [fullUrl, method]);

  return (
    <div className="perspective-1000" style={{ perspective: '1000px' }}>
      <div
        className="relative w-full transition-transform duration-500 cursor-pointer"
        style={{
          transformStyle: 'preserve-3d',
          transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
        }}
      >
        {/* ─── Front Face ─── */}
        <div
          onClick={handleFlip}
          className="rounded-lg border border-gray-200/60 dark:border-gray-800/60 hover:border-accent-500/30 bg-white/5 dark:bg-gray-900/30 backdrop-blur-sm transition-colors duration-200 overflow-hidden"
          style={{ backfaceVisibility: 'hidden' }}
        >
          {/* Cover image */}
          {coverUrl ? (
            <div className="w-full h-28 overflow-hidden">
              <img
                src={coverUrl}
                alt={resource.name}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                loading="lazy"
              />
            </div>
          ) : (
            <div className="w-full h-20 bg-gradient-to-br from-gray-800/40 via-gray-900/30 to-gray-800/50 flex items-center justify-center">
              <div className="i-ph:code text-2xl text-gray-700/40" />
            </div>
          )}

          <div className="px-4 py-3">
            <div className="flex items-start justify-between gap-2 mb-1.5">
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

            {resource.description && (
              <p className="text-xs text-bolt-elements-textSecondary leading-relaxed mb-2.5 line-clamp-2">
                {resource.description}
              </p>
            )}

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

        {/* ─── Back Face ─── */}
        <div
          className="absolute inset-0 rounded-lg border border-accent-500/30 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm overflow-hidden"
          style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
        >
          <div className="p-4 h-full flex flex-col">
            {/* Back header */}
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{resource.name}</h3>
              <button
                onClick={handleFlip}
                style={{ background: 'none' }}
                className="text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors p-0.5"
              >
                <div className="i-ph:x text-sm" />
              </button>
            </div>

            {/* Endpoint info */}
            <div className="space-y-2 mb-3">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent-500/15 text-accent-400 font-bold uppercase">
                  {method}
                </span>
                <span className="text-[11px] font-mono text-gray-600 dark:text-gray-400 truncate">{fullUrl}</span>
              </div>
              <div className="text-[11px] text-gray-500 dark:text-gray-500">
                Price:{' '}
                <span className="text-accent-500 dark:text-accent-400 font-medium">
                  {formatPrice(resource.base_price_usdc)}
                </span>{' '}
                USDC per request
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 mb-3">
              <button
                onClick={handleTryIt}
                disabled={tryResult.status === 'loading'}
                style={{ background: 'none' }}
                className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-accent-500/15 text-accent-400 hover:bg-accent-500/25 border border-accent-500/20 transition-colors disabled:opacity-50"
              >
                {tryResult.status === 'loading' ? (
                  <>
                    <div className="w-3 h-3 border-[1.5px] border-accent-500/30 border-t-accent-500 rounded-full animate-spin" />
                    Calling...
                  </>
                ) : (
                  <>
                    <div className="i-ph:play text-xs" />
                    Try it
                  </>
                )}
              </button>
              <button
                onClick={handleCopyCurl}
                style={{ background: 'none' }}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 px-2 py-2 rounded-lg border border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700 transition-colors"
                title="Copy curl command"
              >
                <div className="i-ph:terminal text-xs" />
                curl
              </button>
              <button
                onClick={handleCopyUrl}
                style={{ background: 'none' }}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 px-2 py-2 rounded-lg border border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700 transition-colors"
                title="Copy URL"
              >
                <div className="i-ph:copy text-xs" />
              </button>
            </div>

            {/* Try-it result */}
            {tryResult.status !== 'idle' && tryResult.status !== 'loading' && (
              <div className="flex-1 min-h-0 overflow-hidden">
                <pre
                  className={`text-[10px] font-mono leading-relaxed whitespace-pre-wrap break-all p-2 rounded-md max-h-32 overflow-y-auto sidebar-scroll ${
                    tryResult.status === 'success'
                      ? 'bg-gray-50 dark:bg-gray-950/60 border border-gray-200 dark:border-gray-800/40 text-emerald-700 dark:text-emerald-300/70'
                      : 'bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/30 text-red-700 dark:text-red-300/70'
                  }`}
                >
                  {tryResult.data}
                </pre>
              </div>
            )}

            {/* Wallet hint */}
            {!walletAddress && tryResult.status === 'idle' && (
              <div className="mt-auto text-[10px] text-gray-400 dark:text-gray-600 text-center">
                Connect wallet to make paid requests
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Feed Component ──────────────────────────────────────────────────────

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
        /* silent */
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
          Built with Dexter
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

      <div className="text-center mt-8">
        <span className="text-[11px] text-bolt-elements-textTertiary">{resources.length} paid APIs earning USDC</span>
      </div>
    </section>
  );
}
