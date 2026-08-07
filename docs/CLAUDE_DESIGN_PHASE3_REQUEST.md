# WEWE ERP — Design Phase 3 Request (paste this to Claude Design)

**Context.** You produced Phase 1, Phase 2 and Phase 1.7. The bundle is the live front end, byte-for-byte, wired to a working backend. We have now reviewed the requisition module end to end against the running system and audited every write surface in the bundle. This request is the complete result.

**Phase 1.7 landed well — please read this first.** It closed most of what was blocking integration. `UploadDocuments` now carries file bytes, `StartDelegation` carries real delegate IDs and dates, `SendRfq` carries a title, `SignDocument` carries a request ID, `SaveWorkflowChain` carries the full stage config, `StartAssetVerification` carries a location. Those were the payloads we could not wire before; we can wire them now. **No further work is needed on any of them.** We also verified 1.7 preserves every integration seam and builds cleanly — it is safe to adopt.

What follows is what remains. One item is much bigger than the rest.

---

## P0 · G25 — A confirmed write must not announce success unless it succeeded

**This is the most serious item in the review, and it is systemic.**

The bundle has a good contract for writes: `hook(name, payload, fallbackMsg)` calls `window['__wewe'+name]`, and we attach real engine calls to it. Where that contract is used, everything works.

The problem is that **15 confirmation handlers bypass it entirely** and call `this.toast(...)` directly with a specific, confident claim that a write happened. There is no seam for integration to attach to — we cannot make these real without changing the design, and we will not touch the design. So they announce work that never occurs, and will keep doing so no matter what we build behind them.

They are specific enough to be believed:

```
qbRepostAll   "All exceptions reposted — 3 journals created, ₦1,048,000.00 now in QuickBooks."
ap2Approve    "<ref> approved for <amount>. It moves to payment processing and the budget line is committed."
onApprove     "<name>'s timesheet approved — 40 hours charged to USAID-LON-24, EU-WISH-23 and FCDO-ACE-25."
confirmSign   "Signature applied. Certificate page generated."
chDo          "Chase sent to <name> and copied to their supervisor."
```

No journals are created. No budget line is committed. No signature is applied. No email is sent.

The full list: `ap2Approve` · `ap2Return` · `apSignHrDo` · `apSignSupDo` · `chDo` · `confirmApprove` · `confirmBulk` · `confirmDlgFilter` · `confirmDlgUpload` · `confirmSign` · `onApprove` · `qbRepostAll` · `shareSend` · `tplCopy` · `tplSave`. (Found by scanning single-line handlers; please check for multi-line ones too.)

**What we need, in two parts:**

1. **Every handler that confirms a write routes through `hook()`** — or through `act(ref, verb, note)` for the workflow verbs. Give each one a hook name and a payload carrying the IDs the action refers to. Keep the current toast as the `fallbackMsg` so the prototype still demonstrates well standalone.

2. **Honour what the hook reports.** Today even the correct path lies: `act()` toasts `"<ref> — <verb> submitted."` unconditionally, ignoring the hook's return value and swallowing its throw. The hook returns truthy on a real write and `false` when the engine refuses. On refusal, show a failure state instead of the success toast — an error toast carrying the engine's reason is enough. Those reasons are already written for people: *"A clarification note is required"*, *"Current stage requires the SUPERVISOR role for this department"*, *"Transaction is RETURNED, not pending approval"*.

Please treat part 2 as a **pattern across the whole bundle**, not a per-screen fix. It is a money-approval system; telling an approver their approval went through when it did not is the worst failure the product can have.

---

## P0 · G22 — The decision panel must be driven by real permissions

**What happens now.** The `Your decision` panel on the requisition detail page assumes **the viewer is the current stage's approver**. It reads the stage and offers that stage's actions to whoever is looking. Two consequences, both in the attached screenshots of the live app:

- `docs/design-requests/current-pending-as-initiator.png` — a requisition **viewed by the person who raised it**. The panel says *"You are acting as Supervisor. Approving releases this to the next stage."* and offers **Approve / Return / Reject**. It is inviting the initiator to approve their own requisition. The engine refuses this (segregation of duties is enforced server-side), so no damage is possible — but the UI should never offer it.
- `docs/design-requests/current-returned-as-initiator.png` — the same requisition after the supervisor returned it with a note. The panel now reads *"This is with the initiator for correction. No decision is open to you."* — **shown to the initiator**, the one person who must act next. The note displays correctly; there is simply no way to respond. **The return loop is a dead end.**

**What we need.** Render the panel from the permission flags the backend already returns on every transaction:

```
permissions: { canAct, canWithdraw, canResubmit, canSubmit }
```

For the two screenshots above the backend returns `{canAct:false, canWithdraw:true, canResubmit:false}` and `{canAct:false, canWithdraw:false, canResubmit:true}` — exactly the states the panel gets wrong.

| Flag | Controls | Notes |
|---|---|---|
| `canAct` | Approve · Return · Reject | today's panel, unchanged — keep the drawer and the mandatory note |
| `canWithdraw` | **Withdraw** | new. Initiator, still pending. Confirm it — it leaves someone's queue |
| `canResubmit` | **Resubmit** | new. Initiator, was returned. The other half of the return loop |
| `canSubmit` | Submit for approval | draft state |
| none | today's explanatory line | genuinely nothing to do |

**Resubmit deserves care.** The initiator is here because someone asked them to change something, and the note is on screen. The flow is: read the note → fix the lines → send it back. Consider letting them add a short reply, and whether the control belongs beside the note as well as in the panel. The engine accepts an optional comment on resubmit.

**Wiring:** call `window.__weweAct(ref, 'withdraw')` and `window.__weweAct(ref, 'resubmit')` on confirm, exactly as the other verbs do — same hook, new verbs. Both endpoints are built and tested; we connect them the moment the controls exist.

### G22b — the same panel is needed for the other transaction types

The engine runs the identical five-stage workflow for **advances, retirements, virements and purchase orders**, and the API is the same (`/v1/transactions/:id/action`). But the bundle has exactly one `Your decision` panel, on requisitions. Advances get a pair of Approve/Return buttons whose handlers are two of the seamless toasts above (`ap2Approve`, `ap2Return`) with no permission logic; retirements, virements and POs have no approval surface at all.

Please make the decision panel a **reusable component driven by `permissions`**, and place it on the detail view of every approvable transaction type. If those detail views don't exist yet, say so and we will scope them as their own phase — do not improvise them into this one.

---

## P1 · G24 — The bulk-approve confirmation reports the wrong count

`confirmBulk` clears `selected` in the same `setState` whose value it then reads for the toast, so a successful batch always announces **"0 items approved in one action."** Capture the count before clearing.

The batch can now genuinely partially succeed — some rows approved, others refused with a stated reason. G11's original spec anticipated this with a results state (*n approved, m skipped and why*). That is worth building now that the writes are real. `confirmBulk` also appears in the G25 list above; the two fixes belong together.

---

## P1 · G26 — The new column mappings in 1.7 point at the wrong API fields

Phase 1.7 added `api:` hints to the requisition register's column definitions. Three are wrong, checked against the live response:

```
Initiator      api:'createdAt'   →  field does not exist on the row (null)
Department     api:'typeCode'    →  field does not exist on the row (null)
Current stage  api:'status'      →  returns 'RETURNED', not the stage
```

The actual list row is:

```
amountKobo · chain · currentStage · department · donorCode · id · initiator
ref · stageRole · status · submittedAt · title · updatedAt
```

So they should be `initiator`, `department`, and `currentStage` (or `stageRole` for the role label). As written, two columns render blank and a third shows the wrong value. Since these hints exist precisely to tell integration where data comes from, they are worth correcting at source.

---

## Not your problem — recorded so you don't chase it

Several write points cannot be completed on your side, and we are **not** asking you to change them:

- **No endpoint exists yet** (backend work, queued on our side): `RaiseRemittancePayment` · `StartOnboarding` · `CreateRole` · `CreateObjective` · `SignOutOtherSessions` · `SaveSignature` · `SaveForm` · `PublishForm` · per-payslip `EmailPayslip`.
- **Authentication** — the sign-in screen and 2FA step are ours to fix, not yours. The design is fine; the integration behind it is a demo stub.

If a screen, state or component this request implies does not exist in the bundle, **stop and tell us** rather than improvising it — same rule as always.

---

## Working notes

- **Almost nothing here needs a new screen.** G25 adds a failure state to an existing confirmation pattern and routes existing handlers through the existing hook contract; G22 changes which controls an existing panel renders and adds two buttons; G24 and G26 are a counting fix and a field-name fix. G22b is the one item that may need new surfaces — flag it rather than inventing them.
- **Data contract unchanged.** Keep reading the existing consts; integration substitutes them at boot. `permissions` arrives on the transaction detail object alongside `lines`, `history` and the tracker data you already consume.
- **Keep every route and byte of existing behaviour intact.** Deliver an updated single bundle; we replace `design/` wholesale and re-run the verbatim check.
- **Screenshots** in `docs/design-requests/` are the live deployment, not mockups.
- Engineering-side record, with endpoint detail, is in `docs/DESIGN_GAP_REPORT.md` (items 22–26).
