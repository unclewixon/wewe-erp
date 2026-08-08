-- PROC-01: seed the PROCUREMENT_OFFICER grants that DEFAULT_ROLE_GRANTS defines in code.
-- The module seeder only runs on an empty database, so a role added to an existing
-- deployment has an enum value, a roles row, and no permissions — which is why the officer
-- was refused on a route their own role is supposed to own.
--
-- Mirrors permissions.logic.ts exactly:
--   procurement            VIEW CREATE EDIT SUBMIT EXPORT   organisation
--   inventory              VIEW CREATE EDIT                 organisation
--   documents, esign       VIEW CREATE                      own
--   budgets, reports       VIEW                             organisation
-- No APPROVE anywhere: the award proposes a commitment, the workflow disposes.

INSERT INTO permissions (module, action)
SELECT m, a FROM (VALUES
  ('procurement','VIEW'),('procurement','CREATE'),('procurement','EDIT'),('procurement','SUBMIT'),('procurement','EXPORT'),
  ('inventory','VIEW'),('inventory','CREATE'),('inventory','EDIT'),
  ('documents','VIEW'),('documents','CREATE'),
  ('esign','VIEW'),('esign','CREATE'),
  ('budgets','VIEW'),('reports','VIEW')
) AS v(m,a)
ON CONFLICT (module, action) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id, scope)
SELECT r.id, p.id, g.scope
FROM roles r
JOIN (VALUES
  ('procurement','VIEW','organisation'),('procurement','CREATE','organisation'),
  ('procurement','EDIT','organisation'),('procurement','SUBMIT','organisation'),
  ('procurement','EXPORT','organisation'),
  ('inventory','VIEW','organisation'),('inventory','CREATE','organisation'),('inventory','EDIT','organisation'),
  ('documents','VIEW','own'),('documents','CREATE','own'),
  ('esign','VIEW','own'),('esign','CREATE','own'),
  ('budgets','VIEW','organisation'),('reports','VIEW','organisation')
) AS g(module,action,scope) ON TRUE
JOIN permissions p ON p.module = g.module AND p.action = g.action
WHERE r.code = 'PROCUREMENT_OFFICER'
ON CONFLICT (role_id, permission_id) DO NOTHING;

SELECT p.module, p.action, rp.scope
FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
JOIN permissions p ON p.id = rp.permission_id
WHERE r.code = 'PROCUREMENT_OFFICER'
ORDER BY p.module, p.action;
