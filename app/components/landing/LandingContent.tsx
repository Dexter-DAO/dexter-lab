import React from 'react';
import { RecentlyDeployed } from './RecentlyDeployed';
import { TopCreators } from './TopCreators';

const GRADIENT_STYLE = {
  background: 'linear-gradient(130deg, #d13f00 0%, #ff6b00 42%, #ffb42c 100%)',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  backgroundClip: 'text',
} as const;

const GRADIENT_FADED_STYLE = {
  background: 'linear-gradient(130deg, rgba(209,63,0,0.35) 0%, rgba(255,107,0,0.35) 42%, rgba(255,180,44,0.35) 100%)',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  backgroundClip: 'text',
} as const;

interface LandingContentProps {
  sendMessage?: (event: React.UIEvent, messageInput?: string) => void;
}

export function LandingContent(_props: LandingContentProps) {
  const scrollToChat = () => {
    const textarea = document.querySelector('textarea');

    if (textarea) {
      textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => textarea.focus(), 500);
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <div className="w-full pb-24 mt-16">
      {/* Divider */}
      <div className="w-12 h-px mx-auto mb-24 bg-gradient-to-r from-transparent via-accent-500/30 to-transparent" />

      {/* Value Prop */}
      <section className="max-w-3xl mx-auto text-center px-6 mb-28">
        <h2 className="font-display text-2xl lg:text-3xl font-bold mb-5 tracking-tight" style={GRADIENT_STYLE}>
          Turn a conversation into a paid API.
        </h2>
        <p className="text-sm lg:text-base text-bolt-elements-textSecondary leading-relaxed max-w-xl mx-auto">
          You describe an idea. Dexter writes the code, deploys it to a live endpoint on{' '}
          <span className="text-accent-500 font-medium">dexter.cash</span>, and wires in x402 payments. Every API call
          earns you USDC.
        </p>
      </section>

      {/* Steps */}
      <section className="max-w-4xl mx-auto px-6 mb-28">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-14 md:gap-10">
          <div>
            <div className="font-display text-4xl lg:text-5xl font-bold mb-4" style={GRADIENT_FADED_STYLE}>
              01
            </div>
            <h3 className="text-base font-semibold text-bolt-elements-textPrimary mb-2">Describe</h3>
            <p className="text-sm text-bolt-elements-textSecondary leading-relaxed">
              Tell Dexter what your API should do and what to charge. Dexter handles the code.
            </p>
          </div>
          <div>
            <div className="font-display text-4xl lg:text-5xl font-bold mb-4" style={GRADIENT_FADED_STYLE}>
              02
            </div>
            <h3 className="text-base font-semibold text-bolt-elements-textPrimary mb-2">Deploy</h3>
            <p className="text-sm text-bolt-elements-textSecondary leading-relaxed">
              One click. Dexter builds your resource into a container and puts it live with a public endpoint.
            </p>
          </div>
          <div>
            <div className="font-display text-4xl lg:text-5xl font-bold mb-4" style={GRADIENT_FADED_STYLE}>
              03
            </div>
            <h3 className="text-base font-semibold text-bolt-elements-textPrimary mb-2">Earn</h3>
            <p className="text-sm text-bolt-elements-textSecondary leading-relaxed">
              Callers pay per request in USDC. You keep <span className="text-accent-500 font-semibold">70%</span> of
              every payment, paid directly to your wallet.
            </p>
          </div>
        </div>
      </section>

      {/* Top Lab Creators — social proof early, right after explaining how it works */}
      <TopCreators />

      {/* Revenue Split — the key selling point */}
      <section className="max-w-3xl mx-auto px-6 mb-28 text-center">
        <h2 className="font-display text-lg lg:text-xl font-semibold mb-8 text-bolt-elements-textPrimary tracking-wide">
          Revenue Split
        </h2>
        <div className="grid grid-cols-2 gap-8 max-w-md mx-auto mb-8">
          <div>
            <div className="font-display text-4xl lg:text-5xl font-bold mb-2" style={GRADIENT_STYLE}>
              70%
            </div>
            <div className="text-sm text-bolt-elements-textSecondary">To you</div>
            <div className="text-xs text-bolt-elements-textTertiary mt-1">Paid to your wallet</div>
          </div>
          <div>
            <div className="font-display text-4xl lg:text-5xl font-bold mb-2" style={GRADIENT_FADED_STYLE}>
              30%
            </div>
            <div className="text-sm text-bolt-elements-textSecondary">To the platform</div>
            <div className="text-xs text-bolt-elements-textTertiary mt-1">Funds $DEXTER buybacks</div>
          </div>
        </div>
        <p className="text-sm text-bolt-elements-textSecondary leading-relaxed max-w-lg mx-auto">
          Automatic payouts at noon and midnight ET. Your earnings land in your Solana wallet every 12 hours. No
          invoices, no waiting. You can also withdraw anytime from the dashboard.
        </p>
      </section>

      {/* What's Included */}
      <section className="max-w-3xl mx-auto px-6 mb-28">
        <h2 className="font-display text-lg lg:text-xl font-semibold mb-10 text-center text-bolt-elements-textPrimary tracking-wide">
          What&apos;s included
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
          <div className="text-center">
            <div className="text-accent-500 text-xs font-mono tracking-widest uppercase mb-3">AI Models</div>
            <div className="text-bolt-elements-textSecondary text-sm">
              GPT&ensp;&middot;&ensp;Claude&ensp;&middot;&ensp;Gemini
            </div>
          </div>
          <div className="text-center">
            <div className="text-accent-500 text-xs font-mono tracking-widest uppercase mb-3">Blockchain Data</div>
            <div className="text-bolt-elements-textSecondary text-sm">
              Helius&ensp;&middot;&ensp;Jupiter&ensp;&middot;&ensp;Birdeye&ensp;&middot;&ensp;Solscan
            </div>
          </div>
          <div className="text-center">
            <div className="text-accent-500 text-xs font-mono tracking-widest uppercase mb-3">Social &amp; Web</div>
            <div className="text-bolt-elements-textSecondary text-sm">Twitter/X&ensp;&middot;&ensp;Web Proxy</div>
          </div>
        </div>
        <p className="text-center mt-8 text-xs text-bolt-elements-textTertiary">
          All accessible through built-in proxies. Authenticated and ready to use in your resource code.
        </p>
      </section>

      {/* Managed Infrastructure */}
      <section className="max-w-3xl mx-auto px-6 mb-28">
        <h2 className="font-display text-lg lg:text-xl font-semibold mb-10 text-center text-bolt-elements-textPrimary tracking-wide">
          Everything is managed
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-2xl mx-auto">
          <div className="text-center">
            <div className="text-accent-500 text-xs font-mono tracking-widest uppercase mb-2">Managed Wallets</div>
            <p className="text-sm text-bolt-elements-textSecondary leading-relaxed">
              Each resource gets its own Solana wallet for payment collection. Revenue tracked in real time.
            </p>
          </div>
          <div className="text-center">
            <div className="text-accent-500 text-xs font-mono tracking-widest uppercase mb-2">Revenue Dashboard</div>
            <p className="text-sm text-bolt-elements-textSecondary leading-relaxed">
              Watch earnings accumulate live. Request counts, revenue totals, and payout history at a glance.
            </p>
          </div>
          <div className="text-center">
            <div className="text-accent-500 text-xs font-mono tracking-widest uppercase mb-2">On-Chain Identity</div>
            <p className="text-sm text-bolt-elements-textSecondary leading-relaxed">
              Every resource gets an 8004 agent identity on Base and Solana. Discoverable on 8004scan.
            </p>
          </div>
          <div className="text-center">
            <div className="text-accent-500 text-xs font-mono tracking-widest uppercase mb-2">Agent Discovery</div>
            <p className="text-sm text-bolt-elements-textSecondary leading-relaxed">
              Resources expose A2A agent cards and MCP tool servers. Other AI agents can find, call, and pay for your API automatically.
            </p>
          </div>
        </div>
      </section>

      {/* MCP — Every resource is an AI tool */}
      <section className="max-w-3xl mx-auto px-6 mb-28">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 mb-6">
            <div className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
            <span className="text-[10px] text-purple-400 font-semibold uppercase tracking-widest">Model Context Protocol</span>
          </div>
          <h2 className="font-display text-2xl lg:text-3xl font-bold mb-5 tracking-tight" style={GRADIENT_STYLE}>
            Every resource is an MCP tool.
          </h2>
          <p className="text-sm lg:text-base text-bolt-elements-textSecondary leading-relaxed max-w-xl mx-auto">
            Deploy an API and it&apos;s instantly callable by Claude, Cursor, and any AI agent that speaks MCP.
            No integration code. No API keys. Payment happens automatically via x402.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-2xl mx-auto mb-10">
          <div className="rounded-xl border border-gray-800/40 bg-gray-900/50 p-5">
            <div className="text-purple-400 text-xs font-mono tracking-widest uppercase mb-3">Per Resource</div>
            <p className="text-sm text-bolt-elements-textSecondary leading-relaxed mb-3">
              Each deployed resource exposes its own <span className="text-gray-300 font-mono text-xs">/mcp</span> endpoint.
              Share the URL directly with anyone who wants to use your API as an AI tool.
            </p>
            <div className="font-mono text-[11px] text-gray-500 bg-gray-950/60 rounded px-3 py-2 border border-gray-800/30">
              https://res-abc123.dexter.cash/mcp
            </div>
          </div>
          <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-5">
            <div className="text-purple-400 text-xs font-mono tracking-widest uppercase mb-3">Platform Marketplace</div>
            <p className="text-sm text-bolt-elements-textSecondary leading-relaxed mb-3">
              One URL, every paid API on the platform. Add it to your MCP client and get access to all{' '}
              <span className="text-purple-400 font-semibold">Lab resources as tools</span>.
            </p>
            <div className="font-mono text-[11px] text-purple-300 bg-gray-950/60 rounded px-3 py-2 border border-purple-500/20">
              https://lab.dexter.cash/api/mcp
            </div>
          </div>
        </div>

        <div className="text-center">
          <p className="text-xs text-bolt-elements-textTertiary leading-relaxed max-w-lg mx-auto">
            When an AI agent calls a tool, the platform pays the x402 fee and returns real data.
            Creators earn revenue from every tool call, just like every API call.
          </p>
        </div>
      </section>

      {/* x402 */}
      <section className="max-w-3xl mx-auto px-6 mb-28 text-center">
        <div className="font-display text-6xl lg:text-8xl font-bold mb-6 select-none" style={GRADIENT_FADED_STYLE}>
          402
        </div>
        <p className="text-sm lg:text-base text-bolt-elements-textSecondary leading-relaxed max-w-xl mx-auto">
          x402 puts HTTP 402 to work. The status code has been reserved for &ldquo;future use&rdquo; since the HTTP spec
          was written in 1997. x402 is the first protocol to actually use it &mdash; your API names a price, the caller
          pays USDC from their wallet, and the response comes back.
        </p>
      </section>

      {/* Pricing + Token Access */}
      <section className="max-w-3xl mx-auto px-6 mb-16 text-center">
        <p className="text-lg lg:text-xl font-semibold text-bolt-elements-textPrimary">Free to build and deploy.</p>
        <p className="text-sm text-bolt-elements-textSecondary mt-2">
          You set the price. You keep 70%. Automatic payouts twice a day.
        </p>
        <div className="mt-8 inline-block rounded-lg border border-accent-500/20 bg-accent-500/5 px-5 py-3">
          <p className="text-xs text-accent-500 font-semibold uppercase tracking-wider mb-1">
            Free for everyone until March 1, 2026
          </p>
          <p className="text-xs text-bolt-elements-textTertiary">
            After the promotional period, resource creation requires $DEXTER token holdings.
          </p>
        </div>
      </section>

      {/* Flywheel */}
      <section className="max-w-2xl mx-auto px-6 mb-28 text-center">
        <p className="text-xs text-bolt-elements-textTertiary leading-relaxed">
          The 30% platform fee funds daily $DEXTER buybacks &mdash; creating a flywheel: more creators build resources,
          more revenue flows, more buybacks happen, and $DEXTER value grows. Everyone wins.
        </p>
      </section>

      {/* Live Resources Feed */}
      <RecentlyDeployed />

      {/* CTA — after browsing resources, give them a next step */}
      <section className="max-w-xl mx-auto px-6 mt-12 mb-8 text-center">
        <button
          onClick={scrollToChat}
          style={{ background: 'none' }}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-full border border-accent-500/30 hover:border-accent-500/60 bg-accent-500/5 hover:bg-accent-500/10 text-accent-400 hover:text-accent-300 text-sm font-semibold transition-all duration-200"
        >
          <span className="i-ph:lightning text-base" />
          Start building your API
        </button>
        <p className="text-[10px] text-bolt-elements-textTertiary mt-3">Free to build and deploy. You set the price.</p>
      </section>

      {/* Bottom fade */}
      <div className="w-12 h-px mx-auto mt-16 bg-gradient-to-r from-transparent via-accent-500/15 to-transparent" />
    </div>
  );
}
