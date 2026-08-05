/**
 * DMS-04: real OCR behind the OcrService seam — Tesseract 5 via the system binary.
 * Images go straight to tesseract; PDFs are rasterised page-by-page with pdftoppm
 * (Poppler) first. Both binaries ship in the api Docker image (see Dockerfile).
 *
 * Deliberately bounded: 20 pages / 25MB per document, 60s per page — digitised
 * archives are processed incrementally, not in one heroic pass. Extraction is a
 * technical step and stays audit-free (reads/downloads are what the log tracks).
 */
import { Injectable } from '@nestjs/common';
import { execFile } from 'child_process';
import { mkdtemp, rm, writeFile, readdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { OcrService } from './ocr';

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_PAGES = 20;
const PAGE_TIMEOUT_MS = 60_000;

const OCR_IMAGE_MIMES = new Set([
  'image/png', 'image/jpeg', 'image/jpg', 'image/tiff', 'image/bmp', 'image/webp',
]);

function run(cmd: string, args: string[], timeout = PAGE_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err); else resolve(stdout);
    });
  });
}

@Injectable()
export class TesseractOcrService implements OcrService {
  static isOcrable(mime: string): boolean {
    return OCR_IMAGE_MIMES.has(mime) || mime === 'application/pdf';
  }

  async extract(bytes: Buffer, mime: string): Promise<string | null> {
    if (!TesseractOcrService.isOcrable(mime) || bytes.length > MAX_BYTES) return null;
    const dir = await mkdtemp(join(tmpdir(), 'wewe-ocr-'));
    try {
      if (OCR_IMAGE_MIMES.has(mime)) {
        const img = join(dir, 'page');
        await writeFile(img, bytes);
        const text = await run('tesseract', [img, 'stdout', '-l', 'eng', '--psm', '3']);
        return this.clean(text);
      }
      // PDF: rasterise pages (300dpi greyscale keeps tesseract accurate and fast)
      const pdf = join(dir, 'doc.pdf');
      await writeFile(pdf, bytes);
      await run('pdftoppm', ['-gray', '-r', '300', '-l', String(MAX_PAGES), '-png', pdf, join(dir, 'p')], PAGE_TIMEOUT_MS * 2);
      const pages = (await readdir(dir)).filter((f) => f.startsWith('p') && f.endsWith('.png')).sort();
      const chunks: string[] = [];
      for (const p of pages.slice(0, MAX_PAGES)) {
        try { chunks.push(await run('tesseract', [join(dir, p), 'stdout', '-l', 'eng', '--psm', '3'])); }
        catch { /* one unreadable page must not sink the document */ }
      }
      return this.clean(chunks.join('\n'));
    } catch (e) {
      console.warn(`[dms] OCR failed for ${mime}: ${(e as Error).message}`);
      return null;
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private clean(text: string): string | null {
    const t = text.replace(/\f/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    return t.length >= 3 ? t.slice(0, 200_000) : null;
  }
}
