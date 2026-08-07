# WEWE ERP — Go-Live Runbook

What the code now supports and the exact steps to move from the demo trial to production.
The application code is done; the remaining items need **your** credentials/decisions.

## 1. Domain + HTTPS (required before real data)
1. Point a DNS A-record (e.g. `erp.weweng.org`) at the droplet IP.
2. In `.env` set: `DOMAIN=erp.weweng.org`, `WEB_PORT=8080`, `COOKIE_SECURE=1`, `WEB_ORIGIN=https://erp.weweng.org`.
3. Bring the stack up with the TLS overlay (Caddy auto-provisions the certificate):
   ```
   docker compose -f docker-compose.yml -f docker-compose.tls.yml up -d
   ```

## 2. Clean production organisation (no demo data)
1. In `.env` set `SEED_DEMO=0` **before first boot** of an empty DB (or start from a fresh `pgdata`).
2. Create the first admin, roles, and reference data:
   ```
   ADMIN_EMAIL=admin@wewe.org ADMIN_PASSWORD='<strong>' \
   docker compose exec -T api node_modules/.bin/ts-node --transpile-only scripts/bootstrap-prod.ts
   ```
3. Log in, enable 2FA, then build departments, users, and budget lines in-app.
   (Two sample grants are seeded as templates — edit or delete them.)

> Already have demo data on the box? Wipe it first: `docker compose down -v` then `up` with `SEED_DEMO=0`, then run the bootstrap. `down -v` deletes the database volume.

## 3. Email (SMTP)
Set in `.env` (works with Google Workspace / Microsoft 365 / any relay):
```
SMTP_HOST=smtp.gmail.com      # or smtp.office365.com
SMTP_PORT=587
SMTP_USER=erp@wewe.org
SMTP_PASS=<app-password>
MAIL_FROM=WEWE ERP <erp@wewe.org>
```
Unset `SMTP_HOST` keeps the dev `.eml` file outbox. Test: `POST /v1/admin/email/process-outbox` as SYSTEM_ADMIN.

## 4. QuickBooks Online (live)
1. Create an app at https://developer.intuit.com; add redirect URI `https://<domain>/v1/qb/callback`.
2. In `.env`: `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI=https://<domain>/v1/qb/callback`, `QBO_ENV=production`.
3. As FINANCE/SYSTEM_ADMIN, `GET /v1/qb/connect` → open the returned URL → authorise the QuickBooks company (stores tokens).
4. Map your QBO account Ids: `POST /v1/qb/accounts` with `{ "bank": "<id>", "staffAdvances": "<id>", "programExpense": "<id>", "reimbursementExpense": "<id>" }`.
5. Switch on: `POST /v1/qb/mode { "mode": "live" }` (refuses until connected + accounts mapped).
   Queued journals then post to QuickBooks; check `GET /v1/qb/status` and the outbox. `POST /v1/qb/disconnect` reverts to sandbox.

## 5. Backups
Enable the nightly job (already scripted): `15 01 * * * /opt/wewe-erp/scripts/backup.sh`.
Point `BACKUP_DIR` at storage that is **not** the same disk and sync it off-VM. Run one restore drill per quarter and confirm `GET /v1/audit/verify` returns `ok: true`.

## 6. Independent penetration test
Commission it before real donor data (the internal `SECURITY_ASSESSMENT.md` is the baseline to hand the firm). Not a code task — but an NFR gate.

---
### Status at a glance
| Item | State |
|---|---|
| QuickBooks live (OAuth + posting) | **code done** — needs Intuit prod credentials + account mapping |
| Email delivery | **code done** — needs SMTP credentials |
| Clean-org bootstrap | **done** — run with your admin credentials |
| HTTPS/TLS (Caddy) | **config done** — needs domain + DNS |
| Backups | **script done** — needs cron + off-VM target |
| Independent pen test | **your action** (not code) |
