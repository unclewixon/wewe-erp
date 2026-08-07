# WEWE ERP — Design Phase 3 Request (paste this to Claude Design)

**Context:** you produced the Phase 1 and Phase 2 bundles. Phase 2 landed in full and is live. The bundle is the front end byte-for-byte, wired to a working backend — requisitions can now be raised, submitted, approved, returned and rejected against the real engine, in batches too.

This phase is small and comes from one production review of the requisition module. It is **not** a request for new screens. Every surface below already exists and looks right; what is wrong is **which controls the existing panel decides to show, and what the UI claims when a write is refused.** Same file, same design system, same runtime patterns, additive only.

One item is blocking a complete workflow — do it first.

---

## P0 — blocking a complete workflow

### G22 · The decision panel must be driven by the transaction's real permissions

**What happens now.** The `Your decision` panel on the requisition detail page assumes **the person viewing is the current stage's approver**. It reads the stage from the transaction and offers that stage's actions to whoever is looking.

Two consequences, both visible in the attached screenshots of the live app:

- `docs/design-requests/current-pending-as-initiator.png` — a requisition **viewed by the person who raised it**. The panel says *"You are acting as Supervisor. Approving releases this to the next stage."* and offers **Approve / Return for correction / Reject**. It is inviting the initiator to approve their own requisition. The engine correctly refuses this (segregation of duties is enforced server-side and cannot be bypassed), so the buttons cannot do damage — but the UI is offering an action that is never legitimate for this person.
- `docs/design-requests/current-returned-as-initiator.png` — the same requisition after the supervisor returned it with a note. The panel now reads *"This is with the initiator for correction. No decision is open to you."* — shown **to the initiator**, the one person who must act next. The supervisor's note is displayed correctly in the history; there is simply no way to respond to it. **The return loop is a dead end.**

**What we need.** The panel should stop inferring the viewer's role from the stage and instead render from the permission flags the backend already returns on every requisition:

```
permissions: {
  canAct:      true,   // this viewer may Approve / Return / Reject at the current stage
  canWithdraw: true,   // initiator, still pending — may pull it back
  canResubmit: true,   // initiator, was returned — may send it back up
  canSubmit:   true    // initiator, still a draft — may submit for approval
}
```

These are already live and correct. For the two screenshots above the backend returns, respectively, `{canAct:false, canWithdraw:true, canResubmit:false}` and `{canAct:false, canWithdraw:false, canResubmit:true}` — exactly the states the panel is getting wrong.

So the panel becomes four mutually-exclusive states, each with copy that explains *why*:

| Flag | Controls | Notes |
|---|---|---|
| `canAct` | Approve · Return for correction · Reject | today's panel, unchanged — keep the drawer and the mandatory note on return/reject |
| `canWithdraw` | **Withdraw** | new. Initiator, still pending. Pulls it out of the approver's queue and back to draft. Worth a confirm — it disappears from someone's queue |
| `canResubmit` | **Resubmit** | new. Initiator, was returned. This is the other half of the return loop and the most important control in this request |
| `canSubmit` | Submit for approval | draft state |
| none true | today's explanatory line | genuinely nothing to do — an observer, or a closed transaction |

**Resubmit deserves particular care.** The initiator arrives here because someone asked them to change something, and the note is right there in the history. The natural flow is: read the note → fix the lines → send it back. Consider whether resubmitting should let them add a short reply to the returner, and whether the button belongs near the note as well as in the panel. The engine accepts an optional comment on resubmit.

**Wiring:** call `window.__weweAct(ref, 'withdraw')` and `window.__weweAct(ref, 'resubmit')` on confirm, exactly as Approve/Return/Reject already do — same hook, new verbs. Fall back to current demo behaviour when the hook is absent. We will connect them on our side the moment the controls exist; both endpoints are built and tested.

*(Closes items 22 and 23 in DESIGN_GAP_REPORT.md.)*

### G25 · A refused write must not be reported as a success

**What happens now.** `act()` toasts `"<ref> — <verb> submitted."` unconditionally. It ignores the value the integration hook returns and swallows any error the hook throws. So when the engine refuses a write — wrong stage, missing mandatory note, insufficient permission, transaction already closed — the approver is told it worked. Nothing happened, and they have no way to know.

This is the single most consequential item in this request. It is a money-approval system; a person being told their approval went through when it did not is worse than any missing screen.

**What we need.** Honour the hook's result. It returns truthy on a successful write, `false` when the engine refused, and may throw. On refusal, show a failure state rather than the success toast — an error toast carrying the engine's reason is enough; the reason is meaningful, user-facing text (*"A clarification note is required"*, *"Current stage requires the SUPERVISOR role for this department"*, *"Transaction is RETURNED, not pending approval"*).

Please treat this as a **pattern across the bundle**, not a requisition fix: everywhere the design calls an integration hook and then toasts, the toast should reflect what actually happened. A general "this didn't go through — here's why" treatment, applied wherever writes are confirmed, is the deliverable.

*(Closes item 25.)*

---

## P1 — copy defect

### G24 · The bulk-approve confirmation reports the wrong count

`confirmBulk` clears `selected` in the same `setState` whose value it then reads for the toast, so a successful batch always announces **"0 items approved in one action."** The write itself is live and correct — a batch really is approved and really does advance — only the number in the message is wrong. Capture the count before clearing.

While you are in there: the batch can now partially succeed (some rows approved, others refused for a stated reason). G11's original spec anticipated this with a results state — *n approved, m skipped and why*. That is worth having now that the writes are real.

*(Closes item 24.)*

---

## Working notes

- **Nothing here needs a new screen.** G22 changes which controls an existing panel renders and adds two buttons to it; G25 adds a failure state to an existing confirmation pattern; G24 is a counting fix. If any of it tempts a new surface, we have got the framing wrong — tell us.
- **Data contract unchanged.** Keep reading the existing consts; integration substitutes them at boot. `permissions` arrives on the transaction detail object alongside `lines`, `history` and the tracker data you already consume.
- **Keep every existing route and byte of behaviour intact.** As before, deliver an updated single bundle; we replace `design/` wholesale and re-run the verbatim check.
- **Screenshots** in `docs/design-requests/` are the live app as of this request, captured against the running deployment — not mockups. They show the two broken states described in G22.
- Engineering-side record of these items, with endpoint detail, is in `docs/DESIGN_GAP_REPORT.md` (22–25).
