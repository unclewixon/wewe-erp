/**
 * MONEY area — budgets & virements (BUD-01..03), advances & travel (ADV-01..04),
 * retirements (RET-01..05), QuickBooks sandbox outbox (QBI-01..05), plus the
 * REQ-02 budget check consumed by the requisitions module.
 */
import { db, schema } from '../../db/client';
import { WorkflowService } from '../../workflow/workflow.service';
import { BudgetsController, BudgetsService } from './budgets';
import { VirementsController, VirementsService, applyVirementHook } from './virements';
import { AdvancesController, AdvancesService } from './advances';
import { RetirementsController, RetirementsService, applyRetirementHook } from './retirements';
import { QbController, QbOAuthController, QbService } from './qb';
import { MONEY_SETTING_DEFAULTS } from './settings.util';

export const controllers = [
  BudgetsController, VirementsController, AdvancesController, RetirementsController, QbController, QbOAuthController,
];
export const providers = [
  BudgetsService, VirementsService, AdvancesService, RetirementsService, QbService,
];

// re-exported for the requisitions module's REQ-02 budget check
export { evaluateBudgetCheck } from './budgets';

/** Idempotent reference data: transaction types + money-area settings defaults. */
export async function seedDefaults(): Promise<void> {
  // Same 4-stage chain as REQUISITION; FINAL_APPROVER only at/above ₦500,000.00 (WFE-03)
  const fourStageChain = [
    { role: 'SUPERVISOR' }, { role: 'INTERNAL_AUDIT' }, { role: 'FINANCE' },
    { role: 'FINAL_APPROVER', minAmountKobo: '50000000' },
  ] as (typeof schema.transactionTypes.$inferInsert)['stages'];

  await db.insert(schema.transactionTypes).values([
    {
      code: 'VIREMENT', name: 'Budget Virement', refPrefix: 'VIR',
      stages: [{ role: 'FINANCE' }, { role: 'FINAL_APPROVER' }],
    },
    { code: 'ADVANCE', name: 'Staff Advance', refPrefix: 'ADV', stages: fourStageChain },
    { code: 'RETIREMENT', name: 'Advance Retirement', refPrefix: 'RET', stages: fourStageChain },
  ]).onConflictDoNothing();

  await db.insert(schema.settings).values(
    Object.entries(MONEY_SETTING_DEFAULTS).map(([key, value]) => ({ key, value: value as unknown })),
  ).onConflictDoNothing();
}

/** Post-approval effects (hooks are idempotent via payload markers). */
export function register(): void {
  WorkflowService.onFinalApproval('VIREMENT', applyVirementHook);
  WorkflowService.onFinalApproval('RETIREMENT', applyRetirementHook);
  // ADVANCE has no final-approval effect by design: the advance stays REQUESTED
  // until Finance records the disbursement (POST /v1/advances/:id/disburse).
}
