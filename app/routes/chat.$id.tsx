import { json, type LoaderFunctionArgs, type MetaFunction } from '@remix-run/cloudflare';
import { default as IndexRoute } from './_index';

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const chatId = data?.id || '';
  return [
    { title: `Chat — Dexter Lab` },
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
    { property: 'og:url', content: `https://lab.dexter.cash/chat/${chatId}` },
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

export async function loader(args: LoaderFunctionArgs) {
  return json({ id: args.params.id });
}

export default IndexRoute;
