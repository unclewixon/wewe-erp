/**
 * File bytes on disk (DMS-01). Key = random hex, never a client filename.
 * Location: apps/api/var/storage (the API runs with cwd = apps/api); override
 * with DMS_STORAGE_DIR for tests/deployments.
 */
import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { mkdirSync, promises as fsp } from 'fs';
import * as path from 'path';

const KEY_RE = /^[0-9a-f]{16,64}$/;

@Injectable()
export class DocStorageService {
  readonly dir = process.env.DMS_STORAGE_DIR ?? path.resolve(process.cwd(), 'var/storage');
  private ensured = false;

  private ensure(): void {
    if (!this.ensured) {
      mkdirSync(this.dir, { recursive: true });
      this.ensured = true;
    }
  }

  private safePath(key: string): string | null {
    if (!KEY_RE.test(key)) return null; // keys are hex only — no traversal possible
    return path.join(this.dir, key);
  }

  sha256(buf: Buffer): string {
    return createHash('sha256').update(buf).digest('hex');
  }

  async save(buf: Buffer): Promise<{ key: string; sha256: string }> {
    this.ensure();
    const key = randomBytes(16).toString('hex');
    await fsp.writeFile(path.join(this.dir, key), buf);
    return { key, sha256: this.sha256(buf) };
  }

  /** null when the file no longer exists (e.g. disposed). */
  async read(key: string): Promise<Buffer | null> {
    const p = this.safePath(key);
    if (!p) return null;
    try {
      return await fsp.readFile(p);
    } catch {
      return null;
    }
  }

  /** Idempotent delete — used only by the DOC_DISPOSAL approval hook. */
  async remove(key: string): Promise<void> {
    const p = this.safePath(key);
    if (!p) return;
    try {
      await fsp.unlink(p);
    } catch {
      /* already gone */
    }
  }
}
