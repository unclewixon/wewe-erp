/* Demo organisation seed. Idempotent-ish: wipes and re-creates. Run: pnpm --filter api seed */
import * as argon2 from 'argon2';
import { db, pool, schema } from '../src/db/client';
import { AuditService } from '../src/audit/audit.service';
import { moduleSeedDefaults } from '../src/app';

(BigInt.prototype as any).toJSON = function () { return this.toString(); };
const N = (naira: number) => BigInt(Math.round(naira)) * 100n; // naira → kobo

async function main() {
  const audit = new AuditService();

  // wipe (FK order)
  for (const t of [
    'auditor_scopes', 'scheduled_reports', 'saved_reports',
    'notifications', 'email_outbox', 'qb_outbox', 'retirements', 'advances',
    'budget_allocations', 'budget_versions', 'signature_signers', 'signature_requests',
    'doc_links', 'doc_versions', 'documents', 'doc_folders',
    'leave_requests', 'leave_balances', 'leave_types', 'staff_checklists',
    'timesheets', 'payroll_items', 'payroll_runs', 'staff_profiles',
    'po_receipts', 'purchase_orders', 'rfq_quotes', 'rfqs', 'contracts',
    'asset_events', 'assets', 'vendors', 'inventory_moves', 'inventory_items',
    'grant_deadlines', 'grants', 'audit_flags', 'findings',
    'role_permissions', 'permissions', 'settings', 'delegations',
    'audit_events', 'stage_events', 'requisition_lines', 'transactions',
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

  const [amina, tunde, ngozi, ibrahim, folake, chiamaka, admin, blessing, emeka, adeleke, fatima] = await db.insert(schema.users).values([
    mkUser('amina.yusuf@wewe.org', 'Amina Yusuf', 'Programme Officer', prg.id),
    mkUser('tunde.balogun@wewe.org', 'Tunde Balogun', 'Head of Programmes', prg.id),
    mkUser('ngozi.okafor@wewe.org', 'Ngozi Okafor', 'Internal Auditor', grc.id),
    mkUser('ibrahim.musa@wewe.org', 'Ibrahim Musa', 'Finance Manager', fin.id),
    mkUser('folake.adeyemi@wewe.org', 'Folake Adeyemi', 'Managing Director', fin.id),
    mkUser('chiamaka.eze@wewe.org', 'Chiamaka Eze', 'M&E Officer', mne.id),
    mkUser('admin@wewe.org', 'Systems Desk', 'System Administrator', ops.id),
    mkUser('blessing.adeyemi@wewe.org', 'Blessing Adeyemi', 'Human Resources Officer', fin.id),
    mkUser('emeka.nwosu@wewe.org', 'Emeka Nwosu', 'Procurement Officer', ops.id),
    mkUser('k.adeleke@auditfirm.ng', 'K. Adeleke', 'External Auditor', grc.id),
    mkUser('fatima.bello@wewe.org', 'Fatima Bello', 'Finance Officer', fin.id),
  ]).returning();

  await db.insert(schema.userRoles).values([
    { userId: amina.id, roleId: role('INITIATOR'), departmentId: null },
    { userId: chiamaka.id, roleId: role('INITIATOR'), departmentId: null },
    { userId: tunde.id, roleId: role('INITIATOR'), departmentId: null },
    { userId: tunde.id, roleId: role('SUPERVISOR'), departmentId: prg.id }, // dept-scoped (WFE-02)
    { userId: tunde.id, roleId: role('SUPERVISOR'), departmentId: mne.id }, // MNE routes to Tunde too — every dept must have a stage-2 approver
    { userId: ngozi.id, roleId: role('INTERNAL_AUDIT'), departmentId: null },
    { userId: ibrahim.id, roleId: role('FINANCE'), departmentId: null },
    { userId: folake.id, roleId: role('FINAL_APPROVER'), departmentId: null },
    { userId: admin.id, roleId: role('SYSTEM_ADMIN'), departmentId: null },
    { userId: blessing.id, roleId: role('HR_OFFICER'), departmentId: null },
    { userId: blessing.id, roleId: role('INITIATOR'), departmentId: null },
    { userId: emeka.id, roleId: role('INITIATOR'), departmentId: null },
    { userId: fatima.id, roleId: role('FINANCE'), departmentId: null }, // second Finance officer — Finance-initiated items can route
    { userId: fatima.id, roleId: role('INITIATOR'), departmentId: null },
  ]);

  // EXTERNAL_AUDITOR role row + K. Adeleke's scoped, expiring access (AUD-06)
  const [extRole] = await db.insert(schema.roles).values({ code: 'EXTERNAL_AUDITOR', name: 'External Auditor' }).returning();
  await db.insert(schema.userRoles).values({ userId: adeleke.id, roleId: extRole.id, departmentId: null });
  await db.insert(schema.auditorScopes).values({
    userId: adeleke.id, donorCode: 'USAID-LON-24', expiresAt: new Date(Date.now() + 90 * 86400_000), createdById: admin.id,
  });

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

  await moduleSeedDefaults();
  console.log('Module defaults seeded (types, settings, permissions, leave types, grants, folders).');

  // ---------- demo enrichment: content for every module surface ----------
  const day = 86400_000;
  const ago = (d: number) => new Date(Date.now() - d * day);

  // vendors
  await db.insert(schema.vendors).values([
    { name: 'Halogen Security Services Ltd', categories: ['Security'], contact: { email: 'ops@halogen.ng' }, tin: '01234567-0001', dueDiligence: { cac: true, taxClearance: true } },
    { name: 'Kaduna Motors Ltd', categories: ['Vehicle maintenance'], contact: { email: 'service@kadunamotors.ng' }, dueDiligence: { cac: true, taxClearance: false } },
    { name: 'Brightline Printers', categories: ['Printing'], contact: { email: 'hello@brightline.ng' } },
    { name: 'Sahel Office Supplies', categories: ['Stationery'], contact: { email: 'sales@sahelsupplies.ng' }, dueDiligence: { cac: true, taxClearance: true } },
  ]);

  // assets
  await db.insert(schema.assets).values([
    { tag: 'WW/IT/0231', description: 'HP ProBook 450 G10', category: 'IT equipment', custodianId: chiamaka.id, location: 'Abuja office', fundingCode: 'EU-WISH-23', costKobo: N(730_000), acquiredAt: ago(400), usefulLifeMonths: 36 },
    { tag: 'WW/VEH/0012', description: 'Toyota Hilux 2.5D', category: 'Vehicle', custodianId: tunde.id, location: 'Abuja pool', fundingCode: 'USAID-LON-24', costKobo: N(28_500_000), acquiredAt: ago(900), usefulLifeMonths: 60 },
    { tag: 'WW/IT/0198', description: 'Canon imageRUNNER 2630', category: 'IT equipment', location: 'Front office', fundingCode: null, costKobo: N(1_450_000), acquiredAt: ago(700), usefulLifeMonths: 48 },
    { tag: 'WW/GEN/0007', description: '20kVA generator', category: 'Generator', location: 'Abuja office', fundingCode: null, costKobo: N(6_800_000), acquiredAt: ago(1100), usefulLifeMonths: 48 },
  ]);

  // inventory
  const inv = await db.insert(schema.inventoryItems).values([
    { code: 'STK-0012', name: 'A4 photocopy paper (ream)', unit: 'ream', qtyOnHand: 64, reorderLevel: 40 },
    { code: 'STK-0031', name: 'Caregiver training manual', unit: 'copy', qtyOnHand: 186, reorderLevel: 150 },
    { code: 'STK-0044', name: 'Safeguarding poster (A2)', unit: 'sheet', qtyOnHand: 22, reorderLevel: 50 },
  ]).returning();
  await db.insert(schema.inventoryMoves).values([
    { itemId: inv[0].id, kind: 'GRN', qty: 100, refText: 'PO-2026-0001', actorId: admin.id },
    { itemId: inv[0].id, kind: 'ISSUE', qty: -36, refText: 'Programmes workshop', actorId: amina.id },
    { itemId: inv[2].id, kind: 'ISSUE', qty: -28, refText: 'Enugu field office', actorId: chiamaka.id },
  ]);

  // findings + one open audit flag
  await db.insert(schema.findings).values([
    { ref: 'F-2026-0001', title: 'Per-diem rates applied inconsistently across departments', severity: 'HIGH', ownerId: ibrahim.id, dueDate: ago(-3), status: 'OPEN' },
    { ref: 'F-2026-0002', title: 'Three POs raised without the required second quote', severity: 'HIGH', ownerId: emeka.id, dueDate: ago(-10), status: 'IN_PROGRESS' },
    { ref: 'F-2026-0003', title: 'Asset verification variance — 1 laptop unlocated', severity: 'MEDIUM', ownerId: admin.id, dueDate: ago(-17), status: 'IN_PROGRESS' },
  ]);
  await db.insert(schema.auditFlags).values({
    entityType: 'transaction', entityId: 'REQ-2026-0002', raisedById: ngozi.id, severity: 'MEDIUM',
    question: 'The venue quote is above the framework rate — confirm the exception was approved.',
  });

  // advances: requested / disbursed+overdue / closed-with-retirement
  const advTx = async (ref: string, title: string, who: typeof amina, amt: bigint, status: string, currentStage: number) => {
    const [tx] = await db.insert(schema.transactions).values({
      ref, typeCode: 'ADVANCE', title, initiatorId: who.id, departmentId: who.departmentId!,
      amountKobo: amt, status: status as any, currentStage, submittedAt: ago(6),
      payload: { chain: [{ role: 'SUPERVISOR' }, { role: 'INTERNAL_AUDIT' }, { role: 'FINANCE' }] },
    }).returning();
    await db.insert(schema.stageEvents).values({ transactionId: tx.id, stageIndex: 0, role: null, action: 'SUBMITTED', actorId: who.id, createdAt: ago(6) });
    return tx;
  };
  const a1 = await advTx('ADV-2026-0001', 'Travel advance — Kano supervision visit', amina, N(280_000), 'PENDING', 0);
  await db.insert(schema.advances).values({ txId: a1.id, staffId: amina.id, purpose: 'Kano supervision visit (4 nights)', travel: { destination: 'Kano', nights: 4 }, status: 'REQUESTED', balanceKobo: 0n });
  const a2 = await advTx('ADV-2026-0002', 'Cash advance — Aba community dialogue', chiamaka, N(350_000), 'APPROVED', 2);
  await db.insert(schema.advances).values({ txId: a2.id, staffId: chiamaka.id, purpose: 'Aba community dialogue logistics', status: 'DISBURSED', balanceKobo: N(350_000), disbursedAt: ago(20), disbursedRef: 'TRF-70021', retirementDeadline: ago(8) });
  const a3 = await advTx('ADV-2026-0003', 'Advance — data verification transport', chiamaka, N(120_000), 'APPROVED', 2);
  await db.insert(schema.advances).values({ txId: a3.id, staffId: chiamaka.id, purpose: 'Quarterly data verification transport', status: 'CLOSED', balanceKobo: 0n, disbursedAt: ago(30), disbursedRef: 'TRF-69544', retirementDeadline: ago(18) });

  // leave: one approved (balance applied), one pending at HR stage
  const lt = await db.select().from(schema.leaveTypes);
  const annual = lt.find((t) => t.code === 'ANNUAL') ?? lt[0];
  if (annual) {
    const mkLeave = async (ref: string, who: typeof amina, days: number, status: string, stage: number) => {
      const [tx] = await db.insert(schema.transactions).values({
        ref, typeCode: 'LEAVE', title: `${annual.name} — ${who.name}`, initiatorId: who.id, departmentId: who.departmentId!,
        amountKobo: 0n, status: status as any, currentStage: stage, submittedAt: ago(4),
        payload: { chain: [{ role: 'SUPERVISOR' }, { role: 'HR_OFFICER' }] },
      }).returning();
      await db.insert(schema.stageEvents).values({ transactionId: tx.id, stageIndex: 0, role: null, action: 'SUBMITTED', actorId: who.id, createdAt: ago(4) });
      await db.insert(schema.leaveRequests).values({ txId: tx.id, userId: who.id, leaveTypeId: annual.id, startDate: ago(-6), endDate: ago(-6 - days), days, handoverNote: 'Files handed to the team lead.' });
      return tx;
    };
    await mkLeave('LVE-2026-0001', amina, 5, 'APPROVED', 1);
    await mkLeave('LVE-2026-0002', chiamaka, 10, 'PENDING', 1);
  }

  // staff profiles with salaries (payroll-ready)
  await db.insert(schema.staffProfiles).values([
    { userId: amina.id, grade: 'PO-2', hireDate: ago(800), salaryKobo: N(450_000), allowances: [{ name: 'Transport', amountKobo: N(50_000).toString() }] },
    { userId: tunde.id, grade: 'M-1', hireDate: ago(1500), salaryKobo: N(850_000) },
    { userId: ibrahim.id, grade: 'M-1', hireDate: ago(1300), salaryKobo: N(900_000) },
  ]);

  console.log('Demo enrichment complete (vendors, assets, inventory, findings, flags, advances, leave, profiles).');
  console.log('Seed complete.');
  console.log('Users (password: Password1!):');
  for (const u of [amina, tunde, ngozi, ibrahim, folake, chiamaka, admin]) console.log(`  ${u.email} — ${u.title}`);
}

main().then(() => pool.end()).catch((e) => { console.error(e); pool.end(); process.exit(1); });
