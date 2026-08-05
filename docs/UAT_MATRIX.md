# UAT Traceability Matrix

Feature IDs → test scenarios → verification status. "Verified (build)" = exercised end-to-end against the running system during development (this repo's history contains the evidence); WEWE's formal UAT re-runs every scenario with their own staff across all five approval roles. Scenarios marked "UI pending design" work at API level but await design gaps #20–21 for their screens.

| ID | Scenario | Status |
|---|---|---|
| AUTH-01 | Sign in with work email + password; neutral failure message; deactivated account cannot sign in | Verified (build) |
| AUTH-02 | Enrol TOTP (QR + backup codes); next login demands code; backup code consumes on use; admin reset | Verified (build) — enrolment screen: design gap #1 |
| AUTH-03 | Session expires after 12 h idle window; sign-out kills session | Verified (build) — sessions UI: gap #6 |
| AUTH-04 | 5 wrong passwords → progressive lock (correct password refused); doubling locks; admin unlock | Verified (build) |
| AUTH-05 | Deactivating a user kills sessions, cancels delegations, notifies admins | Verified (build) |
| WFE-01/02 | Five-stage chain routes by department; Supervisor scoped to own department only | Verified (build + unit tests) |
| WFE-03 | Requisition under ₦500k auto-passes Final Approver; tracker reports it, never a silent gap | Verified (build) |
| WFE-04 | Approve advances; reject terminates with reason; return restarts chain on resubmission | Verified (build) |
| WFE-05 | Delegation: date-bounded, ≤30 days, no chains; SoD blocks delegator-initiator and delegator-prior-approver; on-behalf-of logged | Verified (build + unit tests) |
| WFE-06 | SLA scan: reminder at 75%, escalation at 100%, deduped per stage | Verified (build; manual trigger endpoint) |
| WFE-08 | Bulk approve ≤50 items; amount ceiling; open-flag items excluded; per-item results | Verified (build) |
| WFE-09 | Withdraw before first action only; clone lineage visible | Verified (unit tests) |
| WFE-10 | Transaction types configurable via API; chains freeze at submission | Verified (build) — editor UI: gap #10 |
| REQ-01/03 | Itemised requisition; live tracker; queue/mine/all scopes | Verified (build + UI) |
| REQ-02 | Over-budget line warns or blocks per settings, with per-line detail | Verified (build) — form state UI: gap #13 |
| ADV-01..04 | Advance request → disburse (Finance) → deadline armed → overdue blocks new advances; outstanding register | Verified (build) |
| RET-01..05 | Retirement against advance; variance + refund computed; partials; advance closes at zero | Verified (build) |
| BUD-01..03 | Budget versions/allocations/activation; live position; virement via approval chain with source-floor guard | Verified (build + unit tests) |
| QBI-01..05 | Approved money movements queue journals; sandbox posts; exceptions listed + repostable | Verified (build; live OAuth pending credentials) |
| DMS-01..04 | Upload (hash, dedupe warning), versions/restore, confidential + department permissions, search with snippets | Verified (build + unit tests) |
| DMS-05/06 | Digitisation intake endpoints; archive, legal hold, dual-approved disposal wipes bytes, keeps audit row | Verified (build) |
| DMS-08a–d | Signature request → ordered ceremony → certificate w/ hash; external signer via token + OTP; verify endpoint detects tamper | Verified (build + unit tests) — ceremony UI: gaps #14–16 |
| HRM-01..05 | Profiles w/ bank-detail masking; leave workflow decrements balances; checklists block on mandatory items; letters generated + filed | Verified (build) |
| TLS-01..03 | Timesheet totals 100%; locks on approval; adjustments never edit originals; LOE report | Verified (build + unit tests) |
| PAY-01..03 | Payroll run computes PAYE/pension/NHF in exact kobo (band tests); release chain; payslips self-scoped; cost distribution by LOE | Verified (unit tests + build) |
| PRC-01..05 | Vendor dual-confirm bank changes; RFQ quote thresholds; PO ≤ requisition; partial receipts; contract payment ceiling; order-splitting report | Verified (build + unit tests) |
| AST-01..04 | Register; two-step assignment; verification campaign; disposal via chain; straight-line depreciation | Verified (build + unit tests) |
| INV-01..04 | GRN/issue/adjust/count; stock never negative (row-locked); low-stock notifies Finance | Verified (build + unit tests) |
| DGM-01..04 | Grant budget-vs-actual by donor code; FX integer math; donor report JSON/CSV; reporting calendar escalates | Verified (build + unit tests) |
| AUD-01 | Every consequential action logged; hash chain verifies; survives restore drill | Verified (build; verify endpoint) |
| AUD-02..05 | Flags block bulk actions; findings register; evidence packs; access/activity reports | Verified (build) |
| AUD-06 | External auditor: donor/period-scoped list, writes 403, revocation kills sessions, auto-expiry | Verified (build) |
| DSH-01..04 | Role dashboards live (5+4 personas); pipeline analytics (median/p90/bottleneck); registers + exports | Verified (build + UI) |
| DSH-05/06 | Scheduled report runs to role recipients; saved reports with whitelisted columns + CSV | Verified (build) |
| ADM-01..05 | Users CRUD + invite; permission matrix with SoD-pair blocking + resolver; settings audit-logged; departments guarded delete; integration console | Verified (build) |
| RBAC runtime | Matrix ENFORCES at request time: revoking a grant denies instantly (403 naming module+action); restoring re-allows instantly; SYSTEM_ADMIN break-glass bypass; personal surfaces (dashboard, notifications, own delegations) ungoverned by design | Verified (build) |
| MOB-01..03 | Responsive design bundle covers mobile routes (`/mobile`) | Design-verified; device pass in formal UAT |
| NTF-01..03 | In-app feed from events; email outbox (dev transport); digest preference | Verified (build; provider OAuth pending) |

| SYSTEM SWEEP | Scripted 67-check lifecycle walk across every module as 11 real personas (scripts/system-verify.mjs) + 21-route UI sweep (scripts/ui-sweep.mjs): 67/67 API checks pass, 0 blank routes, 0 JS errors, 0 API-log errors, audit chain verified | Verified (build) — rerun before every release |

**Formal UAT protocol:** each row is executed by WEWE staff in their real roles on a staging deployment (see docs/DEPLOYMENT.md), evidence captured per scenario, Sev-1/2 defects block go-live per the acceptance gates in the Features Spec §17.
