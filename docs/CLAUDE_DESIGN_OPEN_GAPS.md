# WEWE ERP — remaining design gaps after Phase 1.10 (paste this to Claude Design)

**Phase 1.10 landed well.** Verified against the live backend, end to end. Please do not redo any of this:

- **Withdraw** and **Fix and resubmit** work — the return loop closes: a supervisor returns with a note, the initiator sees it on the detail page and sends the requisition back up.
- The **decision panel reads `permissions`** and shows the right controls to the right person.
- **`act()` fails honestly** — it honours the hook's return value, catches its throw, and surfaces the engine's own reason instead of a false success.
- **Bulk approve** captures the count before clearing and routes through the `BulkApprove` hook.
- **`ap2Approve` / `ap2Return`** now route through `act()`, so advances reach the engine.
- The register's **`api:` column hints** are correct (`initiator`, `department`, `currentStage`).
- Confirm handlers with no integration seam are down from 15 to **zero** — the one the scan still flags, `confirmDlgFilter`, only applies a filter and claims no write.

Two things are left.

---

## P0 · G27 — The sign-in form has no fields anyone can type into

The email and password inputs are fixed literals with no binding and no `onChange`:

```html
<input value="n.okafor@wewe.org.ng" />
<input type="password" value="························" />
```

React renders those read-only, so a real person cannot enter a credential. There is also no hook on the sign-in path, so nothing on that screen can reach the engine.

This is now the last thing standing between the product and real authentication. The engine side is finished and waiting: argon2 hashing, progressive account lockout, per-IP throttling, neutral failure messages that do not disclose account status, and TOTP when a user has enrolled.

**What we need:**

1. **Bound fields** — `value` + `onChange` on both inputs, held in state like every other form in the bundle.
2. **A `SignIn` hook** — `hook('SignIn', { email, password }, …)` on the Continue button, and `hook('Verify2fa', { code }, …)` on the verification screen. The engine answers `{requires2fa: true}` when a second factor is owed, so the screens can stay exactly as designed; only the trigger changes.
3. **The signed-in identity from data, not a literal.** The two-step screen currently reads *"…code for **n.okafor@wewe.org.ng**"* whoever is signing in. That address appears three times in the bundle and belongs to nobody real.

Until this ships, integration works around it by replacing the two inputs with clones at runtime — dropping React's listeners so they accept text — and intercepting the buttons. It works and is deployed, but it is surgery on rendered output rather than wiring, and it breaks the moment that markup changes.

---

## P1 · G28 — Three transaction types can be raised but never approved

Retirements, virements and purchase orders run the **same five-stage engine** as requisitions, through the same `/v1/transactions/:id/action` endpoint. But the bundle has no approval surface for any of them:

```
retirements       no approve / return control   (0 in the bundle)
virements         no approve / return control   (0)
purchase orders   no approve / return control   (0)
```

So they can be created and they enter the workflow, and then nobody can move them. They sit at their first stage permanently — the same dead end the requisition return loop had before 1.9.

Advances are half-solved: `ap2Approve` and `ap2Return` reach the engine now, but they sit in a fixed dialog rather than the permission-driven panel, so the controls show regardless of whether the viewer may actually act. The engine refuses correctly, but the UI still offers it.

**What we need:** the `Your decision` panel generalised into a reusable component driven by `permissions`, and placed on the detail view of every approvable transaction type. It already exists and works for requisitions — this is reuse, not new design.

If a detail view for those types does not exist in the bundle yet, **say so and we will scope it as its own phase** rather than have you improvise it here.

---

## Working notes

- No new screens are needed for G27 — it is binding and a hook on a screen you have already designed.
- Data contract unchanged: keep reading the existing consts; integration substitutes them at boot. `permissions` arrives on the transaction detail object alongside `lines`, `history` and the tracker data.
- Keep every existing route and byte of behaviour intact; deliver an updated single bundle and we replace `design/` wholesale and re-run the verbatim check.
- **Please open the app and sign in before shipping.** Both remaining items are visible within one page load and one click.
