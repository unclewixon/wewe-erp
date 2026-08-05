/**
 * DOCUMENTS & E-SIGN module area (DMS-01/02/03/04/06/07/08).
 * Wired into app.ts by the integrator — this file only exports the pieces.
 */
import { WorkflowService } from '../../workflow/workflow.service';
import { DocStorageService } from './storage';
import { NullOcrService } from './ocr';
import { TesseractOcrService } from './ocr.tesseract';
import {
  DmsService, DocumentsController, FoldersController, LinksController, SearchController,
  disposalHook, seedRepositoryDefaults, DOC_DISPOSAL_TYPE,
} from './repository';
import { EsignController, EsignExternalController, EsignService } from './esign';

export const controllers = [
  FoldersController, DocumentsController, LinksController, SearchController,
  EsignController, EsignExternalController,
];

export const providers = [DocStorageService, { provide: NullOcrService, useClass: TesseractOcrService }, DmsService, EsignService];

/** Idempotent reference data: DOC_DISPOSAL type + root folder tree. */
export async function seedDefaults(): Promise<void> {
  await seedRepositoryDefaults();
}

/** DMS-06: after INTERNAL_AUDIT → SYSTEM_ADMIN approval, wipe bytes, keep row + trail. */
export function register(): void {
  WorkflowService.onFinalApproval(DOC_DISPOSAL_TYPE, disposalHook);
}
