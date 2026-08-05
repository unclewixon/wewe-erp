/**
 * GOVERNANCE area — grants & donor management (DGM-01..04), audit flags &
 * findings (AUD-02), evidence packs (AUD-04), access & activity reports
 * (AUD-05), pipeline analytics (DSH-02 backend).
 *
 * The integrator wires `controllers`/`providers` into app.ts and calls
 * `seedDefaults()` / `register()` at bootstrap.
 */
import { db, schema } from '../../db/client';
import { GrantDeadlinesController, GrantsController, GrantsService } from './grants';
import { AuditFlagsController, AuditFlagsService, FindingsController } from './audit-flags';
import { EvidencePackController, EvidencePackService } from './evidence';
import { ActivityController } from './activity';
import { PipelineAnalyticsController } from './pipeline';

export const controllers = [
  GrantsController,
  GrantDeadlinesController,
  AuditFlagsController,
  FindingsController,
  EvidencePackController,
  ActivityController,
  PipelineAnalyticsController,
];

export const providers = [GrantsService, AuditFlagsService, EvidencePackService];

/** Idempotent reference data: two live grants whose codes double as transaction donorCodes. */
export async function seedDefaults(): Promise<void> {
  await db.insert(schema.grants).values([
    {
      code: 'USAID-LON-24',
      donor: 'USAID',
      title: 'Local Orphans & Vulnerable Children Network (LON)',
      currency: 'USD',
      valueMinor: 250_000_000n, // USD 2,500,000.00 in cents
      fxRateToNgn: '1650.00',
      startDate: new Date('2024-01-01T00:00:00Z'),
      endDate: new Date('2026-12-31T23:59:59Z'),
      conditions: 'Quarterly financial reports; 7% de-minimis indirect rate; prior approval required for equipment above USD 5,000.',
      status: 'ACTIVE',
    },
    {
      code: 'EU-WISH-23',
      donor: 'European Union',
      title: 'Women in Sustainable Health (WISH)',
      currency: 'EUR',
      valueMinor: 120_000_000n, // EUR 1,200,000.00 in cents
      fxRateToNgn: '1800.00',
      startDate: new Date('2023-07-01T00:00:00Z'),
      endDate: new Date('2026-09-30T23:59:59Z'),
      conditions: 'Annual narrative and financial reporting; EU visibility guidelines apply to all deliverables.',
      status: 'CLOSING',
    },
  ]).onConflictDoNothing();
}

/** No approval-routed transaction types or bus subscriptions in this area (yet). */
export function register(): void {
  // Governance entities (grants, flags, findings) are not workflow-routed;
  // nothing to hook on final approval and no bus subscriptions needed.
}
