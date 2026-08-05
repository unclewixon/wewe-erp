# Module-builder brief (WEWE ERP backend)

You are building ONE module area of the WEWE ERP backend. Read `CLAUDE.md` first (ground rules), then this.

## Hard boundaries — violating these breaks parallel work
- Create/edit files ONLY under `apps/api/src/modules/<your-area>/`. Your area is stated in your task.
- NEVER edit: `src/db/schema.ts` (complete; all your tables exist — read it), `src/app.ts`, `src/auth/*`, `src/audit/*`, `src/workflow/*`, `src/requisitions/*` (exception only if your task explicitly grants it), `package.json`, anything under `apps/web/` or `design/`.
- Do NOT add npm dependencies. Node stdlib + existing deps (drizzle-orm, zod, @nestjs/*, argon2) only.
- Do NOT start servers or bind ports. Verify with `npx tsc --noEmit` (run in `apps/api/`) and `npx vitest run` only. PostgreSQL is running; you may READ it with psql to check schema, but do not seed or mutate data.

## Module shape (follow exactly)
Your area folder exports everything from an `index.ts`:
```ts
export const controllers = [FooController, BarController];
export const providers = [FooService];
export async function seedDefaults(): Promise<void> { /* idempotent reference data; upsert-style */ }
export function register(): void { /* WorkflowService.onFinalApproval + bus.on subscriptions, if any */ }
```
The integrator wires these into `app.ts` — you never do.

## Platform seams you build on (already implemented — use, don't reimplement)
- `db`, `schema` from `../../db/client` — Drizzle. Money columns are `bigint` mode `bigint`; serialise BigInt as `.toString()` in responses.
- `AuthGuard`, `CurrentUser`, `RequireRoles`, `AuthedUser` from `../../auth/auth` — every controller uses `@UseGuards(AuthGuard)`; role-restrict admin/finance endpoints with `@RequireRoles(...)`.
- `AuditService.log()` from `../../audit/audit.service` — EVERY consequential mutation logs. Constructor-inject it.
- `WorkflowService` from `../../workflow/workflow.service`:
  - `createTransaction(user, { typeCode, title, amountKobo?, departmentId?, donorCode?, payload?, submit?, ip? })` for anything approval-routed (advances, retirements, leave, virements, timesheets, payroll release). Transaction types are rows in `transaction_types` — your `seedDefaults()` inserts yours (code, name, refPrefix, stages json). Stage defs: `{ role, minAmountKobo?, slaHours? }`.
  - `WorkflowService.onFinalApproval(typeCode, hook)` — static; register in `register()` for post-approval effects (apply virement, arm retirement deadline, queue QuickBooks entry…). Hooks must be idempotent-safe.
- `bus` from `../../events` — `tx.submitted` / `tx.stage` / `tx.approved` events for notifications etc.
- Validation: zod schemas parsed at the top of each handler (`Schema.parse(body)`); a global filter maps ZodError → 400.
- Files on disk: if you store files, use `var/storage/` under `apps/api` (create it), key = random hex; never trust client filenames.

## Conventions
- Controllers: `@Controller('v1/<resource>')`. Lists support simple query filters; detail endpoints include related names, not just ids.
- Kobo in, kobo out, as strings in JSON. Dates ISO/UTC.
- Segregation of duties and permission checks live in services, tested where non-trivial (vitest, pure functions preferred).
- Every file compiles under `strict`. Fix YOUR tsc errors; if you see errors clearly outside your folder, leave them and note them in your final report.

## Final report (your return value)
Plain text: files created; endpoints added (method + path, one line each); transaction types + hooks registered; seedDefaults contents; tests added and their status; any TODOs or decisions the integrator must know. No prose padding.
