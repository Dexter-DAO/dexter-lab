import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Kill any process on port 3001
const killPort = spawn('npx', ['kill-port', '3001'], { stdio: 'inherit' });

killPort.on('close', () => {
  // Start the tsx dev server
  const server = spawn('npx', ['tsx', 'watch', 'index.ts'], {
    stdio: 'inherit',
    cwd: __dirname,
    env: { ...process.env, PORT: '3001' }
  });

  server.on('error', (error) => {
    console.error('Failed to start server:', error);
  });
});