import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { BugReportFab } from '~/components/bug-report/BugReportFab.client';
import { useState } from 'react';
import { ClientOnly } from 'remix-utils/client-only';

/**
 * Dev-only route for bug reporter iteration
 * Access at: http://localhost:5173/_dev/bug-reporter
 *
 * Features:
 * - Isolated test environment
 * - Different backgrounds to test contrast
 * - Manual open/close controls
 * - HMR for instant design updates
 */

export async function loader({ request: _request }: LoaderFunctionArgs) {
  // Only allow in development
  if (process.env.NODE_ENV === 'production') {
    throw new Response('Not Found', { status: 404 });
  }

  return json({ ok: true });
}

export default function BugReporterDev() {
  const [background, setBackground] = useState<'light' | 'dark' | 'gradient'>('light');

  const backgrounds = {
    light: 'bg-gray-50',
    dark: 'bg-gray-900',
    gradient: 'bg-gradient-to-br from-purple-900 via-gray-900 to-blue-900',
  };

  return (
    <div className={`min-h-screen ${backgrounds[background]} transition-colors duration-300`}>
      {/* Dev Controls */}
      <div className="fixed top-4 left-4 z-[999] bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 border border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-bold mb-3 text-gray-900 dark:text-white">🔧 Bug Reporter Dev Tools</h3>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1.5">Background</label>
            <div className="flex gap-2">
              {(['light', 'dark', 'gradient'] as const).map((bg) => (
                <button
                  key={bg}
                  onClick={() => setBackground(bg)}
                  className={`px-3 py-1.5 text-xs rounded-md transition-all ${
                    background === bg
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  {bg}
                </button>
              ))}
            </div>
          </div>

          <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              <strong>Keyboard:</strong> Ctrl+Shift+B
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              HMR is active - edit and see changes instantly!
            </p>
          </div>

          <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
            <a
              href="/"
              className="text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
            >
              ← Back to app
            </a>
          </div>
        </div>
      </div>

      {/* Sample Content */}
      <div className="flex items-center justify-center min-h-screen px-4">
        <div className="max-w-2xl">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">Bug Reporter Test Environment</h1>
          <p className="text-lg text-gray-600 dark:text-gray-300 mb-8">
            The bug reporter FAB should appear in the bottom-right corner. Try different backgrounds to test contrast
            and visibility.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm rounded-lg p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Test Scenarios</h3>
              <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                <li>• Click the FAB to open</li>
                <li>• Press Ctrl+Shift+B</li>
                <li>• Fill the form</li>
                <li>• Test validation</li>
                <li>• Submit a report</li>
              </ul>
            </div>

            <div className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm rounded-lg p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="font-semibold text-gray-900 dark:text-white mb-2">HMR Active</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Edit BugReportFab.client.tsx and watch your changes appear instantly. No reload needed!
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Bug Reporter FAB */}
      <ClientOnly>{() => <BugReportFab />}</ClientOnly>
    </div>
  );
}
