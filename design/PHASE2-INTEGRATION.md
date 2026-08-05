# WEWE ERP — Phase 2 integration manifest

Additive to Phase 1. Every existing route and behaviour is intact; the only rewrite is the transaction detail page, which now binds to the route parameter instead of fixtures.

---

## New routes

| Route | Screen | Item |
|---|---|---|
| `/requisitions/:ref` | Transaction detail — binds ANY ref | **G20** |
| `/auth/2fa` | Two-step verification enrolment (3 steps) | **G1** |
| `/auth/reset` | Forgot / reset password (4 states) | **G2** |
| `/auth/setup` | First-time account setup from invite (3 steps) | **G3** |
| `/auth/locked` | Sign-in error states — 3 variants | **G4** |
| `/account/profile` | My profile & security | **G6** |
| `/account/signature` | Saved-signature setup (draw / type / upload) | **G7** |
| `/account/notifications` | Notification preferences | **G8** |
| `/account/delegation` | Delegation — "while I'm away" | **G9** |
| `/admin/workflow/chain` | Approval chain editor | **G10** |
| `/documents/certificate` | Signature certificate | **G15** |
| `/sign/external` | External signer standalone view (no app shell) | **G16** |
| `/print/travel-authority` | Travel Authority, print-ready A4 | **G17** |
| `/print/purchase-order` | Purchase Order on letterhead | **G18** |
| `/print/hr-letter` | HR employment/salary confirmation | **G19** |

`:ref` matches `/^(REQ|ADV|RET|PO)-\d{4}-\d{4}$/`. Any ref present in `TXNS` renders; unknown refs fall through to the normal not-found state.

## New panels and modals (no route)

| Surface | Trigger | Item |
|---|---|---|
| Notification centre | Bell in the top bar | **G5** |
| Decision drawer — approve / return / reject | Detail action panel, queue row actions | **G21** |
| Bulk-approve modal | Queue → *Bulk approve* | **G11** |
| Fulfilment / goods-received | Approved transaction → *Record what was received* | **G12** |
| Signing ceremony | E-signature row → *Sign* | **G14** |
| Chain sandbox test | Chain editor → *Test in sandbox* | **G10** |

## Data-driven states (no new route)

| State | Where | Item |
|---|---|---|
| Over-budget **warn** and **block** | `/requisitions/new` — budget-check table + banners | **G13** |

Both variants are driven by `OB_LINES` plus an in-page switcher so reviewers can see each; in production the variant follows the data (warn when a line has partial headroom, block when the award has no uncommitted balance).

---

## New consts to substitute at boot

| Const | Shape | Feeds |
|---|---|---|
| `TXN_DETAIL` | `{ [ref]: { budgetLine, allocated, committed, lines:[[desc, qty, unitKobo]], docs:[[name, size]], comments:[[who, body, when, tone]] } }` | Transaction detail. Any ref **absent** from this map is synthesised from its `TXNS` row, so partial coverage is safe. `tone` ∈ `green` \| `amber` \| `neutral`. |
| `NOTIFICATIONS` | `{ id, kind:'action'\|'update', title, body, when, unread, to }` | Notification centre. `to` is a route. |
| `SESSIONS_MINE` | `{ device, where, ip, last, current }` | Active sessions table |
| `DELEGATIONS_MINE` | `{ to, title, from, until, scope, state, used }` | Past delegations |
| `NOTIF_PREFS` | `{ cat, note, mode:'instant'\|'digest'\|'off', locked }` | Notification preferences. `locked:true` = always instant. |
| `BACKUP_CODES` | `string[]` (10) | 2FA backup-code sheet |
| `CHAIN_TYPES` | `{ [type]: [{ role, min, sla, note }] }` — `min` in naira, `sla` in hours | Chain editor. `min:0` = stage always applies. |
| `CHAIN_VERSIONS` | `{ v, when, who, note, live }` | Chain version history |
| `BULK_QUEUE` | `{ ref, title, amount, ok, reason }` | Bulk-approve eligibility. `ok:false` + `reason` renders as excluded. |
| `FULFIL_LINES` | `{ desc, ordered, state:'full'\|'part'\|'none', got }` | Goods-received per line |
| `OB_LINES` | `{ line, amount, avail, warn }` | Over-budget line check |
| `CERT_SIGNERS` | `{ name, role, method, verified, when, ip, done }` | Certificate signatory table |
| `DEPT_HEAD` | `{ [dept]: name }` | Stage-2 actor on the tracker |
| `STAGE_ACTOR` | `string[5]`, `'DEPT_HEAD'` resolves via `DEPT_HEAD` | Tracker actors |

Existing consts still read unchanged: `TXNS`, `VENDORS`, `ASSETS`, `LEAVE`, `USERS`, `FINDINGS`, `GRANTS`, `BUDGET_ROWS`, `AUDIT_LOG`, `INV_ITEMS`, `QB_EXCEPTIONS`, `DASH`, `PAGE_SPECS`.

---

## Integration hook — `window.__weweAct`

```js
window.__weweAct = (ref, verb, note) => { /* verb: 'approve' | 'return' | 'reject' */ };
```

Called by the decision drawer on confirm, and by queue row Approve / Return / Reject. When the function is absent the prototype falls back to its own toast, so the bundle still demos standalone.

- `approve` — note optional, may be `''`
- `return` / `reject` — note guaranteed non-empty and ≥ 8 characters; the confirm button is disabled until then, matching the engine's mandatory-note rule.

Confirm copy always restates the ref and the verb ("Return REQ-2026-0187", "Reject PO-2026-0064").

---

## Notes for wiring

1. **Detail page** — `TXNS` substitution alone is enough to make every ref render. Add `TXN_DETAIL` entries where the backend has real line items, documents and comments; anything missing is generated from the row so no ref 404s.
2. **Tracker** — derived from `txn.stage` (0–4, ≥5 = complete) and `txn.status` (`pending` \| `returned` \| `approved` \| `rejected`). Action buttons render only for `pending`.
3. **QR codes** — the 2FA and certificate/printable QR codes are deterministic **placeholder matrices** generated from a seed string, not real encoders. Swap in a QR library and pass `otpauthUri` / the verify URL.
4. **Signature pads** — `<canvas>` with a pointer-event drawing handler. Replace with the codebase's signature component if one exists; the ceremony records which method was used and the certificate prints it.
5. **External signer view** renders as a full-viewport layer above the shell, so it reads as a separate page. In production it should be a genuinely separate route outside the authenticated layout.
6. **Printables** are fixed 794px sheets (A4 at 96dpi) with 64px margins. They print as-is; no separate print stylesheet is needed.
7. New admin sub-nav entries were added under Administration (Approval chain editor) and Documents (Signature certificate, External signer view, Printable documents) so every new surface is reachable by clicking.
