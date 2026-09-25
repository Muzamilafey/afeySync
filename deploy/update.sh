#!/usr/bin/env bash
# Updates AfeySync on the server: pull, build both apps, reload, then check.
# Usage (from anywhere):  bash /var/www/afeySync/deploy/update.sh
# Stops at the first problem and says which step failed, so the old version keeps running untouched.
set -euo pipefail
cd "$(dirname "$0")/.."
BRANCH=claude/afeysync-hmis-platform-cgawwj
step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mSTOPPED: %s\033[0m\n' "$*"; exit 1; }
trap 'fail "the step above failed (see the error just above this line)"' ERR

step "1/6 Code: $(pwd)"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Files changed on this server (they would block the update):"
  git status --short --untracked-files=no
  git stash push -m "server edits $(date +%F_%H%M)" >/dev/null
  echo "Saved them aside with 'git stash' (see them with: git stash list)."
fi
git fetch origin "$BRANCH"
git checkout -q "$BRANCH"
git reset -q --hard "origin/$BRANCH"
echo "Now at: $(git log --oneline -1)"

step "2/6 Backend build"
(cd backend && npm ci --no-audit --no-fund && npm run build)

step "3/6 Frontend build (this takes a few minutes)"
free -m | awk '/Mem:/ {print "Free memory: " $7 " MB"}'
(cd frontend && npm ci --no-audit --no-fund && NODE_OPTIONS=--max-old-space-size=2048 npm run build)

step "4/6 nginx"
cp deploy/nginx.conf /etc/nginx/sites-available/afeysync
cp deploy/afeysync_proxy.conf /etc/nginx/afeysync_proxy.conf
nginx -t && systemctl reload nginx

step "5/6 Restart AfeySync"
pm2 reload afeysync-api afeysync-worker afeysync-web --update-env
sleep 6
pm2 status afeysync-api afeysync-worker afeysync-web

step "6/6 Check"
echo "API:     $(curl -s http://127.0.0.1:9000/health | head -c 80)"
echo "Website: $(curl -s -H 'Host: afey.co.ke' http://127.0.0.1:10000/ | grep -o '<title>[^<]*</title>')"
echo "Blog:    HTTP $(curl -s -o /dev/null -w '%{http_code}' -H 'Host: afey.co.ke' http://127.0.0.1:10000/blog)"
printf '\n\033[1;32mDone. Now open https://afey.co.ke in a private window (or press Ctrl+Shift+R).\033[0m\n'
