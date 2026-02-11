/**
 * ResourceList — Sidebar resource dashboard
 *
 * Shows deployed x402 resources for the connected wallet.
 * Fetched from dexter-api, displayed above "Your Chats" in the sidebar.
 *
 * Revenue data auto-refreshes every 45 seconds (matching the backend
 * reconciliation job that writes gross_revenue_usdc from on-chain truth).
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { useStore } from '@nanostores/react';
import { toast } from 'react-toastify';
import { $walletAddress, $walletConnected } from '~/lib/stores/wallet';
import { closeSidebar } from '~/lib/stores/sidebar';
import { ResourceLogs } from './ResourceLogs';

const DEXTER_API_BASE = 'https://api.dexter.cash';

/** Minimum pending balance (USDC) to show the Withdraw Now option */
const MIN_WITHDRAW_USDC = 0.01;

/** Auto-refresh interval in milliseconds */
const REFRESH_INTERVAL_MS = 45_000;

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
  last_revenue_sync_at?: string | null;
  erc8004_agent_id?: number | null;
  erc8004_agent_registry?: string | null;
  endpoints_json?: LabEndpoint[] | null;
}

interface ResourceBalance {
  sol: number;
  usdc: number;
}

interface PayoutResult {
  success: boolean;
  message: string;
  signature?: string;
  creator_amount_usdc?: number;
}

/*
 * ---------------------------------------------------------------------------
 * Status config
 * ---------------------------------------------------------------------------
 */

const STATUS_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  running: { label: 'Live', color: 'text-emerald-400', dot: 'bg-emerald-500' },
  stopped: { label: 'Stopped', color: 'text-gray-400', dot: 'bg-gray-500' },
  deleted: { label: 'Deleted', color: 'text-gray-500', dot: 'bg-gray-600' },
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

/*
 * ---------------------------------------------------------------------------
 * Formatting helpers
 * ---------------------------------------------------------------------------
 */

function formatUsdc(val: number | string): string {
  const num = typeof val === 'string' ? parseFloat(val) : val;

  if (isNaN(num) || num === 0) {
    return '$0.00';
  }

  if (num < 0.01) {
    return `$${num.toFixed(4).replace(/0+$/, '').replace(/\.$/, '.00')}`;
  }

  return `$${num.toFixed(2)}`;
}

/**
 * Calculate the next automatic payout time label.
 * Payouts fire at noon and midnight America/New_York.
 */
function getNextPayoutLabel(): string {
  const now = new Date();

  // Get current ET hour and minute via Intl
  const etParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(now);

  const hour = parseInt(etParts.find((p) => p.type === 'hour')?.value || '0', 10);
  const minute = parseInt(etParts.find((p) => p.type === 'minute')?.value || '0', 10);
  const currentMinutes = hour * 60 + minute;

  const noonMinutes = 12 * 60;

  let minutesUntil: number;
  let targetLabel: string;

  if (currentMinutes < noonMinutes) {
    minutesUntil = noonMinutes - currentMinutes;
    targetLabel = 'Today 12pm';
  } else {
    minutesUntil = 24 * 60 - currentMinutes;
    targetLabel = 'Tonight 12am';
  }

  if (minutesUntil <= 5) {
    return 'any minute now';
  }

  if (minutesUntil < 60) {
    return `${targetLabel} ET (~${minutesUntil}m)`;
  }

  const hours = Math.floor(minutesUntil / 60);
  const mins = minutesUntil % 60;

  if (hours < 2 && mins > 0) {
    return `${targetLabel} ET (~${hours}h ${mins}m)`;
  }

  return `${targetLabel} ET (~${hours}h)`;
}

/**
 * Format a relative "synced X ago" label from a timestamp.
 */
function formatSyncAge(isoString: string | null | undefined): string | null {
  if (!isoString) {
    return null;
  }

  const diff = Date.now() - new Date(isoString).getTime();

  if (diff < 0 || isNaN(diff)) {
    return null;
  }

  const seconds = Math.floor(diff / 1000);

  if (seconds < 10) {
    return 'just now';
  }

  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  return `${Math.floor(minutes / 60)}h ago`;
}

/*
 * ---------------------------------------------------------------------------
 * ResourceItem
 * ---------------------------------------------------------------------------
 */

function ResourceItem({ resource, onWithdraw }: { resource: LabResource; onWithdraw?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [balance, setBalance] = useState<ResourceBalance | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [payoutResult, setPayoutResult] = useState<PayoutResult | null>(null);
  const statusCfg = getStatusConfig(resource.status);

  // Fetch balance on expand, then refresh on interval
  useEffect(() => {
    if (!expanded) {
      return undefined;
    }

    let cancelled = false;

    const fetchBalance = async () => {
      try {
        const res = await fetch(`${DEXTER_API_BASE}/api/dexter-lab/wallets/${resource.id}/balance`);

        if (res.ok && !cancelled) {
          const data = (await res.json()) as ResourceBalance;
          setBalance({ sol: data.sol, usdc: data.usdc });
        }
      } catch {
        /* silent — balance is supplementary */
      }
    };

    fetchBalance();

    const interval = setInterval(fetchBalance, REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [expanded, resource.id]);

  const handleToggle = () => {
    setExpanded((prev) => !prev);
    setPayoutResult(null);
  };

  const handleWithdraw = async () => {
    if (withdrawing) {
      return;
    }

    setWithdrawing(true);
    setPayoutResult(null);

    try {
      const res = await fetch('/api/payout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resourceId: resource.id }),
      });

      const data = (await res.json()) as {
        success?: boolean;
        signature?: string;
        creator_amount_usdc?: number;
        message?: string;
        error?: string;
      };

      if (data.success) {
        setPayoutResult({
          success: true,
          message: `Sent ${formatUsdc(data.creator_amount_usdc ?? 0)} to your wallet`,
          signature: data.signature,
          creator_amount_usdc: data.creator_amount_usdc,
        });

        // Refresh balance after payout
        setBalance(null);

        try {
          const balRes = await fetch(`${DEXTER_API_BASE}/api/dexter-lab/wallets/${resource.id}/balance`);

          if (balRes.ok) {
            const balData = (await balRes.json()) as ResourceBalance;
            setBalance({ sol: balData.sol, usdc: balData.usdc });
          }
        } catch {
          /* silent */
        }

        // Let parent know to refresh resource data
        onWithdraw?.();
      } else {
        setPayoutResult({
          success: false,
          message: data.message || data.error || 'Payout failed',
        });
      }
    } catch {
      setPayoutResult({
        success: false,
        message: 'Network error — could not reach server',
      });
    } finally {
      setWithdrawing(false);
    }
  };

  const pendingUsdc = balance?.usdc ?? 0;
  const canWithdraw = pendingUsdc >= MIN_WITHDRAW_USDC && !withdrawing;
  const hasRevenue = Number(resource.gross_revenue_usdc) > 0;
  const hasPending = pendingUsdc > 0;
  const syncAge = formatSyncAge(resource.last_revenue_sync_at);

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden transition-colors hover:border-gray-300 dark:hover:border-gray-700">
      {/* ── Collapsed header ── */}
      <button
        onClick={handleToggle}
        style={{ background: 'none' }}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors"
      >
        <div className="relative shrink-0">
          <div
            className={`w-2 h-2 rounded-full ${resource.status === 'running' ? (resource.healthy ? 'bg-emerald-500' : 'bg-red-500') : statusCfg.dot}`}
          />
          {resource.status === 'running' && resource.healthy && (
            <div className="absolute inset-0 w-2 h-2 rounded-full bg-emerald-500 animate-ping opacity-40" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{resource.name}</div>
          <div className="flex items-center gap-2 mt-0.5">
            <span
              className={`text-xs ${resource.status === 'running' ? (resource.healthy ? 'text-emerald-400' : 'text-red-400') : statusCfg.color}`}
            >
              {resource.status === 'running' ? (resource.healthy ? 'Healthy' : 'Unhealthy') : statusCfg.label}
            </span>
            {resource.erc8004_agent_id && (
              <span
                className="i-ph:link-bold text-[10px] text-purple-400"
                title={`Agent #${resource.erc8004_agent_id}`}
              />
            )}
            {hasRevenue && <span className="text-xs text-emerald-400">{formatUsdc(resource.gross_revenue_usdc)}</span>}
          </div>
        </div>
        <div className={`i-ph:caret-down text-xs text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {/* ── Expanded detail ── */}
      {expanded && (
        <div className="px-3 pb-3 pt-0 space-y-2.5 border-t border-gray-100 dark:border-gray-800/50">
          {/* Endpoints */}
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

          {/* ── Revenue stats ── */}
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <div className="text-gray-500 dark:text-gray-500">Requests</div>
            <div className="text-gray-900 dark:text-gray-200 text-right">
              {Number(resource.request_count).toLocaleString()}
            </div>

            <div className="text-gray-500 dark:text-gray-500">Revenue</div>
            <div className="text-emerald-500 text-right">{formatUsdc(resource.gross_revenue_usdc)}</div>

            <div className="text-gray-500 dark:text-gray-500">Paid to You</div>
            <div className="text-gray-900 dark:text-gray-200 text-right">
              {formatUsdc(resource.creator_earnings_usdc)}
            </div>

            {resource.erc8004_agent_id && (
              <>
                <div className="text-gray-500 dark:text-gray-500">On-chain</div>
                <div className="text-right">
                  <a
                    href={`https://www.8004scan.io/agents/base/${resource.erc8004_agent_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-400 hover:text-purple-300 transition-colors"
                  >
                    Agent #{resource.erc8004_agent_id}
                  </a>
                </div>
              </>
            )}
          </div>

          {/* ── Pending payout section ── */}
          {balance !== null && (
            <div className="rounded-md bg-gray-50 dark:bg-gray-800/40 px-2.5 py-2 space-y-1.5">
              {hasPending ? (
                <>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-500 dark:text-gray-500">Pending</span>
                    <span className="font-medium text-emerald-500">{formatUsdc(pendingUsdc)}</span>
                  </div>
                  <div className="text-[10px] text-gray-400 dark:text-gray-600 leading-tight">
                    Next payout: {getNextPayoutLabel()}
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500 dark:text-gray-500">Pending</span>
                  <span className="text-gray-400 dark:text-gray-600 text-[10px]">
                    {Number(resource.creator_earnings_usdc) > 0 ? 'Paid out' : 'Awaiting first payment'}
                  </span>
                </div>
              )}

              {/* Withdraw Now — only when pending exceeds threshold */}
              {canWithdraw && (
                <button
                  onClick={handleWithdraw}
                  disabled={withdrawing}
                  style={{ background: 'none' }}
                  className="flex items-center gap-1 text-[11px] font-medium text-accent-500 hover:text-accent-400 transition-colors mt-0.5 disabled:opacity-50"
                >
                  {withdrawing ? (
                    <>
                      <div className="i-svg-spinners:90-ring-with-bg text-xs" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <div className="i-ph:arrow-up-right text-xs" />
                      Withdraw Now
                    </>
                  )}
                </button>
              )}

              {/* Payout result feedback */}
              {payoutResult && (
                <div
                  className={`text-[10px] leading-tight mt-1 ${
                    payoutResult.success ? 'text-emerald-500' : 'text-red-400'
                  }`}
                >
                  {payoutResult.message}
                  {payoutResult.signature && (
                    <>
                      {' '}
                      <a
                        href={`https://solscan.io/tx/${payoutResult.signature}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline hover:no-underline"
                      >
                        View tx
                      </a>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Loading state for balance */}
          {balance === null && (
            <div className="text-[10px] text-gray-400 dark:text-gray-600 px-0.5">Loading balance...</div>
          )}

          {/* ── Footer: price + actions ── */}
          <div className="flex items-center justify-between pt-0.5">
            <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-600">
              <span>{formatUsdc(resource.base_price_usdc)} / req</span>
              {syncAge && (
                <>
                  <span className="text-gray-300 dark:text-gray-700">·</span>
                  <span className="text-[10px]" title="Last revenue sync">
                    {syncAge}
                  </span>
                </>
              )}
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
              <button
                onClick={(e) => {
                  e.stopPropagation();

                  if (
                    window.confirm(
                      `Remove "${resource.name}"? This will stop the container, clean up the image, and remove it from your resources.`,
                    )
                  ) {
                    fetch(`/api/deploy?id=${encodeURIComponent(resource.id)}&action=remove`, {
                      method: 'POST',
                    })
                      .then((res) => res.json() as Promise<{ success?: boolean }>)
                      .then((data) => {
                        if (data.success) {
                          toast.success(`"${resource.name}" removed`, {
                            autoClose: 4000,
                            position: 'bottom-right',
                          });
                          onWithdraw?.();
                        } else {
                          toast.error(`Failed to remove "${resource.name}"`, {
                            autoClose: 5000,
                            position: 'bottom-right',
                          });
                          console.error('[ResourceList] Remove failed:', data);
                        }
                      })
                      .catch((err) => {
                        toast.error('Remove request failed', {
                          autoClose: 5000,
                          position: 'bottom-right',
                        });
                        console.error('[ResourceList] Remove request failed:', err);
                      });
                  }
                }}
                style={{ background: 'none' }}
                className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-600 hover:text-red-400 transition-colors"
                title="Remove resource"
              >
                <div className="i-ph:trash text-xs" />
              </button>
            </div>
          </div>

          {showLogs && <ResourceLogs resourceId={resource.id} onClose={() => setShowLogs(false)} />}
        </div>
      )}
    </div>
  );
}

/*
 * ---------------------------------------------------------------------------
 * ResourceSections — groups resources into Active / Stopped / Deleted
 * ---------------------------------------------------------------------------
 */

const ACTIVE_STATUSES = new Set(['running', 'pending', 'building', 'deploying', 'updating']);
const DELETED_STATUSES = new Set(['deleted']);

function ResourceSections({ resources, onWithdraw }: { resources: LabResource[]; onWithdraw: () => void }) {
  const [showDeleted, setShowDeleted] = useState(false);

  const active: LabResource[] = [];
  const stopped: LabResource[] = [];
  const deleted: LabResource[] = [];

  for (const r of resources) {
    if (DELETED_STATUSES.has(r.status)) {
      deleted.push(r);
    } else if (ACTIVE_STATUSES.has(r.status)) {
      active.push(r);
    } else {
      stopped.push(r);
    }
  }

  return (
    <div className="space-y-2">
      {/* Active resources — always shown first, no header needed if only section */}
      {active.length > 0 && (
        <div className="space-y-1.5">
          {(stopped.length > 0 || deleted.length > 0) && (
            <div className="text-[10px] font-medium uppercase tracking-wider text-emerald-500/70 px-1 pt-1">
              Active ({active.length})
            </div>
          )}
          {active.map((r) => (
            <ResourceItem key={r.id} resource={r} onWithdraw={onWithdraw} />
          ))}
        </div>
      )}

      {/* Stopped resources */}
      {stopped.length > 0 && (
        <div className="space-y-1.5">
          {(active.length > 0 || deleted.length > 0) && (
            <div className="text-[10px] font-medium uppercase tracking-wider text-gray-500/70 px-1 pt-1">
              Stopped ({stopped.length})
            </div>
          )}
          {stopped.map((r) => (
            <ResourceItem key={r.id} resource={r} onWithdraw={onWithdraw} />
          ))}
        </div>
      )}

      {/* Deleted resources — collapsed by default */}
      {deleted.length > 0 && (
        <div className="space-y-1">
          <button
            onClick={() => setShowDeleted((prev) => !prev)}
            className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-gray-600/50 px-1 pt-1 hover:text-gray-500 transition-colors"
            style={{ background: 'none' }}
          >
            <div className={`i-ph:caret-right text-[9px] transition-transform ${showDeleted ? 'rotate-90' : ''}`} />
            Deleted ({deleted.length})
          </button>
          {showDeleted && (
            <div className="space-y-1.5 opacity-50">
              {deleted.map((r) => (
                <ResourceItem key={r.id} resource={r} onWithdraw={onWithdraw} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/*
 * ---------------------------------------------------------------------------
 * ResourceList — main component with auto-refresh
 * ---------------------------------------------------------------------------
 */

export function ResourceList() {
  const walletConnected = useStore($walletConnected);
  const walletAddress = useStore($walletAddress);
  const [resources, setResources] = useState<LabResource[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialLoadDone = useRef(false);

  /** Track previous values to detect revenue / payout changes for toast notifications */
  const prevValuesRef = useRef<Map<string, { revenue: number; earnings: number }>>(new Map());

  const fetchResources = useCallback(
    async (isInitial: boolean) => {
      if (!walletAddress) {
        return;
      }

      if (isInitial) {
        setLoading(true);
        setError(null);
      }

      try {
        const res = await fetch(
          `${DEXTER_API_BASE}/api/dexter-lab/resources?creator_wallet=${encodeURIComponent(walletAddress)}&limit=50`,
        );

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const data = (await res.json()) as { resources?: LabResource[] };
        const newResources = data.resources || [];

        /* Fire toast notifications on revenue / payout changes (skip on initial load) */
        if (!isInitial && prevValuesRef.current.size > 0) {
          for (const r of newResources) {
            const prev = prevValuesRef.current.get(r.id);

            if (!prev) {
              continue;
            }

            const newRevenue = Number(r.gross_revenue_usdc) || 0;
            const newEarnings = Number(r.creator_earnings_usdc) || 0;

            /* New revenue came in */
            if (newRevenue > prev.revenue) {
              const delta = newRevenue - prev.revenue;

              toast.success(`${r.name} earned ${formatUsdc(delta)}`, {
                autoClose: 5000,
                position: 'bottom-right',
              });
            }

            /* Payout received */
            if (newEarnings > prev.earnings) {
              const delta = newEarnings - prev.earnings;

              toast.success(`Payout received! ${formatUsdc(delta)} sent to your wallet`, {
                autoClose: 8000,
                position: 'bottom-right',
              });
            }
          }
        }

        /* Update tracked values */
        const nextMap = new Map<string, { revenue: number; earnings: number }>();

        for (const r of newResources) {
          nextMap.set(r.id, {
            revenue: Number(r.gross_revenue_usdc) || 0,
            earnings: Number(r.creator_earnings_usdc) || 0,
          });
        }

        prevValuesRef.current = nextMap;

        setResources(newResources);
      } catch (err) {
        console.error('[ResourceList] Failed to fetch resources:', err);

        if (isInitial) {
          setError('Failed to load resources');
        }
      } finally {
        if (isInitial) {
          setLoading(false);
        }
      }
    },
    [walletAddress],
  );

  useEffect(() => {
    if (!walletConnected || !walletAddress) {
      setResources([]);
      initialLoadDone.current = false;

      return undefined;
    }

    // Initial fetch
    initialLoadDone.current = false;
    fetchResources(true).then(() => {
      initialLoadDone.current = true;
    });

    // Auto-refresh every 45 seconds
    const interval = setInterval(() => {
      if (initialLoadDone.current) {
        fetchResources(false);
      }
    }, REFRESH_INTERVAL_MS);

    return () => {
      clearInterval(interval);
    };
  }, [walletConnected, walletAddress, fetchResources]);

  // Callback for child components to trigger a refresh (e.g., after payout)
  const handleWithdraw = useCallback(() => {
    fetchResources(false);
  }, [fetchResources]);

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

      {!loading && resources.length > 0 && <ResourceSections resources={resources} onWithdraw={handleWithdraw} />}
    </div>
  );
}
