# Handoff: WEWE ERP — Widows and Orphans Empowerment Organisation

## Overview

A complete internal ERP for WEWE, a Nigerian NGO managing donor-funded programmes. The system replaces a paper approval chain with a five-stage digital workflow covering requisitions, cash advances and retirements, budgets, procurement, inventory, fixed assets, HR, payroll, timesheets, donor grants, audit, reporting, and administration.

The organising principle: **every transaction is visible from initiation to final approval, and every figure traces back to a record**. Numbers reconcile across screens — a queue badge, a stat card, a tab count and a table all read from the same source. Reviewers should expect internal consistency and treat a mismatch as a bug.

Tagline used on the sign-in screen: *"One approval chain. Five stages. Zero paper."*

---

## About the Design Files

The files in this bundle are **design references created in HTML** — a working prototype demonstrating intended look, layout and behaviour. **They are not production code to copy directly.**

The task is to **recreate these designs in the target codebase's existing environment** (React, Vue, Angular, SwiftUI, native, etc.) using its established component library, routing, state management and styling conventions. If no environment exists yet, choose the most appropriate framework for the project and implement the designs there.

Specifically:
- The prototype is authored as a single-file component with **inline styles only**. Do not replicate that approach — use the target codebase's styling system (CSS modules, Tailwind, styled-components, design tokens, etc.).
- All data is **hard-coded fixture data** in the prototype. Replace with real API calls.
- The prototype uses a **hash router** (`#/requisitions`). Use the target codebase's router.
- `support.js` is the prototype runtime. **It is not part of the design** — ignore it entirely; it exists only so the HTML file opens in a browser.

### Running the prototype
Open `WEWE ERP.dc.html` in a browser. `support.js` must sit beside it. Navigate by hash, e.g. `WEWE ERP.dc.html#/admin/roles`.

---

## Fidelity

**High fidelity.** Final colours, typography, spacing, states and interaction behaviour. Recreate pixel-perfectly using the codebase's existing libraries where equivalents exist; match the specified values where they do not.

---

## Design Tokens

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

**Status colours** (always a tinted background with a darker foreground):

| Status | Background | Foreground |
|---|---|---|
| Success / approved | `rgba(30,142,62,.10)` | `#166F31` (solid `#1E8E3E`) |
| Warning / due soon | `rgba(180,83,9,.12)` | `#8A4B0B` (solid `#B45309`) |
| Danger / overdue | `rgba(194,65,12,.10)` | `#9C3309` (solid `#C2410C`) |
| Info / in progress | `rgba(110,158,201,.18)` | `#2C5C86` (solid `#6E9EC9`) |
| Neutral | `#F3F4F5` | `#6B7280` |

Banner variants pair a tinted fill with a 1px border: success `#EAF4EC` / `#CFE6D6`; warning `#FFF7ED` / `#FDE3C4`; danger `#FBEAE4` / `#F3D6CB`.

### Dark mode

Toggled via a `data-wewe="dark"` attribute on the root, driven by a "Dark" control in the sidebar. Palette:

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

In the prototype dark mode is implemented as attribute-scoped overrides keyed off literal inline background values — **a prototype workaround only**. In production, implement it properly with CSS custom properties or the codebase's theming system.

### Typography

Family: `"Google Sans", "Google Sans Text", Figtree, system-ui, sans-serif`
Figtree (weights 400/500/600/700) is loaded from Google Fonts as the fallback; Google Sans is preferred where licensed.

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
| Status pill | 10px | 700 | uppercase |
| Helper text | 11px | 400 | colour `#9AA0A8` |

**Rules:** every numeric column uses `font-variant-numeric: tabular-nums`. Currency is always full precision Naira — `₦1,250,000.00`. Dates are `DD/MM/YYYY`. Long prose uses `text-wrap: pretty`.

### Spacing, radius, elevation

- Spacing scale: 4 / 5 / 6 / 8 / 10 / 12 / 14 / 16 / 18 / 20 / 22 / 24 / 28px
- Radius: 5–6px (small pills) · 8–9px (buttons, inputs, small controls) · 10–12px (large inputs, inline panels) · 14px (banners) · 16px (cards) · 18px (dialogs) · 999px (chips, avatars, toggles)
- Card shadow: `0 1px 2px rgba(16,24,40,.04), 0 6px 18px rgba(16,24,40,.05)`
- Dialog shadow: `0 32px 64px rgba(16,24,40,.24)`
- Document/paper shadow: `0 1px 3px rgba(16,24,40,.10), 0 12px 30px rgba(16,24,40,.08)`
- Selection ring: `inset 0 0 0 1.5px #E0572E`

### Control sizes

| Control | Height |
|---|---|
| Page action button | 40px |
| Dialog action button | 42px |
| Form input / select | 42px |
| Compact button / filter | 34px |
| Row action button | 28px |
| Status pill | 22–24px |
| Permission cell button | 26 × 26px |
| Toggle switch | 38 × 22px (18px knob) |
| Avatar | 24 / 28 / 30 / 52px |

### Motion

```
wewePulse   2s infinite   expanding accent ring on the current workflow step
weweRise    180ms ease-out   dialog entry (opacity + 6px translateY)
weweSweep   width 0 → 100%   progress fills
weweShimmer opacity .5 → 1 → .5   loading placeholders
```
Hover transitions: `140ms ease-out`.

---

## Application Shell

Fixed-height viewport shell; the sidebar and content column scroll **independently** — the page itself never scrolls.

```
┌──────────────────────────────────────────────────────────┐
│  outer: height:100vh; overflow:hidden;                   │
│  min-width:1360px; max-width:1658px; margin:0 auto;      │
│  background:#E4E5E8; padding:16px; display:flex; gap:8px │
│  ┌────────────┬───────────────────────────────────────┐  │
│  │ Sidebar    │ Top bar (search, + New, avatar)       │  │
│  │ 282px      ├───────────────────────────────────────┤  │
│  │ flex:none  │ Content — overflow-y:auto             │  │
│  │ own scroll │ max-width 1320px, padding-bottom 24px │  │
│  └────────────┴───────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

- **Minimum supported width is 1360px.** All layout must be verified at that width, not just at a wide viewport.
- Sidebar: `width:282px; height:100%; padding:8px 10px 12px`, own `overflow-y:auto`, thin scrollbar.
- Content column: `flex:1; min-width:0; height:100%; min-height:0`, own `overflow-y:auto; overflow-x:hidden`.
- Content is capped at `max-width:1320px` and left-aligned.

### Sidebar

Brand mark, then nav groups with uppercase 11px group labels (`letter-spacing:.07em`, colour `#9AA0A8`): Transactions · Money · Operations · People · Governance · System. Each module row shows an icon, label and optional count badge; the active row uses the accent treatment. Below the nav: "Signed in as" block with name and title, a Dark toggle, and Sign out.

Modules and their routes:

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

Sub-navigation appears under the active module. Full set:

- **Requisitions** — All requisitions `/requisitions` · Awaiting me `/requisitions/queue` · New requisition `/requisitions/new` · Templates `/requisitions/templates`
- **Advances** — Outstanding register `/advances` · New cash advance `/advances/new` · Travel authorisation `/advances/travel` · Retirement `/advances/retire` · Outstanding advances `/advances/outstanding`
- **Budgets** — Overview `/budgets` · Import & validation `/budgets/import` · Virement requests `/budgets/virements` · Version history `/budgets/versions`
- **Payroll** — August run `/payroll` · Payslips `/payroll/payslips` · Remittances `/payroll/remittances`
- **QuickBooks** — Integration console `/quickbooks` · Account mapping `/quickbooks/mapping` · Exception queue `/quickbooks/exceptions`
- **Procurement** — Vendor registry `/procurement` · Vendor register `/procurement/vendors` · RFQs & quotes `/procurement/rfq` · Purchase orders `/procurement/po` · Contracts `/procurement/contracts`
- **Inventory** — Stock on hand `/inventory` · Activity log `/inventory/log` · Goods received `/inventory/grn` · Issues to staff `/inventory/issues` · Stock counts `/inventory/counts`
- **Fixed Assets** — Asset register `/assets` · Verification campaign `/assets/verification` · Depreciation `/assets/depreciation` · Transfers `/assets/transfers` · Disposals `/assets/disposals`
- **Documents** — Repository `/documents` · Document viewer `/documents/view` · E-signature `/documents/esign` · Retention & holds `/documents/retention`
- **HR** — Staff directory `/hr` · Staff record `/hr/staff` · Leave `/hr/leave` · Onboarding `/hr/onboarding` · Appraisals `/hr/appraisals` · Contracts `/hr/contracts`
- **Timesheets** — My timesheet `/timesheets` · Approvals `/timesheets/approvals` · Level of effort `/timesheets/loe`
- **Grants** — Grants `/grants` · Donor reports `/grants/reports` · Reporting calendar `/grants/calendar` · Programme dashboards `/grants/programmes`
- **Audit** — Review queue `/audit` · Findings register `/audit/findings` · Audit log `/audit/log` · User activity monitor `/admin/activity` · Evidence packs `/audit/evidence`
- **Reports** — Report library `/reports` · Custom builder `/reports/builder` · Pipeline analytics `/reports/pipeline` · Scheduled `/reports/scheduled`
- **Administration** — Users `/admin` · Roles & permissions `/admin/roles` · Forms & data capture `/admin/forms` · Form builder `/admin/forms/build` · User activity monitor `/admin/activity` · Organisation structure `/admin/org` · Workflow configuration `/admin/workflow` · Reference data `/admin/reference` · Policy settings `/admin/policies`

### Top bar

Search field, spacer, **+ New** primary pill (44px, `border-radius:999px`), then the avatar + persona switcher. **+ New** opens a quick-create chooser (see Dialogs).

### Persona switching

The prototype ships eight personas so reviewers can see role-scoped navigation. Each persona hides the modules it has no rights to.

| Persona | Name | Title |
|---|---|---|
| Initiator | Ngozi Okafor | Programme Officer · Programmes |
| Supervisor | Tunde Balogun | Head, Programmes |
| Internal Audit | Chiamaka Eze | Internal Audit Officer |
| Finance | Ibrahim Musa | Finance Manager |
| Final Approver | Dr. Amina Yusuf | Managing Director |
| HR Officer | Blessing Adeyemi | Human Resources Officer |
| Procurement | Emeka Nwosu | Procurement Officer |
| System Admin | Segun Ola | System Administrator |

In production this is not a switcher — navigation is derived from the signed-in user's role.

---

## Screens

Below, screens are grouped by module. Every screen follows the same skeleton unless noted: breadcrumb (where nested) → title + subtitle + right-aligned actions → stat cards → content cards.

### Standard patterns

**Stat card** — `background:#FFFFFF; border-radius:16px; padding:20px` + card shadow. 13px/500 `#8A8F98` label; 24px/600 value with tabular numerals; 12px `#9AA0A8` context line. Laid out `grid-template-columns: repeat(auto-fit, minmax(220px,1fr)); gap:12px`.

**Table card** — white, `border-radius:16px`, `overflow:hidden`. Header block `padding:20px 24px 14px` with title, 12px subtitle, and optional right-aligned search or link. Column header row: CSS Grid, `padding:0 24px 8px`, 11px/600 uppercase labels, `border-bottom:1px solid #EEF0F3`. Body rows: same grid template, `padding:14px 24px`, zebra `#F8F9FA` on odd rows, hover `#F1F3F5`. Optional footer strip on `#FAFBFC` with a rule above.

> **Tables are CSS Grid, not `<table>`.** Header and body rows must declare the *same* `grid-template-columns`. Numeric and action columns are fixed px; the descriptive column is `minmax(<min>, 1fr)`. Every text cell in a fixed track needs `min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap` or it will overlap its neighbour. **Verify at 1360px.**

**Status pill** — `height:22px; padding:0 9px; border-radius:6px`, 10px/700 uppercase, tinted background + darker foreground per the status table. Where a tick or cross is useful, an 11–12px stroked SVG sits inside at `stroke-width:2.6–3`.

**Workflow tracker** — horizontal row of steps. Complete: 26px accent-green circle with a tick. Current: 26px accent circle with the step number, `animation:wewePulse 2s infinite`. Future: 26px white circle, `2px solid #D3D6DB`, grey number. Connectors are 2px rules — green when passed, `#EAECEF` when not.

**Section banner** — `padding:14px 18px; border-radius:14px`, an 8px status dot, 13px/500 message, optional right-aligned action button. Used to explain a blocked state.

---

### Dashboard `/dashboard`

Role-aware landing page. Stat cards for the signed-in role, an approval queue list, a bottleneck ranking, and charts. The approvals-cleared-vs-submissions chart is a **smooth wave/area chart** (not bars). Queue rows are clickable and open the transaction.

### Requisitions

- **`/requisitions`** — 214 transactions. Tabs: All (214) · Mine (38) · Awaiting me (6) · Returned (3). Table: reference, item, initiator, department, donor code, amount, date, status, stage.
- **`/requisitions/queue`** — Finance approval queue, oldest first. 6 items worth ₦7,761,500.00, oldest waited 4d 2h. Columns: Reference (104px) · Item (`minmax(130px,1fr)`) · Amount (116px, right) · Waiting (84px, right) · SLA (112px) · actions (188px). Row actions: **Approve · Return · Open**.
- **`/requisitions/new`** — creation form.
- **`/requisitions/templates`** — 8 templates, 6 shared / 2 personal. Columns: Template · Lines · Typical value · Budget line · Sharing · Used · actions. Row actions **Use · Edit · Copy** each open the template document showing its real line items, the typical total, **and its attached form** (see Forms).

### Advances & Retirement

- **`/advances`**, **`/advances/new`**, **`/advances/travel`**
- **`/advances/retire`** — retirement screen. Where actual spend is below the advance, a variance panel shows the refund due and a **Record refund settlement** action.
- **`/advances/outstanding`** — outstanding register aged against the 14-day policy. ₦3,847,000.00 outstanding across 11 staff / 14 advances; ₦1,268,000.00 overdue; 2 staff blocked from new advances. Rows show blocked / overdue / due-soon / within-policy states.

### Budgets

`/budgets` overview, `/budgets/import` import & validation, `/budgets/virements`, `/budgets/versions`.

### Payroll

- **`/payroll`** — August run, 47 staff, ₦18,432,600.00 gross, ₦14,067,842.00 net. **Send for approval** opens the payroll approval dialog.
- **`/payroll/payslips`** — 47 payslips. Columns: Staff · Staff ID · Gross · Deductions · Net pay · Delivery · actions. Row actions **View · PDF · Email**.
- **`/payroll/remittances`** — PAYE ₦2,841,000.00 · pension ₦1,515,200.00 across 4 PFAs · NHF ₦378,800.00, due 10/09/2026. Row actions **View · Export** (or **Prepare · View** where not started).

### QuickBooks

`/quickbooks` console, `/quickbooks/mapping` chart-of-accounts mapping, `/quickbooks/exceptions` exception queue with repost.

### Procurement

`/procurement` · `/procurement/vendors` (6 vendors, ₦19,750,000.00 spend, due-diligence states incl. one blocked) · `/procurement/rfq` · `/procurement/po` (7 open orders, ₦11,240,000.00 committed, delivery and three-way-match columns) · `/procurement/contracts`.

### Inventory & stores

- **`/inventory`** — 8 item lines across the Abuja store and Enugu field office. Columns: Code (96px) · Item (`minmax(130px,1fr)`, with category and unit cost beneath) · Store · Qty · Value · Level (a bar against the reorder point; red when at or below) · Status · actions. Row actions **Issue · Receive**. A banner flags T-shirts at zero and toner below reorder with a *Raise a requisition* action.
- **`/inventory/log`** — full movement history. Typed entries (RECEIPT / ISSUE / ADJUST / COUNT), each with who, when, what moved, quantity, a full prose reason, and a signed reference. +284 units in / −277 out.
- **`/inventory/grn`** · **`/inventory/issues`** (row actions **Docket · Reverse**, or **Return · Docket** / **Return · Chase** where a return is due) · **`/inventory/counts`**.

### Fixed Assets

`/assets` register · `/assets/verification` · `/assets/depreciation` (net book value ₦42,860,000.00, straight-line by class) · transfers · disposals.

### Documents & E-sign

- **`/documents`** — repository; rows open the viewer.
- **`/documents/view`** — document viewer. Page thumbnail rail with the current page ringed in accent, page navigation, zoom, in-document search reporting hit position ("2 of 7") with the match highlighted on the page, and Download / Print / Share. Right rail: details (type, size, version, uploader, OCR confidence, retention, legal hold), who can open it (including a watermarked external auditor), version history, and access activity.
- **`/documents/esign`** — open signature requests with signatory order and what each is waiting on.
- **`/documents/retention`**

### Human Resources

- **`/hr`** — staff directory, 47 staff, 5 departments. **Add staff member** opens the staff creation dialog.
- **`/hr/staff`** — full staff record: role history, contracts, assets held, transactions.
- **`/hr/leave`** · **`/hr/onboarding`** (**Start onboarding** opens the checklist dialog) · **`/hr/contracts`** (renewal schedule keyed to award end dates)
- **`/hr/appraisals`** — appraisal record for the cycle. Header shows the weighted score (34px) and band. Four-stage sign-off tracker: self-assessment → supervisor → HR → filed. Tabs:
  - *Objectives & ratings* — weighted objectives; the supervisor rating is an **editable input per row** and the weighted score, band and colour recalculate live. Bands: ≥4.5 Outstanding · ≥4 Exceeds · ≥3 Meets · ≥2 Needs improvement · else Unsatisfactory.
  - *Competencies* — self vs supervisor as 5-segment bars (self `#6E9EC9`, supervisor `#E0572E`), evidence per row, DISCUSSED flag where they differ.
  - *Development plan* — area, action, date, owner, cost, agreed/proposed.
  - *Cycle progress* — 47 staff with score, band and stage; the current record's row mirrors its live sign-off state.

### Timesheets

- **`/timesheets`** — period picker and *Copy last period*; four-stage tracker. **Editable grid**: 5 day columns × rows, every hour cell is an input; per-row hours and effort % recalculate on every keystroke. Add-a-grant appends a row with an **11-option grant picker** (outlined in accent until chosen); rows can be removed; the leave row is locked and auto-filled. Validation: total must equal the 40 expected hours *and* every row must have a grant, or submit is disabled with the exact gap and an explanatory banner. On submit the tracker advances to "With Tunde Balogun" and offers *Withdraw and edit*. Alongside: team calendar strip (working / field mission / leave requested) and a live per-grant charge breakdown.
- **`/timesheets/approvals`** — 6 submissions with hours, effort, submitted time and status. Row actions **Approve** (charges hours to grants, flips status, updates counters), **Query** (returns to the staff member), **Remind** (for not-submitted). *Approve all compliant* clears the valid ones and holds the one below 100% effort.
- **`/timesheets/loe`**

### Donors & Grants

`/grants` (with **+ Add a donor**) · `/grants/reports` · `/grants/calendar` · `/grants/programmes`.

### Audit & Compliance

`/audit` review queue · `/audit/findings` · `/audit/log` · `/audit/evidence` · `/admin/activity` user activity monitor.

### Reports

- **`/reports`** — report library. **Build a report** navigates to the builder.
- **`/reports/builder`** — four-step wizard with a clickable stepper (both directions) plus Back/Continue:
  1. **Source & columns** — data source select, then 10 column chips toggled on/off; a side panel lists the selection in output order; header count updates live (7 of 10 default).
  2. **Filters** — date range, department, donor, and a minimum-amount selector that genuinely re-filters (₦250,000 minimum → 21 of 24 rows), plus condition chips.
  3. **Group & sort** — group by department / donor / stage / initiator, sort order, subtotal mode, and a sentence stating what the grouping produces.
  4. **Preview & save** — live preview built from the chosen columns and filters, amounts right-aligned. The preview sits in a horizontally scrollable region with a **1160px minimum** so all ten columns can be shown without clipping the card. *Save and share* confirms it reached the report library; *Schedule weekly* is offered alongside.
- **`/reports/pipeline`** · **`/reports/scheduled`**

### Administration

- **`/admin`** users · **`/admin/org`** · **`/admin/workflow`** · **`/admin/reference`** · **`/admin/activity`**

- **`/admin/roles` — Roles & permissions.** The most detailed screen. Two columns: a 296px role list and a content column.
  - **Role list** — 14 roles (11 system, 3 custom) with member count, default scope, DRAFT / CUSTOM badges. Selecting one re-renders everything.
  - **Header** — role name, unpublished-changes pill, description, meta line, and *Duplicate · View as… · Publish changes*.
  - **Permission matrix tab** — **57 modules across 7 groups** (Transactions, Money, Operations, People, Governance, Reporting, System) × **7 actions** (View, Create, Edit, Submit, Approve, Export, Configure). Grid: `minmax(118px,1fr) repeat(7, 58px) 100px`, `column-gap:5px`. Column headings are buttons that **tri-state toggle the whole column**. Cells are 26×26px — granted is a filled accent square with a tick, revoked is an outlined square. Each row has a scope chip (Own / Department / Organisation) or "Not granted". A footer banner explains the SOD-01 block on Requisitions · Approve.
    > At the 1360px minimum the action tracks are 58px and the uppercase 9px/700 headings measure ≤52px. Do not narrow the tracks below 58px without shortening the labels — "CONFIGURE" will collide with the Scope column.
  - **Assignment & resolver tab** — members holding the role with per-assignment scope and primary/additional; then the **effective-permissions resolver**: for a chosen person, each permission with its scope, *why* it is granted (system role, sensitivity set, or a delegation with an expiry), and a note — including explicit "Not granted" rows.
  - **Rules & sensitivity tab** — **11 segregation-of-duties rules, 8 blocking / 3 warning**, each with id, level, the conflicting pair, an explanation and the roles affected. Blocking rules cannot be overridden in the UI; warnings are permitted but flagged to Internal Audit. Below: delegation constraints (no self-delegation, no chains, max 30 days, blocking rules travel with the delegation) and **9 field-level sensitivity sets** with toggles — bank details, salary data, medical & leave evidence, audit flags, donor correspondence, appraisal ratings, beneficiary identifiers, public form responses, vendor due diligence.
  - **Change log tab** — side-by-side draft vs published diff and full from→to history with LIVE / DRAFT states.

- **`/admin/forms` — Forms & data capture.** Library of 8 forms: name, module, what it writes into, field count, responses, distribution channel (IN-APP / EMAIL / PUBLIC LINK), state, and **Open · Share**.

- **`/admin/forms/build` — Form builder.** Three-column build view plus four tabs.
  - **Build** — left: a **13-type field palette** (Short text, Long text, Number, Currency, Date, Dropdown, Multiple choice, Tick boxes, File upload, Signature, Staff picker, Budget line, Section heading) that appends on click. Middle: a live preview where **every field renders as its real control**; each is selectable (accent inset ring), reorderable (↑ ↓) and removable (✕), with its type shown at the right. Right: settings for the selected field — label, help text, options (· separated), required toggle — plus form rules (save partial answers, offline, one response per person, capture GPS).
  - **Mapping** — attach the form to any record: a requisition template, retirement evidence, vendor register, staff file, findings register, asset campaign, or standalone. Below, explicit field-to-record mapping (e.g. *Actual spend → Retirement amount*; a safeguarding answer of "Yes" opens a finding). A right rail lists who can respond.
  - **Distribution** — three channels: **In-app** (shows where it surfaces in the product), **Email invitation** (recipients with group chips, subject, message, send timing, reminders), **Public link** (the link with Copy, plus WhatsApp / Facebook / X share and QR download, a close date and response limits, and a warning that sensitivity-set fields are blocked on public forms). A phone preview and an open → start → complete funnel sit alongside.
  - **Responses** — 186 submissions, each filed against its retirement reference, with a safeguarding column that flags raised findings.

---

## Dialogs

All dialogs share: white surface, `border-radius:18px`, `padding:28px`, dialog shadow, `animation:weweRise 180ms ease-out`, and a right-aligned action row with Cancel (outlined) + primary (accent). Tall dialogs use `max-height:88vh; overflow-y:auto` with sticky header and footer.

**Principle: no generic confirm dialogs.** Every action opens something specific to it — a document, a real form, or a decision with its own consequences spelled out. Where an action would only ever produce a confirmation, it instead shows a labelled toast.

| Dialog | Trigger | Contents |
|---|---|---|
| **Quick create** | Top-bar **+ New** | Eight things you can create, each routing to its real flow |
| **Payslip** | Payslip row **View** | The actual payslip: letterhead, employee and payment block, earnings split (basic 50% / housing 25% / transport 15% / utility 10%), deductions (PAYE, pension 8%, NHF 2.5% of basic), net pay on an ink panel, employer contributions (pension 10%, NSITF 1%), and Jan–Aug year-to-date totals. Figures derive from the row. |
| **Email payslip** | Payslip row **Email** | Recipient from the staff record, password protection option, sensitivity-set logging note |
| **Remittance schedule** | Remittance row **View** | Authority, type, staff covered, average per staff, employee/employer split, total to remit, nominal-roll note |
| **Template** | Template row **Use / Edit / Copy** | The template's real line items and typical total, its **attached form**, plus mode-specific fields |
| **Store issue docket** | Issue row **Docket** | Printable stores issue voucher with both signature lines |
| **Reverse issue** | Issue row **Reverse** | Reason select, note, and a warning that the original stays in the log |
| **Chase return** | Overdue issue row **Chase** | Recipient chain and a pre-written message; notes that a second chase escalates to Internal Audit |
| **Approve transaction** | Queue row **Approve** | Amount, wait time, budget headroom, quotations on file, audit flags; Return-to-initiator alongside Approve |
| **Issue stock** | Inventory **Issue** | Quantity, recipient, optional transaction to charge, purpose, return expectation. Shows what the issue leaves on hand and warns below reorder; over-issue disables the button ("Only 64 on hand") |
| **Receive stock** | Inventory **Receive** | Against a PO with ordered / delivered / accepted. Partial delivery leaves the PO open with the balance stated; a full delivery closes it and releases the invoice for three-way match |
| **Record refund settlement** | Retirement variance panel | Advance vs actual with the refund owed; three settlement routes (cash, bank transfer, salary deduction). Bank transfer asks for a reference; salary deduction warns the amount comes off next net pay |
| **Add staff member** | HR **Add staff member** | Identity, job, reporting line, contract, dates, grade, funding, system role — **plus a required Next of kin section** (name, relationship, two phones, address, email, benefit share, and a second next-of-kin option) |
| **Start onboarding** | Onboarding | New joiner, start date, a 9-task checklist with per-task owners and due offsets, buddy |
| **Raise RFQ** | Procurement | Source requisition, closing date, award criterion, vendor selection. **Blocks below three vendors** and flags a vendor with lapsed due diligence |
| **Asset verification campaign** | Assets | Scope, deadline, required evidence, reminders, and who will be notified |
| **New role** | Roles list | Name, purpose, start-from template, default scope, and a note that blocking SOD rules always apply |
| **Payroll approval** | Payroll | Full gross-to-net breakdown, pre-flight checks, and the two-signature rule |
| **New objective & KPI** | Appraisal | Objective, measurement type, data source, target, deadline, weight. **Weights must total 100%** — over-allocating shows the overshoot and blocks submission |
| **Add a donor** | Grants | Three-step wizard: donor identity → award (reference, value, period, reporting frequency, indirect rate, cost rules, agreement) → budget lines + award manager. Opens as a draft; nobody can charge to it until Finance confirms the budget reconciles |
| **Share form** | Form library **Share** | Public link with Copy, WhatsApp / Facebook / X, QR, plus email invitation with group chips |
| **Publish role changes** | Roles header | Diff of the pending changes with a version bump |
| **View as** | Roles header | Member picker that starts a read-only session |
| **Export** | Any Export / PDF / Print | Format and scope options |

### Toasts

Used for actions whose only outcome is confirmation. They state the specific result, never a generic acknowledgement — e.g. *"ISS-2026-0413 · 12 × A4 photocopy paper issued. 52 left on hand. Docket printed for signature."*

---

## Interactions & Behaviour

**Navigation** — hash routing; sidebar and sub-nav drive it; breadcrumbs on nested screens; table rows and queue items open their record.

**Live recalculation** — several screens recalculate on every keystroke and must not be faked:
- Timesheet hour cells → row totals, effort %, allocated-vs-expected, submit enablement
- Appraisal supervisor ratings → weighted score, band, band colour
- Report builder column chips and filters → preview table, row count, header summary
- Form builder palette and settings → live preview and field count
- Permission cells and column toggles → matrix state
- KPI weight → cycle total and submit enablement
- Stock issue quantity → remaining on hand and submit enablement
- Goods received quantity → partial vs full PO outcome

**Validation** — validation blocks the action *and* explains it in the same place: a disabled primary button carrying the reason ("Submit blocked — 6 h unallocated", "Needs three vendors", "Not enough stock", "Weight exceeds 100%") next to a banner giving the rule and the remedy.

**Selection** — selected rows/fields/options use `inset 0 0 0 1.5px #E0572E` on a `#F5F6F8` fill; radio-style options use a 16px accent dot with a 3px white inset ring.

**Empty and edge states** — a table with nothing to show explains why; overdue and blocked rows are visually distinct, not just differently labelled.

---

## State Management

Per-screen state the implementation must carry:

| Area | State |
|---|---|
| Shell | current route, persona/role, dark mode, sub-nav expansion, dialog (kind + payload), toast |
| Requisitions | active tab, selected rows |
| Timesheets | hour matrix (rows × 5 days), row project assignment, submitted flag |
| Appraisals | active tab, per-objective supervisor scores, supervisor/HR sign-off flags |
| Roles | selected role, active tab, permission overrides (role:module:action), sensitivity toggles, resolver subject |
| Report builder | step, selected columns, minimum amount, grouping, saved flag |
| Form builder | active tab, field array (id, type, label, required, help, options), selected field id, distribution channel, mapping target |
| Inventory | issue quantity, received quantity, selected item |
| Dialogs | refund settlement mode, onboarding task selection, RFQ vendor selection, donor wizard step, KPI weight |

Data fetching: every table, stat card and badge is a query against the same underlying records. Counts shown in navigation badges, stat cards and tab labels **must be derived from the same source as the table they summarise**, not stored separately.

---

## Assets

No external image assets. All iconography is inline 24×24 stroked SVG (`stroke-width:1.6` for nav, `2.6–3` for status ticks/crosses, `stroke-linecap:round`, `stroke-linejoin:round`) — path data is in the `MODULES` map in the prototype. Avatars are initials on a `#EBEDF0` circle. The only external dependency is the Figtree webfont from Google Fonts.

If the target codebase has an icon library, substitute equivalents rather than porting the paths.

---

## Files

| File | What it is |
|---|---|
| `WEWE ERP.dc.html` | The complete design prototype — every screen, dialog and interaction described above |
| `support.js` | Prototype runtime only. **Not part of the design.** Required for the HTML to open in a browser; ignore when implementing |
| `README.md` | This document |

---

## Implementation Notes

1. **Build the shell first** — fixed-height, independently scrolling sidebar and content. Getting this wrong makes every subsequent screen feel wrong.
2. **Build the table primitive second.** Almost every screen is a variation on the table card. Make column definitions data-driven (label, width, alignment, cell renderer, status tone) so screens become configuration.
3. **Then the status pill, stat card, workflow tracker and dialog shell** — these four cover most of the remaining surface.
4. **Verify at 1360px throughout.** The design has a hard minimum width; several tables were tuned specifically for it.
5. **Do not ship generic confirm dialogs.** If an action does not warrant a purpose-built dialog, use a toast that states the specific outcome.
6. **Keep the numbers consistent.** Where a figure appears in more than one place, derive it once.
