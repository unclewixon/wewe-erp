-- Wipe demo/dummy data, keep identity + org + budget structure.
--
-- KEPT:  departments, users, roles, user_roles, sessions, staff_profiles,
--        budget_lines, budget_versions, budget_allocations,
--        transaction_types, permissions, role_permissions, settings,
--        leave_types, doc_folders
--
-- Sessions are kept deliberately: truncating them signs everyone out, including
-- whoever is presenting. Budget versions and allocations are kept because lines
-- without them leave the budget module with structure but no money.
--
-- audit_events is truncated WHOLLY, never in part. The chain is hash-linked and
-- verify() walks it from the first row; removing a subset leaves a permanent
-- brokenAtId. An empty table restarts at 'GENESIS' and verifies clean.
--
-- Run inside one transaction so a mistake rolls back rather than half-applies.

BEGIN;

TRUNCATE TABLE
  -- workflow transactions (requisitions, advances, retirements, virements all live here)
  transactions, requisition_lines, stage_events, advances, retirements, qb_outbox,
  -- procurement
  vendors, rfqs, rfq_quotes, purchase_orders, po_receipts, contracts,
  -- documents & e-sign
  documents, doc_versions, doc_links, signature_requests, signature_signers,
  digitisation_batches, digitisation_pages,
  -- assets & stores
  assets, asset_events, inventory_items, inventory_moves,
  -- grants & audit findings
  grants, grant_deadlines, audit_flags, findings, auditor_scopes,
  -- messaging & delegation
  notifications, email_outbox, delegations,
  -- HR activity (staff_profiles kept — they are part of a user's identity)
  payroll_runs, payroll_items, timesheets, leave_requests, leave_balances, staff_checklists,
  -- reporting
  saved_reports, scheduled_reports,
  -- append-only log: all or nothing (see note above)
  audit_events
RESTART IDENTITY CASCADE;

-- What survived. Users must be non-zero or something cascaded that should not have.
SELECT 'users' AS kept, count(*) FROM users
UNION ALL SELECT 'departments', count(*) FROM departments
UNION ALL SELECT 'user_roles', count(*) FROM user_roles
UNION ALL SELECT 'sessions', count(*) FROM sessions
UNION ALL SELECT 'budget_lines', count(*) FROM budget_lines
UNION ALL SELECT 'budget_versions', count(*) FROM budget_versions
UNION ALL SELECT 'budget_allocations', count(*) FROM budget_allocations
UNION ALL SELECT 'transaction_types', count(*) FROM transaction_types
UNION ALL SELECT '-- wiped --', 0
UNION ALL SELECT 'transactions', count(*) FROM transactions
UNION ALL SELECT 'vendors', count(*) FROM vendors
UNION ALL SELECT 'audit_events', count(*) FROM audit_events;

COMMIT;
