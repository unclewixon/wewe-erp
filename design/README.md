# Handoff: WEWE ERP — Widows and Orphans Empowerment Organisation

## What is in this bundle

| File | What it is |
|---|---|
| `WEWE ERP.dc.html` | The complete design prototype — every screen, dialog and interaction described below |
| `WEWE ERP Walkthrough Deck.dc.html` | 34-slide presentation deck for the leadership and staff handover, with speaker notes on every slide |
| `PHASE2-INTEGRATION.md` | Machine-facing manifest: routes, data-const shapes, and the full `window.__wewe*` hook contract |
| `shots/` | Screenshots of the live system used by the deck, plus `login-bg.jpg` for the sign-in screen |
| `support.js` | Prototype runtime. **Not part of the design** — required only so the HTML opens in a browser |
| `deck-stage.js` | Slide-deck runtime for the walkthrough deck. Also not part of the design |
| `README.md` | This document |

### Running them
Open either `.dc.html` in a browser; the two `.js` files and `shots/` must sit beside them. The prototype navigates by hash (`WEWE ERP.dc.html#/admin/roles`) and opens on a sign-in screen — click through to reach the app. Append `?demo=1` to enable the persona switcher. The deck runs full-screen with arrow-key navigation, a thumbnail rail, and speaker notes.

---

## Overview

A complete internal ERP for WEWE, a Nigerian NGO managing donor-funded programmes. It replaces a paper approval chain with a five-stage digital workflow covering requisitions, cash advances and retirements, budgets, procurement, inventory, fixed assets, HR, payroll, timesheets, donor grants, audit, reporting, forms, e-signature and administration.

The organising principle: **every transaction is visible from initiation to final approval, and every figure traces back to a record**. Counts and totals derive from the underlying collections rather than being written into the markup, so a queue badge, a stat card, a tab label and a table always agree. Treat a mismatch as a bug.

Tagline used on the sign-in screen: *"One approval chain. Five stages. Zero paper."*

---

## About the design files

These are **design references created in HTML** — a working prototype demonstrating intended look, layout and behaviour. **They are not production code to copy directly.**

Recreate these designs in the target codebase's existing environment (React, Vue, Angular, SwiftUI, native) using its established component library, routing, state management and styling conventions.

- Authored as a single-file component with **inline styles only**. Do not replicate that — use the target codebase's styling system.
- All data is **fixture data in named module constants**. Replace with real API calls; `PHASE2-INTEGRATION.md` lists every const name and shape.
- Uses a **hash router**. Use the target codebase's router. Route matching strips the query string, so `?id=` and `?demo=1` are safe anywhere.

**Fidelity: high.** Final colours, typography, spacing, states and interaction behaviour.

---

## Design tokens

### Colour

| Token | Hex | Use |
|---|---|---|
| Accent / primary | `#E0572E` | Primary buttons, active nav, selected states, focus rings |
| Accent hover | `#C8481F` | Primary button hover |
| Accent link | `#D9532B` | Link default |
| Accent link hover | `#B23F1D` | Link hover, secondary emphasis |
| Ink | `#1A1D21` | Headings, primary text, dark surfaces |
| Body text | `#3B3B3B` | Default body copy |
| Muted text | `#6B7280` | Secondary copy |
| Subtle text | `#8A8F98` | Subtitles, captions |
| Faint text | `#9AA0A8` | Table headings, helper text |
| Disabled text | `#C4C8CE` / `#B9BDC4` | Placeholder, disabled labels |
| App background | `#E4E5E8` | Page canvas |
| Surface | `#FFFFFF` | Cards, panels, dialogs |
| Surface alt | `#FAFBFC` | Card footers, group headers |
| Zebra stripe | `#F8F9FA` | Odd table rows |
| Row hover | `#F1F3F5` | Table row hover |
| Input fill | `#F7F8FA` | Form fields, inert chips |
| Chip grey | `#F3F4F5` | Neutral pills |
| Border | `#E3E5E8` | Inputs, buttons, cards |
| Divider | `#EEF0F3` | Section rules |
| Divider light | `#F4F5F7` | Row separators |

**Sign-in screen only** — a warm palette distinct from the app shell: cream panel `#F5F1EA`, field fill `#EFEAE1`, field border `#DFD6C9`, rule `#E4DCD1`, muted text `#8A8177`, footer text `#9A9086`.

**Status colours** — always a tinted background with a darker foreground:

| Status | Background | Foreground |
|---|---|---|
| Success / approved | `rgba(30,142,62,.10)` | `#166F31` (solid `#1E8E3E`) |
| Warning / due soon | `rgba(180,83,9,.12)` | `#8A4B0B` (solid `#B45309`) |
| Danger / overdue | `rgba(194,65,12,.10)` | `#9C3309` (solid `#C2410C`) |
| Info / in progress | `rgba(110,158,201,.18)` | `#2C5C86` (solid `#6E9EC9`) |
| Neutral | `#F3F4F5` | `#6B7280` |

Banner variants pair a tinted fill with a 1px border: success `#EAF4EC` / `#CFE6D6`; warning `#FFF7ED` / `#FDE3C4`; danger `#FBEAE4` / `#F3D6CB`.

Brand accents, share buttons only: WhatsApp `#25D366`, Facebook `#1877F2`, X `#1A1D21`.

### Dark mode

Toggled via `data-wewe="dark"` on the root, driven by a "Dark" control in the sidebar.

| Role | Hex |
|---|---|
| Canvas | `#0C0E11` |
| Surface | `#16191D` |
| Surface alt | `#1A1E22` |
| Input / chip | `#21262C` |
| Raised chip | `#262C33` |
| Body text | `#C3C7CD` |
| Strong text | `#EDEEF0` |
| Muted text | `#6B727B` |
| Border | `#33383F` |
| Link | `#F0805C`, hover `#FF9D7D` |

In the prototype this is attribute-scoped overrides keyed off literal inline background values — **a prototype workaround**. In production use CSS custom properties or the codebase's theming system.

### Typography

`"Google Sans", "Google Sans Text", Figtree, system-ui, sans-serif`. Figtree (400/500/600/700) loads from Google Fonts as fallback.

| Role | Size | Weight | Notes |
|---|---|---|---|
| Page title | 24px | 600 | `letter-spacing:-.01em` |
| Dialog title | 20px | 600 | |
| Large metric | 34px | 600 | `letter-spacing:-.02em`, tabular numerals |
| Stat value | 24px | 600 | tabular numerals |
| Section title | 15px | 600 | |
| Panel title | 14px | 600 | |
| Page subtitle | 14px | 400 | colour `#8A8F98` |
| Body / table cell | 13px | 400–500 | |
| Secondary cell | 12px | 400 | colour `#6B7280` |
| Table heading | 11px | 600 | uppercase, `letter-spacing:.07em`, colour `#9AA0A8` |
| Dense table heading | 9px | 700 | uppercase — permission matrix only |
| Status pill | 10px | 700 | uppercase |
| Helper text | 11px | 400 | colour `#9AA0A8` |
| Printable body | 12px | 400 | `line-height:1.85` |
| Printable label | 9px | 700 | uppercase, `letter-spacing:.08em` |

**Rules:** every numeric column uses `font-variant-numeric: tabular-nums`. Currency is always full-precision Naira — `₦1,250,000.00`, held in kobo. Dates are `DD/MM/YYYY`. Long prose uses `text-wrap: pretty`.

### Spacing, radius, elevation

- Spacing scale: 4 / 5 / 6 / 8 / 10 / 12 / 14 / 16 / 18 / 20 / 22 / 24 / 28px
- Radius: 5–6px small pills · 8–9px buttons and inputs · 10–12px large inputs and inline panels · 14px banners · 16px cards · 18px dialogs · 999px chips, avatars, toggles
- Card shadow: `0 1px 2px rgba(16,24,40,.04), 0 6px 18px rgba(16,24,40,.05)`
- Dialog shadow: `0 32px 64px rgba(16,24,40,.24)`
- Drawer shadow: `-20px 0 48px rgba(16,24,40,.18)`
- Document / paper shadow: `0 1px 3px rgba(16,24,40,.10), 0 12px 30px rgba(16,24,40,.08)`
- Selection ring: `inset 0 0 0 1.5px #E0572E`

### Control sizes

| Control | Height |
|---|---|
| Page action button | 40px |
| Dialog action button | 42px |
| Form input / select | 42px (44px on auth screens) |
| Compact button / filter | 34px |
| Row action button | 28px |
| Status pill | 22–24px |
| Permission cell button | 26 × 26px |
| Toggle switch | 38 × 22px (18px knob) |
| OTP entry | full width × 64px, `letter-spacing:.34em` |
| Avatar | 24 / 28 / 30 / 52px |

### Motion

```
wewePulse   2s infinite      expanding accent ring on the current workflow step
weweRise    180ms ease-out   dialog and drawer entry (opacity + 6px translateY)
weweSweep   width 0 → 100%   progress fills
weweShimmer opacity .5 → 1 → .5   loading placeholders
```
Hover transitions: `140ms ease-out`.

---

## Application shell

Fixed-height viewport shell; sidebar and content column scroll **independently** — the page itself never scrolls.

```
┌──────────────────────────────────────────────────────────┐
│  outer: height:100vh; overflow:hidden;                   │
│  min-width:1360px; max-width:1658px; margin:0 auto;      │
│  background:#E4E5E8; padding:16px; display:flex; gap:8px │
│  ┌────────────┬───────────────────────────────────────┐  │
│  │ Sidebar    │ Top bar (search, bell, + New, avatar) │  │
│  │ 282px      ├───────────────────────────────────────┤  │
│  │ flex:none  │ Content — overflow-y:auto             │  │
│  │ own scroll │ max-width 1320px, padding-bottom 24px │  │
│  └────────────┴───────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

- **Minimum supported width is 1360px.** Verify all layout at that width.
- Sidebar `width:282px; height:100%`, own `overflow-y:auto`.
- Content column `flex:1; min-width:0; height:100%; min-height:0`, own `overflow-y:auto; overflow-x:hidden`, capped at 1320px. Printables are 794px sheets and ignore the cap.

### Sign-in

Full-bleed two-column layout outside the app shell — no card, no visible container. Left is the cream form panel; right carries a photograph that **fades into the panel via a mask on the image itself**, not an overlay scrim. The image is deliberately oversized (`left:-55%; width:155%`) with a horizontal `mask-image` running transparent → opaque, so its own pixels dissolve and no hard edge appears at any boundary. Wordmark, form and footer share a single 398px measure, centred as one block.

### Sidebar

Brand mark, then nav groups with uppercase 11px labels: Transactions · Money · Operations · People · Governance · System. Each module row shows icon, label and an optional count badge **derived from pending items at the signed-in role's stage**. Below: "Signed in as", a Dark toggle, Sign out.

| Group | Module | Route |
|---|---|---|
| Transactions | Dashboard | `/dashboard` |
| Transactions | Requisitions | `/requisitions` |
| Transactions | Advances & Retirement | `/advances` |
| Money | Budgets | `/budgets` |
| Money | Payroll | `/payroll` |
| Money | QuickBooks | `/quickbooks` |
| Operations | Procurement | `/procurement` |
| Operations | Inventory & stores | `/inventory` |
| Operations | Fixed Assets | `/assets` |
| Operations | Documents & E-sign | `/documents` |
| People | Human Resources | `/hr` |
| People | Timesheets | `/timesheets` |
| Governance | Donors & Grants | `/grants` |
| Governance | Audit & Compliance | `/audit` |
| Governance | Reports | `/reports` |
| System | Administration | `/admin` |

Sub-navigation appears under the active module — full list in `PHASE2-INTEGRATION.md`.

**Personal routes** (profile menu): `/account/profile` · `/account/signature` · `/account/notifications` · `/account/delegation`
**Auth routes** (outside the shell in production): `/auth/2fa` · `/auth/reset` · `/auth/setup` · `/auth/locked`

### Top bar

Search, spacer, **notification bell** (44px, unread badge), **+ New** pill opening a quick-create chooser of eight flows, then the avatar. The avatar shows the signed-in user's real job title; the **persona switcher only appears with `?demo=1`**.

### Personas (demo only)

| Persona | Name | Title |
|---|---|---|
| Initiator | Ngozi Okafor | Programme Officer · Programmes |
| Supervisor | Tunde Balogun | Head, Programmes |
| Internal Audit | Chiamaka Eze | Internal Audit Officer |
| Finance | Ibrahim Musa | Finance Manager |
| Final Approver | Folake Adeyemi | Managing Director |
| HR Officer | Blessing Adeyemi | Human Resources Officer |
| Procurement | Emeka Nwosu | Procurement Officer |
| System Admin | Segun Ola | System Administrator |

---

## Standard patterns

**Stat card** — white, `border-radius:16px; padding:20px` + card shadow. 13px/500 label; 24px/600 value, tabular numerals; 12px context line. `repeat(auto-fit, minmax(220px,1fr))`, `gap:12px`.

**Table card** — white, `border-radius:16px`, `overflow:hidden`. Header block `padding:20px 24px 14px`. Column header row: CSS Grid, `padding:0 24px 8px`, 11px/600 uppercase, `border-bottom:1px solid #EEF0F3`. Body rows: same grid template, `padding:14px 24px`, zebra `#F8F9FA`, hover `#F1F3F5`. Optional footer on `#FAFBFC`.

> **Tables are CSS Grid, not `<table>`.** Header and body must declare the *same* `grid-template-columns`. Numeric and action columns fixed px; the descriptive column `minmax(<min>, 1fr)`. Every text cell in a fixed track needs `min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap`. **Verify at 1360px** — and measure *rendered text width against its track*, not just `scrollWidth`; centred text in an `overflow:visible` cell overflows without changing `scrollWidth`.

**Status pill** — `height:22px; padding:0 9px; border-radius:6px`, 10px/700 uppercase, tinted background + darker foreground.

**Workflow tracker** — complete: 26px green circle with a tick. Current: 26px accent circle, `animation:wewePulse 2s infinite`. Future: 26px white circle, `2px solid #D3D6DB`. Connectors 2px — green when passed, `#EAECEF` when not.

**Section banner** — `padding:14px 18px; border-radius:14px`, 8px status dot, 13px/500 message, optional right-aligned action.

**Wizard stepper** — clickable both directions plus Back/Continue.

**Empty state** — centred, `padding:52–56px 24px`, 15px/600 title and a 13px explanation of what will appear and how to create the first one. Present on the register (wording varies by tab), the generic spec tables, the repository, and the line-item editor.

**Printable sheet** — `width:794px; padding:56px 64px`, document shadow. Letterhead: 44px accent logo square, 16px/700 name, 10px address, closed by a `3px solid #E0572E` rule. Verify QR 78px top-right. Signature blocks are a 1px rule with a 10px caption.

---

## Screens

### Dashboard `/dashboard`
Role-aware. Stat cards, approval queue, bottleneck ranking, charts. The approvals-cleared-vs-submissions chart is a **smooth wave/area chart**, not bars. Queue rows and activity-feed refs are data-driven and open their record.

### Requisitions
- **`/requisitions`** — register with tabs All / Mine / Awaiting me / Returned, each count derived. Headline reads the collection length and summed value.
- **`/requisitions/queue`** — approval queue, oldest first, row actions **Approve · Return · Open**, header **Bulk approve**.
- **`/requisitions/new`** — **starts clean**: no purpose, one blank line, ₦0.00, "New requisition · nothing entered yet". Line items are real inputs; row totals, grand total, budget check and approval route all recalculate per keystroke. The route greys out stages the amount doesn't trigger (under ₦250,000 skips Internal Audit; under ₦1,000,000 skips the MD) and reads "*n* of 5 stages at ₦*x*". Submission is disabled while any line lacks a description, quantity or unit cost. Budget panel flips green/amber with the exact shortfall and a virement link.
- **`/requisitions/:ref`** — detail bound to the route parameter. Status pill, tracker with per-stage actor and timestamp, line items, history timeline, decision panel (only while pending), a **Fulfilment** card once approved, budget impact, documents.
- **`/requisitions/templates`** — **Use · Edit · Copy** open the template with real line items and its attached form.

### Advances & Retirement
`/advances`, `/advances/new`, `/advances/travel`; `/advances/retire` shows the variance panel with **Record refund settlement**; `/advances/outstanding` ages every advance against the 14-day policy.

### Budgets
`/budgets`, `/budgets/import` (**Re-upload file** opens the validate dialog), `/budgets/virements`, `/budgets/versions`.

### Payroll
`/payroll` with **Send for approval**; `/payroll/payslips` rows **View · PDF · Email**; `/payroll/remittances` rows **View · Export**. "Showing *n* of *m*" derives from the collection.

### QuickBooks
`/quickbooks`, `/quickbooks/mapping`, `/quickbooks/exceptions` with repost.

### Procurement
`/procurement` · `/procurement/vendors` · `/procurement/rfq` · `/procurement/po` · `/procurement/contracts`.

### Inventory & stores
`/inventory` with level bars against reorder points and **Issue · Receive**; `/inventory/log` with every movement written out in full; `/inventory/grn` · `/inventory/issues` · `/inventory/counts`.

### Fixed Assets
`/assets` · `/assets/verification` · `/assets/depreciation` · transfers · disposals.

### Documents & E-sign
- **`/documents` — the repository.** Four stat cards (documents held, pages OCR'd, confidential, under legal hold). Left rail: a **12-node folder tree** with counts, an **8-class facet**, a digitisation progress panel, and links onward. Table columns: checkbox, document (class and size beneath), folder, version, linked transaction, OCR confidence, updated, and CONF / HOLD / SIGNED marks. **Live search** across name, folder and reference. **Multi-select** drives a bar with Add to evidence pack, Apply legal hold and Download. **+ Upload documents** opens a purpose-built dialog: drop zone, destination folder prefilled from the browsed folder, document class (sets the retention rule), optional transaction link, and Mark-confidential / Run-OCR toggles — the confidential toggle warns that such documents are hidden from the External Auditor and blocked from public forms. Below the table, a **Recent access** log with EXTERNAL / Staff badges.
- **`/documents/view?id=<name>`** — viewer bound to the clicked document: breadcrumb, name, class, size, version, date and OCR all follow the id. Page thumbnail rail with the current page ringed, page nav, zoom, in-document search reporting hit position with the match highlighted, Download / Print / Share. Right rail: details with legal hold, who can open it, version history, access activity.
- **`/documents/esign`** — open requests with signatory order; rows **Sign · Certificate**.
- **`/documents/certificate`** — letterhead, verify QR, signatory table (name, role, method, identity verified by, timestamp, IP), SHA-256 hash with a **Hash matches / HASH MISMATCH** state.
- **`/sign/external`** — standalone, no app shell: email one-time-code gate → document review with the signer's field highlighted → signing pad → done, plus the used/expired-link state.
- **`/documents/retention`**

### Human Resources
`/hr` (**Add staff member** includes a required next-of-kin section) · `/hr/staff` · `/hr/leave` · `/hr/onboarding` · `/hr/contracts` · **`/hr/appraisals`** — weighted score and band in the header, four-stage sign-off tracker, and tabs for objectives (editable supervisor ratings recalculating score, band and colour), competencies (self vs supervisor 5-segment bars with evidence), development plan, and cycle progress.

### Timesheets
`/timesheets` — editable grid, hours recalculating effort per keystroke, an 11-option grant picker on added rows, locked auto-filled leave, and submission blocked with the exact gap until hours total the period and every row has a grant. `/timesheets/approvals` · `/timesheets/loe`.

### Donors & Grants
`/grants` (**+ Add a donor** — a three-step wizard opening as a draft) · `/grants/reports` · `/grants/calendar` · `/grants/programmes`.

### Audit & Compliance
`/audit` · `/audit/findings` · `/audit/log` · `/audit/evidence` · `/admin/activity`.

### Reports
`/reports` · **`/reports/builder`** — four-step wizard: columns as chips with a live ordered list, filters including a minimum-amount selector that genuinely re-filters, group and sort, then a live preview in a horizontally scrollable region with a 1160px minimum. `/reports/pipeline` · `/reports/scheduled`.

### Administration
- **`/admin/roles`** — 14 roles; **permission matrix of 57 modules × 7 actions** with tri-state column toggles and per-row scope; assignment and effective-permissions resolver; **11 SOD rules (8 blocking)** and 9 sensitivity sets; draft-vs-published change log.
  > At 1360px the action tracks are 58px and the 9px/700 headings measure ≤52px. Do not narrow below 58px without shortening labels.
- **`/admin/forms`** and **`/admin/forms/build`** — 13-type field palette, live preview where each field renders as its real control, per-field settings, mapping onto any record with field-to-record wiring, three distribution channels (in-app, email invitation, public link with working share intents and QR), and a responses table.
- **`/admin/workflow/chain`** — five transaction types, five stage cards with role / threshold / SLA, version history, and a sandbox test showing which stages a given value visits.
- `/admin` · `/admin/org` · `/admin/reference` · `/admin/activity`

### Authentication & personal
`/auth/setup` · `/auth/2fa` (QR, **real 6-digit entry** gated until complete, 10 backup codes) · `/auth/reset` · `/auth/locked` (three distinct states) · `/account/profile` (sessions with sign-out-everywhere) · `/account/signature` · `/account/notifications` (locked always-instant categories) · `/account/delegation` (self and chain both blocked with the rule named).

### Printables
`/print/travel-authority` · `/print/purchase-order` · `/print/hr-letter` — A4 sheets on letterhead with approval evidence, signature blocks and a verify QR.

---

## Dialogs

All: white, `border-radius:18px`, `padding:28px`, dialog shadow, `weweRise` entry, right-aligned Cancel + primary. Tall ones use `max-height:88vh; overflow-y:auto` with sticky header and footer.

**Principle: no generic confirm dialogs.** Every action opens something specific — a document, a real form, or a decision with its consequences spelled out. Where an action would only ever produce a confirmation, it shows a labelled toast.

Purpose-built dialogs cover: the decision drawer (mandatory note for return/reject, confirm disabled under 8 characters), quick create, bulk approve with per-item eligibility and a results state, fulfilment, the signing ceremony, payslip and its email, remittance schedule, template, store issue docket, reverse issue, chase return, issue and receive stock, refund settlement, add staff, onboarding, RFQ (blocks below three vendors), asset verification, new role, payroll approval, new objective (weights must total 100%), add donor, share form, document upload, chain sandbox test, publish role changes, view-as, and export.

### Toasts
Neutral by default — "Submitted.", "Saved." — never asserting an outcome that did not happen. When an integration hook is present its return string is used instead; a throwing handler reports that nothing was saved.

---

## Interactions & behaviour

**Live recalculation** — must not be faked:
- Requisition line items → row totals, grand total, budget state, approval route, submit enablement
- Timesheet hours → effort %, allocated-vs-expected, submit enablement
- Appraisal ratings → weighted score, band, colour
- Report builder chips and filters → preview, row count, header
- Form builder palette → live preview and field count
- Permission cells and column toggles → matrix state
- KPI weight, stock quantity, goods received, fulfilment state, bulk selection, decision note length

**Validation blocks the action *and* explains it in place**: a disabled primary button carrying the reason ("Submit blocked — 6 h unallocated", "Needs three vendors", "Not enough stock", "Weight exceeds 100%", "A note is required", "Enter all 6 digits", "Complete every line first") next to a banner giving the rule and the remedy.

**Selection** — `inset 0 0 0 1.5px #E0572E` on `#F5F6F8`; radio-style options use a 16px accent dot with a 3px white inset ring.

---

## State management

| Area | State |
|---|---|
| Shell | route, persona/role, dark mode, sub-nav, dialog (kind + payload), drawer, toast, notification panel, notifications read |
| Requisitions | active tab, selected rows; new-form purpose, budget line, line array |
| Detail | derived entirely from the route ref — no local copy |
| Decision drawer | note text (gates confirm) |
| Documents | folder, class, search, multi-select; upload confidential + OCR flags |
| Timesheets | hour matrix, row project assignment, submitted flag |
| Appraisals | tab, per-objective scores, sign-off flags |
| Roles | selected role, tab, permission overrides, sensitivity toggles, resolver subject |
| Report builder | step, columns, minimum amount, grouping, saved flag |
| Form builder | tab, field array, selected field, channel, mapping target |
| Chain editor | transaction type, selected stage |
| Auth | 2FA step, OTP digits, reset step, setup step |
| Account | signature tab, per-category preference, delegate, delegation active |
| E-signature | ceremony step and method, external step and OTP, hash result |

**Derive counts once.** Register and reports headlines, payroll "Showing *n* of *m*", sidebar badges, repository counts and dashboard feed refs all read the collections. Do not reintroduce literals.

---

## Assets

Iconography is inline 24×24 stroked SVG (`stroke-width:1.6` nav, `2.6–3` status marks). Avatars are initials on `#EBEDF0`. Signatures are a single stroked path. QR codes are **deterministic placeholder matrices** with correct finder squares — swap in a real encoder. `shots/` holds the deck screenshots plus `login-bg.jpg`, which must be served at that path. The only external dependency is Figtree from Google Fonts.

---

## The walkthrough deck

34 slides at 1920×1080 with a full presenter transcript in the speaker notes of every slide. Title and why → agenda → six numbered sections → close. Section dividers are full-bleed accent with an oversized numeral; module slides pair a screenshot with a commentary column; assurance and hero slides run on near-black `#12100F`.

Deck-specific conventions, distinct from the app: warm off-white `#F4F3F1` module slides; **minimum type size 24px** (verified, zero text below it); body 24–25px, card headings 26–29px, section titles 52–58px, hero 104–112px. The approval chain is a chevron flow; the audit trail a hash-chain diagram with a pulsing "Chain intact ✓"; the permission matrix is drawn natively at slide scale with **Approve** shown blocked by SOD-01 rather than shrinking a screenshot. Exports cleanly to PPTX or PDF.

---

## Implementation notes

1. **Build the shell first** — fixed-height, independently scrolling sidebar and content.
2. **Build the table primitive second.** Make column definitions data-driven (label, width, alignment, cell renderer, status tone) so screens become configuration.
3. **Then the status pill, stat card, workflow tracker, wizard stepper, empty state and dialog shell** — these six cover most of the remaining surface.
4. **Verify at 1360px throughout,** measuring rendered text against its grid track.
5. **Do not ship generic confirm dialogs**, and do not let a toast claim something that did not happen.
6. **Keep the numbers derived.** Where a figure appears twice, compute it once.
7. **Mandatory notes are a workflow rule** — return and reject must be impossible without one, at every entry point.
8. **Auth and external-signer screens belong outside the authenticated layout** in production, even though the prototype renders them inside the shell so they are reachable for review.
9. **Grep before naming.** Dialog `kind` strings and renderVals keys share one namespace; a duplicate silently renders two dialogs at once.
