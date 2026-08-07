# Phase 1.8 — regression report (paste this to Claude Design)

**Please read the second section before doing anything.** The Phase 3 work in 1.8 is correct and complete. This is a rendering regression on top of it. We need a reissue, not a redo.

## The blocker: nobody can sign in

The external-signer screen renders **on top of** the sign-in screen and intercepts every click. The sign-in "Continue" button is visible, enabled and stable, and still unclickable — the browser reports the interception directly:

```
<div>…</div> from <sc-if value="{{ isExt }}"> subtree intercepts pointer events
```

The app is unusable from the first screen.

**Supporting symptoms, all pointing the same way — several screens are being painted at once:**

- **Six** `Continue` buttons render on the landing page. Phase 1.7 renders one.
- Raw template placeholders reach the screen: `{{ extOtp }}` appears where the external signer's code input should be, and one button carries the literal attribute `onclick="{{ toSecondFactor }}"` — that node was never compiled.
- Two `ReferenceError`s at load: `onOtp is not defined`, `nrSetPurpose is not defined`. **Both are defined in the bundle**, so these are scope/compile failures, not missing handlers. `nrSetPurpose` is the new-requisition Purpose field, so the create flow is in the blast radius too.

**Controlled comparison** — the same script, same steps, against the live 1.7 deployment and a local 1.8 build:

| | live (1.7) | 1.8 |
|---|---|---|
| after clicking Continue | Two-step verification | click intercepted, times out |
| `Continue` buttons on page | 1 | 6 |
| raw `{{ }}` visible | none | `{{ extOtp }}` |
| page errors | none | 2 × ReferenceError |

**What we ruled out for you:**

- `support.js` is **byte-identical** to 1.7 — the runtime is not involved. The fault is inside `WEWE ERP.dc.html`.
- Tag balance is clean: `sc-if` 605 open / 605 close, `sc-for` 128/128, and `div` / `span` / `button` all even. So it is not a simply unclosed tag.
- The gating expression is unchanged from 1.7: `isExt: base('/sign/external')`. The condition is the same, so what changed is how or where that block is emitted — most likely its nesting relative to the screens added in this phase, or a wrapper that no longer contains it.

**To reproduce:** load the app at `/`, fill the sign-in fields, click `Continue`.

## Do not redo the Phase 3 work — it is right

We verified all of it against the live backend. Keep every bit of this:

- **G22** — the decision panel reads `permissions` and carries **Withdraw** and **Resubmit**. Correct.
- **G25** — `act()` honours the hook's return value, catches its throw, and fails with the engine's own reason. Confirm handlers with no integration seam are down from **15 to 1**. This was the biggest item in the brief and it is properly done.
- **G24** — `confirmBulk` captures the count before clearing, and routes through a real `BulkApprove` hook carrying `{ids, verb}`. Both halves fixed.
- **G26** — the column hints now read `initiator`, `department`, `currentStage`. Correct.

We also confirmed every integration seam survives — the identity map behind `REQ_ROWS`, the `window['__wewe'+name]` dispatch, and all 36 of our build-time injection points. Our side is ready: the two adapter rewires 1.8 needs (`__weweBulkApprove`, and routing `withdraw`/`resubmit` to their own endpoints) are written and waiting on a branch.

## What we need

The same bundle, with the overlay fixed and the uncompiled nodes compiling. Everything else stays exactly as it is in 1.8.

One request for the reissue: **open the app and sign in before shipping it.** Both this and the check we ran are a single page load and one click — the blocker is not subtle once the app is opened.
