/**
 * Development tools and utilities
 * Only active in development mode
 */

export const isDev = process.env.NODE_ENV !== 'production';

/**
 * Dev-only feature flags
 * Toggle features on/off during development
 */
export const devFlags = {
  // Show bug reporter even when it would normally be hidden
  forceBugReporter: isDev && typeof window !== 'undefined' && localStorage.getItem('dev:force-bug-reporter') === 'true',

  // Add dev tools panel
  showDevPanel: isDev && typeof window !== 'undefined' && localStorage.getItem('dev:show-panel') === 'true',
};

/**
 * Dev keyboard shortcuts
 * Available in browser console or dev panel
 */
if (isDev && typeof window !== 'undefined') {
  // @ts-ignore
  window.__DEV__ = {
    // Toggle bug reporter force-show
    toggleBugReporter: () => {
      const current = localStorage.getItem('dev:force-bug-reporter') === 'true';
      localStorage.setItem('dev:force-bug-reporter', String(!current));
      console.log(`🐛 Bug reporter force-show: ${!current ? 'ON' : 'OFF'} (refresh to apply)`);
    },

    // Toggle dev panel
    toggleDevPanel: () => {
      const current = localStorage.getItem('dev:show-panel') === 'true';
      localStorage.setItem('dev:show-panel', String(!current));
      console.log(`🔧 Dev panel: ${!current ? 'ON' : 'OFF'} (refresh to apply)`);
    },

    // Clear all dev flags
    clearFlags: () => {
      localStorage.removeItem('dev:force-bug-reporter');
      localStorage.removeItem('dev:show-panel');
      console.log('✅ All dev flags cleared');
    },

    // Show help
    help: () => {
      console.log(`
🔧 Dev Tools Available:
  
  __DEV__.toggleBugReporter()  - Force show bug reporter everywhere
  __DEV__.toggleDevPanel()     - Show dev tools panel
  __DEV__.clearFlags()         - Clear all dev flags
  __DEV__.help()               - Show this help
  
Keyboard Shortcuts:
  Ctrl+Shift+B    - Toggle bug reporter
  Ctrl+Shift+D    - Toggle dev panel (if enabled)
      `);
    },
  };

  console.log('🔧 Dev tools loaded. Type __DEV__.help() for commands.');
}
