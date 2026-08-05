/* Demo organisation seed. Idempotent-ish: wipes and re-creates. Run: pnpm --filter api seed */
import * as argon2 from 'argon2';
import { db, pool, schema } from '../src/db/client';
import { AuditService } from '../src/audit/audit.service';

(BigInt.prototype as any).toJSON = function () { return this.toString(); };
const N = (naira: number) => BigInt(Math.round(naira)) * 100n; // naira → kobo

async function main() {
  const audit = new AuditService();

  // wipe (FK order)
  for (const t of ['audit_events', 'stage_events', 'requisition_lines', 'transactions',
    'transaction_types', 'budget_lines', 'sessions', 'user_roles', 'users', 'roles', 'departments']) {
    await pool.query(`DELETE FROM ${t}`);
  }

  const [prg, fin, mne, grc, ops] = await db.insert(schema.departments).values([
    { code: 'PRG', name: 'Programmes' },
    { code: 'FIN', name: 'Finance & Admin' },
    { code: 'MNE', name: 'M&E' },
    { code: 'GRC', name: 'Grants & Compliance' },
    { code: 'OPS', name: 'Operations' },
  ]).returning();

  const roleRows = await db.insert(schema.roles).values([
    { code: 'INITIATOR', name: 'Initiator' },
    { code: 'SUPERVISOR', name: 'Supervisor' },
    { code: 'INTERNAL_AUDIT', name: 'Internal Audit' },
    { code: 'FINANCE', name: 'Finance' },
    { code: 'FINAL_APPROVER', name: 'Final Approver' },
    { code: 'HR_OFFICER', name: 'HR Officer' },
    { code: 'SYSTEM_ADMIN', name: 'System Administrator' },
  ]).returning();
  const role = (c: string) => roleRows.find((r) => r.code === c)!.id;

  const hash = await argon2.hash('Password1!');
  const mkUser = (email: string, name: string, title: string, departmentId: string) =>
    ({ email, name, title, passwordHash: hash, departmentId });

  const [amina, tunde, ngozi, ibrahim, folake, chiamaka, admin] = await db.insert(schema.users).values([
    mkUser('amina.yusuf@wewe.org', 'Amina Yusuf', 'Programme Officer', prg.id),
    mkUser('tunde.balogun@wewe.org', 'Tunde Balogun', 'Head of Programmes', prg.id),
    mkUser('ngozi.okafor@wewe.org', 'Ngozi Okafor', 'Internal Auditor', grc.id),
    mkUser('ibrahim.musa@wewe.org', 'Ibrahim Musa', 'Finance Manager', fin.id),
    mkUser('folake.adeyemi@wewe.org', 'Folake Adeyemi', 'Managing Director', fin.id),
    mkUser('chiamaka.eze@wewe.org', 'Chiamaka Eze', 'M&E Officer', mne.id),
    mkUser('admin@wewe.org', 'Systems Desk', 'System Administrator', ops.id),
  ]).returning();

  await db.insert(schema.userRoles).values([
    { userId: amina.id, roleId: role('INITIATOR'), departmentId: null },
    { userId: chiamaka.id, roleId: role('INITIATOR'), departmentId: null },
    { userId: tunde.id, roleId: role('INITIATOR'), departmentId: null },
    { userId: tunde.id, roleId: role('SUPERVISOR'), departmentId: prg.id }, // dept-scoped (WFE-02)
    { userId: ngozi.id, roleId: role('INTERNAL_AUDIT'), departmentId: null },
    { userId: ibrahim.id, roleId: role('FINANCE'), departmentId: null },
    { userId: folake.id, roleId: role('FINAL_APPROVER'), departmentId: null },
    { userId: admin.id, roleId: role('SYSTEM_ADMIN'), departmentId: null },
  ]);

  const year = new Date().getFullYear();
  const bl = await db.insert(schema.budgetLines).values([
    { code: 'PRG-TRV', name: 'Programme travel & fieldwork', departmentId: prg.id, fiscalYear: year, allocatedKobo: N(18_500_000), donorCode: 'USAID-LON-24' },
    { code: 'PRG-TRN', name: 'Community training & workshops', departmentId: prg.id, fiscalYear: year, allocatedKobo: N(24_000_000), donorCode: 'USAID-LON-24' },
    { code: 'MNE-DAT', name: 'Data collection & verification', departmentId: mne.id, fiscalYear: year, allocatedKobo: N(9_800_000), donorCode: 'EU-WISH-23' },
    { code: 'OPS-GEN', name: 'Generator fuel & maintenance', departmentId: ops.id, fiscalYear: year, allocatedKobo: N(6_200_000), donorCode: null },
    { code: 'FIN-OFF', name: 'Office supplies & utilities', departmentId: fin.id, fiscalYear: year, allocatedKobo: N(4_750_000), donorCode: null },
  ]).returning();
  const line = (code: string) => bl.find((b) => b.code === code)!;

  await db.insert(schema.transactionTypes).values({
    code: 'REQUISITION', name: 'Requisition', refPrefix: 'REQ',
    stages: [
      { role: 'SUPERVISOR' }, { role: 'INTERNAL_AUDIT' }, { role: 'FINANCE' },
      // WFE-03: requisitions under ₦500,000.00 auto-pass the Final Approver stage
      { role: 'FINAL_APPROVER', minAmountKobo: '50000000' },
    ],
  });

  // ---- sample transactions across the pipeline ----
  let seq = 0;
  const ref = () => `REQ-${year}-${String(++seq).padStart(4, '0')}`;

  async function makeTx(opts: {
    title: string; initiator: typeof amina; departmentId: string; donorCode?: string | null;
    lines: { d: string; q: number; unit: number; bl?: string }[];
    approvals: number; // how many stages already approved (0–4)
    final?: 'RETURNED' | 'REJECTED' | 'DRAFT' | null;
    daysAgo: number;
  }) {
    const amount = opts.lines.reduce((s, l) => s + BigInt(l.q) * N(l.unit), 0n);
    const submitted = opts.final === 'DRAFT' ? null : new Date(Date.now() - opts.daysAgo * 86400_000);
    const status = opts.final === 'DRAFT' ? 'DRAFT'
      : opts.final ?? (opts.approvals >= 4 ? 'APPROVED' : 'PENDING');
    const currentStage = status === 'PENDING' ? opts.approvals
      : status === 'APPROVED' ? 3 : status === 'RETURNED' ? 0 : opts.approvals;
    const [tx] = await db.insert(schema.transactions).values({
      ref: ref(), typeCode: 'REQUISITION', title: opts.title, initiatorId: opts.initiator.id,
      departmentId: opts.departmentId, amountKobo: amount, donorCode: opts.donorCode ?? null,
      status: status as any, currentStage, submittedAt: submitted,
      createdAt: new Date(Date.now() - (opts.daysAgo + 1) * 86400_000),
    }).returning();
    await db.insert(schema.requisitionLines).values(opts.lines.map((l) => ({
      transactionId: tx.id, description: l.d, qty: l.q, unitKobo: N(l.unit),
      budgetLineId: l.bl ? line(l.bl).id : null,
    })));

    const approvers = [tunde, ngozi, ibrahim, folake];
    const roles = ['SUPERVISOR', 'INTERNAL_AUDIT', 'FINANCE', 'FINAL_APPROVER'] as const;
    const events: any[] = [];
    if (status !== 'DRAFT') {
      events.push({ transactionId: tx.id, stageIndex: 0, role: null, action: 'SUBMITTED', actorId: opts.initiator.id, createdAt: submitted });
      for (let i = 0; i < opts.approvals; i++) {
        events.push({
          transactionId: tx.id, stageIndex: i, role: roles[i], action: 'APPROVED', actorId: approvers[i].id,
          comment: i === 1 ? 'Documentation complete; within policy.' : null,
          createdAt: new Date(submitted!.getTime() + (i + 1) * 3600_000 * 20),
        });
      }
      if (opts.final === 'RETURNED') events.push({
        transactionId: tx.id, stageIndex: opts.approvals, role: roles[opts.approvals], action: 'RETURNED',
        actorId: approvers[opts.approvals].id, comment: 'Attach the vendor quote for the projector before we can proceed.',
        createdAt: new Date(submitted!.getTime() + 86400_000),
      });
      if (opts.final === 'REJECTED') events.push({
        transactionId: tx.id, stageIndex: opts.approvals, role: roles[opts.approvals], action: 'REJECTED',
        actorId: approvers[opts.approvals].id, comment: 'Duplicate of an already-approved request (see earlier ref).',
        createdAt: new Date(submitted!.getTime() + 86400_000),
      });
    }
    if (events.length) await db.insert(schema.stageEvents).values(events);
    await audit.log({ actorId: opts.initiator.id, actorEmail: opts.initiator.email, action: 'TX_CREATED', entityType: 'transaction', entityId: tx.ref, data: { seeded: true } });
    return tx;
  }

  await makeTx({ title: 'Field visit — Nasarawa cluster monitoring', initiator: amina, departmentId: prg.id, donorCode: 'USAID-LON-24', lines: [{ d: 'Vehicle hire (3 days)', q: 3, unit: 85_000, bl: 'PRG-TRV' }, { d: 'Per-diem, 2 officers', q: 6, unit: 25_000, bl: 'PRG-TRV' }], approvals: 0, daysAgo: 1 });
  await makeTx({ title: 'Widows skills workshop — venue & materials', initiator: amina, departmentId: prg.id, donorCode: 'USAID-LON-24', lines: [{ d: 'Hall rental (2 days)', q: 2, unit: 150_000, bl: 'PRG-TRN' }, { d: 'Training materials pack', q: 40, unit: 7_500, bl: 'PRG-TRN' }, { d: 'Refreshments', q: 40, unit: 3_500, bl: 'PRG-TRN' }], approvals: 1, daysAgo: 3 });
  await makeTx({ title: 'Quarterly data verification exercise', initiator: chiamaka, departmentId: mne.id, donorCode: 'EU-WISH-23', lines: [{ d: 'Enumerator stipends', q: 12, unit: 30_000, bl: 'MNE-DAT' }, { d: 'Transport reimbursements', q: 12, unit: 8_000, bl: 'MNE-DAT' }], approvals: 2, daysAgo: 5 });
  await makeTx({ title: 'Generator servicing & fuel — August', initiator: tunde, departmentId: prg.id, lines: [{ d: 'Diesel (litres)', q: 400, unit: 1_150, bl: 'OPS-GEN' }, { d: 'Servicing', q: 1, unit: 95_000, bl: 'OPS-GEN' }], approvals: 3, daysAgo: 6 });
  await makeTx({ title: 'Office internet renewal — Q3', initiator: amina, departmentId: prg.id, lines: [{ d: 'Fibre subscription (3 months)', q: 3, unit: 120_000, bl: 'FIN-OFF' }], approvals: 4, daysAgo: 9 });
  await makeTx({ title: 'Projector and screen for training hall', initiator: amina, departmentId: prg.id, donorCode: 'USAID-LON-24', lines: [{ d: 'Projector (Epson EB-X51)', q: 1, unit: 385_000, bl: 'PRG-TRN' }, { d: 'Projection screen', q: 1, unit: 95_000, bl: 'PRG-TRN' }], approvals: 1, final: 'RETURNED', daysAgo: 4 });
  await makeTx({ title: 'Community training refreshments — duplicate', initiator: chiamaka, departmentId: mne.id, lines: [{ d: 'Refreshments', q: 35, unit: 4_000, bl: 'MNE-DAT' }], approvals: 1, final: 'REJECTED', daysAgo: 8 });
  await makeTx({ title: 'Stationery restock — Programmes', initiator: amina, departmentId: prg.id, lines: [{ d: 'A4 paper (cartons)', q: 10, unit: 28_000, bl: 'FIN-OFF' }, { d: 'Toner cartridges', q: 4, unit: 45_000, bl: 'FIN-OFF' }], approvals: 0, final: 'DRAFT', daysAgo: 0 });

  console.log('Seed complete.');
  console.log('Users (password: Password1!):');
  for (const u of [amina, tunde, ngozi, ibrahim, folake, chiamaka, admin]) console.log(`  ${u.email} — ${u.title}`);
}

main().then(() => pool.end()).catch((e) => { console.error(e); pool.end(); process.exit(1); });
