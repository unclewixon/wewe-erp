# WEWE ERP — Project Status

_Last updated: 05/08/2026. One page: what exists, how to run it, what remains and who owns it._

## What exists (all in this repo, all committed)

**Backend — complete.** NestJS + Drizzle + PostgreSQL. 221 REST routes (OpenAPI at `/docs`), 164 green tests. Config-driven five-stage workflow engine (thresholds, delegation, SoD, SLA escalation), requisitions, advances/travel/retirements, budgets with virements and REQ-02 checks, QuickBooks (sandbox + **live** — Intuit OAuth2 connect/refresh and JournalEntry posting with configurable account mapping), documents with versions/permissions/search/retention/disposal, full e-sign incl. external signers, HR (profiles/leave/checklists/letters), timesheets + LOE, payroll (PAYE/pension/NHF, kobo-exact), procurement (vendors/RFQ/PO/contracts), assets, inventory, grants with FX + donor reports, audit suite (hash-chained log + verify, flags, findings, evidence packs, activity reports), notifications + email (**real SMTP transport**, file outbox when unconfigured), granular permissions with SoD-pair blocking, scheduled + saved reports, auth with TOTP 2FA, progressive lockout, scoped read-only external auditors.

**Front end — the Claude Design bundle, VERBATIM.** Byte-identical (guarded by `scripts/check-design-verbatim.sh`, re-checked inside the Docker image build). A serve-time adapter feeds live API data into 13+ surfaces (register, queue, dashboards for 9 personas, budgets, grants, staff, vendors, assets, inventory, findings, leave, users, audit trail) and wires the queue's Approve button to the real engine. Persona sessions via `?as=<persona>`. Google Sans loaded from Google Fonts (design's first-choice family).

**Delivery artifacts.** Features & Build Specification v1.1 (every feature at build level) · design master prompt · UAT traceability matrix (`docs/UAT_MATRIX.md`) · deployment runbook + Docker stack + backups (`docs/DEPLOYMENT.md`) · this status page.

## Run it

```bash
service postgresql start && pnpm install
pnpm --filter api db:push && pnpm --filter api seed   # demo org, password Password1!
pnpm --filter api start:dev                            # API :3001 (docs at /docs)
pnpm --filter web dev                                  # web :5173  (?as=finance etc.)
```
Production: `docker compose up -d --build` — see `docs/DEPLOYMENT.md`, and `docs/GO-LIVE.md` for the full go-live runbook (HTTPS, clean-org bootstrap, SMTP, live QuickBooks, backups). Clean production org (no demo data): set `SEED_DEMO=0` and run `scripts/bootstrap-prod.ts`. HTTPS via the Caddy overlay: `docker compose -f docker-compose.yml -f docker-compose.tls.yml up -d`.

## What remains — and whose move it is

| Item | Owner | Reference |
|---|---|---|
| ~~21 missing screens/states~~ — DONE: Phase 2 bundle integrated; detail page binds live refs, decision drawer drives the engine, 15 new routes, notifications/account/chain-editor wired | — | closed |
| ~~QuickBooks live connection~~ — CODE DONE: OAuth2 connect/callback/refresh + JournalEntry posting + account mapping (`qb.live.ts`). Needs Intuit **production** credentials + one-time account mapping to activate | WEWE (Intuit prod credentials) | `docs/GO-LIVE.md` §4 |
| ~~Real email sending~~ — CODE DONE: SMTP transport (nodemailer), file outbox fallback. Needs SMTP credentials to activate | WEWE (mailbox/app password) | `docs/GO-LIVE.md` §3 |
| ~~OCR engine~~ — DONE: Tesseract 5 live (upload-time + backfill endpoint) | — | closed |
| ~~Clean-org bootstrap (no demo data)~~ — DONE: `scripts/bootstrap-prod.ts` (admin + roles + permission matrix, zero transactions) | — | `docs/GO-LIVE.md` §2 |
| ~~HTTPS/TLS~~ — CONFIG DONE: Caddy auto-HTTPS overlay (`docker-compose.tls.yml`, `deploy/Caddyfile`). Needs a domain + DNS | WEWE (domain/DNS) | `docs/GO-LIVE.md` §1 |
| Independent penetration test | Techtink to commission | NFRs, spec §14 |
| Formal UAT with WEWE staff | WEWE + Techtink | `docs/UAT_MATRIX.md` |
| Production backup cron + restore drill | Techtink ops | `docs/GO-LIVE.md` §5 |

Phase 2 bundle integrated 05/08/2026: full approve/return/reject cycle works from the UI (verified live). Demo data now populates every module (procurement, payroll, timesheets, e-sign, retirements, budget versions, grant deadlines, delegations, notifications, reports) via the expanded seed, so no persona lands on placeholder rows; a few named fixtures stay deliberate (BACKUP_CODES — real codes only ever shown once at enrolment). Production runs on a clean org via `scripts/bootstrap-prod.ts` (no demo data).

Live QuickBooks + SMTP email added 05/08/2026: type-checks clean, 164 tests green, API boots with the new routes correctly guarded, clean-org bootstrap verified on a fresh DB. Activation is credentials-only — see `docs/GO-LIVE.md`. The live QuickBooks posting path is exercised end-to-end at the first real Intuit company connection (treat that as the acceptance test before flipping `qb.mode` to live).
