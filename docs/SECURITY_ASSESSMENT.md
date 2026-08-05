# WEWE ERP — Internal Security Assessment

**Status:** internal self-assessment, not the independent penetration test.
**Date:** 05/08/2026 · **Method:** automated dependency audit + 27 live attack probes (`scripts/security-probe.mjs`) against the running API, findings fixed and re-verified.

> This does **not** replace the NFR-required independent penetration test. Its purpose is to make that engagement cheap and boring — the common vulnerability classes are already closed and provable. Give this document and `scripts/security-probe.mjs` to the external firm as a starting baseline; ask them to focus on business-logic abuse, infrastructure, and anything below.

## Scope
The NestJS API (`apps/api`) and its authn/authz, injection surface, object-level authorization, audit integrity, and HTTP hardening — on a seeded staging-equivalent instance. Out of scope for an internal pass: the TLS terminator, host/network, social engineering, and physical security (all belong to the external test).

## Findings & remediation (all fixed and re-verified)

| # | Severity | Finding | Fix | Verified |
|---|---|---|---|---|
| F-1 | **HIGH** | **BOLA/IDOR** — an external auditor could fetch any requisition by direct ID (`GET /v1/requisitions/:id`), bypassing their donor/period scope that `list()` enforced. | Detail handler now applies the same auditor-scope check; out-of-scope returns 404 (does not confirm existence). | probe D4 ✓ |
| F-2 | MED | **Wrong status codes** — the generic `/v1/transactions` guard threw `Unauthorized` (401) for both missing objects and authz denials, muddying "not authenticated" vs "not allowed". | Missing → 404, authz denial → 403 `Forbidden`. | probe B6/B7 ✓ |
| F-3 | MED | **No clickjacking / MIME protections** — responses lacked `X-Frame-Options`, `X-Content-Type-Options`, CSP. | Added `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`. | probe E ✓ |
| F-4 | LOW | **Stack disclosure** — `X-Powered-By: Express` header. | `x-powered-by` disabled. | probe E ✓ |
| F-5 | MED | **No IP rate-limiting on login** — brute force was slowed only by per-account lockout; password-spraying across many accounts from one IP was unthrottled. | Per-IP throttle on **failed** logins (15/min → 429). Counts failures only, so a NAT'd office does not lock out legitimate concurrent sign-ins. | probe E ✓ |
| F-6 | MED | **Oversized body → 500** — a >15 MB JSON body returned 500 instead of 413. | Global exception filter now passes body-parser status through (413 Payload Too Large); `urlencoded` given the same 15 MB cap. | probe C2 ✓ |
| F-7 | — | **Dependency vulnerabilities** (25, incl. 1 critical). | pnpm overrides pin `js-yaml ≥4.3.0` (only prod-runtime one, via `@nestjs/swagger`), `vite`, `vitest` (the critical — dev-only, never in the prod image), `esbuild`. Remaining are transitive dev-tooling advisories not shipped in the `NODE_ENV=production` image. | `pnpm audit --prod` ✓ |

## Secure behaviours confirmed (27, all passing)

**Authentication & session:** unauthenticated requests 401 · session cookie is HttpOnly + SameSite (Secure is env-gated via `COOKIE_SECURE=1` in the prod compose) · forged/garbage tokens rejected · a pending-2FA token cannot authorise a session · SQL-injection login payload safely rejected · no password/hash ever in `/me`.

**Authorization (BOLA/IDOR & privilege):** confidential documents unreadable by unauthorised users · external auditor writes 403 · auditor sees only in-scope donor rows *and cannot fetch out-of-scope records by ID* (F-1) · initiators blocked from admin endpoints · non-admins cannot edit the permission matrix (no self-granted admin) · segregation of duties holds via the generic transaction endpoint (initiator cannot self-approve) · cross-department approval blocked.

**Injection & input:** search is parameterised (Drizzle) — SQLi attempt handled, table intact · oversized payloads rejected (413) · malformed bodies 400 via zod at every boundary · mass-assignment ignored — `status`, `ref`, `currentStage` are server-controlled and cannot be set by the client.

**Audit integrity & leakage:** the audit log has no create/update/delete route (append-only by construction) · the hash chain verifies · error responses leak no stack traces or filesystem paths.

**HTTP hardening:** nosniff, frame-deny, CSP present · no `X-Powered-By` · login rate-limited.

## Defences already in the design (context for the external test)
argon2id password hashing · TOTP 2FA (RFC-6238, tested against RFC vectors) with single-use backup codes · progressive per-account lockout · role + department RBAC with a runtime permission matrix (deny layer) · segregation of duties enforced in the pure engine (unit-tested) · append-only hash-chained audit log with a verify endpoint that survives restore drills · BigInt-kobo money (no float rounding attacks) · external auditors read-only, donor/period-scoped, and auto-expiring.

## Recommended focus for the independent penetration test
1. **Business-logic abuse** — approval-chain edge cases, virement/budget arithmetic, retirement variance manipulation, timesheet/payroll boundary conditions.
2. **Infrastructure** — TLS config, the reverse proxy, container escape, secrets handling, the PostgreSQL surface.
3. **Session lifecycle** — fixation, concurrent-session limits, cookie handling behind the real TLS proxy with `COOKIE_SECURE=1`.
4. **File handling** — the DMS upload path, OCR pipeline (tesseract/poppler process boundary), stored-XSS in document metadata rendered by the UI.
5. **The e-signature external-signer flow** — token/OTP entropy and replay, certificate hash integrity.
6. Anything this internal pass, by not being independent, is structurally blind to.

## Re-running
```bash
# API on :3001, seeded. Run the functional sweep FIRST, then the security probe
# (its brute-force test poisons the per-IP login window for ~60s).
node scripts/system-verify.mjs     # 67 functional lifecycle checks
node scripts/security-probe.mjs     # 27 security probes → exits non-zero on any HIGH/CRIT
```
