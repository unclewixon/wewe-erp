# Test personas — requisition flows

Verified against the live deployment. **Every account below signs in with `Password1!`** and none has 2FA enrolled, so sign-in is email + password, then the code screen passes straight through.

Sign in at the app URL with the persona you want to be. The old `?as=` URL switch is gone — it granted a session without a credential check, so switching persona now means signing out and signing in as that person.

## Super admin (for presenting)

| Email | Password | Roles |
|---|---|---|
| `superadmin@wewe.org` | `zObG5BBCfHnQ` | SYSTEM_ADMIN · FINANCE · INTERNAL_AUDIT · SUPERVISOR · FINAL_APPROVER · HR_OFFICER · INITIATOR |

Verified: reads **20/20** module endpoints and writes across requisitions, vendors and RFQs.

**It still cannot push one transaction through the whole chain, and that is deliberate.** Segregation of duties is not a permission, so no amount of role-granting switches it off:

```
approving its own requisition -> refused: an initiator cannot act on their own transaction
approving someone else's      -> ok
approving the SAME one twice  -> refused: this user has already approved a stage on this transaction
```

To demonstrate a full approval chain on stage, use the separate personas below — that is the product working, not a limitation to apologise for.

## The accounts

| Email | Role | Department |
|---|---|---|
| `amina.yusuf@wewe.org` | Initiator | Programmes |
| `chiamaka.eze@wewe.org` | Initiator | M&E |
| `emeka.nwosu@wewe.org` | Initiator (procurement) | Procurement |
| `blessing.adeyemi@wewe.org` | HR Officer · Initiator · **Supervisor** | Human Resources |
| `fatima.bello@wewe.org` | Finance · Initiator | Finance & Admin |
| `tunde.balogun@wewe.org` | **Supervisor** (all departments) · Initiator | Programmes |
| `ngozi.okafor@wewe.org` | **Internal Audit** | Grants & Compliance |
| `ibrahim.musa@wewe.org` | **Finance** | Finance & Admin |
| `folake.adeyemi@wewe.org` | **Final Approver (MD)** | Operations |
| `k.adeleke@auditfirm.ng` | External Auditor (read-only scope) | Grants & Compliance |
| `admin@wewe.org` | System Admin | Operations |

## The approval chain

```
SUPERVISOR  →  INTERNAL_AUDIT  →  FINANCE  →  FINAL_APPROVER
 always         always            always      only ≥ ₦500,000
```

Under ₦500,000 the MD stage is auto-passed and Finance closes it. Both bands are verified working:

- **₦400,000** → Tunde → Ngozi → Ibrahim → `APPROVED`
- **₦750,000** → Tunde → Ngozi → Ibrahim → Folake → `APPROVED`

## Use this path

**Raise as `amina.yusuf@wewe.org`** (Programmes). It is the only initiator whose whole chain is staffed end to end.

| To test | Sign in as |
|---|---|
| Create · save draft · submit · withdraw · fix-and-resubmit | `amina.yusuf@wewe.org` |
| Approve · return · reject · bulk approve | `tunde.balogun@wewe.org` |
| Second-stage approval | `ngozi.okafor@wewe.org` |
| Third-stage approval, closes anything under ₦500k | `ibrahim.musa@wewe.org` |
| Final signature on ₦500k and above | `folake.adeyemi@wewe.org` |

To see a **return loop**: raise as Amina → sign in as Tunde → *Return for correction* with a note → sign back in as Amina → the note is on the detail page with **Fix and resubmit** beside it.

To see the **over-budget justification**: raise a requisition larger than the remaining balance on its budget line. The panel turns amber and submit stays disabled until a justification is written; it is stored in the audit trail next to the budget warning. If the line has no headroom at all the panel turns red and blocks entirely — no justification is offered, because a written excuse cannot create money that isn't there.

## Departments

Seven now, with people spread by what they actually do: Programmes, M&E, Finance & Admin, Operations, Grants & Compliance, **Human Resources** and **Procurement**. The last two were added because HR and procurement work had no home and four of eleven people were sitting in Finance & Admin.

## ~~Known gap — three departments have no supervisor~~ RESOLVED

Tunde is the only Supervisor in the system, scoped to **Programmes and M&E**. Requisitions raised from the other three departments reach the Supervisor stage and stop there permanently — nobody can action them:

```
emeka.nwosu@wewe.org      (Operations)         → stalls
admin@wewe.org            (Operations)         → stalls
blessing.adeyemi@wewe.org (Finance & Admin)    → stalls
fatima.bello@wewe.org     (Finance & Admin)    → stalls
```

Resolved by `scripts/grant-supervisors.mjs`: Tunde and Blessing now hold organisation-wide Supervisor, so a requisition from any department can be approved. Two people hold it rather than one, because segregation of duties blocks self-approval — a lone supervisor's own requisitions would stall the same way.
