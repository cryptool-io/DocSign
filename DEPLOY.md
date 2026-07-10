# Deploying DocSign on ronserver2

Same shape as AMT: a single Node process behind nginx, managed by PM2, TLS via certbot.

## 1. Prerequisites on the box

- Node ≥ 20, npm ≥ 10
- Postgres (local or reachable), a database for the app
- nginx + certbot
- PM2 (`npm i -g pm2`)

## 2. Clone

```bash
cd /data/www/main
git clone https://github.com/cryptool-io/cto-docsign.git
cd cto-docsign
```

## 3. Configure

```bash
cp server/.env server/.env.local
# Edit server/.env.local — at minimum set:
#   NODE_ENV=production
#   APP_BASE_URL=https://docsign.cryptool.io
#   DATABASE_URL=postgres://user:pass@localhost:5432/docsign   (or discrete DB_* vars)
#   JWT_ACCESS_SECRET / JWT_REFRESH_SECRET / DOCROOM_VIEWER_SECRET  (long random strings)
#   DOCROOM_STORAGE_DRIVER=s3   (recommended) + DOCROOM_S3_BUCKET + AWS_* ;
#                               or leave =local to store PDFs on disk
#   MAIL_HOST / MAIL_USER / MAIL_PASSWORD / MAIL_FROM_EMAIL   (SES SMTP or other)
#   ALLOWED_ORIGINS=https://docsign.cryptool.io
```

Generate secrets: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`

## 4. Install, migrate, build, start

```bash
npm run install:all
npm run migrate                 # creates the 15 tables
npm run build                   # builds web/dist
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup                     # enables boot autostart (run the printed command)
```

The process listens on `127.0.0.1:4400`.

## 5. nginx + TLS

```bash
sudo cp deploy/nginx-docsign.cryptool.io.conf /etc/nginx/sites-available/docsign.cryptool.io
sudo ln -s /etc/nginx/sites-available/docsign.cryptool.io /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d docsign.cryptool.io
```

Point the `docsign` A record at the box (or add it to the Cloudflare Tunnel, matching
however `amt.cryptool.io` is wired). With Cloudflare in front, use SSL mode "Full (strict)".

## 6. Updating

From the box:

```bash
cd /data/www/main/cto-docsign && npm run deploy:pm2
```

Or from the app UI — an **admin** user can POST `/api/admin/update`, which runs
`git fetch` → `git reset --hard origin/main` → install → build → **syntax precheck** →
`pm2 restart docsign-server`. The fetch-before-reset guard means it never resets onto
stale code, and the precheck aborts the restart if the new code doesn't parse. Set the
first user's role to `admin` in the DB to enable it:

```sql
UPDATE "Users" SET "Role" = 'admin' WHERE "Email" = 'you@cryptool.io';
```

## Backups

- **Database**: `pg_dump docsign` on your normal schedule — it holds all metadata, the
  audit trail, and view analytics.
- **Storage**: if `DOCROOM_STORAGE_DRIVER=local`, back up `server/storage/`. On `s3`,
  enable bucket versioning. The completed (signed) PDFs live here.
