import { cloudflareDevProxyVitePlugin as remixCloudflareDevProxy, vitePlugin as remixVitePlugin } from '@remix-run/dev';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import UnoCSS from 'unocss/vite';
import { defineConfig, type ViteDevServer } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { optimizeCssModules } from 'vite-plugin-optimize-css-modules';
import tsconfigPaths from 'vite-tsconfig-paths';
import * as dotenv from 'dotenv';

// Load environment variables from multiple files
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });
dotenv.config();

// @ts-expect-error -- conditional plugin array with mixed types is valid at runtime
export default defineConfig((config) => {
  // We're running in Node.js via PM2, so we should use native Node.js APIs for SSR
  // Only polyfill for client-side builds
  const isSSR = config.isSsrBuild;
  
  return {
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
      'global': 'globalThis',
      // Expose Sentry DSN to client-side code (DSN is a public identifier, not a secret)
      'import.meta.env.SENTRY_DSN': JSON.stringify(process.env.SENTRY_DSN || ''),
    },
    build: {
      target: 'esnext',
      // Source maps for Sentry (hidden = not referenced in bundle, uploaded separately)
      sourcemap: 'hidden',
      // For SSR builds, don't bundle Node.js built-ins - use native APIs
      rollupOptions: isSSR ? {
        external: ['buffer', 'stream', 'util', 'events', 'path', 'fs', 'crypto', 'http', 'https', 'url', 'querystring', 'os', 'child_process', 'worker_threads', 'net', 'tls', 'zlib', 'dns', 'tty', 'assert'],
      } : undefined,
    },
    ssr: {
      // In Node.js, use native modules instead of polyfills
      external: ['buffer', 'stream', 'util', 'events', 'path', 'fs', 'crypto', 'http', 'https', 'url', 'os', 'child_process'],
      // Don't externalize these - they need to be bundled
      noExternal: ['@remix-run/react', 'remix-island', 'isbot'],
    },
    plugins: [
      // Only apply node polyfills to client builds, not server builds
      // Server runs in Node.js where native APIs are available
      !isSSR && nodePolyfills({
        include: ['buffer', 'process', 'util', 'stream'],
        globals: {
          Buffer: true,
          process: true,
          global: true,
        },
        protocolImports: true,
        exclude: ['child_process', 'fs', 'path'],
      }),
      // Only use Cloudflare dev proxy in development mode, not for production Node.js builds
      config.mode === 'development' && remixCloudflareDevProxy(),
      remixVitePlugin({
        future: {
          v3_fetcherPersist: true,
          v3_relativeSplatPath: true,
          v3_throwAbortReason: true,
          v3_lazyRouteDiscovery: true,
        },
      }),
      UnoCSS(),
      tsconfigPaths(),
      chrome129IssuePlugin(),
      config.mode === 'production' && optimizeCssModules({ apply: 'build' }),
      // Sentry source map uploads (only in production builds when auth token is available)
      config.mode === 'production' && process.env.SENTRY_AUTH_TOKEN && sentryVitePlugin({
        org: process.env.SENTRY_ORG || '',
        project: process.env.SENTRY_PROJECT || 'dexter-lab',
        authToken: process.env.SENTRY_AUTH_TOKEN,
        // Automatically clean up source maps after upload
        sourcemaps: {
          filesToDeleteAfterUpload: ['./build/**/*.map'],
        },
      }),
    ].filter(Boolean),
    envPrefix: [
      'VITE_',
      'OPENAI_LIKE_API_BASE_URL',
      'OPENAI_LIKE_API_MODELS',
      'OLLAMA_API_BASE_URL',
      'LMSTUDIO_API_BASE_URL',
      'TOGETHER_API_BASE_URL',
    ],
    css: {
      preprocessorOptions: {
        scss: {
          api: 'modern-compiler',
        },
      },
    },
    test: {
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/cypress/**',
        '**/.{idea,git,cache,output,temp}/**',
        '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
        '**/tests/preview/**', // Exclude preview tests that require Playwright
      ],
    },
  };
});

function chrome129IssuePlugin() {
  return {
    name: 'chrome129IssuePlugin',
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        const raw = req.headers['user-agent']?.match(/Chrom(e|ium)\/([0-9]+)\./);

        if (raw) {
          const version = parseInt(raw[2], 10);

          if (version === 129) {
            res.setHeader('content-type', 'text/html');
            res.end(
              '<body><h1>Please use Chrome Canary for testing.</h1><p>Chrome 129 has an issue with JavaScript modules & Vite local development, see <a href="https://github.com/stackblitz/bolt.new/issues/86#issuecomment-2395519258">for more information.</a></p><p><b>Note:</b> This only impacts <u>local development</u>. `pnpm run build` and `pnpm run start` will work fine in this browser.</p></body>',
            );

            return;
          }
        }

        next();
      });
    },
  };
}