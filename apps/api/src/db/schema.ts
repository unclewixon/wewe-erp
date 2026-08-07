import {
  pgTable, pgEnum, text, timestamp, integer, bigint, boolean, jsonb, serial, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

export const roleCode = pgEnum('role_code', [
  'INITIATOR', 'SUPERVISOR', 'INTERNAL_AUDIT', 'FINANCE', 'FINAL_APPROVER', 'HR_OFFICER', 'SYSTEM_ADMIN', 'EXTERNAL_AUDITOR',
]);
export type RoleCode = (typeof roleCode.enumValues)[number];

export const txStatus = pgEnum('tx_status', [
  'DRAFT', 'PENDING', 'RETURNED', 'REJECTED', 'WITHDRAWN', 'APPROVED',
]);
export type TxStatus = (typeof txStatus.enumValues)[number];

const cuid = (name: string) => text(name).primaryKey().default(sql`gen_random_uuid()::text`);

export const departments = pgTable('departments', {
  id: cuid('id'),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
});

export const users = pgTable('users', {
  id: cuid('id'),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  title: text('title'),
  passwordHash: text('password_hash').notNull(),
  active: boolean('active').notNull().default(true),
  departmentId: text('department_id').references(() => departments.id),
  // AUTH-02: TOTP 2FA
  totpSecret: text('totp_secret'),
  totpEnabledAt: timestamp('totp_enabled_at', { withTimezone: true }),
  backupCodes: jsonb('backup_codes'), // sha256 hashes of unused codes
  // AUTH-04: progressive lockout
  failedAttempts: integer('failed_attempts').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const roles = pgTable('roles', {
  id: cuid('id'),
  code: roleCode('code').notNull().unique(),
  name: text('name').notNull(),
});

export const userRoles = pgTable('user_roles', {
  id: cuid('id'),
  userId: text('user_id').notNull().references(() => users.id),
  roleId: text('role_id').notNull().references(() => roles.id),
  // null = organisation-wide scope; set = scoped to that department
  departmentId: text('department_id').references(() => departments.id),
}, (t) => [uniqueIndex('user_role_scope_uq').on(t.userId, t.roleId, t.departmentId)]);

export const sessions = pgTable('sessions', {
  id: cuid('id'),
  token: text('token').notNull().unique(),
  userId: text('user_id').notNull().references(() => users.id),
  ip: text('ip'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const budgetLines = pgTable('budget_lines', {
  id: cuid('id'),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  departmentId: text('department_id').notNull().references(() => departments.id),
  fiscalYear: integer('fiscal_year').notNull(),
  allocatedKobo: bigint('allocated_kobo', { mode: 'bigint' }).notNull(),
  donorCode: text('donor_code'),
});

export const transactionTypes = pgTable('transaction_types', {
  id: cuid('id'),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  refPrefix: text('ref_prefix').notNull(),
  // ordered approval chain after the initiator; minAmountKobo = WFE-03 threshold (stage
  // applies only at/above that amount): [{"role":"SUPERVISOR"},...,{"role":"FINAL_APPROVER","minAmountKobo":"50000000"}]
  stages: jsonb('stages').notNull().$type<{ role: RoleCode; minAmountKobo?: string }[]>(),
});

export const transactions = pgTable('transactions', {
  id: cuid('id'),
  ref: text('ref').notNull().unique(),
  typeCode: text('type_code').notNull().references(() => transactionTypes.code),
  title: text('title').notNull(),
  initiatorId: text('initiator_id').notNull().references(() => users.id),
  departmentId: text('department_id').notNull().references(() => departments.id),
  amountKobo: bigint('amount_kobo', { mode: 'bigint' }).notNull().default(sql`0`),
  currency: text('currency').notNull().default('NGN'),
  donorCode: text('donor_code'),
  status: txStatus('status').notNull().default('DRAFT'),
  // index into the stage chain while PENDING (0 = first approver stage)
  currentStage: integer('current_stage').notNull().default(0),
  payload: jsonb('payload'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const requisitionLines = pgTable('requisition_lines', {
  id: cuid('id'),
  transactionId: text('transaction_id').notNull().references(() => transactions.id),
  description: text('description').notNull(),
  qty: integer('qty').notNull(),
  unitKobo: bigint('unit_kobo', { mode: 'bigint' }).notNull(),
  budgetLineId: text('budget_line_id').references(() => budgetLines.id),
});

export const stageEvents = pgTable('stage_events', {
  id: cuid('id'),
  transactionId: text('transaction_id').notNull().references(() => transactions.id),
  stageIndex: integer('stage_index').notNull(),
  role: roleCode('role'),
  action: text('action').notNull(), // SUBMITTED | APPROVED | REJECTED | RETURNED | RESUBMITTED | WITHDRAWN
  actorId: text('actor_id').notNull().references(() => users.id),
  comment: text('comment'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Append-only, hash-chained. No update/delete path exists in the application.
export const auditEvents = pgTable('audit_events', {
  id: serial('id').primaryKey(),
  actorId: text('actor_id'),
  actorEmail: text('actor_email'),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  data: jsonb('data'),
  ip: text('ip'),
  prevHash: text('prev_hash').notNull(),
  hash: text('hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const usersRelations = relations(users, ({ many, one }) => ({
  roles: many(userRoles),
  department: one(departments, { fields: [users.departmentId], references: [departments.id] }),
}));
export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, { fields: [userRoles.userId], references: [users.id] }),
  role: one(roles, { fields: [userRoles.roleId], references: [roles.id] }),
  department: one(departments, { fields: [userRoles.departmentId], references: [departments.id] }),
}));
export const transactionsRelations = relations(transactions, ({ one, many }) => ({
  type: one(transactionTypes, { fields: [transactions.typeCode], references: [transactionTypes.code] }),
  initiator: one(users, { fields: [transactions.initiatorId], references: [users.id] }),
  department: one(departments, { fields: [transactions.departmentId], references: [departments.id] }),
  lines: many(requisitionLines),
  stageEvents: many(stageEvents),
}));
export const requisitionLinesRelations = relations(requisitionLines, ({ one }) => ({
  transaction: one(transactions, { fields: [requisitionLines.transactionId], references: [transactions.id] }),
  budgetLine: one(budgetLines, { fields: [requisitionLines.budgetLineId], references: [budgetLines.id] }),
}));
export const stageEventsRelations = relations(stageEvents, ({ one }) => ({
  transaction: one(transactions, { fields: [stageEvents.transactionId], references: [transactions.id] }),
  actor: one(users, { fields: [stageEvents.actorId], references: [users.id] }),
}));

// WFE-05: date-bounded delegation of approval duties. A delegate acts "on behalf of" the delegator.
export const delegations = pgTable('delegations', {
  id: cuid('id'),
  delegatorId: text('delegator_id').notNull().references(() => users.id),
  delegateId: text('delegate_id').notNull().references(() => users.id),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ============================================================
 * Full-backend schema — module areas (money, dms, people, ops,
 * governance, platform). Money is BigInt kobo everywhere.
 * ============================================================ */

// ---------- platform: notifications, email outbox, settings, granular permissions ----------
export const notifications = pgTable('notifications', {
  id: cuid('id'),
  userId: text('user_id').notNull().references(() => users.id),
  kind: text('kind').notNull(), // ACTION_REQUIRED | UPDATE | ESCALATION | FLAG
  title: text('title').notNull(),
  body: text('body'),
  entityType: text('entity_type'),
  entityId: text('entity_id'),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const emailOutbox = pgTable('email_outbox', {
  id: cuid('id'),
  toEmail: text('to_email').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  status: text('status').notNull().default('PENDING'), // PENDING | SENT | FAILED
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});


export const settings = pgTable('settings', {
  id: cuid('id'),
  key: text('key').notNull().unique(),
  value: jsonb('value').notNull(),
  updatedById: text('updated_by_id').references(() => users.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const permissions = pgTable('permissions', {
  id: cuid('id'),
  module: text('module').notNull(),
  action: text('action').notNull(), // VIEW | CREATE | EDIT | SUBMIT | APPROVE | EXPORT | CONFIGURE
}, (t) => [uniqueIndex('perm_uq').on(t.module, t.action)]);

export const rolePermissions = pgTable('role_permissions', {
  id: cuid('id'),
  roleId: text('role_id').notNull().references(() => roles.id),
  permissionId: text('permission_id').notNull().references(() => permissions.id),
  scope: text('scope').notNull().default('organisation'), // own | department | organisation
}, (t) => [uniqueIndex('role_perm_uq').on(t.roleId, t.permissionId)]);

// ---------- money: budgets, virements, advances, retirements, quickbooks ----------
export const budgetVersions = pgTable('budget_versions', {
  id: cuid('id'),
  fiscalYear: integer('fiscal_year').notNull(),
  versionNo: integer('version_no').notNull(),
  status: text('status').notNull().default('DRAFT'), // DRAFT | ACTIVE | SUPERSEDED
  note: text('note'),
  createdById: text('created_by_id').references(() => users.id),
  activatedAt: timestamp('activated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const budgetAllocations = pgTable('budget_allocations', {
  id: cuid('id'),
  versionId: text('version_id').notNull().references(() => budgetVersions.id),
  budgetLineId: text('budget_line_id').notNull().references(() => budgetLines.id),
  amountKobo: bigint('amount_kobo', { mode: 'bigint' }).notNull(),
  /**
   * BUD-02: how the year's allocation is phased across Q1–Q4, as four kobo strings.
   * The builder collects this and it is what makes a budget a plan rather than a total;
   * amountKobo stays the authoritative annual figure that every budget check measures
   * against. Nullable because allocations created before phasing existed have none.
   */
  quartersKobo: jsonb('quarters_kobo'),
}, (t) => [uniqueIndex('alloc_uq').on(t.versionId, t.budgetLineId)]);

export const advances = pgTable('advances', {
  id: cuid('id'),
  txId: text('tx_id').notNull().unique().references(() => transactions.id),
  staffId: text('staff_id').notNull().references(() => users.id),
  purpose: text('purpose').notNull(),
  travel: jsonb('travel'), // { destination, startDate, endDate, perDiemKobo, nights } when a travel advance
  disbursedAt: timestamp('disbursed_at', { withTimezone: true }),
  disbursedRef: text('disbursed_ref'),
  retirementDeadline: timestamp('retirement_deadline', { withTimezone: true }),
  balanceKobo: bigint('balance_kobo', { mode: 'bigint' }).notNull().default(sql`0`),
  status: text('status').notNull().default('REQUESTED'), // REQUESTED | DISBURSED | RETIRING | CLOSED | WRITTEN_OFF
});

export const retirements = pgTable('retirements', {
  id: cuid('id'),
  txId: text('tx_id').notNull().unique().references(() => transactions.id),
  advanceId: text('advance_id').references(() => advances.id), // null = freestanding reimbursement claim
  totalKobo: bigint('total_kobo', { mode: 'bigint' }).notNull(),
  varianceKobo: bigint('variance_kobo', { mode: 'bigint' }).notNull().default(sql`0`),
  refundDueKobo: bigint('refund_due_kobo', { mode: 'bigint' }).notNull().default(sql`0`),
  refundSettledAt: timestamp('refund_settled_at', { withTimezone: true }),
  refundSettledRef: text('refund_settled_ref'),
});

export const qbOutbox = pgTable('qb_outbox', {
  id: cuid('id'),
  txId: text('tx_id').references(() => transactions.id),
  kind: text('kind').notNull(), // JOURNAL | PAYMENT_STATUS
  payload: jsonb('payload').notNull(),
  status: text('status').notNull().default('PENDING'), // PENDING | POSTED | ERROR
  error: text('error'),
  qbRef: text('qb_ref'),
  attempts: integer('attempts').notNull().default(0),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------- dms: folders, documents, versions, permissions, links, e-sign ----------
export const docFolders = pgTable('doc_folders', {
  id: cuid('id'),
  parentId: text('parent_id'),
  name: text('name').notNull(),
  departmentId: text('department_id').references(() => departments.id),
  confidential: boolean('confidential').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const documents = pgTable('documents', {
  id: cuid('id'),
  folderId: text('folder_id').references(() => docFolders.id),
  name: text('name').notNull(),
  mime: text('mime').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  storageKey: text('storage_key').notNull(),
  sha256: text('sha256').notNull(),
  docType: text('doc_type'),
  tags: jsonb('tags'),
  textContent: text('text_content'), // extracted text for full-text search (OCR fills this later)
  confidential: boolean('confidential').notNull().default(false),
  uploadedById: text('uploaded_by_id').notNull().references(() => users.id),
  currentVersion: integer('current_version').notNull().default(1),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  legalHold: boolean('legal_hold').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * DMS-09: a scanning run. Pages are captured first and indexed afterwards, so a batch
 * carries its own state and the pages hang off it — an unindexed page is a real thing
 * that exists, not an absence.
 */
export const digitisationBatches = pgTable('digitisation_batches', {
  id: cuid('id'),
  ref: text('ref').notNull().unique(),
  source: text('source').notNull(),                       // where the paper came from
  estimatedPages: integer('estimated_pages').notNull().default(0),
  defaultFolderId: text('default_folder_id').references(() => docFolders.id),
  operator: text('operator'),
  status: text('status').notNull().default('OPEN'),       // OPEN | CLOSED
  createdById: text('created_by_id').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const digitisationPages = pgTable('digitisation_pages', {
  id: cuid('id'),
  batchId: text('batch_id').notNull().references(() => digitisationBatches.id),
  pageNumber: integer('page_number').notNull(),
  documentClass: text('document_class'),
  title: text('title'),
  reference: text('reference'),
  /** PENDING until someone indexes it, INDEXED once classified, FLAGGED when unusable. */
  status: text('status').notNull().default('PENDING'),
  flagReason: text('flag_reason'),
  indexedById: text('indexed_by_id').references(() => users.id),
  indexedAt: timestamp('indexed_at', { withTimezone: true }),
}, (t) => [uniqueIndex('digi_page_uq').on(t.batchId, t.pageNumber)]);

export const docVersions = pgTable('doc_versions', {
  id: cuid('id'),
  documentId: text('document_id').notNull().references(() => documents.id),
  versionNo: integer('version_no').notNull(),
  storageKey: text('storage_key').notNull(),
  sha256: text('sha256').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  note: text('note'),
  uploadedById: text('uploaded_by_id').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('doc_ver_uq').on(t.documentId, t.versionNo)]);

export const docLinks = pgTable('doc_links', {
  id: cuid('id'),
  documentId: text('document_id').notNull().references(() => documents.id),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
});

export const signatureRequests = pgTable('signature_requests', {
  id: cuid('id'),
  documentId: text('document_id').notNull().references(() => documents.id),
  versionNo: integer('version_no').notNull(),
  requestedById: text('requested_by_id').notNull().references(() => users.id),
  message: text('message'),
  deadline: timestamp('deadline', { withTimezone: true }),
  status: text('status').notNull().default('OPEN'), // OPEN | COMPLETED | DECLINED | VOIDED
  certificate: jsonb('certificate'), // filled on completion: signers, times, hash
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const signatureSigners = pgTable('signature_signers', {
  id: cuid('id'),
  requestId: text('request_id').notNull().references(() => signatureRequests.id),
  orderNo: integer('order_no').notNull().default(1),
  userId: text('user_id').references(() => users.id),
  externalName: text('external_name'),
  externalEmail: text('external_email'),
  externalToken: text('external_token').unique(), // single-use link token (DMS-08d)
  otpCode: text('otp_code'),
  status: text('status').notNull().default('PENDING'), // PENDING | SIGNED | DECLINED
  method: text('method'), // drawn | typed | saved
  declineReason: text('decline_reason'),
  docSha256AtSign: text('doc_sha256_at_sign'),
  ip: text('ip'),
  signedAt: timestamp('signed_at', { withTimezone: true }),
});

// ---------- people: hr profile, leave, checklists, timesheets, payroll ----------
export const staffProfiles = pgTable('staff_profiles', {
  id: cuid('id'),
  userId: text('user_id').notNull().unique().references(() => users.id),
  grade: text('grade'),
  hireDate: timestamp('hire_date', { withTimezone: true }),
  contractEnd: timestamp('contract_end', { withTimezone: true }),
  bankName: text('bank_name'),
  bankAccount: text('bank_account'), // visible to HR + Finance only (field-level control at API)
  pensionPin: text('pension_pin'),
  emergencyContact: jsonb('emergency_contact'),
  salaryKobo: bigint('salary_kobo', { mode: 'bigint' }), // monthly gross basis for payroll
  allowances: jsonb('allowances'), // [{name, amountKobo}]
});

export const leaveTypes = pgTable('leave_types', {
  id: cuid('id'),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  daysPerYear: integer('days_per_year').notNull(),
});

export const leaveBalances = pgTable('leave_balances', {
  id: cuid('id'),
  userId: text('user_id').notNull().references(() => users.id),
  leaveTypeId: text('leave_type_id').notNull().references(() => leaveTypes.id),
  year: integer('year').notNull(),
  entitledDays: integer('entitled_days').notNull(),
  usedDays: integer('used_days').notNull().default(0),
}, (t) => [uniqueIndex('leave_bal_uq').on(t.userId, t.leaveTypeId, t.year)]);

export const leaveRequests = pgTable('leave_requests', {
  id: cuid('id'),
  txId: text('tx_id').notNull().unique().references(() => transactions.id),
  userId: text('user_id').notNull().references(() => users.id),
  leaveTypeId: text('leave_type_id').notNull().references(() => leaveTypes.id),
  startDate: timestamp('start_date', { withTimezone: true }).notNull(),
  endDate: timestamp('end_date', { withTimezone: true }).notNull(),
  days: integer('days').notNull(),
  handoverNote: text('handover_note'),
});

export const staffChecklists = pgTable('staff_checklists', {
  id: cuid('id'),
  userId: text('user_id').notNull().references(() => users.id),
  kind: text('kind').notNull(), // ONBOARDING | OFFBOARDING
  items: jsonb('items').notNull(), // [{label, ownerRole, mandatory, done, doneById, doneAt}]
  status: text('status').notNull().default('OPEN'), // OPEN | COMPLETE
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const timesheets = pgTable('timesheets', {
  id: cuid('id'),
  txId: text('tx_id').unique().references(() => transactions.id),
  userId: text('user_id').notNull().references(() => users.id),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  rows: jsonb('rows').notNull(), // [{projectCode, percent}] must total 100
  status: text('status').notNull().default('DRAFT'), // DRAFT | SUBMITTED | LOCKED
  lockedAt: timestamp('locked_at', { withTimezone: true }),
}, (t) => [uniqueIndex('timesheet_uq').on(t.userId, t.periodStart)]);

export const payrollRuns = pgTable('payroll_runs', {
  id: cuid('id'),
  period: text('period').notNull().unique(), // YYYY-MM
  txId: text('tx_id').unique().references(() => transactions.id),
  status: text('status').notNull().default('DRAFT'), // DRAFT | PENDING | RELEASED
  totals: jsonb('totals'),
  createdById: text('created_by_id').references(() => users.id),
  releasedAt: timestamp('released_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const payrollItems = pgTable('payroll_items', {
  id: cuid('id'),
  runId: text('run_id').notNull().references(() => payrollRuns.id),
  userId: text('user_id').notNull().references(() => users.id),
  grossKobo: bigint('gross_kobo', { mode: 'bigint' }).notNull(),
  payeKobo: bigint('paye_kobo', { mode: 'bigint' }).notNull(),
  pensionEmployeeKobo: bigint('pension_employee_kobo', { mode: 'bigint' }).notNull(),
  pensionEmployerKobo: bigint('pension_employer_kobo', { mode: 'bigint' }).notNull(),
  nhfKobo: bigint('nhf_kobo', { mode: 'bigint' }).notNull(),
  otherDeductionsKobo: bigint('other_deductions_kobo', { mode: 'bigint' }).notNull().default(sql`0`),
  netKobo: bigint('net_kobo', { mode: 'bigint' }).notNull(),
  breakdown: jsonb('breakdown'),
}, (t) => [uniqueIndex('payroll_item_uq').on(t.runId, t.userId)]);

// ---------- ops: vendors, rfq, po, contracts, assets, inventory ----------
export const vendors = pgTable('vendors', {
  id: cuid('id'),
  name: text('name').notNull(),
  contact: jsonb('contact'), // {email, phone, address}
  tin: text('tin'),
  bankDetails: jsonb('bank_details'),
  categories: jsonb('categories'),
  blacklisted: boolean('blacklisted').notNull().default(false),
  blacklistReason: text('blacklist_reason'),
  dueDiligence: jsonb('due_diligence'), // {cacDocId, taxClearanceDocId, expiresAt}
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const rfqs = pgTable('rfqs', {
  id: cuid('id'),
  ref: text('ref').notNull().unique(),
  requisitionTxId: text('requisition_tx_id').references(() => transactions.id),
  title: text('title').notNull(),
  deadline: timestamp('deadline', { withTimezone: true }),
  status: text('status').notNull().default('OPEN'), // OPEN | SELECTED | CANCELLED
  selectionJustification: text('selection_justification'),
  createdById: text('created_by_id').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const rfqQuotes = pgTable('rfq_quotes', {
  id: cuid('id'),
  rfqId: text('rfq_id').notNull().references(() => rfqs.id),
  vendorId: text('vendor_id').notNull().references(() => vendors.id),
  totalKobo: bigint('total_kobo', { mode: 'bigint' }).notNull(),
  lines: jsonb('lines'),
  validityDays: integer('validity_days'),
  selected: boolean('selected').notNull().default(false),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
});

export const purchaseOrders = pgTable('purchase_orders', {
  id: cuid('id'),
  ref: text('ref').notNull().unique(),
  requisitionTxId: text('requisition_tx_id').references(() => transactions.id),
  rfqId: text('rfq_id').references(() => rfqs.id),
  vendorId: text('vendor_id').notNull().references(() => vendors.id),
  totalKobo: bigint('total_kobo', { mode: 'bigint' }).notNull(),
  lines: jsonb('lines').notNull(), // [{description, qty, unitKobo, receivedQty}]
  status: text('status').notNull().default('OPEN'), // OPEN | PARTIAL | CLOSED | CANCELLED
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
});

export const poReceipts = pgTable('po_receipts', {
  id: cuid('id'),
  poId: text('po_id').notNull().references(() => purchaseOrders.id),
  lines: jsonb('lines').notNull(), // [{lineIndex, qty}]
  note: text('note'),
  receivedById: text('received_by_id').notNull().references(() => users.id),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
});

export const contracts = pgTable('contracts', {
  id: cuid('id'),
  ref: text('ref').notNull().unique(),
  vendorId: text('vendor_id').notNull().references(() => vendors.id),
  title: text('title').notNull(),
  valueKobo: bigint('value_kobo', { mode: 'bigint' }).notNull(),
  paidKobo: bigint('paid_kobo', { mode: 'bigint' }).notNull().default(sql`0`),
  startDate: timestamp('start_date', { withTimezone: true }),
  endDate: timestamp('end_date', { withTimezone: true }),
  documentId: text('document_id').references(() => documents.id),
  status: text('status').notNull().default('ACTIVE'), // ACTIVE | EXPIRED | TERMINATED
});

export const assets = pgTable('assets', {
  id: cuid('id'),
  tag: text('tag').notNull().unique(),
  description: text('description').notNull(),
  category: text('category').notNull(),
  custodianId: text('custodian_id').references(() => users.id),
  location: text('location'),
  fundingCode: text('funding_code'),
  costKobo: bigint('cost_kobo', { mode: 'bigint' }).notNull(),
  acquiredAt: timestamp('acquired_at', { withTimezone: true }),
  usefulLifeMonths: integer('useful_life_months'),
  status: text('status').notNull().default('IN_SERVICE'), // IN_SERVICE | IN_STORE | UNDER_REPAIR | DISPOSED | MISSING
  photos: jsonb('photos'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const assetEvents = pgTable('asset_events', {
  id: cuid('id'),
  assetId: text('asset_id').notNull().references(() => assets.id),
  kind: text('kind').notNull(), // ASSIGN | TRANSFER | RETURN | VERIFY | REPAIR | DISPOSE
  data: jsonb('data'),
  actorId: text('actor_id').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const inventoryItems = pgTable('inventory_items', {
  id: cuid('id'),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  unit: text('unit').notNull().default('unit'),
  qtyOnHand: integer('qty_on_hand').notNull().default(0),
  reorderLevel: integer('reorder_level').notNull().default(0),
});

export const inventoryMoves = pgTable('inventory_moves', {
  id: cuid('id'),
  itemId: text('item_id').notNull().references(() => inventoryItems.id),
  kind: text('kind').notNull(), // GRN | ISSUE | ADJUST | COUNT
  qty: integer('qty').notNull(), // positive in, negative out
  refText: text('ref_text'),
  actorId: text('actor_id').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------- governance: grants, audit flags, findings ----------
export const grants = pgTable('grants', {
  id: cuid('id'),
  code: text('code').notNull().unique(), // = donorCode on transactions
  donor: text('donor').notNull(),
  title: text('title').notNull(),
  currency: text('currency').notNull().default('NGN'),
  valueMinor: bigint('value_minor', { mode: 'bigint' }).notNull(), // grant currency minor units
  fxRateToNgn: text('fx_rate_to_ngn'), // dated rate string, e.g. "1650.00"
  startDate: timestamp('start_date', { withTimezone: true }),
  endDate: timestamp('end_date', { withTimezone: true }),
  conditions: text('conditions'),
  status: text('status').notNull().default('ACTIVE'), // PIPELINE | ACTIVE | CLOSING | CLOSED
});

export const grantDeadlines = pgTable('grant_deadlines', {
  id: cuid('id'),
  grantId: text('grant_id').notNull().references(() => grants.id),
  title: text('title').notNull(),
  dueDate: timestamp('due_date', { withTimezone: true }).notNull(),
  ownerRole: roleCode('owner_role'),
  status: text('status').notNull().default('OPEN'), // OPEN | DONE | OVERDUE
});

export const auditFlags = pgTable('audit_flags', {
  id: cuid('id'),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  raisedById: text('raised_by_id').notNull().references(() => users.id),
  severity: text('severity').notNull().default('MEDIUM'), // LOW | MEDIUM | HIGH
  question: text('question').notNull(),
  response: text('response'),
  respondedById: text('responded_by_id').references(() => users.id),
  status: text('status').notNull().default('OPEN'), // OPEN | RESPONDED | CLOSED
  closedAt: timestamp('closed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const findings = pgTable('findings', {
  id: cuid('id'),
  ref: text('ref').notNull().unique(),
  title: text('title').notNull(),
  severity: text('severity').notNull().default('MEDIUM'),
  ownerId: text('owner_id').references(() => users.id),
  dueDate: timestamp('due_date', { withTimezone: true }),
  status: text('status').notNull().default('OPEN'), // OPEN | IN_PROGRESS | RESOLVED | CLOSED
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});


// AUD-06: external auditor scope — read-only, donor/period-bounded, auto-expiring.
export const auditorScopes = pgTable('auditor_scopes', {
  id: cuid('id'),
  userId: text('user_id').notNull().references(() => users.id),
  donorCode: text('donor_code'), // null = all donors
  periodStart: timestamp('period_start', { withTimezone: true }),
  periodEnd: timestamp('period_end', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdById: text('created_by_id').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// DSH-05: scheduled reports — emailed on a cadence to role recipients.
export const scheduledReports = pgTable('scheduled_reports', {
  id: cuid('id'),
  name: text('name').notNull(),
  reportKey: text('report_key').notNull(), // requisition-register | outstanding-advances | pipeline
  filters: jsonb('filters'),
  recipientsRole: roleCode('recipients_role').notNull(),
  dayOfWeek: integer('day_of_week').notNull().default(1), // 0=Sun..6
  hour: integer('hour').notNull().default(8), // Africa/Lagos
  active: boolean('active').notNull().default(true),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  createdById: text('created_by_id').references(() => users.id),
});

// DSH-06: saved custom report definitions over curated views.
export const savedReports = pgTable('saved_reports', {
  id: cuid('id'),
  name: text('name').notNull(),
  ownerId: text('owner_id').notNull().references(() => users.id),
  shared: boolean('shared').notNull().default(false),
  config: jsonb('config').notNull(), // { entity:'transactions', columns:[], filters:{} }
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
