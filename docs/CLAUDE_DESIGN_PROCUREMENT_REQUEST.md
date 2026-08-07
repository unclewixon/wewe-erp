# WEWE ERP — Procurement write controls (paste this to Claude Design)

**The procurement backend is finished and tested end to end; the module has one control that can reach it.** Vendors, RFQs, quotes, award, purchase orders, goods receipts and contracts all work on the engine — 35 of 36 checks pass against the live system. The bundle emits exactly one procurement write, `SendRfq`, which we have now wired. Every other operation exists on the engine with no control anywhere in the UI to trigger it.

Searching the whole bundle for procurement handlers returns two: `openRfq` and `rfqSend`.

## Already live — please do not redo

- **Vendor registry**, **RFQ list and quote comparison**, **purchase orders** and **contracts** all read live data. The comparison screen already shows real quotes against a real RFQ.
- **Raise RFQ from requisition** works: the dialog, the title field, the vendor picker and the three-vendor gate all behave, and it now writes to the engine.

## What is missing

The module has a spine — **quote → award → purchase order → goods receipt** — and today it stops after the first step. An RFQ can be raised and quotes can be viewed, and then nothing further can happen. Below, each item names the hook to fire and the payload the engine expects.

### P0 · The award spine

**1. Record a quote against an RFQ.** Quotes arrive by email and someone types them in. Needs vendor, total, optional line detail and validity.
`hook('AddQuote', { rfqId, vendorId, totalKobo, lines?: [{description, qty, unitKobo}], validityDays? })`

**2. Award a winning quote.** This is the most interesting screen in the module, because the rules are real and the UI has to carry them:

- Below the amount band's quote count — **three** at the current threshold — the award is refused unless the buyer writes a **sole-source case**. The engine's own words: *"This amount band requires at least 3 quote(s) — you have 2. Add more quotes or provide a sole-source justification."*
- Every award needs a **written justification of at least 10 characters**, whatever the count.
- The top band additionally requires a **committee note**.
- A **blacklisted vendor cannot win**, and the engine refuses it.

`hook('AwardQuote', { rfqId, quoteId, justification, soleSource?, committeeNote? })`

The comparison screen is the natural home: pick a winner, and let the form ask for exactly what that award requires — the sole-source box appearing only when the quote count is short is the behaviour worth designing.

**3. Raise the purchase order** from the awarded RFQ. One action, no fields — the PO is generated from the award.
`hook('CreatePurchaseOrder', { rfqId })`

**Note:** a PO is *not* an approval transaction. The spend was approved at the requisition stage, so there is no approve/return control to design here — issuing it is the action.

**4. Record a goods receipt** against a PO — quantities per line, plus a note. Partial deliveries are normal, so the form should take a received quantity per line rather than a single confirm.
`hook('RecordGoodsReceipt', { purchaseOrderId, lines: [{lineIndex, qty}], note? })`

### P1 · Vendors

**5. Register a vendor** — name, contact, TIN, categories.
`hook('CreateVendor', { name, contact?: {email, phone, address}, tin?, categories?: [] })`

**6. Record due diligence** — CAC and tax-clearance references plus an expiry. This matters more than it looks: **a vendor is only invitable when its due diligence is complete and unexpired**, and the "Create RFQ" button counts only those vendors. A vendor with lapsed papers should read as blocked in the picker, with the reason visible.
`hook('RecordDueDiligence', { vendorId, cacDocId, taxClearanceDocId, expiresAt })`

**7. Bank details** are deliberately two-handed: a change is never applied on submission, and **the person who proposed it cannot confirm it**. The design needs a pending state on the vendor record and a confirm/reject pair that is visibly for someone else — that separation is the control, so it should be legible rather than incidental.
`hook('ProposeBankDetails', { vendorId, bankName, accountName, accountNumber })` · `hook('ConfirmBankDetails', { vendorId })` · `hook('RejectBankDetails', { vendorId, reason })`

**8. Blacklist / reinstate a vendor**, each with a **mandatory written reason**. Restricted to Finance, Internal Audit and Admin.
`hook('BlacklistVendor', { vendorId, reason })` · `hook('UnblacklistVendor', { vendorId, reason })`

### P1 · Contracts

**9. Create a contract** — vendor, title, value, start and end dates.
`hook('CreateContract', { vendorId, title, valueKobo, startsAt, endsAt })`

**10. Record a payment** against a contract, and **11. amend the contract value** with a reason of at least 10 characters. Both are restricted to Finance and Admin.
`hook('RecordContractPayment', { contractId, amountKobo, note? })` · `hook('AmendContract', { contractId, newValueKobo, reason })`

## How to treat refusals

Every rule above is enforced by the engine and returns a sentence written for a person — *"This amount band requires at least 3 quote(s) — you have 2…"*, *"Select a winning quote before generating a PO"*, *"RFQ is SELECTED — only OPEN RFQs can be selected"*. `hook()` already surfaces these through `fail()`. Where a rule can be known in advance — quote count, blacklist status, lapsed due diligence — the UI should say so before the click rather than after it, the way the new-requisition form gates submit on the over-budget justification.

## Working notes

- Data contract unchanged: keep reading the existing consts; integration substitutes them at boot.
- If a screen this implies does not exist in the bundle, **say so and we will scope it** rather than have you improvise it.
- Keep every existing route and byte of behaviour intact; deliver an updated single bundle.
- Recorded on our side as gap 29 in `docs/DESIGN_GAP_REPORT.md`.
