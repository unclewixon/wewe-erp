/**
 * OPERATIONS module area — procurement (vendors, RFQs, POs, contracts),
 * assets, and inventory. Wired into app.ts by the integrator.
 */
import { db, schema } from '../../db/client';
import { WorkflowService } from '../../workflow/workflow.service';
import { DEFAULT_ASSET_CATEGORIES, DEFAULT_THRESHOLDS } from './ops.logic';
import { VendorsController, VendorsService } from './vendors';
import { RfqsController, RfqsService } from './rfqs';
import { PurchaseOrdersController, PurchaseOrdersService } from './purchase-orders';
import { ContractsController, ContractsService } from './contracts';
import { AssetCampaignsController, AssetsController, AssetsService } from './assets';
import { InventoryController, InventoryService } from './inventory';

export const controllers = [
  VendorsController, RfqsController, PurchaseOrdersController,
  ContractsController, AssetsController, AssetCampaignsController, InventoryController,
];

export const providers = [
  VendorsService, RfqsService, PurchaseOrdersService,
  ContractsService, AssetsService, InventoryService,
];

/** Idempotent reference data: threshold bands, asset category lives, ASSET_DISPOSAL type. */
export async function seedDefaults(): Promise<void> {
  await db.insert(schema.settings)
    .values({ key: 'procurement.thresholds', value: DEFAULT_THRESHOLDS })
    .onConflictDoNothing({ target: schema.settings.key });

  await db.insert(schema.settings)
    .values({ key: 'assets.categories', value: DEFAULT_ASSET_CATEGORIES })
    .onConflictDoNothing({ target: schema.settings.key });

  await db.insert(schema.transactionTypes).values({
    code: 'ASSET_DISPOSAL',
    name: 'Asset Disposal',
    refPrefix: 'ADS',
    stages: [{ role: 'FINANCE' }, { role: 'FINAL_APPROVER' }],
  }).onConflictDoNothing({ target: schema.transactionTypes.code });
}

/** Post-approval effects: an approved ASSET_DISPOSAL marks the asset DISPOSED + DISPOSE event. */
export function register(): void {
  WorkflowService.onFinalApproval('ASSET_DISPOSAL', async (tx) => {
    await AssetsService.applyDisposal(tx);
  });
}

export {
  VendorsController, VendorsService, RfqsController, RfqsService,
  PurchaseOrdersController, PurchaseOrdersService, ContractsController, ContractsService,
  AssetsController, AssetCampaignsController, AssetsService, InventoryController, InventoryService,
};
