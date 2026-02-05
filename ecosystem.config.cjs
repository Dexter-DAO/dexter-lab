module.exports = {
  apps: [{
    name: 'dexter-lab',
    script: 'pnpm',
    args: 'run start',
    cwd: '/home/branchmanager/websites/dexter-lab',
    env: {
      PORT: 5173,
      NODE_ENV: 'production'
    },
    // Load additional env vars from .env file
    env_file: '/home/branchmanager/websites/dexter-lab/.env'
  }]
};
