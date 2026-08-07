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
  const vend = await db.insert(schema.vendors).values([
    { name: 'Halogen Security Services Ltd', categories: ['Security'], contact: { email: 'ops@halogen.ng' }, tin: '01234567-0001', dueDiligence: { cac: true, taxClearance: true } },
    { name: 'Kaduna Motors Ltd', categories: ['Vehicle maintenance'], contact: { email: 'service@kadunamotors.ng' }, dueDiligence: { cac: true, taxClearance: false } },
    { name: 'Brightline Printers', categories: ['Printing'], contact: { email: 'hello@brightline.ng' } },
    { name: 'Sahel Office Supplies', categories: ['Stationery'], contact: { email: 'sales@sahelsupplies.ng' }, dueDiligence: { cac: true, taxClearance: true } },
  ]).returning();

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
  const [adv2] = await db.insert(schema.advances).values({ txId: a2.id, staffId: chiamaka.id, purpose: 'Aba community dialogue logistics', status: 'DISBURSED', balanceKobo: N(350_000), disbursedAt: ago(20), disbursedRef: 'TRF-70021', retirementDeadline: ago(8) }).returning();
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

  // ---------- module enrichment: procurement, payroll, timesheets, e-sign, retirements, budget versions, grant deadlines, delegations, notifications, reports ----------
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const nowD = new Date();
  const curPeriod = `${nowD.getFullYear()}-${pad2(nowD.getMonth() + 1)}`;
  const prevMonth = new Date(nowD.getFullYear(), nowD.getMonth() - 1, 1);
  const prevPeriod = `${prevMonth.getFullYear()}-${pad2(prevMonth.getMonth() + 1)}`;
  const prevMonthEnd = new Date(nowD.getFullYear(), nowD.getMonth(), 0);

  // budget version + allocations (this year's active budget, mirrors the seeded lines)
  const [bv] = await db.insert(schema.budgetVersions).values({
    fiscalYear: year, versionNo: 1, status: 'ACTIVE', note: 'FY opening budget — board approved',
    createdById: ibrahim.id, activatedAt: ago(210),
  }).returning();
  await db.insert(schema.budgetAllocations).values(bl.map((b) => ({
    versionId: bv.id, budgetLineId: b.id, amountKobo: b.allocatedKobo,
  })));

  // procurement: RFQ with competing quotes → PO (partly received) → contract
  const [rfq1] = await db.insert(schema.rfqs).values({
    ref: 'RFQ-2026-0001', title: 'Projector & screen for training hall', deadline: ago(-2),
    status: 'SELECTED', selectionJustification: 'Brightline Printers — lowest compliant quote, valid tax clearance.',
    createdById: emeka.id, createdAt: ago(12),
  }).returning();
  await db.insert(schema.rfqs).values({
    ref: 'RFQ-2026-0002', title: 'Annual vehicle servicing framework', deadline: ago(-9),
    status: 'OPEN', createdById: emeka.id, createdAt: ago(4),
  });
  await db.insert(schema.rfqQuotes).values([
    { rfqId: rfq1.id, vendorId: vend[2].id, totalKobo: N(468_000), lines: [{ d: 'Projector', qty: 1, unitKobo: N(378_000).toString() }, { d: 'Screen', qty: 1, unitKobo: N(90_000).toString() }], validityDays: 30, selected: true, receivedAt: ago(10) },
    { rfqId: rfq1.id, vendorId: vend[3].id, totalKobo: N(512_000), lines: [{ d: 'Projector + screen bundle', qty: 1, unitKobo: N(512_000).toString() }], validityDays: 14, selected: false, receivedAt: ago(11) },
  ]);
  const [po1] = await db.insert(schema.purchaseOrders).values({
    ref: 'PO-2026-0001', rfqId: rfq1.id, vendorId: vend[2].id, totalKobo: N(468_000),
    lines: [{ description: 'Projector (Epson EB-X51)', qty: 1, unitKobo: N(378_000).toString(), receivedQty: 1 }, { description: 'Projection screen', qty: 1, unitKobo: N(90_000).toString(), receivedQty: 0 }],
    status: 'PARTIAL', issuedAt: ago(8),
  }).returning();
  await db.insert(schema.poReceipts).values({
    poId: po1.id, lines: [{ lineIndex: 0, qty: 1 }], note: 'Projector received; screen back-ordered.', receivedById: admin.id, receivedAt: ago(3),
  });
  await db.insert(schema.contracts).values([
    { ref: 'CTR-2026-0001', vendorId: vend[0].id, title: 'Office security services (12 months)', valueKobo: N(7_200_000), paidKobo: N(1_800_000), startDate: ago(120), endDate: ago(-245), status: 'ACTIVE' },
    { ref: 'CTR-2026-0002', vendorId: vend[1].id, title: 'Fleet maintenance retainer', valueKobo: N(3_600_000), paidKobo: N(3_600_000), startDate: ago(400), endDate: ago(35), status: 'EXPIRED' },
  ]);

  // payroll: last month released, current month pending
  const payItem = (runId: string, u: { id: string }, grossNaira: number) => {
    const gross = N(grossNaira);
    const pensionEmployee = (gross * 8n) / 100n;
    const pensionEmployer = (gross * 10n) / 100n;
    const nhf = (gross * 25n) / 1000n;
    const paye = (gross * 7n) / 100n;
    const net = gross - paye - pensionEmployee - nhf;
    return { runId, userId: u.id, grossKobo: gross, payeKobo: paye, pensionEmployeeKobo: pensionEmployee, pensionEmployerKobo: pensionEmployer, nhfKobo: nhf, otherDeductionsKobo: 0n, netKobo: net, breakdown: { basis: 'monthly gross', paye: paye.toString(), pensionEmployee: pensionEmployee.toString(), nhf: nhf.toString() } };
  };
  const [prRun] = await db.insert(schema.payrollRuns).values({
    period: prevPeriod, status: 'RELEASED', totals: { staff: 3, netKobo: '0' }, createdById: ibrahim.id, releasedAt: ago(6),
  }).returning();
  await db.insert(schema.payrollItems).values([
    payItem(prRun.id, amina, 450_000), payItem(prRun.id, tunde, 850_000), payItem(prRun.id, ibrahim, 900_000),
  ]);
  await db.insert(schema.payrollRuns).values({
    period: curPeriod, status: 'PENDING', createdById: ibrahim.id,
  });

  // timesheets: LOE split across grants
  await db.insert(schema.timesheets).values([
    { userId: amina.id, periodStart: prevMonth, periodEnd: prevMonthEnd, rows: [{ projectCode: 'USAID-LON-24', percent: 60 }, { projectCode: 'EU-WISH-23', percent: 40 }], status: 'SUBMITTED' },
    { userId: chiamaka.id, periodStart: prevMonth, periodEnd: prevMonthEnd, rows: [{ projectCode: 'EU-WISH-23', percent: 100 }], status: 'SUBMITTED' },
  ]);

  // documents + e-sign: one document out for signature (internal signed, external pending)
  const [doc1] = await db.insert(schema.documents).values({
    name: 'Amendment 3 — USAID-LON-24.pdf', mime: 'application/pdf', sizeBytes: 248_310,
    storageKey: 'seed/amendment-3-usaid-lon-24.pdf', sha256: 'a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00',
    docType: 'CONTRACT', tags: ['grant', 'amendment'], uploadedById: emeka.id, currentVersion: 1, createdAt: ago(5),
  }).returning();
  await db.insert(schema.docVersions).values({
    documentId: doc1.id, versionNo: 1, storageKey: doc1.storageKey, sha256: doc1.sha256, sizeBytes: 248_310, note: 'Initial upload', uploadedById: emeka.id,
  });
  const [sr1] = await db.insert(schema.signatureRequests).values({
    documentId: doc1.id, versionNo: 1, requestedById: ibrahim.id, message: 'Please countersign Amendment 3.', deadline: ago(-23), status: 'OPEN', createdAt: ago(2),
  }).returning();
  await db.insert(schema.signatureSigners).values([
    { requestId: sr1.id, orderNo: 1, userId: folake.id, status: 'SIGNED', method: 'typed', docSha256AtSign: doc1.sha256, signedAt: ago(1) },
    { requestId: sr1.id, orderNo: 2, externalName: 'Karen Adeleke', externalEmail: 'k.adeleke@usaid.gov', externalToken: 'seed-amend3-ext-0002', otpCode: '000000', status: 'PENDING' },
  ]);

  // retirement of the disbursed advance (a2), with a small refund due
  const [rtx] = await db.insert(schema.transactions).values({
    ref: 'RET-2026-0001', typeCode: 'RETIREMENT', title: 'Retirement — Aba community dialogue advance',
    initiatorId: chiamaka.id, departmentId: chiamaka.departmentId!, amountKobo: N(330_000), status: 'APPROVED', currentStage: 3,
    submittedAt: ago(6), payload: { chain: [{ role: 'SUPERVISOR' }, { role: 'INTERNAL_AUDIT' }, { role: 'FINANCE' }, { role: 'FINAL_APPROVER' }] },
  }).returning();
  await db.insert(schema.stageEvents).values({ transactionId: rtx.id, stageIndex: 0, role: null, action: 'SUBMITTED', actorId: chiamaka.id, createdAt: ago(6) });
  await db.insert(schema.retirements).values({
    txId: rtx.id, advanceId: adv2.id, totalKobo: N(330_000), varianceKobo: N(20_000), refundDueKobo: N(20_000),
  });

  // delegation: MD delegates approvals to Finance Manager over a leave window
  await db.insert(schema.delegations).values({
    delegatorId: folake.id, delegateId: ibrahim.id, startsAt: ago(2), endsAt: ago(-5), active: true,
  });

  // notifications across personas
  await db.insert(schema.notifications).values([
    { userId: ibrahim.id, kind: 'ACTION_REQUIRED', title: 'Requisition awaiting Finance', body: 'REQ-2026-0004 has reached the Finance stage.', entityType: 'transaction', entityId: 'REQ-2026-0004' },
    { userId: amina.id, kind: 'UPDATE', title: 'Requisition returned', body: 'Your projector request was returned for a vendor quote.', entityType: 'transaction', entityId: 'REQ-2026-0006' },
    { userId: ngozi.id, kind: 'FLAG', title: 'Flag raised on REQ-2026-0002', body: 'Venue quote appears above the framework rate.', entityType: 'transaction', entityId: 'REQ-2026-0002' },
  ]);

  // saved + scheduled reports
  await db.insert(schema.savedReports).values({
    name: 'Outstanding advances (all departments)', ownerId: ibrahim.id, shared: true,
    config: { entity: 'advances', columns: ['ref', 'staff', 'balanceKobo', 'retirementDeadline'], filters: { status: 'DISBURSED' } },
  });
  await db.insert(schema.scheduledReports).values({
    name: 'Weekly requisition register', reportKey: 'requisition-register', recipientsRole: 'FINANCE', dayOfWeek: 1, hour: 8, active: true, createdById: ibrahim.id,
  });

  // grant reporting deadlines
  const grantRows = await db.select().from(schema.grants);
  const grantId = (code: string) => grantRows.find((g) => g.code === code)?.id;
  const usaid = grantId('USAID-LON-24');
  const euwish = grantId('EU-WISH-23');
  const gd: any[] = [];
  if (usaid) gd.push(
    { grantId: usaid, title: 'Q3 financial report to USAID', dueDate: ago(-14), ownerRole: 'FINANCE', status: 'OPEN' },
    { grantId: usaid, title: 'Annual inventory certification', dueDate: ago(6), ownerRole: 'SYSTEM_ADMIN', status: 'OVERDUE' },
  );
  if (euwish) gd.push(
    { grantId: euwish, title: 'EU narrative & financial report', dueDate: ago(-30), ownerRole: 'FINANCE', status: 'OPEN' },
  );
  if (gd.length) await db.insert(schema.grantDeadlines).values(gd);

  // leave balances for the year (annual)
  if (annual) {
    await db.insert(schema.leaveBalances).values([
      { userId: amina.id, leaveTypeId: annual.id, year, entitledDays: annual.daysPerYear, usedDays: 5 },
      { userId: chiamaka.id, leaveTypeId: annual.id, year, entitledDays: annual.daysPerYear, usedDays: 0 },
    ]);
  }

  // one onboarding checklist
  await db.insert(schema.staffChecklists).values({
    userId: fatima.id, kind: 'ONBOARDING',
    items: [
      { label: 'Sign code of conduct', ownerRole: 'HR_OFFICER', mandatory: true, done: true },
      { label: 'IT account provisioning', ownerRole: 'SYSTEM_ADMIN', mandatory: true, done: false },
      { label: 'Bank & pension details', ownerRole: 'HR_OFFICER', mandatory: true, done: false },
    ],
    status: 'OPEN',
  });

  console.log('Module enrichment complete (procurement, payroll, timesheets, e-sign, retirements, budget versions, grant deadlines, delegations, notifications, reports).');
  console.log('Demo enrichment complete (vendors, assets, inventory, findings, flags, advances, leave, profiles).');
  console.log('Seed complete.');
  console.log('Users (password: Password1!):');
  for (const u of [amina, tunde, ngozi, ibrahim, folake, chiamaka, admin]) console.log(`  ${u.email} — ${u.title}`);
}

main().then(() => pool.end()).catch((e) => { console.error(e); pool.end(); process.exit(1); });
