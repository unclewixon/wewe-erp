/**
 * Production bootstrap — stand up a CLEAN organisation (no demo data).
 * Run this instead of the demo seed when SEED_DEMO=0.
 *
 *   ADMIN_EMAIL=admin@wewe.org ADMIN_PASSWORD='<strong>' \
 *   pnpm --filter api exec ts-node --transpile-only scripts/bootstrap-prod.ts
 *
 * Creates: the eight system roles, one SYSTEM_ADMIN user (from env), and the module
 * reference data (transaction types, settings, permission matrix, leave types, folders).
 * It does NOT create departments, budget lines, or any transactions — the admin builds
 * the real organisation through the app. Refuses to run if any users already exist.
 *
 * Two sample grants (USAID-LON-24, EU-WISH-23) come from the module defaults as
 * templates; edit or delete them in-app once the real grants are entered.
 */
import * as argon2 from 'argon2';
import { db, pool, schema } from '../src/db/client';
import { moduleSeedDefaults } from '../src/app';

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD environment variables.');
  if (password.length < 10) throw new Error('ADMIN_PASSWORD must be at least 10 characters.');

  const existing = await db.select().from(schema.users);
  if (existing.length) {
    console.log(`Refusing: ${existing.length} user(s) already exist. Bootstrap is for an empty database only.`);
    await pool.end();
    return;
  }

  const roleDefs: [string, string][] = [
    ['INITIATOR', 'Initiator'], ['SUPERVISOR', 'Supervisor'], ['INTERNAL_AUDIT', 'Internal Audit'],
    ['FINANCE', 'Finance'], ['FINAL_APPROVER', 'Final Approver'], ['HR_OFFICER', 'HR Officer'],
    ['SYSTEM_ADMIN', 'System Administrator'], ['EXTERNAL_AUDITOR', 'External Auditor'],
    ['PROCUREMENT_OFFICER', 'Procurement Officer'],
  ];
  await db.insert(schema.roles).values(roleDefs.map(([code, name]) => ({ code: code as any, name }))).onConflictDoNothing();
  const roles = await db.select().from(schema.roles);
  const adminRole = roles.find((r) => r.code === 'SYSTEM_ADMIN');
  if (!adminRole) throw new Error('SYSTEM_ADMIN role missing after insert.');

  const passwordHash = await argon2.hash(password);
  const [admin] = await db.insert(schema.users).values({
    email, name: process.env.ADMIN_NAME || 'System Administrator', title: 'System Administrator', passwordHash,
  }).returning();
  await db.insert(schema.userRoles).values({ userId: admin.id, roleId: adminRole.id, departmentId: null });

  await moduleSeedDefaults();

  console.log('Bootstrap complete.');
  console.log(`  Admin user: ${email} (set your own strong password; enable 2FA at first login)`);
  console.log('  Reference data seeded: transaction types, settings, permission matrix, leave types, document folders.');
  console.log('  Next: create departments, users, and budget lines in-app; edit/delete the two sample grants.');
}

main().then(() => pool.end()).catch((e) => { console.error(e); pool.end(); process.exit(1); });
