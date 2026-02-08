import { memo } from 'react';
import { useStore } from '@nanostores/react';
import { ClientOnly } from 'remix-utils/client-only';
import { motion } from 'framer-motion';
import { chatStore } from '~/lib/stores/chat';
import { classNames } from '~/utils/classNames';
import { HeaderActionButtons } from './HeaderActionButtons.client';
import { ChatDescription } from '~/lib/persistence/ChatDescription.client';
import { toggleSidebar, $sidebarOpen } from '~/lib/stores/sidebar';
import { $walletConnected, $walletDisplay } from '~/lib/stores/wallet';
import { useAppKit } from '@reown/appkit/react';

/**
 * Dexter crest logo — memoized so it never re-renders or restarts animation.
 */
const DexterCrest = memo(() => {
  return (
    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-auto">
      <a href="/" className="block">
        <motion.div
          style={{
            width: 52,
            height: 52,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          animate={{ scale: [0.99, 1.02, 0.99] }}
          transition={{ duration: 5.2, repeat: Infinity, ease: [0.6, 0, 0.4, 1] }}
        >
          <img src="/dexter-crest.svg" alt="Dexter" width={46} height={46} style={{ marginTop: 6, marginBottom: -6 }} />
        </motion.div>
      </a>
    </div>
  );
});

function WalletHeaderButton() {
  const connected = useStore($walletConnected);
  const display = useStore($walletDisplay);
  const appKit = useAppKit();

  if (connected) {
    return (
      <button
        onClick={() => appKit.open()}
        style={{ background: 'rgba(16,185,129,0.1)' }}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-emerald-400 hover:bg-emerald-500/20 transition-colors text-sm font-medium"
      >
        <div className="w-2 h-2 rounded-full bg-emerald-500" />
        {display}
      </button>
    );
  }

  return (
    <button
      onClick={() => appKit.open()}
      style={{ color: '#a3a3a3', background: 'none' }}
      className="flex items-center gap-1.5 px-3 py-1.5 hover:text-orange-400 transition-colors text-sm font-medium"
    >
      <div className="i-ph:wallet text-base" />
      Connect
    </button>
  );
}

export function Header() {
  const chat = useStore(chatStore);
  const sidebarOpen = useStore($sidebarOpen);

  return (
    <header
      className={classNames('flex items-center justify-between px-4 border-b h-[var(--header-height)] relative', {
        'border-transparent': !chat.started,
        'border-bolt-elements-borderColor': chat.started,
      })}
    >
      {/* Left: sidebar toggle — hidden when sidebar is open */}
      <button
        onClick={toggleSidebar}
        style={{ color: '#a3a3a3', background: 'none' }}
        className={classNames(
          'flex items-center justify-center w-8 h-8 rounded-lg z-logo',
          'hover:text-white hover:bg-white/10 transition-colors cursor-pointer',
          sidebarOpen ? 'invisible' : 'visible',
        )}
        aria-label="Toggle sidebar"
      >
        <div className="i-ph:sidebar-simple-duotone text-xl" />
      </button>

      {/* Center: Dexter crest */}
      <DexterCrest />

      {/* Right: wallet + action buttons */}
      <div className="flex items-center gap-2 z-logo">
        <ClientOnly>{() => <WalletHeaderButton />}</ClientOnly>
        {chat.started && (
          <>
            <span className="flex-1 px-4 truncate text-center text-bolt-elements-textPrimary hidden sm:block">
              <ClientOnly>{() => <ChatDescription />}</ClientOnly>
            </span>
            <ClientOnly>{() => <HeaderActionButtons chatStarted={chat.started} />}</ClientOnly>
          </>
        )}
      </div>
    </header>
  );
}
