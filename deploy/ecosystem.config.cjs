// PM2 process file: pm2 start deploy/ecosystem.config.cjs --env production
// Ports: API 9000, worker 9001, web 10000 (must match the upstreams in deploy/nginx.conf).
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
      env_production: { NODE_ENV: 'production', RUN_WORKERS: 'false', PORT: '9000' },
    },
    {
      // Single worker process for the job queue (SMS, email, callbacks) so jobs are not raced.
      name: 'afeysync-worker',
      cwd: backend,
      script: 'dist/server.js',
      instances: 1,
      env_production: { NODE_ENV: 'production', RUN_WORKERS: 'true', PORT: '9001' },
    },
    {
      name: 'afeysync-web',
      cwd: frontend,
      script: 'node_modules/next/dist/bin/next',
      // Web on 10000 (3000 is often taken by other Node apps on a shared VPS).
      args: 'start -p 10000',
      instances: 1,
      // Server-side pages (home-page articles, blog, pricing) read the API directly on its local port.
      env_production: { NODE_ENV: 'production', API_INTERNAL_URL: 'http://127.0.0.1:9000' },
    },
  ],
};
