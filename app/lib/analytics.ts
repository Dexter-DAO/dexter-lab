/**
 * Google Analytics Event Tracking for Dexter Lab
 *
 * Typed event tracking across the full user funnel:
 * Awareness → Prompt → Agent → Code → Wallet → Deploy → Post-Deploy
 */

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

export const GA_MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID || 'G-5VWKHNMTMT';

/* eslint-disable @blitz/lines-around-comment */
type EventName =
  /* Engagement */
  | 'prompt_submitted'
  | 'agent_started'
  | 'agent_completed'

  /* Code */
  | 'code_generated'

  /* Wallet */
  | 'wallet_connected'
  | 'wallet_disconnected'

  /* Deploy */
  | 'deploy_started'
  | 'deploy_building'
  | 'deploy_testing'
  | 'deploy_succeeded'
  | 'deploy_failed'

  /* Post-deploy */
  | 'resource_viewed'
  | 'resource_url_copied'
  | 'payout_requested'
  | 'payout_completed'

  /* Landing */
  | 'resource_card_clicked';
/* eslint-enable @blitz/lines-around-comment */

interface EventParams {
  /* Prompt */
  prompt_length?: number;
  model?: string;
  provider?: string;

  /* Agent */
  success?: boolean;
  turn_count?: number;
  duration_ms?: number;
  error?: string;

  /* Code */
  file_count?: number;

  /* Wallet */
  wallet_prefix?: string;

  /* Deploy */
  resource_id?: string;
  resource_name?: string;
  price_usdc?: number;
  public_url?: string;
  failure_reason?: string;
  test_count?: number;

  /* Payout */
  amount?: number;
  tx_signature?: string;

  /* Generic */
  [key: string]: unknown;
}

/**
 * Track a custom event in Google Analytics.
 * Safe to call anywhere -- silently no-ops if gtag isn't loaded.
 */
export function trackEvent(name: EventName, params?: EventParams): void {
  try {
    if (typeof window !== 'undefined' && window.gtag) {
      window.gtag('event', name, {
        ...params,

        // Strip undefined values
        ...Object.fromEntries(Object.entries(params || {}).filter(([, v]) => v !== undefined)),
      });
    }
  } catch {
    // Never let analytics break the app
  }
}

/**
 * Initialize GA page view tracking on route change.
 */
export function trackPageView(url: string): void {
  try {
    if (typeof window !== 'undefined' && window.gtag) {
      window.gtag('config', GA_MEASUREMENT_ID, {
        page_path: url,
      });
    }
  } catch {
    // Silent
  }
}
