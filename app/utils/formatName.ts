const KNOWN_ABBREVIATIONS = new Set([
  'ai',
  'api',
  'nft',
  'defi',
  'dao',
  'dex',
  'sol',
  'btc',
  'eth',
  'usdc',
  'usdt',
  'mcp',
  'a2a',
  'etf',
  'fatf',
  'kyc',
  'aml',
]);

/**
 * Convert a slug like "solana-price-check" to "Solana Price Check".
 * Handles common crypto/tech abbreviations (AI, API, NFT, DeFi, etc.)
 */
export function slugToTitle(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase();

      if (KNOWN_ABBREVIATIONS.has(lower)) {
        return word.toUpperCase();
      }

      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}
