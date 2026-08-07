# WEWE ERP — Phase 2 integration manifest

Additive to Phase 1. Every Phase 1 route and behaviour is intact. Read alongside `README.md`.

---

## New routes

| Route | Screen |
|---|---|
| `/requisitions/:ref` | Transaction detail — binds ANY ref in `TXNS` |
| `/documents/view?id=<name>` | Document viewer — binds the document named in `id` |
| `/auth/2fa` | Two-step verification enrolment (3 steps) |
| `/auth/reset` | Forgot / reset password (4 states) |
| `/auth/setup` | First-time account setup from invite (3 steps) |
| `/auth/locked` | Sign-in error states — 3 variants |
| `/account/profile` | My profile & security |
| `/account/signature` | Saved-signature setup (draw / type / upload) |
| `/account/notifications` | Notification preferences |
| `/account/delegation` | Delegation — "while I'm away" |
| `/admin/workflow/chain` | Approval chain editor |
| `/admin/forms` | Forms & data capture library |
| `/admin/forms/build` | Form builder |
| `/documents/certificate` | Signature certificate |
| `/sign/external` | External signer standalone view (no app shell) |
| `/print/travel-authority` | Travel Authority, print-ready A4 |
| `/print/purchase-order` | Purchase Order on letterhead |
| `/print/hr-letter` | HR employment/salary confirmation |

`:ref` matches `/^(REQ|ADV|RET|PO)-\d{4}-\d{4}$/`. Route matching **strips the query string**, so `?id=` and `?demo=1` are safe on any route.

## Panels and modals (no route)

| Surface | Trigger |
|---|---|
| Notification centre | Bell in the top bar |
| Decision drawer — approve / return / reject | Detail action panel, queue row actions |
| Bulk-approve modal | Queue → *Bulk approve* |
| Fulfilment / goods received | Approved transaction → *Record what was received* |
| Signing ceremony | E-signature row → *Sign* |
| Document upload | Repository → *+ Upload documents* |
| Chain sandbox test | Chain editor → *Test in sandbox* |

---

## Integration hooks

Two mechanisms. Both fall back to a neutral toast when the handler is absent, so the bundle still demos standalone.

### 1. Approval actions — `window.__weweAct`

```js
window.__weweAct = (ref, verb, note) => { /* verb: 'approve' | 'return' | 'reject' */ };
```

Called by the decision drawer and by queue row Approve / Return / Reject.
- `approve` — note optional, may be `''`
- `return` / `reject` — note guaranteed non-empty and ≥ 8 characters; confirm is disabled until then

### 2. Everything else — `window.__wewe<Action>(payload)`

Each returns an optional string used as the toast; throwing surfaces "the server rejected it. Nothing was saved."

| Handler | Payload | Fired by |
|---|---|---|
| `__weweCreateRequisition` | `{purpose, budgetLine, lines, totalKobo}` | New requisition → Submit |
| `__weweSaveRequisitionDraft` | `{purpose, lines}` | New requisition → Save as draft |
| `__weweSubmitPayroll` | `{period}` | Payroll → Send for approval |
| `__weweSubmitTimesheet` | `{rows}` | Timesheet → Submit |
| `__weweApplyLegalHold` | `{documents:[name]}` | Repository → Apply legal hold |
| `__weweUploadDocuments` | `{name, mime, dataBase64, folderId, confidential, ocr}` — **one call per file** | Repository → Upload |
| `__weweSettleRefund` | `{retirementId, refundSettledRef, method}` — method ∈ `CASH`\|`BANK_TRANSFER`\|`SALARY_DEDUCTION` | Retirement variance |
| `__weweCreateStaff` | `{name, email, roles:[code]}` | HR → Add staff member |
| `__weweStartOnboarding` | `{userId}` | Onboarding |
| `__weweSendRfq` | `{title}` (min 3 chars) | Procurement → Create RFQ |
| `__weweStartAssetVerification` | `{location}` | Assets |
| `__weweCreateDonor` | `{code, donor, title, currency, valueMinor}` — code `^[A-Z0-9][A-Z0-9-]*$`, value in minor units | Grants → Add a donor |
| `__weweSignDocument` | `{requestId, method}` — method ∈ `drawn`\|`typed`\|`saved` | Signing ceremony |
| `__weweSaveWorkflowChain` | `{code, name, refPrefix, stages:[{role, minAmountKobo?, slaHours?}]}` — role is the enum code | Chain editor |
| `__wewePublishRole` | `{roleCode, grants:[{module, action, scope}]}` | Roles → Publish changes |
| `__weweSaveReport` | `{name, columns:[apiField]}` | Report builder → Save |
| `__weweEnrol2fa` | `{code}` — the entered 6-digit TOTP | 2FA enrolment |
| `__weweStartDelegation` | `{delegateId, startsAt, endsAt}` | Delegation |
| `__weweCancelDelegation` | `{id}` | Delegation → Cancel now |
| `__weweExport` | `{}` | Any export |

**Awaiting a backend route — hooks fire, fallback toast stands:** `EmailPayslip`, `RaiseRemittancePayment`, `CreateObjective`, `CreateRole`, `SaveForm`, `PublishForm`, `SignOutOtherSessions`, `SaveSignature`, `CreateEvidencePack`.

**Report column names** map to the API set `ref, title, typeCode, status, amountKobo, donorCode, submittedAt, createdAt` via the `api` key on `RB_FIELDS`.

---|---|---|
| `__weweCreateRequisition` | `{purpose, budgetLine, lines, totalKobo}` | New requisition → Submit |
| `__weweSaveRequisitionDraft` | `{purpose, lines}` | New requisition → Save as draft |
| `__weweSubmitPayroll` | `{period}` | Payroll → Send for approval |
| `__weweSubmitTimesheet` | `{rows}` | Timesheet → Submit |
| `__weweUploadDocuments` | `{folder, confidential, ocr}` | Repository → Upload |
| `__weweCreateEvidencePack` | `{documents}` | Repository → Add to evidence pack |
| `__weweApplyLegalHold` | `{documents}` | Repository → Apply legal hold |
| `__weweSignDocument` | `{method}` | Signing ceremony |
| `__weweCreateStaff` | `{}` | HR → Add staff member |
| `__weweSendRfq` | `{vendors}` | Procurement → Send RFQ |
| `__weweCreateDonor` | `{}` | Grants → Add a donor |
| `__weweSaveForm` / `__wewePublishForm` | `{fields, mapTo}` | Form builder |
| `__weweSaveWorkflowChain` | `{type}` | Chain editor → Save version |
| `__weweCreateRole` / `__wewePublishRole` | `{}` | Roles |
| `__weweStartDelegation` / `__weweCancelDelegation` | `{to}` | Delegation |
| `__weweSettleRefund` | `{method}` | Retirement variance |
| `__weweSaveReport` | `{groupBy}` | Report builder |
| `__weweEmailPayslip` | `{staff}` | Payslip → Email |
| `__weweRaiseRemittancePayment` | `{authority}` | Remittances |
| `__weweStartAssetVerification` | `{}` | Assets |
| `__weweStartOnboarding` | `{tasks}` | Onboarding |
| `__weweCreateObjective` | `{weight}` | Appraisal |
| `__weweEnrol2fa` / `__weweSignOutOtherSessions` / `__weweSaveSignature` | `{}` | Account |
| `__weweExport` | `{}` | Any export |

---

## Data consts

Existing, read unchanged: `TXNS`, `VENDORS`, `ASSETS`, `LEAVE`, `USERS`, `FINDINGS`, `GRANTS`, `BUDGET_ROWS`, `AUDIT_LOG`, `INV_ITEMS`, `QB_EXCEPTIONS`, `DASH`, `PAGE_SPECS`, `PAYROLL`, `DOCS`.

**New in Phase 2** — substitute these the same way:

| Const | Shape | Feeds |
|---|---|---|
| `TXN_DETAIL` | `{ [ref]: { budgetLine, allocated, committed, lines:[[desc,qty,unitKobo]], docs:[[name,size]], comments:[[who,body,when,tone]] } }` | Transaction detail. A ref absent from this map is synthesised from its `TXNS` row, so partial coverage is safe. `tone` ∈ `green`\|`amber`\|`neutral`. |
| `DMS_TREE` | `{label, count, depth}` | Repository folder tree |
| `DMS_CLASSES` | `{label, n}` | Repository class facet |
| `DMS_DOCS` | `{name, folder, cls, size, ver, when, conf, hold, ocr, linked, signed}` | Repository table **and the document viewer** |
| `DMS_ACCESS` | `{who, act, when, ext}` | Recent access table |
| `NOTIFICATIONS` | `{id, kind:'action'\|'update', title, body, when, unread, to}` | Notification centre |
| `SESSIONS_MINE` | `{device, where, ip, last, current}` | Active sessions |
| `DELEGATIONS_MINE` | `{to, title, from, until, scope, state, used}` | Past delegations |
| `NOTIF_PREFS` | `{cat, note, mode:'instant'\|'digest'\|'off', locked}` | Notification preferences |
| `BACKUP_CODES` | `string[]` (10) | 2FA backup-code sheet |
| `CHAIN_TYPES` | `{ [type]: [{role, min, sla, note}] }` — `min` naira, `sla` hours | Chain editor. `min:0` = always applies. |
| `CHAIN_VERSIONS` | `{v, when, who, note, live}` | Chain version history |
| `BULK_QUEUE` | `{ref, title, amount, ok, reason}` | Bulk-approve eligibility |
| `FULFIL_LINES` | `{desc, ordered, state:'full'\|'part'\|'none', got}` | Goods received |
| `OB_LINES` | `{line, amount, avail, warn}` | Over-budget line check |
| `CERT_SIGNERS` | `{name, role, method, verified, when, ip, done}` | Certificate signatory table |
| `DEPT_HEAD` / `STAGE_ACTOR` | `{[dept]: name}` / `string[5]` | Tracker actors |
| `FORM_LIST`, `FIELD_TYPES`, `START_FIELDS` | see source | Form builder |
| `ONB_TASKS`, `RFQ_VENDORS`, `TEMPLATE_LINES`, `RB_FIELDS` | see source | Dialogs and report builder |

---

## Derived values — do not hardcode over these

These now compute from the collections, so sparse live data reads correctly:

- Register headline — `TXNS.length` and the summed amount
- Reports headline — same source
- Payroll "Showing *n* of *m*" — `PAYROLL.length`
- Sidebar badges — pending `TXNS` at the signed-in role's stage
- Dashboard activity feed refs — first pending `TXNS`
- Repository counts — the filtered `DMS_DOCS` set
- Requisition detail, budget bar, approval route — all from the record

## Empty states

Present on the requisitions register (wording varies by tab), the generic `PAGE_SPECS` tables, the repository, and the new-requisition line editor. They fire off `.length === 0`, so they appear automatically under sparse data.

## Demo affordances

- **Persona switcher** — chevron and panel render only when the URL carries `?demo=1`. Without it the avatar shows the signed-in user's real job title and is inert.
- **2FA / external OTP** — real 6-digit numeric inputs; Confirm is disabled until all six digits are entered. Verification itself is server-side.
- No toast asserts a specific outcome that did not happen; unwired actions say "Submitted." / "Saved."

## Notes for wiring

1. **Detail page** — substituting `TXNS` alone makes every ref render. Add `TXN_DETAIL` entries where real line items exist.
2. **Tracker** — derived from `txn.stage` (0–4, ≥5 complete) and `txn.status` (`pending`\|`returned`\|`approved`\|`rejected`). Action buttons render only for `pending`.
3. **QR codes** are deterministic placeholder matrices, not real encoders. Swap in a QR library and pass `otpauthUri` / the verify URL.
4. **Signature pads** are `<canvas>` with a pointer handler; the ceremony records which method was used and the certificate prints it.
5. **External signer** renders as a full-viewport layer above the shell. In production it should be a separate route outside the authenticated layout.
6. **Printables** are fixed 794px sheets (A4 at 96dpi); they print as-is with no separate stylesheet.
