# WEWE ERP — Engineering Guide (read me first)

Custom ERP for WEWE (Nigerian NGO, Abuja): five-stage approval workflow, requisitions, advances/retirement, budgets, documents, HR, audit, QuickBooks. Full scope: `docs/BUILD_PLAN.md` and the Features & Build Specification v1.1 (feature IDs like WFE-04, REQ-02 refer to it).

## Ground rules (non-negotiable)

1. **Money is BigInt kobo.** Never floats, never Number for amounts. Serialise as strings over the wire. Format ₦1,250,000.00 only at the UI edge (`web/src/lib/money.ts`).
2. **Every consequential mutation writes an audit event** through `AuditService.log()` — the ONLY write path to `audit_events`. It is append-only and hash-chained; there is no update/delete anywhere in the codebase, and PRs adding one get rejected.
3. **Segregation of duties lives in the engine** (`workflow/engine.logic.ts`), not in controllers: no self-approval, no acting twice on one transaction, approvers never edit values. Add rules there, with tests.
4. **The workflow engine is configuration-driven.** New transaction types = new `TransactionType` row with a stage config, not new code paths. Resist the urge to special-case.
5. **Design fidelity:** the design system is `design/README.md` + tokens in `apps/web/src/styles/tokens.css` (accent `#E0572E`, Figtree, 282px sidebar, min-width 1360px, tabular-nums on all figures). Reuse components in `web/src/components/`; never invent ad-hoc styles. The approval tracker (`ApprovalTracker.tsx`) is the product's signature element — treat changes to it as design changes, not refactors.
6. **Dates:** store UTC, display DD/MM/YYYY Africa/Lagos. Currency and dates have helpers; use them.
7. TypeScript strict everywhere; zod at every API boundary (`packages/shared`).

## Layout

```
apps/api        NestJS + Prisma + PostgreSQL (OpenAPI at /docs)
  prisma/       schema.prisma, migrations, seed.ts
  src/modules/  auth · users · workflow · requisitions · audit · meta
apps/web        React 18 + Vite (proxy /v1 → :3001)
  src/styles/   tokens.css (design system source of truth)
  src/components/  Shell, ApprovalTracker, StatusPill, StatCard, DataTable…
packages/shared zod schemas + types shared api↔web
design/         the high-fidelity handoff (README.md = design spec; .dc.html = reference prototype — recreate, don't copy)
docs/adr/       decisions; add an ADR for anything hard to reverse
```

## Commands

```bash
# postgres must be running: service postgresql start
pnpm install
pnpm --filter api prisma migrate dev     # apply schema
pnpm --filter api prisma db seed         # demo org + users (password: Password1!)
pnpm --filter api start:dev              # API on :3001
pnpm --filter web dev                    # web on :5173
pnpm --filter api test                   # engine + unit tests — keep green
pnpm build                               # build everything
```

Seed users: `amina.yusuf@wewe.org` (Initiator), `tunde.balogun@wewe.org` (Supervisor, Programmes), `ngozi.okafor@wewe.org` (Internal Audit), `ibrahim.musa@wewe.org` (Finance), `folake.adeyemi@wewe.org` (Final Approver/MD), `admin@wewe.org` (Admin). All `Password1!`.

## Workflow for new features

Find the feature ID in the spec → check `docs/BUILD_PLAN.md` for its phase → write/extend the module → engine logic gets pure functions + tests first → API endpoint (zod-validated, permission-guarded, audit-logged) → UI from existing components → update BUILD_PLAN checkbox. UAT scenarios map 1:1 to feature IDs; don't break that traceability.
