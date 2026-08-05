# WEWE ERP — Build Plan

Feature IDs refer to the Features & Build Specification v1.1. Tick items as they land; keep this file honest.

## Phase 0 — Standing rule: VERBATIM design
The Claude Design bundle is used verbatim; the build designs nothing. Missing screens are logged in `docs/DESIGN_GAP_REPORT.md` and requested from Claude Design. Phase-1 interim screens are replaced by verbatim ports as each area is touched.

## Phase 1 — Foundation (IN PROGRESS)
- [x] ADR-001 stack decision; monorepo scaffold
- [x] Prisma schema: users, roles, permissions, departments, budget lines, transaction types, transactions, stages, audit events, sessions
- [x] Seed: demo org, six role users, budgets, sample transactions
- [x] Auth: email+password (argon2), httpOnly session cookie, guards (AUTH-01, AUTH-03 partial)
- [x] RBAC: role checks with department scoping; permission guard skeleton (ADM-01 partial)
- [x] Audit log: append-only, hash-chained AuditService (AUD-01 core)
- [x] Workflow engine: config-driven five-stage chain, approve/reject/return/withdraw, SoD rules, restart-on-resubmit (WFE-01/02/04/09 core) + unit tests
- [x] Requisitions vertical slice: draft→submit→five approvals→approved, lines, ref generator (REQ-01/03 core)
- [x] Web: tokens.css from design handoff, Shell (282px sidebar, groups), sign-in, dashboard (live stats), requisitions queue/list, new-requisition form, transaction detail with ApprovalTracker
- [x] Interim build-side screens DELETED; apps/web now serves the design bundle byte-for-byte (cmp-guarded)
- [x] Data adapter Phase A: serve-time fallback wrapping (TXNS/BUDGET_ROWS/QB_EXCEPTIONS) + pre-boot adapter fetching live requisitions, budget positions, QB exceptions; design byte-identical (cmp-guarded). Phase B done: ?as=<persona> auth bridge (9 personas incl. external auditor), 12 consts wired live (TXNS, BUDGET_ROWS, QB_EXCEPTIONS, AUDIT_LOG, GRANTS, STAFF, VENDORS, ASSETS, INV_ITEMS, FINDINGS, LEAVE, USERS). Phase C done: /requisitions/queue rendered live per persona (PAGE_SPECS merge) and the design's Approve button drives the real engine (verified: Tunde approved REQ-2026-0001 from the UI; queue emptied; DB advanced to Internal Audit). Return/Reject + detail page blocked on design gaps #20–21. Phase D done: live dashboards for finance/supervisor/initiator/audit/md personas (cards, banner, queue refs, grant-burn meters), grant-spent mapping fixed (totals.actualKobo), /advances/outstanding wired, Google Sans loaded from Google Fonts at serve time (design's first-choice family; Figtree fallback intact). Remaining fixtures: mid-dashboard charts, other spec pages — wire as needed
- [x] 2FA TOTP (AUTH-02): RFC-6238 impl (zero-dep, RFC-4226 test vectors), enrolment + backup codes, pending-login verify; enrolment SCREEN still awaiting design (gap #1)
- [x] Progressive lockout + admin unlock (AUTH-04); session/profile UI awaiting design (gaps #2–4, #6)

## Phase 2 — Workflow depth (BACKEND COMPLETE)
- [x] Amount-based rules / thresholds (WFE-03): chain resolved & frozen at submission; auto-passed stages reported, never silent (config via TransactionType.stages)
- [x] Delegation (WFE-05): date-bounded, max 30 days, no chains, SoD-safe (delegator-initiator and delegator-prior-approver blocked), on-behalf-of logged; endpoints /v1/delegations
- [x] Instant revocation (AUTH-05): deactivate kills sessions + delegations, audit + notify
- [x] SLA timers + escalation (WFE-06): in-process 60s scanner, 75% reminder / 100% escalation, deduped per stage (BullMQ/Redis = production upgrade path)
- [x] Notifications in-app (NTF-01) via event bus + email outbox with dev transport (.eml to var/outbox; provider OAuth pending — NTF-02 stub noted in code)
- [x] Bulk actions (WFE-08): 50-item cap, per-item amount ceiling, open-audit-flag exclusion, per-item results
- [x] Workflow configuration API (WFE-10 backend): transaction-types CRUD with validation; UI = verbatim design

## Phase 3 — Money (BACKEND COMPLETE)
- [x] Budgets: versions/allocations/activation, position (allocated/committed/actual/available), virements via VIREMENT workflow + hook (BUD-01..03); REQ-02 check in requisitions (block/warn per settings)
- [x] Advances & travel: per-diem calc, disbursement, deadlines, outstanding register, overdue block (ADV-01..04); retirements: variance, refunds, partials, auto-close (RET-01..05)
- [x] QuickBooks outbox: journal queue, exceptions, repost, sandbox posting (QBI core); live OAuth connect + CoA mapping screen = integration task with real WEWE credentials

## Phase 4 — Documents & e-sign (BACKEND COMPLETE)
- [x] Repository, versions, permissions, links, search (DMS-01..04; OCR LIVE: Tesseract 5 at upload + admin backfill, proven on scanned PNG and image-only PDF); retention/legal hold + dual-approved disposal workflow (DMS-06)
- [x] E-signature series complete incl. external signers (token+OTP), certificates, hash verification (DMS-08a–d)

## Phase 5 — People (BACKEND COMPLETE)
- [x] HR core: profiles w/ field-level masking, leave workflow + balances, checklists, letters (HRM-01..05); timesheets + LOE (TLS-01..03); payroll: PAYE/pension/NHF computation, runs, payslips, remittances, cost distribution (PAY-01..03)

## Phase 6 — Depth modules (BACKEND COMPLETE)
- [x] Procurement: vendors/RFQ/quotes/PO/receipts/contracts/thresholds/order-splitting (PRC-01..05); assets: register/assign/verify/dispose/depreciation (AST-01..04); grants: budget-vs-actual, FX, reports, calendar (DGM-01..04)
- [x] Inventory & stores: items, GRN/issue/adjust/count, low-stock alerts (INV-01..04)
- [x] Audit suite backend: flags/respond/close, findings, evidence packs, access & activity reports (AUD-02..05)
- [x] External auditor accounts (AUD-06): scoped (donor/period), auto-expiring, read-only enforced at guard level, revocation kills sessions
- [x] Pipeline analytics + registers + exports (DSH-02..04); scheduled reports w/ role recipients + Lagos-time cadence (DSH-05); saved custom reports w/ whitelisted columns/filters + CSV (DSH-06)

## Phase 7 — Admin depth & hardening (BACKEND LARGELY COMPLETE)
- [x] Roles & Permissions backend: 17×7 catalog, matrix get/set with SoD-pair blocking, resolver, change log (UI = verbatim design)
- [x] Departments CRUD, settings with audit history, workflow config API (ADM-02..04 core; effective-dating refinement pending)
- [ ] Mobile polish (MOB-01..03), PWA offline (MOB-04); NFR pass: perf budgets, pen-test prep, backups/DR runbook

## Deployment readiness (done this phase)
- [x] OpenAPI at /docs (177 paths) · CORS/cookie hardening via env · trust proxy
- [x] Production web build verified (serve-time transforms + verbatim guard baked into the image build)
- [x] Dockerfiles (api, web+nginx) + docker-compose (db/api/web, volumes, healthchecks) + .env.example
- [x] scripts/backup.sh (nightly pg_dump + files, 14-day rotation) + quarterly restore drill w/ audit-chain verify
- [x] docs/DEPLOYMENT.md runbook (first deploy, upgrades, integration flips, monitoring, security recap)

## System verification (this phase)
- [x] Engine fix (found by sweep): approvals before a return no longer block re-approval after resubmission (priorApproversSinceLastSubmit; unit-tested)
- [x] Generic /v1/transactions surface: type-aware matrix checks (LEAVE approval = hr:APPROVE, not requisitions:APPROVE)
- [x] Matrix defaults expanded to cover every real workflow; SoD-clean (disburse/settle mapped as APPROVE-stage operations)
- [x] Seed: FK-safe wipe order, MNE supervisor mapping, second Finance officer (single-officer dept cannot route own items)
- [x] scripts/system-verify.mjs (67 checks) + scripts/ui-sweep.mjs (21 routes) — both green; rerun before every release

## Phase 2 design bundle — INTEGRATED
- [x] All 21 gaps delivered by Claude Design; bundle swapped in byte-verified; all 16 transform anchors stable
- [x] G20 live: /requisitions/:ref renders ANY live ref (verified: tracker, lines, comments from the API)
- [x] G21 live: decision drawer -> window.__weweAct -> /v1/transactions/:id/action (verified: Return with note -> RETURNED)
- [x] Wired live: TXN_DETAIL, NOTIFICATIONS, SESSIONS_MINE (new /v1/auth/sessions endpoint), DELEGATIONS_MINE, BULK_QUEUE (real cap+flag rules), CHAIN_TYPES
- [x] 35-route UI sweep clean; system-verify 67/67 and idempotent across reruns

## Standing quality gates
Engine/budget/QuickBooks logic always has tests · every endpoint permission-guarded + audit-logged · every screen uses shared components · feature-ID traceability maintained.
