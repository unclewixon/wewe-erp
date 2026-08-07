# WEWE ERP — Implementation guide for Claude Code

**Read this first, then `PHASE2-INTEGRATION.md` for the machine-facing contracts.**

You are being handed a complete, working HTML prototype of an ERP for WEWE, a Nigerian NGO managing donor-funded programmes. Your job is to **rebuild it in the target codebase** — not to copy its source. This document tells you what to build, in what order, and which details are load-bearing.

---

## 1 · What you are building

An internal ERP that replaces a paper approval chain with a five-stage digital workflow. Twenty-nine modules covering requisitions, cash advances and retirements, budgets, procurement, inventory, fixed assets, HR, payroll, timesheets, donor grants, audit, reporting, forms, e-signature and administration.

**The one organising idea:** every transaction travels the same five-stage chain — Initiator → Supervisor → Internal Audit → Finance → Final Approver — and every figure on every screen traces back to a record. Stages are skipped by amount thresholds, never by exception. Almost every screen in the product is a variation on this.

**The non-negotiable property:** counts and totals are *derived*, never written into markup. A queue badge, a stat card, a tab label and a table showing the same thing must agree because they read the same source. If you hardcode a count, you have introduced a bug.

Tagline on the sign-in screen: *"One approval chain. Five stages. Zero paper."*

### Files in this bundle

| File | What it is |
|---|---|
| `WEWE ERP.dc.html` | The prototype. Every screen, dialog and interaction. Open it in a browser and click through before writing code. |
| `PHASE2-INTEGRATION.md` | Route list, data-const shapes, and the full `window.__wewe*` write-hook contract. |
| `WEWE ERP Walkthrough Deck.dc.html` | 34-slide deck explaining the product to staff, with speaker notes. Useful for understanding intent. |
| `shots/` | Screenshots used by the deck, plus `login-bg.jpg` which the sign-in screen requires at that path. |
| `support.js`, `deck-stage.js` | Prototype runtimes. **Not part of the design.** Ignore them entirely. |

### How to run the prototype
Open `WEWE ERP.dc.html` in a browser with the two `.js` files and `shots/` beside it. Navigate by hash: `WEWE ERP.dc.html#/admin/roles`. You land on a sign-in screen — click through it. Append `?demo=1` to unlock the persona switcher and see the app as each of the eight roles.

---

## 2 · Ground rules

**Do not copy the prototype's code.** It is a single file of inline-styled markup, written that way so it renders without a build step. Rebuild it with the target codebase's component library, router, state management and styling system. If no codebase exists, pick a framework and build there.

**Fidelity is high.** Colours, type, spacing, states and interaction behaviour are final. Match them. Where the target codebase has an equivalent primitive, use it; where it does not, match the values in §3.

**Data is fixtures.** Everything renders from named module constants. Replace them with API calls. `PHASE2-INTEGRATION.md` lists each const and its shape.

**Routing.** The prototype uses a hash router and strips the query string before matching, so `?id=` and `?demo=1` are safe on any route. Use the codebase's router; keep the same paths.

**Currency is kobo.** Every amount is an integer minor unit, formatted `₦1,250,000.00` at the edge. Never store or compute in naira floats. Dates are `DD/MM/YYYY`.

---

## 3 · Design tokens

### Colour

| Token | Hex | Use |
|---|---|---|
| Accent / primary | `#E0572E` | Primary buttons, active nav, selected states, focus rings |
| Accent hover | `#C8481F` | Primary button hover |
| Link | `#D9532B` | Link default |
| Link hover | `#B23F1D` | Link hover, secondary emphasis |
| Ink | `#1A1D21` | Headings, primary text, dark surfaces |
| Body | `#3B3B3B` | Default copy |
| Muted | `#6B7280` | Secondary copy |
| Subtle | `#8A8F98` | Subtitles, captions |
| Faint | `#9AA0A8` | Table headings, helper text |
| Disabled | `#C4C8CE` / `#B9BDC4` | Placeholder, disabled labels |
| Canvas | `#E4E5E8` | Page background |
| Surface | `#FFFFFF` | Cards, panels, dialogs |
| Surface alt | `#FAFBFC` | Card footers, group headers |
| Zebra | `#F8F9FA` | Odd table rows |
| Row hover | `#F1F3F5` | Table row hover |
| Input fill | `#F7F8FA` | Form fields, inert chips |
| Chip grey | `#F3F4F5` | Neutral pills |
| Border | `#E3E5E8` | Inputs, buttons, cards |
| Divider | `#EEF0F3` | Section rules |
| Divider light | `#F4F5F7` | Row separators |

**Sign-in screen only** — a warmer palette, deliberately distinct from the app shell: panel `#F5F1EA`, field fill `#EFEAE1`, field border `#DFD6C9`, rule `#E4DCD1`, muted `#8A8177`, footer `#9A9086`.

**Status colours** — always a tinted background with a darker foreground, never a saturated fill:

| Status | Background | Foreground |
|---|---|---|
| Success / approved | `rgba(30,142,62,.10)` | `#166F31` (solid `#1E8E3E`) |
| Warning / due soon | `rgba(180,83,9,.12)` | `#8A4B0B` (solid `#B45309`) |
| Danger / overdue | `rgba(194,65,12,.10)` | `#9C3309` (solid `#C2410C`) |
| Info / in progress | `rgba(110,158,201,.18)` | `#2C5C86` (solid `#6E9EC9`) |
| Neutral | `#F3F4F5` | `#6B7280` |

Banners pair a tinted fill with a 1px border: success `#EAF4EC`/`#CFE6D6`; warning `#FFF7ED`/`#FDE3C4`; danger `#FBEAE4`/`#F3D6CB`.

Brand accents appear **only** on share buttons: WhatsApp `#25D366`, Facebook `#1877F2`, X `#1A1D21`.

### Dark mode

Driven by `data-wewe="dark"` on the root, toggled from the sidebar.

| Role | Hex |
|---|---|
| Canvas | `#0C0E11` |
| Surface | `#16191D` |
| Surface alt | `#1A1E22` |
| Input / chip | `#21262C` |
| Raised chip | `#262C33` |
| Body | `#C3C7CD` |
| Strong | `#EDEEF0` |
| Muted | `#6B727B` |
| Border | `#33383F` |
| Link | `#F0805C`, hover `#FF9D7D` |

⚠️ The prototype implements dark mode as attribute-scoped overrides keyed off literal inline background values. **That is a prototype hack — do not reproduce it.** Use CSS custom properties or the codebase's theming system.

### Typography

`"Google Sans", "Google Sans Text", Figtree, system-ui, sans-serif`. Figtree (400/500/600/700) loads from Google Fonts as the fallback.

| Role | Size | Weight |
|---|---|---|
| Page title | 24px | 600, `letter-spacing:-.01em` |
| Dialog title | 20px | 600 |
| Large metric | 34px | 600, `letter-spacing:-.02em` |
| Stat value | 24px | 600 |
| Section title | 15px | 600 |
| Panel title | 14px | 600 |
| Page subtitle | 14px | 400, `#8A8F98` |
| Body / table cell | 13px | 400–500 |
| Secondary cell | 12px | 400, `#6B7280` |
| Table heading | 11px | 600, uppercase, `letter-spacing:.07em`, `#9AA0A8` |
| Dense heading | 9px | 700, uppercase — permission matrix only |
| Status pill | 10px | 700, uppercase |
| Helper text | 11px | 400, `#9AA0A8` |

**Rules.** Numeric columns use `font-variant-numeric: tabular-nums` — always. Long prose uses `text-wrap: pretty`.

### Spacing, radius, elevation

- Spacing: 4 / 5 / 6 / 8 / 10 / 12 / 14 / 16 / 18 / 20 / 22 / 24 / 28px
- Radius: 5–6px small pills · 8–9px buttons and inputs · 10–12px large inputs and inline panels · 14px banners · 16px cards · 18px dialogs · 999px chips, avatars, toggles
- Card shadow `0 1px 2px rgba(16,24,40,.04), 0 6px 18px rgba(16,24,40,.05)`
- Dialog shadow `0 32px 64px rgba(16,24,40,.24)`
- Drawer shadow `-20px 0 48px rgba(16,24,40,.18)`
- Paper shadow `0 1px 3px rgba(16,24,40,.10), 0 12px 30px rgba(16,24,40,.08)`
- Selection ring `inset 0 0 0 1.5px #E0572E`

### Control heights

Page action 40px · dialog action 42px · input/select 42px (44px on auth) · compact 34px · row action 28px · status pill 22–24px · permission cell 26×26px · toggle 38×22px with an 18px knob · OTP entry full-width × 64px with `letter-spacing:.34em` · avatars 24/28/30/52px.

### Motion

```
wewePulse   2s infinite      accent ring on the current workflow step
weweRise    180ms ease-out   dialog and drawer entry (opacity + 6px translateY)
weweSweep   width 0 → 100%   progress fills
weweShimmer opacity .5→1→.5  loading placeholders
```
Hover transitions `140ms ease-out`.

---

## 4 · The shell

Fixed-height viewport. Sidebar and content scroll **independently**; the page itself never scrolls.

```
height:100vh; overflow:hidden;
min-width:1360px; max-width:1658px; margin:0 auto;
background:#E4E5E8; padding:16px; display:flex; gap:8px;

  sidebar  width:282px; flex:none; height:100%; overflow-y:auto
  content  flex:1; min-width:0; height:100%; min-height:0;
           overflow-y:auto; overflow-x:hidden; max-width:1320px
```

**1360px is a hard minimum.** Verify every layout at that width, not just at a wide viewport. Printable documents are fixed 794px sheets and ignore the 1320px cap.

**Build this first.** Getting the two independent scroll regions wrong makes every subsequent screen feel wrong, and it is very hard to retrofit.

### Sidebar

Brand mark, then groups with 11px uppercase labels: Transactions · Money · Operations · People · Governance · System. Each row is icon + label + optional count badge **derived from pending items at the signed-in role's stage**. Below the nav: "Signed in as", a Dark toggle, Sign out. Sub-navigation expands under the active module.

### Top bar

Search · spacer · notification bell (44px, unread badge) · **+ New** pill opening a quick-create chooser of eight flows · avatar.

The avatar shows the signed-in user's real job title. **The persona switcher only renders with `?demo=1`** — in production the persona is the signed-in user and there is no switching.

### Sign-in

Full-bleed two columns outside the app shell — no card, no visible container. Left is the cream form panel; right carries a photograph that **fades via a mask on the image itself**, not an overlay scrim. The image is oversized (`left:-55%; width:155%`) with a horizontal `mask-image` running transparent → opaque, so its own pixels dissolve and no hard edge appears at any boundary. Wordmark, form and footer share one 398px measure, centred as a block.

⚠️ **Any full-viewport overlay must be gated on auth state.** A regression once had the external-signer layer painting over the sign-in screen and intercepting every click. Overlays render only when the app is showing, and sit *below* the auth screen in z-order.

---

## 5 · Build order

Build these six primitives before any screen. Together they cover most of the product.

1. **Shell** — fixed height, independent scroll (§4).
2. **Table card** — see below. Almost every screen is a variation on it.
3. **Stat card** — white, `border-radius:16px; padding:20px`, card shadow. 13px/500 label; 24px/600 value with tabular numerals; 12px context line. Laid out `repeat(auto-fit, minmax(220px,1fr))`, `gap:12px`.
4. **Status pill** — `height:22px; padding:0 9px; border-radius:6px`, 10px/700 uppercase, tinted background + darker foreground.
5. **Workflow tracker** — complete: 26px green circle with a tick. Current: 26px accent circle, `wewePulse`. Future: 26px white circle, `2px solid #D3D6DB`. Connectors are 2px rules, green when passed.
6. **Dialog shell** — white, `border-radius:18px; padding:28px`, dialog shadow, `weweRise`, right-aligned Cancel + primary. Tall dialogs use `max-height:88vh; overflow-y:auto` with sticky header and footer.

Then: **wizard stepper** (clickable both directions plus Back/Continue) and **empty state** (centred, `padding:52–56px 24px`, 15px/600 title plus a 13px line explaining what appears here and how to create the first one).

### The table card, in detail

White, `border-radius:16px`, `overflow:hidden`. Header block `padding:20px 24px 14px` with title, 12px subtitle, optional right-aligned search or link. Column header row `padding:0 24px 8px`, 11px/600 uppercase, `border-bottom:1px solid #EEF0F3`. Body rows `padding:14px 24px`, zebra `#F8F9FA` on odd rows, hover `#F1F3F5`. Optional footer strip on `#FAFBFC`.

> **Tables are CSS Grid, not `<table>`.** Header and body rows must declare the **same** `grid-template-columns`. Numeric and action columns are fixed px; the descriptive column is `minmax(<min>, 1fr)`. Every text cell in a fixed track needs `min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap` or it will overlap its neighbour.
>
> **Verify at 1360px, and measure rendered text width against its track — not `scrollWidth`.** Centred text in an `overflow:visible` cell overflows silently without changing `scrollWidth`. This bit us repeatedly.

Make column definitions data-driven — label, width, alignment, cell renderer, status tone — so a screen becomes configuration rather than markup.

---

## 6 · Behaviour that is load-bearing

These are not decoration. Getting them wrong changes what the product means.

### Live recalculation
These recalculate on **every keystroke** and must not be faked:
- Requisition line items → row totals, grand total, budget state, approval route, submit enablement
- Timesheet hours → effort %, allocated-vs-expected, submit enablement
- Appraisal ratings → weighted score, band, band colour
- Report builder chips and filters → preview table, row count, header summary
- Form builder palette → live preview and field count
- Permission cells and column toggles → matrix state
- KPI weight · stock quantity · goods received · fulfilment state · bulk selection · decision note length

### Validation explains itself in place
A disabled primary button carries the reason, next to a banner giving the rule and the remedy. Real examples from the product: *"Submit blocked — 6 h unallocated"*, *"Needs three vendors"*, *"Not enough stock"*, *"Weight exceeds 100%"*, *"A note is required"*, *"Enter all 6 digits"*, *"Complete every line first"*, *"Justification required"*.

### Mandatory notes are a workflow rule
**Return and reject must be impossible without a written note**, at every entry point — detail panel, queue row, bulk. Confirm stays disabled under 8 characters. Approve, withdraw, resubmit and submit take an optional note.

### Never claim a write that did not happen
This is the single most important rule in the product. It is a money-approval system; telling an approver their approval went through when it did not is the worst failure available.

Every write routes through one contract:

```js
hook(name, payload, fallbackMsg)   // calls window['__wewe'+name](payload)
act(ref, verb, note)               // calls window.__weweAct(ref, verb, note)
```

Both **honour what the handler reports**: a throw, `false`, `null`, `undefined`, or `{ok:false, reason}` all produce a **failure toast carrying the engine's own reason** — red cross icon, not the green tick — and no success claim. State changes follow the write; they never precede it. A refused QuickBooks repost must not mark the exceptions fixed.

Where no handler is attached, the fallback toast is **neutral** — "Submitted.", "Saved." — never a fabricated specific like "3 journals created, ₦1,048,000.00 now in QuickBooks."

### The decision panel is permission-driven
Never infer from stage alone. The panel reads four flags supplied per transaction:

| Flag | Renders |
|---|---|
| `canAct` | Approve · Return · Reject |
| `canWithdraw` | Withdraw — initiator, still pending |
| `canResubmit` | Fix and resubmit — initiator, was returned |
| `canSubmit` | Submit for approval — draft |
| none | An explanatory line only |

When flags are absent, the fallback must check **both** that the transaction is not the viewer's own **and** that the viewer holds the current stage. Offering Approve to someone who holds none of the role is a bug even though the server refuses it.

On a returned transaction the initiator sees the approver's note repeated **inside the panel** under "What you were asked to change" — the note sits next to the button that answers it. Without this the return loop is a dead end.

### No generic confirm dialogs
Every action opens something specific: a document, a real form, or a decision with its consequences spelled out. If an action would only ever produce a confirmation, show a toast instead — and make that toast state the actual outcome. There are roughly thirty purpose-built dialogs in the prototype; study a few before writing your own.

### Empty and sparse states
Real data is sparse. Every list needs an empty state, correct pluralisation, and a layout that doesn't look broken with two rows.

---

## 7 · Screens

Full route list in `PHASE2-INTEGRATION.md`. Highlights where the behaviour is unusual:

**Requisitions.** Register with derived tab counts. Queue with row actions Approve · Return · Open plus header Bulk approve. **New requisition** starts genuinely clean — no purpose, one blank line, ₦0.00 — with a live budget panel that shows one of three states from your actual numbers: within budget (green), over budget with headroom (amber, with a **required** justification field that gates submit and rides along as `overBudgetJustification`), or no headroom at all (red, hard block, no justification offered — a written excuse cannot create money that isn't there). Detail binds any `:ref` and carries the permission-driven panel.

**Documents.** Repository with a 12-node folder tree, 8-class facet, live search, multi-select driving Add-to-evidence-pack / Legal hold / Download, and a real file picker emitting `{name, mime, dataBase64}`. Viewer binds `?id=`, with page thumbnails, in-document search reporting hit position, and a right rail carrying legal hold and access activity. E-signature, certificate with a **Hash matches / HASH MISMATCH** state, and a standalone external signer with an OTP gate.

**Roles & permissions.** Matrix of **17 modules × 7 actions** sourced from the backend catalog, lowercase scopes (`own`/`department`/`organisation`), tri-state column toggles, 11 segregation-of-duties rules (8 blocking), 9 sensitivity sets, and a draft-vs-published change log. Publishing emits a **complete** grant set — the save is a destructive full replace, so a partial set silently changes access.

**Timesheets.** Editable grid recalculating effort per keystroke; submission blocked until hours total the period **and** every row has a grant.

**Appraisals.** Editable supervisor ratings recalculating a weighted score and band live; self-vs-supervisor competency bars with evidence.

**Printables.** `/print/travel-authority`, `/print/purchase-order`, `/print/hr-letter` — 794px A4 sheets on letterhead with approval evidence, signature blocks and a verify QR. They print as-is; no separate stylesheet.

---

## 8 · Assets

Iconography is inline 24×24 stroked SVG — `stroke-width:1.6` for nav, `2.6–3` for status ticks and crosses, round caps and joins. Substitute the codebase's icon library rather than porting paths. Avatars are initials on a `#EBEDF0` circle. Signatures are a single stroked path.

⚠️ **QR codes in the prototype are deterministic placeholder matrices** with correct finder squares but meaningless data. Swap in a real encoder and feed it the `otpauthUri` (2FA) or verify URL (certificates, printables).

`shots/login-bg.jpg` must be served at that path for the sign-in screen.

---

## 9 · Traps we hit — do not repeat them

- **Grep before naming.** Dialog `kind` strings and view-model keys share one namespace. A duplicate silently renders two dialogs stacked on each other.
- **Overlays and auth.** Any `position:fixed; inset:0` layer must be gated on auth state and sit below the sign-in screen in z-order.
- **Temporal dead zone.** Route-derived values are computed in dependency order; declaring a helper below its first use blanks the entire app.
- **Measure text, not containers.** `scrollWidth` does not catch centred text overflowing an `overflow:visible` grid cell.
- **Derive counts once.** Every place a figure appears, it reads the same source. Reintroducing a literal is how the three-places-disagree bug comes back.
- **Verb grammar.** Past tenses are irregular — withdraw→withdrawn, resubmit→resubmitted. Use an explicit map, never string concatenation.

---

## 10 · Suggested sequence

1. Shell and the six primitives (§5).
2. Requisitions end to end — register, queue, new-requisition form, detail with the decision panel. It is the most-used flow and every other module copies its shape.
3. Advances, retirements, budgets — the money modules, same chain.
4. HR, leave, timesheets, payroll.
5. Procurement, inventory, assets.
6. Documents, e-signature, printables.
7. Grants, audit, reports.
8. Administration — roles, forms, workflow chain.
9. Auth and account screens. **These belong outside the authenticated layout** in production, even though the prototype renders them inside the shell so they stay reachable for review.

Wire each module's reads and writes as you build it, so a module goes fully live in one pass rather than leaving a trail of fixtures behind you.
