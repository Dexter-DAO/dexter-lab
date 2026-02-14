import { json, type MetaFunction } from '@remix-run/cloudflare';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import * as Sentry from '@sentry/remix';
import { ClientOnly } from 'remix-utils/client-only';
import { BaseChat } from '~/components/chat/BaseChat';
import { Chat } from '~/components/chat/Chat.client';
import { Header } from '~/components/header/Header';
import BackgroundRays from '~/components/ui/BackgroundRays';

/**
 * Granular error boundary that catches component crashes without killing
 * the whole page. Reports to Sentry and shows a recoverable fallback.
 */
class ChatErrorBoundary extends Component<
  { children: ReactNode; section: string },
  { hasError: boolean; error?: Error }
> {
  constructor(props: { children: ReactNode; section: string }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    Sentry.captureException(error, {
      extra: {
        section: this.props.section,
        componentStack: errorInfo.componentStack,
      },
    });
    console.error(`[ChatErrorBoundary:${this.props.section}]`, error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center p-4">
          <div className="text-center">
            <p className="text-sm text-gray-400">Something went wrong in {this.props.section}.</p>
            <button
              onClick={() => this.setState({ hasError: false, error: undefined })}
              className="mt-2 text-xs text-accent-400 hover:text-accent-300 underline bg-transparent border-0 cursor-pointer"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export const meta: MetaFunction = () => {
  return [
    { title: 'Dexter Lab' },
    {
      name: 'description',
      content: 'Build and deploy paid APIs from your browser. Every call settles via x402 on Solana.',
    },
    { property: 'og:title', content: 'Dexter Lab' },
    {
      property: 'og:description',
      content: 'Build and deploy paid APIs from your browser. Every call settles via x402 on Solana.',
    },
    { property: 'og:image', content: 'https://dexter.cash/api/og/lab' },
    { property: 'og:image:width', content: '1200' },
    { property: 'og:image:height', content: '630' },
    { property: 'og:url', content: 'https://lab.dexter.cash' },
    { property: 'og:site_name', content: 'Dexter' },
    { property: 'og:type', content: 'website' },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: 'Dexter Lab' },
    {
      name: 'twitter:description',
      content: 'Build and deploy paid APIs from your browser. Earn revenue from every request.',
    },
    { name: 'twitter:image', content: 'https://dexter.cash/api/og/lab' },
  ];
};

export const loader = () => json({});

/**
 * Landing page component for Dexter Lab
 * Note: Settings functionality should ONLY be accessed through the sidebar menu.
 * Do not add settings button/panel to this landing page as it was intentionally removed
 * to keep the UI clean and consistent with the design system.
 */
export default function Index() {
  return (
    <div className="flex flex-col h-full w-full bg-bolt-elements-background-depth-1">
      <BackgroundRays />
      <ChatErrorBoundary section="header">
        <Header />
      </ChatErrorBoundary>
      <ChatErrorBoundary section="chat">
        <ClientOnly fallback={<BaseChat />}>{() => <Chat />}</ClientOnly>
      </ChatErrorBoundary>
    </div>
  );
}
