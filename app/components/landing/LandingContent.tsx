import React, { useCallback } from 'react';

const EXAMPLES = [
  {
    title: 'Whale Watch API',
    description: 'Track large Solana wallet movements and score trading patterns',
    prompt:
      'Build a whale watch API that monitors large Solana wallet movements and scores their trading patterns using Helius data',
  },
  {
    title: 'AI Code Reviewer',
    description: 'Automated pull request feedback, powered by Claude',
    prompt: 'Create a code review API that gives automated line-by-line feedback on code submissions using Claude',
  },
  {
    title: 'Token Sentiment Engine',
    description: 'Score market mood from on-chain activity and trading volume',
    prompt:
      'Build a token sentiment engine that scores market mood based on on-chain trading activity using Birdeye data',
  },
  {
    title: 'Product Shot Generator',
    description: 'Turn product descriptions into studio-quality marketing images',
    prompt: 'Create a product shot generator API that turns product descriptions into marketing images using DALL-E',
  },
  {
    title: 'Smart Contract Explainer',
    description: 'Feed in a program address, get a plain-English breakdown',
    prompt: 'Build an API that takes a Solana program address and returns a plain-English explanation of what it does',
  },
  {
    title: 'DeFi Route Optimizer',
    description: 'Find optimal swap paths across Solana DEXes via Jupiter',
    prompt: 'Create a DeFi route optimizer that finds the best token swap paths across Solana using Jupiter',
  },
];

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

export function LandingContent({ sendMessage }: LandingContentProps) {
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

      {/* Steps — no containers, just typography */}
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
              Callers pay per request in USDC. The payment is part of the HTTP flow, built on x402.
            </p>
          </div>
        </div>
      </section>

      {/* What's Included — split categories, not a paragraph dump */}
      <section className="max-w-3xl mx-auto px-6 mb-28">
        <h2 className="font-display text-lg lg:text-xl font-semibold mb-10 text-center text-bolt-elements-textPrimary tracking-wide">
          What&apos;s included
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
          <div className="text-center">
            <div className="text-accent-500 text-xs font-mono tracking-widest uppercase mb-3">AI Models</div>
            <div className="text-bolt-elements-textSecondary text-sm">
              GPT&ensp;&middot;&ensp;Claude&ensp;&middot;&ensp;Gemini
            </div>
          </div>
          <div className="text-center">
            <div className="text-accent-500 text-xs font-mono tracking-widest uppercase mb-3">On-Chain Data</div>
            <div className="text-bolt-elements-textSecondary text-sm">
              Helius&ensp;&middot;&ensp;Birdeye&ensp;&middot;&ensp;Jupiter
            </div>
          </div>
        </div>
        <p className="text-center mt-8 text-xs text-bolt-elements-textTertiary">
          All accessible through Dexter&apos;s proxy. Authenticated and ready to use.
        </p>
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

      {/* Pricing */}
      <section className="max-w-3xl mx-auto px-6 mb-28 text-center">
        <p className="text-lg lg:text-xl font-semibold text-bolt-elements-textPrimary">Free to build and deploy.</p>
        <p className="text-sm text-bolt-elements-textSecondary mt-2">
          You set the price for your API. You keep the revenue.
        </p>
      </section>

      {/* What You Could Build — at the bottom, faded orange borders */}
      <section className="max-w-4xl mx-auto px-6 mb-20">
        <h2 className="font-display text-lg lg:text-xl font-semibold mb-10 text-center text-bolt-elements-textPrimary tracking-wide">
          What you could build
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-1">
          {EXAMPLES.map((example) => (
            <ExampleItem key={example.title} {...example} sendMessage={sendMessage} />
          ))}
        </div>
      </section>

      {/* Bottom fade */}
      <div className="w-12 h-px mx-auto mt-24 bg-gradient-to-r from-transparent via-accent-500/15 to-transparent" />
    </div>
  );
}

function ExampleItem({
  title,
  description,
  prompt,
  sendMessage,
}: {
  title: string;
  description: string;
  prompt: string;
  sendMessage?: (event: React.UIEvent, messageInput?: string) => void;
}) {
  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      sendMessage?.(event, prompt);
    },
    [sendMessage, prompt],
  );

  return (
    <div
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && handleClick(e as unknown as React.MouseEvent)}
      className="text-left group py-4 pl-4 border-l-2 border-accent-500/25 hover:border-accent-500 transition-all duration-200 cursor-pointer"
    >
      <h3 className="text-sm font-semibold text-bolt-elements-textPrimary group-hover:text-accent-500 transition-colors duration-200">
        {title}
      </h3>
      <p className="text-xs text-bolt-elements-textSecondary mt-1 leading-relaxed">{description}</p>
    </div>
  );
}
