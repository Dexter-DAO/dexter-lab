import { json, type MetaFunction } from '@remix-run/cloudflare';
import { ClientOnly } from 'remix-utils/client-only';
import { BaseChat } from '~/components/chat/BaseChat';
import { Chat } from '~/components/chat/Chat.client';
import { Header } from '~/components/header/Header';
import BackgroundRays from '~/components/ui/BackgroundRays';

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
      <Header />
      <ClientOnly fallback={<BaseChat />}>{() => <Chat />}</ClientOnly>
    </div>
  );
}
