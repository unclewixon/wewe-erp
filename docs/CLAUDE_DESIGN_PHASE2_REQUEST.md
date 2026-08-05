# WEWE ERP — Design Phase 2 Request (paste this to Claude Design)

**Context:** you produced the WEWE ERP Phase 1 bundle (`WEWE ERP.dc.html`). It is now the live front end, byte-for-byte, wired to a complete backend. Integration surfaced everything the bundle doesn't cover. Build these missing screens/states **in the same file, same design system, same runtime patterns** (extend PAGE_SPECS or add built pages as appropriate; reuse the existing components — stepper, pills, cards, tables, dialogs). Keep every existing route and byte of behaviour intact; this is an additive phase. Deliver an updated single bundle.

Two items are **integration-blocking** — do them first:

## P0 — blocking live functionality

**G20 · Transaction detail bound to the route param.** The detail page (`/requisitions/REQ-2026-0187`) is a fixed KNOWN route rendering fixture consts. Rework it so `/requisitions/:ref` renders ANY ref from the TXNS data source (title, amount, donor, department, lines, attachments, comments, the five-stage tracker with per-stage actors/timestamps, and the action panel). The backend serves all of this; the integration layer substitutes TXNS at boot — your job is only the binding. Keep the current visual design exactly.

**G21 · Comment drawer bound to Return/Reject.** The engine requires a written note for return/reject (approve needs none). Wire the detail page's and queue rows' Return/Reject buttons to open the existing comment/drawer pattern: mandatory note, confirm restates the ref + verb, on confirm call the (integration-provided) handler `window.__weweAct(ref, verb, note)` if present, else fall back to current demo behaviour. Approve buttons should likewise call `window.__weweAct(ref, 'approve')` when present.

## P1 — authentication & personal (screens that exist in the backend today)

**G1 · 2FA enrolment** — settings-style page/modal: QR (render `otpauthUri` as QR), 6-digit confirm, then a one-time backup-codes sheet (10 codes, download/print button, "I've saved these" confirm).
**G2 · Forgot/reset password** — request link → emailed-code/link state → new-password form with policy hints.
**G3 · First-time account setup** — invite landing: set password, confirm profile basics, then straight into 2FA enrolment if the role requires it.
**G4 · Locked-account state** — sign-in error state for progressive lock ("try again in N minutes / contact your administrator"), distinct from wrong-password.
**G5 · Notification centre panel** — bell opens a right panel: "Needs my action" vs "Updates" sections, unread dots, mark-all-read, per-item deep link. Data source const `NOTIFICATIONS` (integration substitutes it).
**G6 · My profile & security** — contact details, active sessions table (device/IP/last active, "sign out everywhere"), 2FA status + manage, saved signature preview.
**G7 · Saved-signature setup** — draw / type / upload tabs, preview, save; reused by the e-sign ceremony.
**G8 · Notification preferences** — instant vs daily digest per category; escalations always instant (locked toggle with explainer).
**G9 · Delegation setup** — "While I'm away": pick delegate (people picker), date range (max 30 days), scope; active delegation banner with cancel; blocked states for self/chain per the SoD rules already on /admin/roles.

## P2 — workflow & modules

**G10 · Workflow chain editor** — replace the `/admin/workflow-old` stub: visual editor of the five stage nodes per transaction type; per-stage role, threshold (`minAmountKobo`), SLA hours; version history sidebar; "applies to new transactions only" notice; sandbox-test walkthrough.
**G11 · Bulk-approve modal** — from the queue's Bulk approve button: selected items table, total value, per-item eligibility (over-cap and flagged items shown excluded with reasons), single confirm; results state (n approved, m skipped and why).
**G12 · Fulfilment / goods-received state** — on an approved requisition: received/partial toggle per line, proof upload, closes the loop; badge on the register.
**G13 · Over-budget states on the new-requisition form** — two variants driven by data: warn (amber inline panel per offending line, submit allowed with justification field) and block (red panel, submit disabled, per-line shortfall figures).

## P3 — e-signature suite (backend fully ready)

**G14 · Signing ceremony modal** — full-document review pane, highlighted signature field, sign modal with draw (canvas) / type / saved tabs, confirm restating name+role+time.
**G15 · Certificate page** — post-completion view: signer table (name, method, verified-by, timestamp, IP), document SHA-256, QR linking to the verify endpoint, "hash matches / MISMATCH" state.
**G16 · External signer standalone view** — no app shell: email-code (OTP) gate → document review → same ceremony → done state. Single-use link expiry state.

## P4 — printables (render as designed documents on WEWE letterhead)

**G17 · Travel Authority** — print-ready A4: traveller, purpose, destination, dates, per-diem table, approval chain with names/dates, QR verify.
**G18 · Purchase Order** — numbered PO on letterhead: vendor block, lines, totals, terms, approval evidence, signature area.
**G19 · HR letter** — employment/salary confirmation template page: merge-field preview, letterhead, issue log line.

## Working notes
- Data contracts: keep reading the existing consts (TXNS, VENDORS, ASSETS, LEAVE, USERS, FINDINGS, GRANTS, BUDGET_ROWS, AUDIT_LOG, INV_ITEMS, QB_EXCEPTIONS, DASH, PAGE_SPECS) — integration substitutes them at boot. For new surfaces, introduce clearly named consts (e.g. `NOTIFICATIONS`, `SESSIONS_MINE`, `DELEGATIONS_MINE`) with realistic fixtures; integration will wire them the same way.
- Currency ₦ with kobo precision, dates DD/MM/YYYY, tabular numerals, status = colour + icon + label — as you already do.
- After building, list every new route and const you added, so integration can wire them immediately.
