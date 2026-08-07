# RETRACTED — the Phase 1.8 regression report was wrong

**If this was sent to Claude Design, please send them this retraction.** Phase 1.8 was not broken. The fault was entirely on our side, in the test build used to evaluate it.

## What we got wrong

We reported that 1.8 rendered the external-signer screen over the sign-in screen, leaked raw `{{ }}` placeholders, and threw `ReferenceError`s — and concluded the bundle could not ship.

Every one of those symptoms came from **our own local build being incomplete**. The web build is two steps:

```
npx vite build && cp support.js dist/support.js
```

We ran only the first. `support.js` — the design runtime that compiles the templates — was missing from the build we tested, so it 404'd. With no runtime, nothing compiles: every screen renders at once as raw markup, `{{ }}` bindings appear verbatim, hidden screens overlay live ones and swallow clicks, and handlers appear undefined. That is a precise description of a bundle with no runtime, and it is exactly what we observed and misattributed.

## How we confirmed it

We served the untouched `.dc.html` files directly, with no build step and no adapter:

| bundle | Continue buttons | raw `{{ }}` | errors |
|---|---|---|---|
| 1.7 | 1 | 0 | none |
| **1.8** | **1** | **0** | **none** |
| 1.9 | 1 | 0 | none |

All three are clean. We then rebuilt 1.8 with the `cp support.js` step included and it rendered correctly — 1 Continue button, no leaks, no errors.

## What this means

- **1.8 was always fine.** Nothing needed fixing.
- Our "what we ruled out for you" section was worse than useless: it confidently eliminated the runtime as a factor (`support.js is byte-identical`) while the actual fault was that the runtime was not being served at all. Byte-identical on disk, absent from the build.
- Any time spent on that report is time we cost you. Sorry.

## Phase 1.9

We have verified 1.9 properly, against the live backend, with a correct build. It works, and the Phase 3 items are confirmed live end to end:

- **Withdraw** — pulls a pending requisition back; engine returns `WITHDRAWN`.
- **Fix and resubmit** — returns a corrected requisition to the chain; engine returns `PENDING @ SUPERVISOR`. **The return loop now closes**, which was the most important gap in the brief.
- **Bulk approve** — writes through the new `BulkApprove` hook and reports the real count.
- The decision panel reads the permission flags correctly once we pass them through.

No further design work is needed from this round. Thank you — and again, apologies for the false alarm on 1.8.
