# Deployment (Ubuntu/Debian VPS, no Docker required)

1. Install Node.js 22 LTS, MongoDB 7 (replica set recommended), nginx, PM2 (`npm i -g pm2`) and
   MongoDB Database Tools.
2. `git clone` the repo to `/opt/afeysync`.
3. Backend:
   ```bash
   cd backend && npm ci && npm run build
   cp .env.example .env   # set secrets: openssl rand -hex 48 / openssl rand -base64 32
   AFS_OWNER_PASSWORD='…' npm run seed:owner -- --email you@domain
   ```
4. Frontend: `cd frontend && npm ci && npm run build`. Set `OWNER_HOSTS` and
   `NEXT_PUBLIC_PLATFORM_DOMAIN` before building.
5. Start the processes: `pm2 start deploy/ecosystem.config.cjs --env production && pm2 save && pm2 startup`.
6. nginx: see `deploy/nginx.conf`. It must pass `Host` and `X-Forwarded-Host`, because the API
   resolves the tenant from them. Keep `TRUST_PROXY=loopback` so only the local nginx is trusted.
7. TLS: use a wildcard certificate for `*.afeysync.com`, either a Cloudflare origin certificate or
   certbot with the DNS challenge. Point custom facility domains at the server with a CNAME/A
   record, verify them with the TXT token shown in the owner portal, and give them a certificate
   (Cloudflare for SaaS or certbot).
8. Backups: `deploy/backup.sh all` from cron, with `BACKUP_KEY_FILE` stored off-server. Restore
   test: `deploy/backup.sh verify <file>`.
9. Monitoring: `GET /health`, `/health/database`, `/health/integrations`, plus the Owner → System
   Health page.
