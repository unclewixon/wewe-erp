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
11. ~~Bulk-approve confirmation modal (the queue page has the button; the modal flow is unbuilt).~~ **CLOSED** — Phase 2 built it (selection bar → "Approve all" → "Approve N items?" → "Approve selected"), and it now writes to the engine. Two follow-ups in item 24.
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
20. ~~Transaction detail page is hard-bound to the fixture ref `REQ-2026-0187`.~~ **CLOSED** (Phase 2 + serve-time transform, ticket T-00). Verified 06/08/2026: live refs open from the register and render their own lines, history and tracker.
21. ~~Return/Reject are visual no-ops pending the comment drawer.~~ **CLOSED** (Phase 2 delivered G21). Verified 06/08/2026: the decision drawer is bound, the note is mandatory, and both verbs write to the engine. The remaining problem is not the binding but the *failure* path — see item 25.

**Discovered during the requisition-module production review** — issued to Design as `docs/CLAUDE_DESIGN_PHASE3_REQUEST.md`.

**Status after Phase 1.10 (verified live):** items 22, 23, 24, 25, 25a and 26 are **CLOSED** — withdraw, fix-and-resubmit, the permission-driven panel, the bulk count, honest write failures, and the column hints all work end to end. Still open: **27** (sign-in fields are literals) and the second half of **25b**, now restated as **28** below. Current asks live in `docs/CLAUDE_DESIGN_OPEN_GAPS.md`.

**Root cause behind 22 and 23:** the detail page's `Your decision` panel infers the viewer's role from the transaction's current *stage* rather than reading the `permissions` object the API returns on every requisition. It therefore offers the current stage's actions to whoever is looking — including the initiator — and never offers initiator-side actions to anyone. Evidence captured against the running deployment in `docs/design-requests/`.

22. **No Withdraw control on a requisition.** The engine supports it (`POST /v1/transactions/:id/withdraw`, initiator-only, verified working) and the detail payload returns `permissions.canWithdraw: true`, but no button exists anywhere in the requisition flow. The only "Withdraw and edit" in the bundle belongs to timesheets. An initiator cannot pull back their own pending requisition. Worse, on that same screen the panel offers them **Approve / Return / Reject** on a requisition they raised — an action that is never legitimate for them (the engine refuses it, correctly).
23. **No Resubmit control on a returned requisition.** `POST /v1/transactions/:id/resubmit` works and `permissions.canResubmit: true` is returned, but a RETURNED requisition tells its own initiator *"No decision is open to you."* This breaks the return loop: a supervisor returns with a note, the note displays correctly, and the one person who must act on it has no control to do so. Needed on the detail page whenever `canResubmit` is true.
24. **Bulk confirm reports the wrong count.** `confirmBulk` clears `selected` in the same `setState` it then reads for the toast, so the message always reads "0 items approved in one action." even on a successful run. The write itself is now live via the integration bridge; only the count in the copy is wrong.
25a. **15 confirmation handlers claim a write with no integration seam.** Found auditing every write surface in the bundle: `ap2Approve`, `ap2Return`, `apSignHrDo`, `apSignSupDo`, `chDo`, `confirmApprove`, `confirmBulk`, `confirmDlgFilter`, `confirmDlgUpload`, `confirmSign`, `onApprove`, `qbRepostAll`, `shareSend`, `tplCopy`, `tplSave` call `this.toast(...)` directly instead of routing through `hook()`. Integration has nothing to attach to, so these can never be made real without a design change. The claims are specific — `qbRepostAll` announces "3 journals created, ₦1,048,000.00 now in QuickBooks"; `ap2Approve` announces an advance approved and the budget line committed. This is the systemic form of item 25 and the largest single item in the Phase 3 request.

25b. **Approval surfaces exist only for requisitions.** Advances, retirements, virements and purchase orders run the same five-stage engine through the same `/v1/transactions/:id/action` endpoint, but the bundle has one `Your decision` panel (requisitions). Advances have Approve/Return buttons that are two of the seamless toasts in 25a; retirements, virements and POs have no approval surface at all. The panel needs to become a reusable, permission-driven component.

26. **Phase 1.7's new `api:` column hints point at wrong fields.** `Initiator → createdAt` and `Department → typeCode` do not exist on the list row (both null); `Current stage → status` returns the status, not the stage. Correct values: `initiator`, `department`, `currentStage`/`stageRole`.

27. **The sign-in form has no inputs a person can type into.** The email and password fields are fixed literals with no binding and no `onChange` — `<input value="n.okafor@wewe.org.ng" />` and a password of literal dot characters — so React renders them read-only. The 2FA screen likewise hardcodes `n.okafor@wewe.org.ng` in its copy regardless of who is signing in. There is also no hook on either screen, so nothing on the sign-in path can reach the engine. Integration currently works around this by replacing the two nodes with clones at runtime (dropping React's listeners so they accept text) and intercepting the buttons — it works, but it is a workaround on rendered output, not wiring. **Needed:** bound fields with `onChange`, the signed-in identity taken from data rather than hardcoded, and a `SignIn` hook (payload `{email, password}`) plus a `Verify2fa` hook (`{code}`) so the credential check can be a real one. The engine side is complete already: argon2, progressive lockout, per-IP throttle, neutral failure messages, and TOTP when enrolled.

28. **Retirements and virements can be raised but never approved.** They are engine transaction types (`RET`, `VIR`) running the same five-stage chain through `/v1/transactions/:id/action`, but the bundle carries no approve/return control for either, so they stall at their first stage permanently. Advances are half-solved: `ap2Approve`/`ap2Return` reach the engine as of 1.10, but they sit in a fixed dialog rather than the permission-driven panel, so the controls show whether or not the viewer may act. **Correction:** an earlier version of this item also listed purchase orders. That was wrong — `PURCHASE_ORDER` is not a transaction type. The engine runs ADVANCE, ASSET_DISPOSAL, DOC_DISPOSAL, LEAVE, PAYROLL, REQUISITION, RETIREMENT, TIMESHEET and VIREMENT; a PO is issued from an already-awarded RFQ and needs no separate approval.

31. ~~**Vendor blacklist and reinstate have no control.**~~ **WRONG — it shipped with the P1 batch in Phase 1.12 and is now wired.** The bundle carries the full flow: per-row Blacklist/Reinstate that switches on vendor state, a dialog naming the vendor and stating the restriction and audit consequence, a reason gated at 10 characters, and — on the award screen — a BLOCKED pill that refuses selection before the click rather than after. Verified live: blacklist and reinstate both write, a short reason is refused, and an Initiator is refused with the engine's role message.

**How the error happened, since it affects how these audits are run:** every "which hooks exist" scan in this engagement matched `this.hook('Name'` — a literal first argument. Blacklisting is dispatched under a computed name (`const name = mode === 'blacklist' ? 'BlacklistVendor' : 'UnblacklistVendor'`), so it was invisible to the scan while being plainly present in the file. A re-scan for non-literal call sites found exactly one — this pair — so nothing else was hidden, but the scan now checks for both forms. Original text:

31-old. **Vendor blacklist and reinstate have no control.** The engine enforces both with a mandatory written reason and restricts them to Finance / Internal Audit / Admin, and a blacklisted vendor cannot win an award. Nothing in the bundle can trigger either, so a vendor that fails due diligence cannot be stopped from the UI. Last item outstanding from the procurement brief.

30. ~~**Two Phase 1.11 procurement payloads cannot be satisfied.**~~ **CLOSED by Phase 1.12** — `RecordContractPayment` now carries `amountKobo` and is wired. `SavePurchaseOrderDraft` remains answered with a refusal: the engine has no draft state for a purchase order, since a PO is generated from an awarded RFQ. Original text:

30-old. **Two Phase 1.11 procurement payloads cannot be satisfied.** `RecordContractPayment` sends only a contract reference with no amount, so there is nothing to post — the engine takes `{amountKobo, note?}`. `SavePurchaseOrderDraft` has no counterpart at all: a PO is generated from an awarded RFQ and the engine holds no draft state for one. Both are answered with a refusal rather than left undefined, so the design shows its failure state instead of announcing work that never happened. Still outstanding from the procurement brief: contract creation and amendment, vendor blacklist/reinstate, and the bank-details propose/confirm/reject trio.

29. ~~**The procurement module has one write control for the entire module.**~~ **CLOSED by Phase 1.11** — CreateVendor, RecordDueDiligence, AddQuote, AwardQuote, CreatePurchaseOrder and RecordGoodsReceipt all landed and are wired. The spine runs end to end: vendor, due diligence, RFQ, quotes, award, purchase order, goods receipt. Original text:

29-old. **The procurement module has one write control for the entire module.** The engine side is complete and tested end to end — vendors with dual-control bank details, blacklisting, RFQs, quotes, the quote-count threshold band with a sole-source path, award with a mandatory written justification, PO generation from the awarded RFQ, a printable PO, goods receipts, and contracts with payments and amendments. The bundle emits exactly one procurement hook, `SendRfq`, which is now wired. There is no control anywhere that adds a quote, awards a winning quote, raises the PO, records a goods receipt, registers or blacklists a vendor, or creates a contract — so none of that can be reached from the UI. Procurement reads are all live (vendor registry, RFQ comparison, purchase orders, contracts).

~~28-old. Retirements, virements and purchase orders can be raised but never approved.~~ They run the same five-stage engine through the same `/v1/transactions/:id/action` endpoint, but the bundle carries no approve/return control for any of them, so they stall at their first stage permanently. Advances are half-solved: `ap2Approve`/`ap2Return` reach the engine as of 1.10, but they sit in a fixed dialog rather than the permission-driven panel, so the controls show whether or not the viewer may act.

32. ~~**A budget version cannot be published from the UI.**~~ **CLOSED by Phase 1.14** — `ActivateBudgetVersion` landed and is wired. Version history now renders live versions with an Activate chip on any that is not already live; clicking it activates and the live version moves. Original text:

32-old. **A budget version cannot be published from the UI.** The engine exposes `POST /v1/budgets/versions/{id}/activate` and it works — Finance can activate, an Initiator is refused, and activating twice is refused. Version history carries a "Publish version 5" button, but its confirm handler is bound to `PublishRole`, the roles-and-permissions publish, not to the budget version. So a version can be built and saved from the builder and then never made live. Needs its own hook, e.g. `PublishBudgetVersion { versionId }`.

33. ~~**Raising a virement has no hook.**~~ **CLOSED by Phase 1.14** — `CreateVirement` landed and is wired; raising one writes and routes FINANCE → FINAL_APPROVER. Original text:

33-old. **Raising a virement has no hook.** Both controls exist — "Request virement" on the budget overview and "New virement" on the virement register — and the engine is complete: `POST /v1/virements` with source, destination, amount and reason, routed FINANCE → FINAL_APPROVER, refusing a same-line transfer, a zero amount, and anything beyond the source line's available balance. Neither control fires a hook or matches the generic label matcher, so nothing can reach it. Needs `CreateVirement { sourceLineId, destLineId, amountKobo, reason?, submit? }`.

34. ~~**`SubmitBudget` promises a route the money never takes.**~~ **CLOSED by Phase 1.14** — the copy now reads "Saved as a new budget version. Activate it from Version history to make it live", which is what actually happens. Original text:

34-old. **`SubmitBudget` promises a route the money never takes.** Its copy reads "Budget submitted to Finance, then the Managing Director", but there is no budget approval chain — the engine's nine transaction types do not include one, and submitting can only create a version. Integration deliberately does not repeat that sentence; it reports what actually happened and points at Version history. Either the chain should exist as a transaction type, or the copy should describe saving a version.

35. **`UploadBudget` — design side done, engine side missing.** Phase 1.14 now sends `{ fiscalYear, name, mime, dataBase64 }`, so nothing further is needed from Design. It stays refused because **we** have no budget-import endpoint to receive it. Ours to build, not theirs. Original text:

35-old. **`UploadBudget` carries no file.** The payload is `{ fiscalYear }` only, and there is no import endpoint on the engine, so "Budget file uploaded — validation running" describes nothing. Answered with a refusal rather than left to announce it. Needs both a real file payload (as `UploadDocuments` already does with `{name, mime, dataBase64}`) and an import endpoint.

**Closed by Phase 1.7 (no further design work):** payload gaps that previously blocked wiring — `UploadDocuments` (file bytes), `StartDelegation`/`CancelDelegation` (ids + dates), `SendRfq` (title), `SignDocument` (request id), `SaveWorkflowChain` (stage config), `StartAssetVerification` (location), `PublishRole` (roleCode + grants), `SaveReport` (name + columns). These are now integration work on our side.

**Backend gaps, not design:** no endpoint exists for `RaiseRemittancePayment`, `StartOnboarding`, `CreateRole`, `CreateObjective`, `SignOutOtherSessions`, `SaveSignature`, `SaveForm`, `PublishForm`, or per-payslip `EmailPayslip`.

25. **`act()` announces success even when the engine refuses.** The design's `act()` toasts `"<ref> — <verb> submitted."` unconditionally, ignoring the hook's return value and swallowing its throw. A rejected write (wrong stage, missing note, insufficient permission) is therefore reported to the approver as if it succeeded. The hook returns `false` and logs the reason; the design needs to honour that and surface an error state.

## Design exceeds the feature spec (adopt into the build plan)

- **Inventory & stores module** (GRN, issues, counts, movement log) — not in Features Spec v1.1; added to BUILD_PLAN Phase 6 as INV-01…04 (spec addendum needed).
- **Form builder** (`/admin/forms`) — generalises WFE-10's "form template reference"; adopt.
- **Dark mode** — shipped in the design despite being deferred in the master prompt; adopt (tokens exist in design/README.md).
- Persona set is 9 roles (adds Procurement Officer and External Auditor as first-class personas) — matches spec intent; adopt.

## Build-side consequences (recorded, in progress)

- The Phase-1 web UI committed in this repo was built from the design *tokens* before the verbatim rule was declared. It is functionally correct but **interim**: each screen is to be replaced by a verbatim port of the corresponding design markup, wired to the real API. Tracked in BUILD_PLAN Phase 1.
- `support.js` remains excluded (prototype runtime only, per the design README).
