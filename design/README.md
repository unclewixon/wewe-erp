# Handoff: WEWE ERP — Widows and Orphans Empowerment Organisation

## What is in this bundle

| File | What it is |
|---|---|
| `WEWE ERP.dc.html` | The complete design prototype — every screen, dialog and interaction described below |
| `WEWE ERP Walkthrough Deck.dc.html` | 34-slide presentation deck for the leadership and staff handover, with speaker notes on every slide |
| `PHASE2-INTEGRATION.md` | Machine-facing manifest: Phase 2 routes, data-const shapes, and the `window.__weweAct` contract |
| `shots/` | Screenshots of the live system used by the deck, plus the sign-in photograph |
| `support.js` | Prototype runtime. **Not part of the design** — required only so the HTML opens in a browser |
| `deck-stage.js` | Slide-deck runtime for the walkthrough deck. Also not part of the design |
| `README.md` | This document |

### Running them
Open either `.dc.html` in a browser; the two `.js` files and `shots/` must sit beside them. The prototype navigates by hash (`WEWE ERP.dc.html#/admin/roles`) and opens on a sign-in splash — click through it to reach the app. The deck runs full-screen with arrow-key navigation, a thumbnail rail, and speaker notes.

---

## Overview

A complete internal ERP for WEWE, a Nigerian NGO managing donor-funded programmes. It replaces a paper approval chain with a five-stage digital workflow covering requisitions, cash advances and retirements, budgets, procurement, inventory, fixed assets, HR, payroll, timesheets, donor grants, audit, reporting, forms, e-signature and administration.

The organising principle: **every transaction is visible from initiation to final approval, and every figure traces back to a record**. Numbers reconcile across screens — a queue badge, a stat card, a tab count and a table all read from the same source. Expect internal consistency and treat a mismatch as a bug.

Tagline used on the sign-in screen: *"One approval chain. Five stages. Zero paper."*

This bundle covers **Phase 1 and Phase 2**. Phase 2 added authentication and personal-settings screens, a workflow chain editor, the e-signature suite, printable documents, and bound the transaction detail page to its route parameter.

---

## About the design files

These are **design references created in HTML** — a working prototype demonstrating intended look, layout and behaviour. **They are not production code to copy directly.**

Recreate these designs in the target codebase's existing environment (React, Vue, Angular, SwiftUI, native) using its established component library, routing, state management and styling conventions. If no environment exists yet, choose the most appropriate framework and implement there.

- The prototype is authored as a single-file component with **inline styles only**. Do not replicate that — use the target codebase's styling system.
- All data is **hard-coded fixture data** in named module constants. Replace with real API calls; `PHASE2-INTEGRATION.md` lists the const names and shapes.
- The prototype uses a **hash router**. Use the target codebase's router.

**Fidelity: high.** Final colours, typography, spacing, states and interaction behaviour. Recreate pixel-perfectly using existing libraries where equivalents exist; match the specified values where they do not.

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

In the prototype dark mode is attribute-scoped overrides keyed off literal inline background values — **a prototype workaround only**. In production use CSS custom properties or the codebase's theming system.

### Typography

`"Google Sans", "Google Sans Text", Figtree, system-ui, sans-serif`. Figtree (400/500/600/700) loads from Google Fonts as the fallback; Google Sans is preferred where licensed.

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

**Rules:** every numeric column uses `font-variant-numeric: tabular-nums`. Currency is always full-precision Naira — `₦1,250,000.00`. Dates are `DD/MM/YYYY`. Long prose uses `text-wrap: pretty`.

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
| OTP digit box | 52 × 60px |
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

- **Minimum supported width is 1360px.** Verify all layout at that width, not just at a wide viewport.
- Sidebar `width:282px; height:100%; padding:8px 10px 12px`, own `overflow-y:auto`, thin scrollbar.
- Content column `flex:1; min-width:0; height:100%; min-height:0`, own `overflow-y:auto; overflow-x:hidden`, capped at `max-width:1320px`, left-aligned. Printable documents are 794px sheets and ignore the cap.

### Sign-in

Full-bleed two-column layout outside the app shell — no card, no visible container. Left column is the cream form panel; right column carries a photograph that **fades into the panel via a mask on the image itself**, not an overlay scrim. The image is deliberately oversized (`left:-55%; width:155%`) with a horizontal `mask-image` running transparent → opaque, so its own pixels dissolve and no hard edge can appear at any boundary. Wordmark, form and footer share a single 398px measure, centred as one block in the panel.

### Sidebar

Brand mark, then nav groups with uppercase 11px group labels: Transactions · Money · Operations · People · Governance · System. Each module row shows icon, label and optional count badge; the active row uses the accent treatment. Below: "Signed in as" block, a Dark toggle, Sign out.

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
| System | Design system | `/design-system` |

Sub-navigation appears under the active module:

- **Requisitions** — All `/requisitions` · Awaiting me `/requisitions/queue` · New `/requisitions/new` · Templates `/requisitions/templates`
- **Advances** — Register `/advances` · New cash advance `/advances/new` · Travel authorisation `/advances/travel` · Retirement `/advances/retire` · Outstanding `/advances/outstanding`
- **Budgets** — Overview `/budgets` · Import & validation `/budgets/import` · Virements `/budgets/virements` · Versions `/budgets/versions`
- **Payroll** — Run `/payroll` · Payslips `/payroll/payslips` · Remittances `/payroll/remittances`
- **QuickBooks** — Console `/quickbooks` · Account mapping `/quickbooks/mapping` · Exception queue `/quickbooks/exceptions`
- **Procurement** — Registry `/procurement` · Vendor register `/procurement/vendors` · RFQs `/procurement/rfq` · Purchase orders `/procurement/po` · Contracts `/procurement/contracts`
- **Inventory** — Stock on hand `/inventory` · Activity log `/inventory/log` · Goods received `/inventory/grn` · Issues `/inventory/issues` · Counts `/inventory/counts`
- **Fixed Assets** — Register `/assets` · Verification `/assets/verification` · Depreciation `/assets/depreciation` · Transfers `/assets/transfers` · Disposals `/assets/disposals`
- **Documents** — Repository `/documents` · Viewer `/documents/view` · E-signature `/documents/esign` · Certificate `/documents/certificate` · External signer `/sign/external` · Printables `/print/travel-authority` · Retention `/documents/retention`
- **HR** — Directory `/hr` · Staff record `/hr/staff` · Leave `/hr/leave` · Onboarding `/hr/onboarding` · Appraisals `/hr/appraisals` · Contracts `/hr/contracts`
- **Timesheets** — My timesheet `/timesheets` · Approvals `/timesheets/approvals` · Level of effort `/timesheets/loe`
- **Grants** — Grants `/grants` · Donor reports `/grants/reports` · Calendar `/grants/calendar` · Programme dashboards `/grants/programmes`
- **Audit** — Review queue `/audit` · Findings `/audit/findings` · Audit log `/audit/log` · User activity `/admin/activity` · Evidence packs `/audit/evidence`
- **Reports** — Library `/reports` · Custom builder `/reports/builder` · Pipeline `/reports/pipeline` · Scheduled `/reports/scheduled`
- **Administration** — Users `/admin` · Roles & permissions `/admin/roles` · Forms `/admin/forms` · Form builder `/admin/forms/build` · User activity `/admin/activity` · Organisation structure `/admin/org` · Workflow configuration `/admin/workflow` · Approval chain editor `/admin/workflow/chain` · Reference data `/admin/reference` · Policy settings `/admin/policies`

**Personal routes** (profile menu, not module nav): `/account/profile` · `/account/signature` · `/account/notifications` · `/account/delegation`
**Auth routes** (outside the shell in production): `/auth/2fa` · `/auth/reset` · `/auth/setup` · `/auth/locked`

### Top bar

Search field, spacer, **notification bell** (44px circle with unread count badge), **+ New** primary pill (44px, `border-radius:999px`) opening a quick-create chooser of eight flows, then avatar + persona switcher.

### Persona switching

Eight personas so reviewers can see role-scoped navigation; each hides modules it has no rights to. In production navigation derives from the signed-in user's role.

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

**Stat card** — white, `border-radius:16px; padding:20px` + card shadow. 13px/500 `#8A8F98` label; 24px/600 value, tabular numerals; 12px `#9AA0A8` context line. Laid out `repeat(auto-fit, minmax(220px,1fr))`, `gap:12px`.

**Table card** — white, `border-radius:16px`, `overflow:hidden`. Header block `padding:20px 24px 14px` with title, 12px subtitle, optional right-aligned search or link. Column header row: CSS Grid, `padding:0 24px 8px`, 11px/600 uppercase labels, `border-bottom:1px solid #EEF0F3`. Body rows: same grid template, `padding:14px 24px`, zebra `#F8F9FA` on odd rows, hover `#F1F3F5`. Optional footer strip on `#FAFBFC`.

> **Tables are CSS Grid, not `<table>`.** Header and body rows must declare the *same* `grid-template-columns`. Numeric and action columns fixed px; the descriptive column `minmax(<min>, 1fr)`. Every text cell in a fixed track needs `min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap` or it will overlap its neighbour. **Verify at 1360px** — and check *rendered text width against its track*, not just `scrollWidth`, since centred text in an `overflow:visible` cell overflows without changing `scrollWidth`.

**Status pill** — `height:22px; padding:0 9px; border-radius:6px`, 10px/700 uppercase, tinted background + darker foreground. Where a tick or cross helps, an 11–12px stroked SVG at `stroke-width:2.6–3`.

**Workflow tracker** — horizontal steps. Complete: 26px green circle with a tick. Current: 26px accent circle with the step number, `animation:wewePulse 2s infinite`. Future: 26px white circle, `2px solid #D3D6DB`, grey number. Connectors are 2px rules — green when passed, `#EAECEF` when not.

**Section banner** — `padding:14px 18px; border-radius:14px`, 8px status dot, 13px/500 message, optional right-aligned action. Used to explain a blocked state.

**Wizard stepper** — clickable both directions plus Back/Continue. Done steps show a tick, current pulses, future outlined.

**Printable sheet** — `width:794px; padding:56px 64px` on white with the document shadow. Letterhead: 44px accent logo square, organisation name 16px/700, address and registration at 10px, closed by a `3px solid #E0572E` rule. Verify QR at 78px top-right. Signature blocks are a 1px ink rule with a 10px caption beneath.

---

## Screens

### Dashboard `/dashboard`
Role-aware landing page. Stat cards for the signed-in role, an approval queue list, a bottleneck ranking, and charts. The approvals-cleared-vs-submissions chart is a **smooth wave/area chart**, not bars. Queue rows open the transaction.

### Requisitions
- **`/requisitions`** — 214 transactions. Tabs: All (214) · Mine (38) · Awaiting me (6) · Returned (3).
- **`/requisitions/queue`** — Finance queue, oldest first. 6 items worth ₦7,761,500.00, oldest waited 4d 2h. Columns: Reference (104px) · Item (`minmax(130px,1fr)`) · Amount (116px, right) · Waiting (84px, right) · SLA (112px) · actions (188px). Row actions **Approve · Return · Open**; header action **Bulk approve**.
- **`/requisitions/new`** — creation form with the over-budget budget-check table and warn/block variants.
- **`/requisitions/:ref`** — transaction detail bound to the route parameter. Header: title, status pill (`At <stage>` / Returned / Approved and closed / Rejected), ref, initiator, department, donor chip, overdue chip, total with budget line. Five-stage tracker with per-stage actor, timestamp, elapsed time. Left: line items with totals, transaction history as an avatar timeline. Right: decision panel (Approve / Return for correction / Reject, only while pending, plus Open comments), a **Fulfilment** card on approved transactions, budget impact with a headroom bar, documents.
- **`/requisitions/templates`** — 8 templates. Row actions **Use · Edit · Copy** open the template with real line items, typical total, and its **attached form**.

### Advances & Retirement
`/advances`, `/advances/new`, `/advances/travel`; **`/advances/retire`** shows a variance panel with the refund due and **Record refund settlement**; **`/advances/outstanding`** ages every advance against the 14-day policy (₦3,847,000.00 outstanding, ₦1,268,000.00 overdue, 2 staff blocked).

### Budgets
`/budgets` overview, `/budgets/import`, `/budgets/virements`, `/budgets/versions`.

### Payroll
- **`/payroll`** — 47 staff, ₦18,432,600.00 gross, ₦14,067,842.00 net. **Send for approval** opens the payroll approval dialog.
- **`/payroll/payslips`** — row actions **View · PDF · Email**.
- **`/payroll/remittances`** — PAYE ₦2,841,000.00 · pension ₦1,515,200.00 across 4 PFAs · NHF ₦378,800.00, due 10/09/2026. Row actions **View · Export** (or **Prepare · View**).

### QuickBooks
`/quickbooks` console, `/quickbooks/mapping`, `/quickbooks/exceptions` with repost.

### Procurement
`/procurement` · `/procurement/vendors` (6 vendors, ₦19,750,000.00 spend, one blocked for lapsed screening) · `/procurement/rfq` · `/procurement/po` (7 open orders, ₦11,240,000.00 committed, delivery and three-way-match columns) · `/procurement/contracts`.

### Inventory & stores
- **`/inventory`** — 8 item lines across two stores, level bar against reorder point (red at or below), row actions **Issue · Receive**, banner flagging zero stock and below-reorder items.
- **`/inventory/log`** — every movement in full: who, when, what moved, quantity, prose reason, signed reference. Typed RECEIPT / ISSUE / ADJUST / COUNT. +284 in / −277 out.
- **`/inventory/grn`** · **`/inventory/issues`** (**Docket · Reverse**, or **Return · Docket** / **Return · Chase**) · **`/inventory/counts`**.

### Fixed Assets
`/assets` · `/assets/verification` · `/assets/depreciation` (net book value ₦42,860,000.00, straight-line by class) · transfers · disposals.

### Documents & E-sign
- **`/documents`** — repository; rows open the viewer.
- **`/documents/view`** — page thumbnail rail with the current page ringed, page nav, zoom, in-document search reporting hit position ("2 of 7") with the match highlighted, Download / Print / Share. Right rail: details with OCR confidence and legal hold, who can open it (including a watermarked external auditor), version history, access activity.
- **`/documents/esign`** — open signature requests with signatory order and what each waits on. Row actions **Sign · Certificate**.
- **`/documents/certificate`** — certificate of electronic signature. Letterhead, verify QR, document and execution blocks, signatory table (name, role, method, identity verified by, timestamp, IP), SHA-256 hash. Banner states **Hash matches** or **HASH MISMATCH — do not rely on this document**; *Re-verify hash* toggles between them.
- **`/sign/external`** — standalone external signer, no app shell. Email one-time-code gate → document review with the signer's field highlighted and prior signatures shown → signing pad with identity summary → done state, plus the used/expired-link message.
- **`/documents/retention`**

### Human Resources
- **`/hr`** — directory, 47 staff. **Add staff member** opens the staff dialog with next of kin.
- **`/hr/staff`** — full record: role history, contracts, assets held, transactions.
- **`/hr/leave`** · **`/hr/onboarding`** · **`/hr/contracts`** (renewals keyed to award end dates)
- **`/hr/appraisals`** — weighted score (34px) and band in the header; four-stage sign-off tracker. Tabs: *Objectives & ratings* (supervisor rating is an editable input per row; score, band and colour recalculate live — ≥4.5 Outstanding, ≥4 Exceeds, ≥3 Meets, ≥2 Needs improvement, else Unsatisfactory), *Competencies* (self `#6E9EC9` vs supervisor `#E0572E` as 5-segment bars, evidence per row, DISCUSSED flag on gaps), *Development plan*, *Cycle progress* across 47 staff.

### Timesheets
- **`/timesheets`** — period picker, *Copy last period*, four-stage tracker. **Editable grid**: 5 day columns, every hour cell an input; row hours and effort % recalculate on each keystroke. Add-a-grant appends a row with an 11-option grant picker outlined in accent until chosen; rows removable; leave row locked and auto-filled. Total must equal the 40 expected hours **and** every row must have a grant, or submit is disabled with the exact gap plus an explanatory banner. On submit the tracker advances and offers *Withdraw and edit*. Alongside: team calendar strip and a live per-grant charge breakdown.
- **`/timesheets/approvals`** — 6 submissions. **Approve** charges hours to grants and flips status; **Query** returns it; **Remind** for not-submitted. *Approve all compliant* clears valid ones and holds the one below 100% effort.
- **`/timesheets/loe`**

### Donors & Grants
`/grants` (with **+ Add a donor**) · `/grants/reports` · `/grants/calendar` · `/grants/programmes`.

### Audit & Compliance
`/audit` · `/audit/findings` · `/audit/log` · `/audit/evidence` · `/admin/activity`.

### Reports
- **`/reports`** — library. **Build a report** navigates to the builder.
- **`/reports/builder`** — four-step wizard: **Source & columns** (10 column chips, side panel showing output order, live count), **Filters** (dates, department, donor, and a minimum-amount selector that genuinely re-filters — ₦250,000 → 21 of 24 rows), **Group & sort**, **Preview & save** (live preview from the chosen columns, amounts right-aligned, in a horizontally scrollable region with a 1160px minimum so all ten columns show without clipping the card). *Save and share* confirms it reached the library; *Schedule weekly* alongside.
- **`/reports/pipeline`** · **`/reports/scheduled`**

### Administration

- **`/admin`** · **`/admin/org`** · **`/admin/workflow`** · **`/admin/reference`** · **`/admin/activity`**

- **`/admin/roles` — Roles & permissions.** 296px role list + content column.
  - **Role list** — 14 roles (11 system, 3 custom) with member count, default scope, DRAFT / CUSTOM badges. Selecting one re-renders everything.
  - **Header** — name, unpublished-changes pill, description, meta, *Duplicate · View as… · Publish changes*.
  - **Permission matrix** — **57 modules across 7 groups** × **7 actions** (View, Create, Edit, Submit, Approve, Export, Configure). Grid `minmax(118px,1fr) repeat(7, 58px) 100px`, `column-gap:5px`. Column headings are buttons that **tri-state toggle the whole column**. Cells 26×26px — granted is a filled accent square with a tick, revoked an outlined square. Each row has a scope chip (Own / Department / Organisation) or "Not granted". Footer banner explains the SOD-01 block on Requisitions · Approve.
    > At 1360px the action tracks are 58px and the uppercase 9px/700 headings measure ≤52px. Do not narrow below 58px without shortening labels — "CONFIGURE" will collide with Scope.
  - **Assignment & resolver** — members with per-assignment scope; then the effective-permissions resolver: each permission with scope, *why* it is granted (system role, sensitivity set, or a delegation with expiry) and a note, including explicit "Not granted" rows.
  - **Rules & sensitivity** — **11 segregation-of-duties rules, 8 blocking / 3 warning**, each with id, level, conflicting pair, explanation and affected roles. Delegation constraints (no self-delegation, no chains, max 30 days, blocking rules travel with the delegation) and **9 field-level sensitivity sets** with toggles.
  - **Change log** — draft-vs-published diff and full from→to history with LIVE / DRAFT states.

- **`/admin/forms`** — library of 8 forms: module, what it writes into, field count, responses, channel (IN-APP / EMAIL / PUBLIC LINK), state, **Open · Share**.

- **`/admin/forms/build` — Form builder.** Three-column build view plus four tabs.
  - **Build** — 13-type field palette appending on click; live preview where **every field renders as its real control**, each selectable (accent inset ring), reorderable and removable; right panel settings (label, help text, options, required toggle) plus form rules (partial answers, offline, one response per person, GPS).
  - **Mapping** — attach to any record: requisition template, retirement evidence, vendor register, staff file, findings register, asset campaign, or standalone. Explicit field-to-record mapping (*Actual spend → Retirement amount*; a safeguarding "Yes" opens a finding). Right rail lists who can respond.
  - **Distribution** — **In-app**, **Email invitation** (recipients with group chips, subject, message, timing, reminders), **Public link** (Copy, WhatsApp / Facebook / X, QR download, close date, response limits, plus a warning that sensitivity-set fields are blocked on public forms). Phone preview and an open → start → complete funnel alongside.
  - **Responses** — 186 submissions, each filed against its retirement reference, with a safeguarding column flagging raised findings.

- **`/admin/workflow/chain` — Approval chain editor.** Type chips for five transaction types; five stage cards in a horizontal flow showing role, when it applies, and SLA, selectable to edit. Stage editor: role select, `minAmountKobo` threshold, SLA hours, and a line stating whether the stage is conditional or always applies. Right rail: version history v1–v6 with the live one accented. *Test in sandbox* walks a value through the draft chain showing visited and skipped stages; *Save as version 7*. A standing banner states changes apply to new transactions only.

### Authentication & personal

- **`/auth/setup`** — invite landing. Set password → confirm profile basics (name and department read-only) → account ready, straight into 2FA where the role requires it.
- **`/auth/2fa`** — scan the QR (with hand-entry key, account and issuer, and a warning not to share it) → confirm a six-digit code → one-time backup-code sheet (10 codes, Download / Print / Copy all).
- **`/auth/reset`** — email → check-your-email with code field and resend timer → new password with a live policy checklist → confirmation stating other sessions were signed out.
- **`/auth/locked`** — three states: wrong password with attempts remaining, temporary lock with countdown and doubling delay, and administrator suspension (visually distinct, since waiting will not help).
- **`/account/profile`** — contact details (HR-owned fields greyed), active sessions with per-row sign-out and *Sign out everywhere*, 2FA status card warning only 3 backup codes remain, password age, saved-signature preview.
- **`/account/signature`** — Draw / Type / Upload tabs; the draw pad is a real canvas with a signing line, Type offers two hands, Upload is a drop zone.
- **`/account/notifications`** — 9 categories × Instant / Daily digest / Off. Escalations and audit queries marked ALWAYS INSTANT and locked, with an explainer.
- **`/account/delegation`** — active-delegation banner with Cancel now; setup form with delegate picker, dates (14 of a 30-day maximum), scope and reason. Choosing yourself blocks on SOD-01; choosing someone already delegating onward blocks as a chain.

### Printables

- **`/print/travel-authority`** — TA-2026-0087: traveller, department, destination, dates, funding, linked transaction, purpose, entitlements table totalling ₦796,000.00, four-stage approval chain with names and dates, two signature blocks.
- **`/print/purchase-order`** — PO-2026-0064: supplier and deliver-to blocks, requisition / funding / budget line / payment terms strip, numbered lines with subtotal, 7.5% VAT and total ₦4,798,800.00, five terms, approval-evidence paragraph, signature blocks for WEWE and supplier acceptance.
- **`/print/hr-letter`** — employment and salary confirmation addressed to a bank, merge fields filled from the staff record, staff-member selector above the sheet, signature block, and an issue-log line recording reference, requester, addressee and the sensitivity set under which salary data was released.

All three share a tab strip and Print / Download PDF actions.

---

## Dialogs, drawers and panels

All dialogs: white, `border-radius:18px`, `padding:28px`, dialog shadow, `animation:weweRise 180ms ease-out`, right-aligned Cancel (outlined) + primary (accent). Tall ones use `max-height:88vh; overflow-y:auto` with sticky header and footer.

**Principle: no generic confirm dialogs.** Every action opens something specific — a document, a real form, or a decision with its consequences spelled out. Where an action would only ever produce a confirmation, it shows a labelled toast instead.

| Surface | Trigger | Contents |
|---|---|---|
| **Notification centre** | Bell | Right panel, 420px. "Needs my action" and "Updates" sections, unread dots, Mark all read, per-item deep link |
| **Decision drawer** | Detail panel and queue rows | Ref / item / amount / current stage, then a note field — **mandatory for return and reject** (confirm disabled under 8 characters with the reason shown), optional for approve. Consequence panel per verb; confirm restates ref + verb |
| **Quick create** | **+ New** | Eight things you can create, each routing to its real flow |
| **Bulk approve** | Queue → *Bulk approve* | Selected-items table with per-item eligibility, excluded rows greyed with reasons, running count and total, one shared note, single confirm — then a results state (*n* approved, *m* skipped and why) |
| **Fulfilment** | Approved transaction | Per-line Received in full / Partial / Not yet, live got-vs-ordered, delivery note, date, proof upload. Partial keeps the PO open with the balance stated; full closes it and releases the invoice for three-way match |
| **Signing ceremony** | E-signature row → *Sign* | Read the document with a certification statement → method (saved / draw on canvas / type) with the field highlighted → confirmation restating name, capacity, method, time, identity verification and IP |
| **Payslip** | Payslip row **View** | The actual payslip — letterhead, employee and payment block, earnings split (basic 50% / housing 25% / transport 15% / utility 10%), deductions (PAYE, pension 8%, NHF 2.5% of basic), net pay on an ink panel, employer contributions, Jan–Aug year-to-date totals, all derived from the row |
| **Email payslip** | Payslip row **Email** | Recipient from the staff record, password protection, sensitivity-set logging note |
| **Remittance schedule** | Remittance row **View** | Authority, type, staff covered, average per staff, employee/employer split, total, nominal-roll note |
| **Template** | Template row **Use / Edit / Copy** | Real line items and total, the attached form, plus mode-specific fields |
| **Store issue docket** | Issue row **Docket** | Printable stores issue voucher with both signature lines |
| **Reverse issue** | Issue row **Reverse** | Reason select, note, warning that the original stays in the log |
| **Chase return** | Overdue issue **Chase** | Recipient chain and a pre-written message; second chase escalates to Internal Audit |
| **Issue stock** | Inventory **Issue** | Quantity, recipient, optional transaction to charge, purpose, return expectation. Shows what it leaves on hand and warns below reorder; over-issue disables the button |
| **Receive stock** | Inventory **Receive** | Ordered / delivered / accepted against a PO. Partial leaves it open with the balance; full closes it and releases the invoice |
| **Record refund settlement** | Retirement variance | Advance vs actual with the refund owed, three settlement routes; bank transfer asks for a reference, salary deduction warns it comes off next net pay |
| **Add staff member** | HR | Identity, job, reporting line, contract, dates, grade, funding, system role — plus a required **Next of kin** section (name, relationship, two phones, address, email, benefit share, second next-of-kin option) |
| **Start onboarding** | Onboarding | New joiner, start date, 9-task checklist with owners and due offsets, buddy |
| **Raise RFQ** | Procurement | Source requisition, closing date, award criterion, vendor selection — **blocks below three vendors** and flags lapsed due diligence |
| **Asset verification campaign** | Assets | Scope, deadline, required evidence, reminders, who will be notified |
| **New role** | Roles list | Name, purpose, start-from template, default scope, note that blocking SOD rules always apply |
| **Payroll approval** | Payroll | Gross-to-net breakdown, pre-flight checks, two-signature rule |
| **New objective & KPI** | Appraisal | Objective, measurement type, data source, target, deadline, weight — **weights must total 100%**, over-allocating blocks with the overshoot |
| **Add a donor** | Grants | Donor identity → award (reference, value, period, reporting frequency, indirect rate, cost rules, agreement) → budget lines + manager. Opens as a draft until Finance confirms the budget reconciles |
| **Share form** | Form library **Share** | Public link with Copy, WhatsApp / Facebook / X, QR, plus email invitation with group chips |
| **Chain sandbox test** | Chain editor | Type and value, then the route under the draft chain showing visited and skipped stages with total SLA |
| **Publish role changes** | Roles header | Diff of pending changes with a version bump |
| **View as** | Roles header | Member picker starting a read-only session |
| **Export** | Any Export / PDF / Print | Format and scope options |

### Toasts
For actions whose only outcome is confirmation. They state the specific result, never a generic acknowledgement — e.g. *"ISS-2026-0413 · 12 × A4 photocopy paper issued. 52 left on hand. Docket printed for signature."*

---

## Interactions & behaviour

**Navigation** — hash routing; sidebar and sub-nav drive it; breadcrumbs on nested screens; table rows, queue items and notifications open their record.

**Live recalculation** — these recalculate on every keystroke and must not be faked:
- Timesheet hour cells → row totals, effort %, allocated-vs-expected, submit enablement
- Appraisal supervisor ratings → weighted score, band, band colour
- Report builder chips and filters → preview table, row count, header summary
- Form builder palette and settings → live preview and field count
- Permission cells and column toggles → matrix state
- KPI weight → cycle total and submit enablement
- Stock issue quantity → remaining on hand and submit enablement
- Goods received quantity → partial vs full PO outcome
- Fulfilment per-line state → order status and the invoice-release message
- Bulk-approve selection → count and total value
- Decision note length → confirm enablement

**Validation blocks the action *and* explains it in the same place**: a disabled primary button carrying the reason ("Submit blocked — 6 h unallocated", "Needs three vendors", "Not enough stock", "Weight exceeds 100%", "A note is required", "Submit blocked — no budget") next to a banner giving the rule and the remedy.

**Over-budget, two variants** (`/requisitions/new`):
- **Warn** — amber banner naming the count of offending lines and total shortfall, per-line shortfall figures, a **required** justification field, and a working submit button. Notes that over-budget requisitions always route to the Managing Director.
- **Block** — red banner explaining the award has no uncommitted balance, no justification field, submit disabled. Both offer a virement route.

**Selection** — selected rows / fields / options use `inset 0 0 0 1.5px #E0572E` on a `#F5F6F8` fill; radio-style options use a 16px accent dot with a 3px white inset ring.

**Empty and edge states** — a table with nothing to show explains why; overdue and blocked rows are visually distinct, not just differently labelled.

---

## State management

| Area | State |
|---|---|
| Shell | route, persona/role, dark mode, sub-nav expansion, dialog (kind + payload), drawer, toast, notification panel open, notifications read |
| Requisitions | active tab, selected rows, over-budget variant |
| Detail | derived entirely from the route ref — no local copy |
| Decision drawer | note text (gates confirm) |
| Bulk approve | per-ref selection, results-shown flag |
| Fulfilment | per-line received state |
| Timesheets | hour matrix (rows × 5 days), row project assignment, submitted flag |
| Appraisals | active tab, per-objective supervisor scores, supervisor/HR sign-off flags |
| Roles | selected role, active tab, permission overrides (role:module:action), sensitivity toggles, resolver subject |
| Report builder | step, selected columns, minimum amount, grouping, saved flag |
| Form builder | active tab, field array (id, type, label, required, help, options), selected field id, distribution channel, mapping target |
| Chain editor | selected transaction type, selected stage |
| Auth | 2FA step, reset step, setup step |
| Account | signature tab, notification preference per category, delegate choice, delegation active |
| Inventory | issue quantity, received quantity, selected item |
| E-signature | ceremony step, ceremony method, external signer step, hash verification result |
| Dialogs | refund mode, onboarding task selection, RFQ vendor selection, donor wizard step, KPI weight |

Data fetching: every table, stat card and badge is a query against the same underlying records. **Counts in navigation badges, stat cards and tab labels must derive from the same source as the table they summarise**, not be stored separately.

Integration hook: `window.__weweAct(ref, verb, note)` — see `PHASE2-INTEGRATION.md`.

---

## Assets

Iconography is inline 24×24 stroked SVG (`stroke-width:1.6` nav, `2.6–3` status ticks/crosses, `stroke-linecap:round`, `stroke-linejoin:round`); path data is in the `MODULES` map. Avatars are initials on a `#EBEDF0` circle. Signatures are a single stroked SVG path. QR codes are **deterministic placeholder matrices** generated from a seed string with the three finder squares drawn correctly — swap in a real QR encoder.

`shots/` holds 20 screenshots of the live system used by the walkthrough deck, plus `login-bg.jpg`, the sign-in photograph. The only external dependency is the Figtree webfont from Google Fonts.

If the target codebase has an icon library, substitute equivalents rather than porting paths.

---

## The walkthrough deck

`WEWE ERP Walkthrough Deck.dc.html` — 34 slides at 1920×1080 for the leadership and staff handover, with a full presenter transcript in the speaker notes of every slide.

Structure: title and why → agenda → six numbered sections (Foundations, The money modules, People & operations, Documents & assurance, Platform & security, Go-live) → close. Section dividers are full-bleed accent with an oversized numeral; module slides pair a screenshot with a commentary column; the assurance and hero slides run on near-black `#12100F`.

Deck-specific conventions, distinct from the app:
- Warm off-white `#F4F3F1` for module slides, near-black `#12100F` for hero and assurance, accent `#E0572E` for dividers only.
- **Minimum type size is 24px** — verified, zero text nodes below it. Body copy 24–25px, card headings 26–29px, section titles 52–58px, hero 104–112px.
- The approval chain is drawn as a chevron flow, not a bullet list. The audit trail is a hash-chain diagram with a pulsing "Chain intact ✓" verify state. The permission matrix is drawn natively at slide scale — seven large action tiles with **Approve** shown blocked by SOD-01 — rather than shrinking a UI screenshot.

Exports cleanly to PPTX or PDF without further print work.

---

## Implementation notes

1. **Build the shell first** — fixed-height, independently scrolling sidebar and content. Getting this wrong makes every later screen feel wrong.
2. **Build the table primitive second.** Almost every screen is a variation on the table card. Make column definitions data-driven (label, width, alignment, cell renderer, status tone) so screens become configuration.
3. **Then the status pill, stat card, workflow tracker, wizard stepper and dialog shell** — these five cover most of the remaining surface.
4. **Verify at 1360px throughout,** and measure rendered text against its grid track, not just container overflow.
5. **Do not ship generic confirm dialogs.** If an action does not warrant a purpose-built dialog, use a toast stating the specific outcome.
6. **Keep the numbers consistent.** Where a figure appears in more than one place, derive it once.
7. **Mandatory notes are a workflow rule, not decoration** — return and reject must be impossible without one, at every entry point.
8. **The auth and external-signer screens belong outside the authenticated layout** in production, even though the prototype renders them inside the shell (external signer as a full-viewport layer) so they are reachable for review.
