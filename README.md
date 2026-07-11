# Cryptool DocSign

A self-hosted **DocSend + e-signature** app: upload a PDF, share a tracked link with
per-page view analytics, and/or send it out for signature with drag-and-drop fields,
email-OTP identity verification, and a tamper-evident audit trail. Runs standalone at
`docsign.cryptool.io`, the same way AMT runs at `amt.cryptool.io`.

## What it does

**Sharing half (DocSend-style)**
- Upload PDFs, grouped under projects.
- Generate per-recipient share links with gating: require email, password, allowed
  email/domain list, expiry, max views, download on/off, and a per-viewer watermark.
- Track who opened it, from where, and **how long they spent on each page**.

**Signing half (DocuSign-style)**
- Reusable **templates**: place signature / initials / date / text / checkbox fields on
  the page, addressed by signer *role*.
- **Send for signature**: pick a project, a document, a template, and the people who must
  sign (with parallel or sequential order). Bind template roles to real recipients.
- Recipients verify identity with an emailed one-time code, fill their fields, and adopt a
  signature. The final PDF is stamped and a **Certificate of Completion** is appended.
- Every action is written to a **SHA-256 hash-chained audit trail**; editing or deleting
  any event invalidates every hash after it, and the app flags exactly where.

## Architecture

```
cto-docsign/
  server/   Node + Express + Sequelize (Postgres). Serves the API and the built SPA.
  web/      Vite + React SPA (sender dashboard + public viewer/signing pages).
  deploy/   nginx reverse-proxy config.
  ecosystem.config.cjs   PM2 process (single fork).
```

- **One process** serves everything: `/api/*` is the JSON API, everything else falls back
  to the React SPA (`web/dist`). Recipients get plain no-login pages at `/v/:token`
  (viewer) and `/sign/:token` (signing).
- **Storage is pluggable** via `DOCROOM_STORAGE_DRIVER`: `s3` (encrypted, presigned) or
  `local` (disk). Nothing is ever world-readable.
- **Recipients are not app users** — viewers and signers get their own short-lived,
  audience-scoped tokens, entirely separate from the sender auth.

## Local development

Requires Node ≥ 20 and Postgres.

```bash
# 1. Install
npm run install:all

# 2. Configure — copy the template and edit secrets
cp server/.env server/.env.local     # then edit DB creds, JWT secrets, etc.

# 3. Create the database and run migrations
createdb docsign          # or: psql -c 'create database docsign'
npm run migrate

# 4a. Dev with hot reload (two terminals)
npm run dev:server        # API on :4400
npm run dev:web           # SPA on :5173 (proxies /api -> :4400)

# 4b. Or run the production shape (SPA served by the API)
npm run build && npm start   # everything on :4400
```

With `MAIL_HOST` blank, all emails (verification, OTP codes, signature requests) are
printed to the server console instead of sent — handy for local testing.

## Tests

An end-to-end suite lives in [`tests/`](./tests) and runs against a real database.
It covers the crypto primitives + browser↔server interop, OAuth email mechanics,
the full sender+signer journey (sequential multi-signer, share-link viewing,
completion, audit, inbox attribution, OTP guard, decline), zero-knowledge document
encryption (decrypt-to-stamp), and encrypted data rooms.

```bash
createdb docsign && npm run migrate   # once
npm test                              # boots the API if needed, runs every suite
```

CI (GitHub Actions, [.github/workflows/ci.yml](./.github/workflows/ci.yml)) spins up
Postgres, migrates, runs the suite, and builds the SPA on every push and PR.

See [DEPLOY.md](./DEPLOY.md) for the ronserver2 (PM2 + nginx + certbot) setup.
