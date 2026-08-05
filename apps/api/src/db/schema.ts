import {
  pgTable, pgEnum, text, timestamp, integer, bigint, boolean, jsonb, serial, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

export const roleCode = pgEnum('role_code', [
  'INITIATOR', 'SUPERVISOR', 'INTERNAL_AUDIT', 'FINANCE', 'FINAL_APPROVER', 'HR_OFFICER', 'SYSTEM_ADMIN',
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
  // ordered approval chain after the initiator:
  // [{"role":"SUPERVISOR"},{"role":"INTERNAL_AUDIT"},{"role":"FINANCE"},{"role":"FINAL_APPROVER"}]
  stages: jsonb('stages').notNull().$type<{ role: RoleCode }[]>(),
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
