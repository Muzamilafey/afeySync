// PM2 process file: pm2 start deploy/ecosystem.config.cjs --env production
// Folders are resolved from this file's location, so it works wherever the repo is cloned (e.g. /var/www/afeysync).
const path = require('path');
const backend = path.join(__dirname, '..', 'backend');
const frontend = path.join(__dirname, '..', 'frontend');

module.exports = {
  apps: [
    {
      name: 'afeysync-api',
      cwd: backend,
      script: 'dist/server.js',
      instances: 2,
      exec_mode: 'cluster',
      max_memory_restart: '1G',
      env_production: { NODE_ENV: 'production', RUN_WORKERS: 'false' },
    },
    {
      // Single worker process for the job queue (SMS, email, callbacks) so jobs are not raced.
      name: 'afeysync-worker',
      cwd: backend,
      script: 'dist/server.js',
      instances: 1,
      env_production: { NODE_ENV: 'production', RUN_WORKERS: 'true', PORT: '4001' },
    },
    {
      name: 'afeysync-web',
      cwd: frontend,
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000',
      instances: 1,
      env_production: { NODE_ENV: 'production' },
    },
  ],
};
