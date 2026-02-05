type CommonRequest = Omit<RequestInit, 'body'> & { body?: URLSearchParams };

export async function request(url: string, init?: CommonRequest) {
  if (import.meta.env.DEV && typeof window === 'undefined') {
    // Server-side only: use node-fetch with custom HTTPS agent
    try {
      const nodeFetch = await import('node-fetch');

      // Dynamic import to avoid TS errors in browser context
      // eslint-disable-next-line no-eval
      const https = await (eval('import("node:https")') as Promise<typeof import('https')>);

      const agent = url.startsWith('https') ? new https.Agent({ rejectUnauthorized: false }) : undefined;

      return nodeFetch.default(url, { ...init, agent });
    } catch {
      // Fallback to standard fetch if node modules not available
      return fetch(url, init);
    }
  }

  return fetch(url, init);
}
