# Design Coverage Audit — Phase 1 handoff bundle vs full-app inventory

**Rule in force:** the Claude Design files (`design/WEWE ERP.dc.html` + `design/README.md`) are used **VERBATIM**. The build team ports markup, styles, and behaviour exactly; nothing is designed by the build side. Anything listed under "Missing" below must be produced by Claude Design as a follow-up design phase — not improvised in code.

## What the bundle fully covers (built, high-fidelity, verbatim-usable)

Sign-in with 2FA code entry (OTP step) · role switcher with **9 personas** including a scoped External Auditor · dark mode · the five-stage approval tracker · dashboards for all 9 roles · requisitions list, new-requisition form, and full transaction detail (`REQ-2026-0187`) with attachments, comments, history · advances & retirement (incl. retire flow) · budgets · QuickBooks · documents & e-sign hub · HR · timesheets (grid + approvals) · payroll · procurement · fixed assets · donors & grants · audit & compliance · reports · administration (users) · **the deep Roles & Permissions module** (`/admin/roles`: permission matrix, scopes, SoD rules incl. no-self-delegation/no-chains, sensitivity sets, members, effective-permissions resolver, change log) · a form builder (`/admin/forms`) · mobile views (`/mobile`) · system/edge pages (`/system`) · the living design-system page.

Plus **47 spec-driven secondary pages** (stats + table pattern) covering: requisition queue & templates; advance new/travel/outstanding; budget import/virements/versions; payslips & remittances; QuickBooks mapping & exceptions; procurement RFQ/orders/contracts/vendors/PO; asset verification/transfers/disposals/depreciation; document signatures/digitisation/retention/e-sign; HR leave/onboarding/contracts; LOE; grant reports/calendar/programmes; audit findings/log/evidence; report pipeline/scheduled; inventory GRN/issues/counts; admin org/reference/policies.

## ~~Missing~~ — DELIVERED in the Phase 2 bundle (05/08/2026). All 21 gaps closed; see design/PHASE2-INTEGRATION.md for routes/consts. Original list kept for traceability:

## Original request list (all delivered)

**Authentication & account**
1. 2FA enrolment screen (QR scan, confirm code, backup codes download) — enrolment is referenced in audit copy but has no screen.
2. Forgot/reset-password flow.
3. First-time account setup (invite → set password → profile basics).
4. Locked-account state.

**Personal / shell**
5. Notification centre panel (bell exists conceptually; no feed panel is built).
6. My profile & security page (active sessions list, "sign out everywhere").
7. Saved-signature setup (draw/type/upload once, reuse in ceremonies).
8. Notification preferences (instant vs digest, quiet hours).
9. Delegation setup UI for approvers (the *rules* exist on /admin/roles; the user-facing "set my delegate + dates" screen does not).

**Workflow & requisitions**
10. Workflow chain configuration editor — only a legacy spec stub (`/admin/workflow-old`) exists; the visual five-node editor with thresholds/SLA/versions needs a real design.
11. Bulk-approve confirmation modal (the queue page has the button; the modal flow is unbuilt).
12. Fulfilment / goods-received closure state on a requisition.
13. Over-budget warning state on the new-requisition form (REQ-02 hard-block and warn-with-override variants).

**E-signature (DMS-08)**
14. The signing ceremony modal itself — draw / type / saved-signature tabs (no canvas flow exists).
15. Signed-document certificate page (signers, timestamps, hash, QR) — referenced in copy, not designed.
16. External signer standalone view (email-code gate, no shell) — exists only as narrative text in a status feed.

**Printables**
17. Travel Authority printable document.
18. Purchase Order branded PDF preview.
19. HR letter generation screen + letter template.

**Discovered during integration (Phase C write-wiring)**
20. Transaction detail page is hard-bound to the fixture ref `REQ-2026-0187` (its route is a fixed entry in KNOWN and its content reads fixture consts). It needs template binding to the route parameter so any live ref renders. Until then, live rows can be listed and actioned from the queue but not opened in detail.
21. Return/Reject need the comment drawer bound to the action (a note is mandatory in the engine); the current buttons are visual no-ops. Approve is wired live via the integration bridge; Return/Reject wait on this binding.

## Design exceeds the feature spec (adopt into the build plan)

- **Inventory & stores module** (GRN, issues, counts, movement log) — not in Features Spec v1.1; added to BUILD_PLAN Phase 6 as INV-01…04 (spec addendum needed).
- **Form builder** (`/admin/forms`) — generalises WFE-10's "form template reference"; adopt.
- **Dark mode** — shipped in the design despite being deferred in the master prompt; adopt (tokens exist in design/README.md).
- Persona set is 9 roles (adds Procurement Officer and External Auditor as first-class personas) — matches spec intent; adopt.

## Build-side consequences (recorded, in progress)

- The Phase-1 web UI committed in this repo was built from the design *tokens* before the verbatim rule was declared. It is functionally correct but **interim**: each screen is to be replaced by a verbatim port of the corresponding design markup, wired to the real API. Tracked in BUILD_PLAN Phase 1.
- `support.js` remains excluded (prototype runtime only, per the design README).
