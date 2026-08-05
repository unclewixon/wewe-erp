/**
 * DMS-04 OCR seam. The default implementation is a deliberate stub: it returns
 * null (no extracted text) and logs a TODO. It writes NO audit events — text
 * extraction is a technical step, not a business action. `textContent` can be
 * supplied by the client at upload instead.
 */
import { Injectable } from '@nestjs/common';

export interface OcrService {
  /** Extracted plain text for search indexing, or null when unavailable. */
  extract(bytes: Buffer, mime: string): Promise<string | null>;
}

@Injectable()
export class NullOcrService implements OcrService {
  async extract(_bytes: Buffer, mime: string): Promise<string | null> {
    // TODO(DMS-04): integrate a real OCR engine (e.g. Tesseract sidecar) and
    // backfill documents.text_content. Intentionally audit-free.
    console.log(`[dms] OCR stub: no text extracted for ${mime} (TODO: integrate OCR engine)`);
    return null;
  }
}
