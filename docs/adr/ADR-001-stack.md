# ADR-001: Technology stack for the WEWE ERP

**Status:** Accepted · **Date:** 2026-08-05 · **Deciders:** Techtink engineering (via Claude Code)

## Context

We are building the WEWE ERP described in the Features & Build Specification v1.1: a workflow-engine-centred ERP with a five-stage approval chain, granular RBAC, an immutable audit log, QuickBooks Online integration, document management with OCR, and a Phase 2 roadmap that includes an offline PWA, e-signatures, and payroll. Constraints that matter:

- **API-01** requires a versioned REST API that the UI itself consumes — the API is a product surface, not an implementation detail.
- The spec demands structure that survives a team: module boundaries per domain, guards for permissions, interceptors for audit — an ERP rots fastest at its seams.
- Maintenance will be done by Techtink's team in Abuja; the local hiring pool is strongest in JavaScript/TypeScript and PHP.
- QuickBooks Online has first-party OAuth/SDK support in Node (`intuit-oauth`, `node-quickbooks`).
- The design handoff is token-based HTML/CSS; the front end must reproduce it faithfully without fighting a component framework's opinions.
- Money must never be floats. Kobo-integer arithmetic end to end.

## Options considered

1. **Laravel 11 + Inertia/React** — excellent RBAC/audit packages, big PHP pool. Weaker fit: two languages across the stack, and the workflow engine + future PWA/offline sync push toward a TypeScript domain model shared between API and web.
2. **Django + React** — strong admin story, but Python adds a third skill silo and no first-party QuickBooks SDK.
3. **NestJS + Prisma + PostgreSQL API, React (Vite) web, TypeScript throughout** — one language, shared types for the domain model, NestJS modules/guards/interceptors map 1:1 onto the spec's permission and audit requirements, Prisma migrations give a reviewable schema history (an audit story in itself), and OpenAPI comes free via `@nestjs/swagger`.

## Decision

**Option 3.** pnpm monorepo:

```
apps/api      NestJS 10 · Prisma · PostgreSQL 16 · argon2 · OpenAPI at /docs
apps/web      React 18 · Vite · TypeScript · React Router · TanStack Query
packages/shared   zod schemas + shared domain types (single source of truth)
```

Money is stored as **BigInt kobo**. All timestamps UTC (`timestamptz`); the UI renders Africa/Lagos. The audit log is an append-only, hash-chained table written through a single service — no other write path exists. Styling is **plain CSS with custom properties** lifted verbatim from the design handoff's tokens (`design/README.md`); no Tailwind/UI kit, because the handoff IS the design system and re-expressing it through a framework's abstractions would drift from it.

## Consequences

- (+) One language, one domain model, shared validation; the workflow engine's types are used by both API and web.
- (+) NestJS structure gives the team obvious seams: one module per spec section, guards enforce the permission matrix, an interceptor stamps audit context.
- (+) Prisma migration history doubles as schema audit; PostgreSQL row-level integrity for the hash chain.
- (−) NestJS has decorator ceremony; accepted for the structural payoff.
- (−) BigInt kobo requires custom JSON serialisation (strings over the wire); handled once in a serializer.
- Background jobs (SLA timers, QuickBooks sync, OCR) will use BullMQ + Redis when those features land — not installed until needed (YAGNI, ADR-002 when due).
