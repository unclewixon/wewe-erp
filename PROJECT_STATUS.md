# WEWE ERP — Project Status

_Last updated: 05/08/2026. One page: what exists, how to run it, what remains and who owns it._

## What exists (all in this repo, all committed)

**Backend — complete.** NestJS + Drizzle + PostgreSQL. 221 REST routes (OpenAPI at `/docs`), 161 green tests. Config-driven five-stage workflow engine (thresholds, delegation, SoD, SLA escalation), requisitions, advances/travel/retirements, budgets with virements and REQ-02 checks, QuickBooks outbox (sandbox), documents with versions/permissions/search/retention/disposal, full e-sign incl. external signers, HR (profiles/leave/checklists/letters), timesheets + LOE, payroll (PAYE/pension/NHF, kobo-exact), procurement (vendors/RFQ/PO/contracts), assets, inventory, grants with FX + donor reports, audit suite (hash-chained log + verify, flags, findings, evidence packs, activity reports), notifications + email outbox, granular permissions with SoD-pair blocking, scheduled + saved reports, auth with TOTP 2FA, progressive lockout, scoped read-only external auditors.

**Front end — the Claude Design bundle, VERBATIM.** Byte-identical (guarded by `scripts/check-design-verbatim.sh`, re-checked inside the Docker image build). A serve-time adapter feeds live API data into 13+ surfaces (register, queue, dashboards for 9 personas, budgets, grants, staff, vendors, assets, inventory, findings, leave, users, audit trail) and wires the queue's Approve button to the real engine. Persona sessions via `?as=<persona>`. Google Sans loaded from Google Fonts (design's first-choice family).

**Delivery artifacts.** Features & Build Specification v1.1 (every feature at build level) · design master prompt · UAT traceability matrix (`docs/UAT_MATRIX.md`) · deployment runbook + Docker stack + backups (`docs/DEPLOYMENT.md`) · this status page.

## Run it

```bash
service postgresql start && pnpm install
pnpm --filter api db:push && pnpm --filter api seed   # demo org, password Password1!
pnpm --filter api start:dev                            # API :3001 (docs at /docs)
pnpm --filter web dev                                  # web :5173  (?as=finance etc.)
```
Production: `docker compose up -d --build` — see `docs/DEPLOYMENT.md`.

## What remains — and whose move it is

| Item | Owner | Reference |
|---|---|---|
| 21 missing screens/states (2 blocking: detail-page binding, comment drawer) | **Claude Design** | `docs/CLAUDE_DESIGN_PHASE2_REQUEST.md` — paste it to the design session |
| QuickBooks live connection | Techtink + WEWE (Intuit credentials) | DEPLOYMENT.md §7 |
| Real email sending | WEWE (Workspace/M365 OAuth grant) | DEPLOYMENT.md §7 |
| ~~OCR engine~~ — DONE: Tesseract 5 live (upload-time + backfill endpoint) | — | closed |
| Independent penetration test | Techtink to commission | NFRs, spec §14 |
| Formal UAT with WEWE staff | WEWE + Techtink | `docs/UAT_MATRIX.md` |
| Production deployment + backup cron + restore drill | Techtink ops | `docs/DEPLOYMENT.md` |
| Remaining fixture surfaces (mid-dashboard charts, secondary spec pages) | Integration (this codebase) — wire on demand via the established adapter pattern | `apps/web/public/adapter.js` |

When Claude Design ships the Phase 2 bundle: drop it into `design/`, run `pnpm --filter web sync-design`, wire any new consts in the adapter, and the two P0 items unlock the full approve/return/reject cycle in the UI.
