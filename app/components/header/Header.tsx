import { useStore } from '@nanostores/react';
import { ClientOnly } from 'remix-utils/client-only';
import { motion } from 'framer-motion';
import { chatStore } from '~/lib/stores/chat';
import { classNames } from '~/utils/classNames';
import { HeaderActionButtons } from './HeaderActionButtons.client';
import { ChatDescription } from '~/lib/persistence/ChatDescription.client';

export function Header() {
  const chat = useStore(chatStore);

  return (
    <header
      className={classNames('flex items-center px-4 border-b h-[var(--header-height)] relative', {
        'border-transparent': !chat.started,
        'border-bolt-elements-borderColor': chat.started,
      })}
    >
      {/* Left: sidebar toggle */}
      <div className="flex items-center gap-2 z-logo text-bolt-elements-textPrimary cursor-pointer">
        <div className="i-ph:sidebar-simple-duotone text-xl" />
      </div>

      {/* Center: Dexter crest — always visible, overhangs header top and bottom */}
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
            <img
              src="/dexter-crest.svg"
              alt="Dexter"
              width={46}
              height={46}
              style={{ marginTop: 6, marginBottom: -6 }}
            />
          </motion.div>
        </a>
      </div>

      {chat.started && (
        <>
          <span className="flex-1 px-4 truncate text-center text-bolt-elements-textPrimary">
            <ClientOnly>{() => <ChatDescription />}</ClientOnly>
          </span>
          <ClientOnly>
            {() => (
              <div className="">
                <HeaderActionButtons chatStarted={chat.started} />
              </div>
            )}
          </ClientOnly>
        </>
      )}
    </header>
  );
}
