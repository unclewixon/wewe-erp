# WEWE ERP

Custom ERP for the Widows and Orphans Empowerment Organisation (WEWE): a five-stage approval workflow (Initiator → Supervisor → Internal Audit → Finance → Final Approver) replacing paper across requisitions, advances, budgets, documents, HR and audit. Built by Techtink Solutions Ltd.

- **Start here:** `CLAUDE.md` (engineering ground rules) and `docs/BUILD_PLAN.md` (phased roadmap with feature IDs).
- **Stack:** NestJS + Drizzle + PostgreSQL API, React/Vite web, TypeScript throughout — see `docs/adr/ADR-001-stack.md`.
- **Design:** `design/` holds the high-fidelity handoff; `apps/web/src/styles/tokens.css` is its living token sheet.

## Quick start

```bash
service postgresql start        # local dev database
pnpm install
pnpm --filter api db:push       # apply schema
pnpm --filter api seed          # demo org (password: Password1!)
pnpm --filter api start:dev     # API on :3001
pnpm --filter web dev           # web on :5173
pnpm --filter api test          # workflow-engine unit tests
```

Sign in as `ibrahim.musa@wewe.org` / `Password1!` (Finance) and open the queue, or `amina.yusuf@wewe.org` (Initiator) and raise a requisition.
