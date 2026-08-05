/**
 * PEOPLE area — HR core (HRM-01), leave (HRM-02), checklists (HRM-03),
 * HR letters (HRM-05), timesheets (TLS-01..03), payroll (PAY-01..03).
 * Wired into app.ts by the integrator via controllers/providers/seedDefaults/register.
 */
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../../db/client';
import { WorkflowService } from '../../workflow/workflow.service';
import { bus } from '../../events';
import type { RoleCode } from '../../db/schema';
import { seedSetting } from './settings.util';
import { CHECKLIST_TEMPLATES, ChecklistsController, HrService, LETTER_TEMPLATES, StaffController } from './hr';
import { LEAVE_TYPE_SEED, LeaveController, LeaveService, leaveApprovalHook } from './leave';
import { TimesheetsController, TimesheetsService, timesheetApprovalHook } from './timesheets';
import { PayrollController, PayrollService, payrollApprovalHook } from './payroll';
import { SEED_PAYROLL_RULES } from './payroll.logic';

export const controllers = [
  StaffController, ChecklistsController, LeaveController, TimesheetsController, PayrollController,
];
export const providers = [HrService, LeaveService, TimesheetsService, PayrollService];

/** Approval chains for this area's transaction types (WFE-10: config rows, not code paths). */
const TRANSACTION_TYPES: { code: string; name: string; refPrefix: string; stages: { role: RoleCode }[] }[] = [
  { code: 'LEAVE', name: 'Leave Request', refPrefix: 'LVE', stages: [{ role: 'SUPERVISOR' }, { role: 'HR_OFFICER' }] },
  { code: 'TIMESHEET', name: 'Timesheet', refPrefix: 'TSH', stages: [{ role: 'SUPERVISOR' }, { role: 'FINANCE' }] },
  { code: 'PAYROLL', name: 'Payroll Release', refPrefix: 'PAY', stages: [{ role: 'FINANCE' }, { role: 'FINAL_APPROVER' }] },
];

/** Idempotent reference data: transaction types, leave types, HR/payroll settings. */
export async function seedDefaults(): Promise<void> {
  for (const t of TRANSACTION_TYPES) {
    await db.insert(schema.transactionTypes).values(t)
      .onConflictDoNothing({ target: schema.transactionTypes.code });
  }
  for (const lt of LEAVE_TYPE_SEED) {
    await db.insert(schema.leaveTypes).values(lt)
      .onConflictDoNothing({ target: schema.leaveTypes.code });
  }
  await seedSetting('hr.checklists', CHECKLIST_TEMPLATES);
  await seedSetting('hr.letterTemplates', LETTER_TEMPLATES);
  await seedSetting('payroll.rules', SEED_PAYROLL_RULES);
}

let registered = false;

/** Post-approval hooks + bus subscriptions. Safe to call more than once. */
export function register(): void {
  if (registered) return;
  registered = true;

  WorkflowService.onFinalApproval('LEAVE', leaveApprovalHook);
  WorkflowService.onFinalApproval('TIMESHEET', timesheetApprovalHook);
  WorkflowService.onFinalApproval('PAYROLL', payrollApprovalHook);

  // A rejected/returned submission goes back to DRAFT so the owner can fix and resubmit
  // (resubmission creates a fresh transaction; the old one stays in the history).
  bus.on('tx.stage', (e: { txId: string; typeCode: string; resulting: string }) => {
    void (async () => {
      if (e.resulting !== 'REJECTED' && e.resulting !== 'RETURNED') return;
      try {
        if (e.typeCode === 'TIMESHEET') {
          await db.update(schema.timesheets).set({ status: 'DRAFT' })
            .where(and(eq(schema.timesheets.txId, e.txId), eq(schema.timesheets.status, 'SUBMITTED')));
        } else if (e.typeCode === 'PAYROLL') {
          await db.update(schema.payrollRuns).set({ status: 'DRAFT' })
            .where(and(eq(schema.payrollRuns.txId, e.txId), eq(schema.payrollRuns.status, 'PENDING')));
        }
      } catch {
        /* notification-grade side effect — never block the approval flow */
      }
    })();
  });
}
