#!/usr/bin/env bash
# Pull the latest master, install, migrate, rebuild, and restart under PM2.
# Run by the GitHub webhook (server/src/controllers/hooksController.js) on every
# push to master, or by hand. Logs to server/logs/deploy.log.
set -euo pipefail

cd "$(dirname "$0")/.."
BRANCH="${DEPLOY_BRANCH:-master}"

echo "===== deploy $(date -u +%FT%TZ) (branch $BRANCH) ====="
git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"
npm --prefix server install --no-audit --no-fund
npm --prefix web install --no-audit --no-fund
npm --prefix server run migrate
npm --prefix web run build
pm2 restart docsign-server --update-env
echo "===== deploy done $(date -u +%FT%TZ) ====="
