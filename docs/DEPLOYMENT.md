# WEWE ERP — Deployment Runbook

Audience: the Techtink engineer taking this to WEWE's server. One VM with Docker is enough for launch (NFR: 200 users). Everything below assumes the repo root.

## 1. Prerequisites
- Linux VM (2 vCPU / 4 GB / 40 GB disk to start), Docker + Docker Compose plugin.
- A domain (e.g. `erp.weweng.org`) pointed at the VM.
- TLS terminator in front — Caddy is the least-effort choice (auto-HTTPS): reverse-proxy the domain to `localhost:8080`.

## 2. First deployment
```bash
git clone <repo> wewe-erp && cd wewe-erp
cp .env.example .env          # set DB_PASSWORD (strong), WEB_ORIGIN=https://erp.weweng.org
docker compose up -d --build
# apply schema + reference data (first boot only)
docker compose exec api sh -c "cd /app/apps/api && node -e 'require(\"child_process\")'" || true
```
Schema + seed from a workstation with repo access (drizzle-kit is a dev dependency, not shipped in the image):
```bash
DATABASE_URL=postgresql://wewe:<pw>@<vm-ip>:5432/wewe_erp pnpm --filter api db:push
DATABASE_URL=postgresql://wewe:<pw>@<vm-ip>:5432/wewe_erp pnpm --filter api seed   # demo org — SKIP for a clean production org
```
For production, skip the demo seed and create the real organisation through `/v1/admin` (departments, users, budget lines) as SYSTEM_ADMIN — the first admin account can be inserted with a one-off SQL insert or by running the seed then deactivating demo users.

**Change every seeded password immediately. The demo `Password1!` must never reach a server with real data.**

## 3. Environment reference
| Variable | Where | Meaning |
|---|---|---|
| `DB_PASSWORD` | .env | Postgres password (compose refuses to start without it) |
| `WEB_ORIGIN` | .env → api `CORS_ORIGIN` | Public web origin for CORS |
| `COOKIE_SECURE=1` | compose (default) | Session cookies only over HTTPS — keep 1 in production |
| `WEB_PORT` | .env | Host port nginx listens on (TLS proxy targets this) |

## 4. What runs where
- **web** — nginx serving the production build of the VERBATIM design bundle (the build re-runs `check-design-verbatim.sh`; a tampered design fails the image build). Proxies `/v1` and `/docs` to the API, so cookies are same-origin.
- **api** — NestJS on :3001 (internal). OpenAPI at `/docs`.
- **db** — PostgreSQL 16 with a named volume `pgdata`.
- **apivar volume** — uploaded documents, evidence exports, and the email outbox. Included in backups.

## 5. Backups & restore (NFR: RPO ≤ 24 h, RTO ≤ 8 h)
- Nightly cron: `15 01 * * * /path/to/repo/scripts/backup.sh` (pg_dump + files tar, 14-day rotation). Point `BACKUP_DIR` at storage that is NOT the same disk, and sync it off-VM (rclone to any object storage).
- Restore drill (run one per quarter, keep the evidence for audit):
```bash
gunzip -c wewe-erp-<stamp>.sql.gz | docker compose exec -T db psql -U wewe wewe_erp
docker run --rm -v <apivar-volume>:/var/data -v $PWD:/b alpine tar xzf /b/wewe-erp-files-<stamp>.tar.gz -C /var/data
```
- Verify after restore: `GET /v1/audit/verify` must return `ok: true` — the hash chain proves the audit log survived intact.

## 6. Upgrades
```bash
git pull
docker compose build && docker compose up -d          # zero-config restart
DATABASE_URL=... pnpm --filter api db:push            # only when the release notes say "schema change"
```
Chains freeze at submission, so workflow-config/schema changes never corrupt in-flight approvals. Roll back = `git checkout <previous tag>` + rebuild; schema rollbacks are restore-from-backup (drizzle push is forward-only — treat schema releases with respect).

## 7. Integrations still on stubs (flip when credentials exist)
| Integration | Today | To go live |
|---|---|---|
| QuickBooks | sandbox outbox (`qb.mode=sandbox` setting) | Intuit developer app + OAuth connect flow; set `qb.mode=live` and implement the posting client against the queued payloads |
| Email | `.eml` files in `var/outbox` | WEWE's Google Workspace / M365 OAuth; replace the dev transport in `platform/email.ts` |
| OCR | **LIVE — Tesseract 5** (images + rasterised PDFs at upload; `POST /v1/dms/documents/ocr-backfill` for pre-existing files; binaries in the api image) | done |
| SMS/WhatsApp | not built | Phase 2 (NTF-05) |

## 8. Monitoring, minimum viable
- `docker compose ps` in a cron + mail on failure, or install Uptime Kuma pointing at `/v1/auth/me` (expects 401 — that means the API is up) and `/` on the web.
- Disk: the `pgdata` and backup volumes are the growth points; alert at 80 %.
- Application signals live in the audit log: `HOOK_ERROR`, `AUTH_LOGIN_FAILED` clusters, and the QB exception queue are the three worth a weekly look — all visible in the UI.

## 9. Security posture recap
TLS at the proxy · secure/httpOnly/SameSite cookies · argon2id passwords · TOTP 2FA with backup codes · progressive lockout · role+department RBAC with SoD enforced in the engine · append-only hash-chained audit log (verify endpoint) · external auditors read-only and auto-expiring · NDPA notes in the spec (retention rules configurable per document type). Before real donor data: run the independent penetration test the NFRs call for.
