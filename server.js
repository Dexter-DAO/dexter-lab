/**
 * Dexter Lab - Node.js Server
 * 
 * This runs Remix as a traditional Node.js Express server,
 * which provides full Node.js API access required by the Claude Agent SDK.
 */

import { createRequestHandler } from '@remix-run/express';
import { installGlobals } from '@remix-run/node';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as dotenv from 'dotenv';

// Load environment variables from .env files
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '.env.local') });
dotenv.config({ path: join(__dirname, '.env') });
dotenv.config();

installGlobals();

const app = express();
const PORT = process.env.PORT || 5173;

// Serve static files from the client build
app.use(express.static(join(__dirname, 'build/client'), {
  maxAge: '1y',
  immutable: true,
}));

// Handle all other requests with Remix
app.all(
  '*',
  createRequestHandler({
    build: await import('./build/server/index.js'),
    mode: process.env.NODE_ENV || 'production',
  })
);

app.listen(PORT, () => {
  console.log(`🚀 Dexter Lab server running at http://localhost:${PORT}`);
});
