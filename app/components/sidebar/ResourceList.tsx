/**
 * ResourceList — Sidebar resource dashboard
 *
 * Shows deployed x402 resources for the connected wallet.
 * Fetched from dexter-api, displayed above "Your Chats" in the sidebar.
 */

import { useEffect, useState, useCallback } from 'react';
import { useStore } from '@nanostores/react';
import { $walletAddress, $walletConnected } from '~/lib/stores/wallet';
import { closeSidebar } from '~/lib/stores/sidebar';
import { ResourceLogs } from './ResourceLogs';

const DEXTER_API_BASE = 'https://api.dexter.cash';

interface LabEndpoint {
  path: string;
  method: string;
  description?: string;
  priceUsdc?: number;
  exampleBody?: string;
}

interface LabResource {
  id: string;
  name: string;
  status: string;
  public_url: string | null;
  healthy: boolean;
  base_price_usdc: number | string;
  gross_revenue_usdc: number | string;
  creator_earnings_usdc: number | string;
  platform_fees_usdc: number | string;
  request_count: number | string;
  created_at: string;
  pay_to_wallet: string;
  endpoints_json?: LabEndpoint[] | null;
}

interface ResourceBalance {
  sol: number;
  usdc: number;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  running: { label: 'Live', color: 'text-emerald-400', dot: 'bg-emerald-500' },
  stopped: { label: 'Stopped', color: 'text-gray-400', dot: 'bg-gray-500' },
  failed: { label: 'Failed', color: 'text-red-400', dot: 'bg-red-500' },
  pending: { label: 'Pending', color: 'text-yellow-400', dot: 'bg-yellow-500' },
  building: { label: 'Building', color: 'text-blue-400', dot: 'bg-blue-500' },
  deploying: { label: 'Deploying', color: 'text-blue-400', dot: 'bg-blue-500' },
  lost: { label: 'Lost', color: 'text-red-400', dot: 'bg-red-500' },
  updating: { label: 'Updating', color: 'text-blue-400', dot: 'bg-blue-500' },
};

function getStatusConfig(status: string) {
  return STATUS_CONFIG[status] || { label: status, color: 'text-gray-400', dot: 'bg-gray-500' };
}

function formatUsdc(val: number | string): string {
  const num = typeof val === 'string' ? parseFloat(val) : val;

  if (isNaN(num) || num === 0) {
    return '$0.00';
  }

  /*
   * Show enough decimals for sub-cent prices (e.g., $0.005)
   * but don't show excessive trailing zeros for round amounts
   */
  if (num < 0.01) {
    return `$${num.toFixed(4).replace(/0+$/, '').replace(/\.$/, '.00')}`;
  }

  return `$${num.toFixed(2)}`;
}

function ResourceItem({ resource }: { resource: LabResource }) {
  const [expanded, setExpanded] = useState(false);
  const [balance, setBalance] = useState<ResourceBalance | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const statusCfg = getStatusConfig(resource.status);

  const loadBalance = useCallback(async () => {
    if (balance || loadingBalance) {
      return;
    }

    setLoadingBalance(true);

    try {
      const res = await fetch(`${DEXTER_API_BASE}/api/dexter-lab/wallets/${resource.id}/balance`);

      if (res.ok) {
        const data = (await res.json()) as ResourceBalance;
        setBalance({ sol: data.sol, usdc: data.usdc });
      }
    } catch {
      /* silent */
    } finally {
      setLoadingBalance(false);
    }
  }, [resource.id, balance, loadingBalance]);

  const handleToggle = () => {
    const opening = !expanded;
    setExpanded(opening);

    if (opening) {
      loadBalance();
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden transition-colors hover:border-gray-300 dark:hover:border-gray-700">
      <button
        onClick={handleToggle}
        style={{ background: 'none' }}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors"
      >
        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusCfg.dot}`} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{resource.name}</div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={`text-xs ${statusCfg.color}`}>{statusCfg.label}</span>
            {Number(resource.gross_revenue_usdc) > 0 && (
              <span className="text-xs text-emerald-400">{formatUsdc(resource.gross_revenue_usdc)}</span>
            )}
          </div>
        </div>
        <div className={`i-ph:caret-down text-xs text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-0 space-y-2 border-t border-gray-100 dark:border-gray-800/50">
          {resource.public_url && (
            <div className="mt-2 space-y-1">
              {resource.endpoints_json && resource.endpoints_json.length > 0 ? (
                resource.endpoints_json
                  .filter((ep) => ep.priceUsdc !== undefined && ep.priceUsdc > 0)
                  .map((ep, i) => {
                    const fullUrl = `${resource.public_url}${ep.path}`;

                    return (
                      <button
                        key={i}
                        onClick={() => {
                          navigator.clipboard.writeText(fullUrl);
                        }}
                        title="Click to copy endpoint URL"
                        className="flex items-center gap-1.5 text-xs w-full text-left bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-700/50 rounded-lg px-2 py-1.5 -mx-1 transition-colors group"
                      >
                        <span className="font-mono px-1.5 py-0.5 rounded bg-gray-200/80 dark:bg-gray-700 text-accent-500 font-semibold shrink-0">
                          {ep.method}
                        </span>
                        <span className="text-gray-600 dark:text-gray-400 font-mono text-[10px] break-all leading-tight">
                          {fullUrl}
                        </span>
                        <span className="i-ph:copy text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 text-xs" />
                      </button>
                    );
                  })
              ) : (
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(resource.public_url!);
                  }}
                  title="Click to copy URL"
                  className="flex items-center gap-1.5 text-xs text-accent-500 hover:text-accent-400 transition-colors w-full text-left group"
                >
                  <div className="i-ph:arrow-square-out text-xs shrink-0" />
                  <span className="font-mono text-[10px] break-all leading-tight">
                    {resource.public_url!.replace('https://', '')}
                  </span>
                  <span className="i-ph:copy text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 text-xs" />
                </button>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <div className="text-gray-500 dark:text-gray-500">Requests</div>
            <div className="text-gray-900 dark:text-gray-200 text-right">
              {Number(resource.request_count).toLocaleString()}
            </div>

            <div className="text-gray-500 dark:text-gray-500">Revenue</div>
            <div className="text-emerald-500 text-right">{formatUsdc(resource.gross_revenue_usdc)}</div>

            <div className="text-gray-500 dark:text-gray-500">Your Earnings</div>
            <div className="text-gray-900 dark:text-gray-200 text-right">
              {formatUsdc(resource.creator_earnings_usdc)}
            </div>

            <div className="text-gray-500 dark:text-gray-500">Platform Fee</div>
            <div className="text-gray-900 dark:text-gray-200 text-right">{formatUsdc(resource.platform_fees_usdc)}</div>

            {balance && (
              <>
                <div className="text-gray-500 dark:text-gray-500">Wallet USDC</div>
                <div className="text-gray-900 dark:text-gray-200 text-right">{formatUsdc(balance.usdc)}</div>

                <div className="text-gray-500 dark:text-gray-500">Wallet SOL</div>
                <div className="text-gray-900 dark:text-gray-200 text-right">{balance.sol.toFixed(4)}</div>
              </>
            )}

            {loadingBalance && !balance && (
              <>
                <div className="text-gray-500 dark:text-gray-500">Balance</div>
                <div className="text-gray-400 text-right">Loading...</div>
              </>
            )}
          </div>

          <div className="flex items-center justify-between pt-1">
            <div className="text-xs text-gray-500 dark:text-gray-600">
              Price: {formatUsdc(resource.base_price_usdc)} / request
            </div>
            <div className="flex items-center gap-2">
              <a
                href={`/?edit=${encodeURIComponent(resource.id)}`}
                onClick={() => closeSidebar()}
                className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500 hover:text-accent-500 transition-colors"
              >
                <div className="i-ph:pencil-simple text-xs" />
                Edit
              </a>
              {resource.status === 'running' && (
                <button
                  onClick={() => setShowLogs(!showLogs)}
                  style={{ background: 'none' }}
                  className={`flex items-center gap-1 text-xs transition-colors ${
                    showLogs ? 'text-accent-500' : 'text-gray-400 dark:text-gray-500 hover:text-accent-500'
                  }`}
                >
                  <div className="i-ph:terminal text-xs" />
                  Logs
                </button>
              )}
            </div>
          </div>

          {showLogs && <ResourceLogs resourceId={resource.id} onClose={() => setShowLogs(false)} />}
        </div>
      )}
    </div>
  );
}

export function ResourceList() {
  const walletConnected = useStore($walletConnected);
  const walletAddress = useStore($walletAddress);
  const [resources, setResources] = useState<LabResource[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!walletConnected || !walletAddress) {
      setResources([]);

      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`${DEXTER_API_BASE}/api/dexter-lab/resources?creator_wallet=${encodeURIComponent(walletAddress)}&limit=50`)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const data = (await res.json()) as { resources?: LabResource[] };

        if (!cancelled) {
          setResources(data.resources || []);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('[ResourceList] Failed to fetch resources:', err);
          setError('Failed to load resources');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [walletConnected, walletAddress]);

  if (!walletConnected) {
    return null;
  }

  return (
    <div className="px-3 pb-2">
      <div className="flex items-center justify-between px-1 py-2">
        <div className="font-medium text-sm text-gray-600 dark:text-gray-400">Your Resources</div>
        {resources.length > 0 && <span className="text-xs text-gray-400 dark:text-gray-600">{resources.length}</span>}
      </div>

      {loading && <div className="px-1 py-3 text-xs text-gray-400 dark:text-gray-500">Loading resources...</div>}

      {error && <div className="px-1 py-3 text-xs text-red-400">{error}</div>}

      {!loading && !error && resources.length === 0 && (
        <div className="px-1 py-3 text-xs text-gray-400 dark:text-gray-500">
          No resources yet. Deploy your first one!
        </div>
      )}

      {!loading && resources.length > 0 && (
        <div className="space-y-1.5">
          {resources.map((resource) => (
            <ResourceItem key={resource.id} resource={resource} />
          ))}
        </div>
      )}
    </div>
  );
}
