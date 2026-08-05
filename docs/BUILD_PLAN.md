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
- [ ] Replace interim screens with VERBATIM ports from design bundle (shell, sign-in+OTP, dashboards, requisitions list/new/detail)
- [ ] 2FA TOTP enrolment + verification (AUTH-02) — awaiting design (gap #1)
- [ ] Session management UI (AUTH-03 rest), lockout (AUTH-04) — awaiting design (gaps #2–4, #6)

## Phase 2 — Workflow depth
- [ ] Amount-based rules / thresholds (WFE-03) — engine hook exists, config UI pending
- [ ] Delegation & backup approvers (WFE-05); instant revocation reassignment (AUTH-05)
- [ ] SLA timers + escalation via BullMQ (WFE-06); aging badges
- [ ] Bulk actions (WFE-08); notifications in-app (NTF-01) + email via provider OAuth (NTF-02/03)
- [ ] Workflow configuration UI (WFE-10)

## Phase 3 — Money
- [ ] Budget module: import, revisions/virement, commitment accounting (BUD-01..04); budget-check validation on submit + Finance stage (REQ-02)
- [ ] Advances & travel (ADV-01..04); retirement with variance + receipts (RET-01..05)
- [ ] QuickBooks: OAuth connect, CoA mapping, posting queue + exceptions, status sync (QBI-01..05)

## Phase 4 — Documents & e-sign
- [ ] Repository, versions, permissions, search+OCR (DMS-01..04); digitisation intake (DMS-05); retention (DMS-06)
- [ ] E-signature series (DMS-08a–d)

## Phase 5 — People
- [ ] HR core (HRM-01..05); timesheets (TLS-01..03); payroll decision + build (PAY-01..03)

## Phase 6 — Depth modules
- [ ] Procurement (PRC-01..05); fixed assets (AST-01..04); donor & grants (DGM-01..04, PBT-01)
- [ ] Inventory & stores (INV-01..04: GRN, issues, counts, movement log) — design-driven addition; spec addendum needed
- [ ] Audit suite completion: flags/queries UI, findings register, checklists, exports, auditor portal (AUD-02..06)
- [ ] Reports & analytics (DSH-02..06)

## Phase 7 — Admin depth & hardening
- [ ] Roles & Permissions module UI (matrix editor, scopes, SoD rules panel, effective-permissions resolver, view-as, change log)
- [ ] Org structure effective-dating, policy settings, reference data UIs (ADM-02..04)
- [ ] Mobile polish (MOB-01..03), PWA offline (MOB-04); NFR pass: perf budgets, pen-test prep, backups/DR runbook

## Standing quality gates
Engine/budget/QuickBooks logic always has tests · every endpoint permission-guarded + audit-logged · every screen uses shared components · feature-ID traceability maintained.
