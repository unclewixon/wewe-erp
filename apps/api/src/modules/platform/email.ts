/**
 * NTF email outbox. Queue rows in email_outbox; processOutbox() delivers.
 *
 * DEV TRANSPORT: delivery writes .eml-style plain-text files to apps/api/var/outbox/
 * and marks the row SENT. Wiring a real provider (Microsoft 365 / Gmail via OAuth)
 * is a later integration — swap the file write in deliver() for the provider call;
 * everything else (queueing, retry counters, status flow) stays as is.
 */
import { Controller, Injectable, Post, UseGuards } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { db, schema } from '../../db/client';
import { AuthGuard, RequireRoles } from '../../auth/auth';

// __dirname = <apps/api>/src/modules/platform (ts-node) or <apps/api>/dist/modules/platform (build)
const OUTBOX_DIR = join(__dirname, '..', '..', '..', 'var', 'outbox');
const MAX_ATTEMPTS = 5;
const FROM = 'WEWE ERP <no-reply@wewe.org>';

@Injectable()
export class EmailService {
  async enqueue(toEmail: string, subject: string, body: string): Promise<void> {
    await db.insert(schema.emailOutbox).values({ toEmail, subject, body });
  }

  /** Deliver all PENDING rows (oldest first). Failures retry until MAX_ATTEMPTS, then FAILED. */
  async processOutbox(): Promise<{ processed: number; sent: number; failed: number }> {
    const rows = await db.select().from(schema.emailOutbox)
      .where(eq(schema.emailOutbox.status, 'PENDING'))
      .orderBy(asc(schema.emailOutbox.createdAt)).limit(200);
    let sent = 0; let failed = 0;
    for (const row of rows) {
      try {
        this.deliver(row.id, row.toEmail, row.subject, row.body, row.createdAt);
        await db.update(schema.emailOutbox)
          .set({ status: 'SENT', sentAt: new Date(), attempts: row.attempts + 1, lastError: null })
          .where(eq(schema.emailOutbox.id, row.id));
        sent += 1;
      } catch (e: any) {
        const attempts = row.attempts + 1;
        await db.update(schema.emailOutbox)
          .set({ attempts, lastError: String(e?.message ?? e), status: attempts >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING' })
          .where(eq(schema.emailOutbox.id, row.id));
        failed += 1;
      }
    }
    return { processed: rows.length, sent, failed };
  }

  /** Dev transport (see file header): one .eml-style text file per message. */
  private deliver(id: string, to: string, subject: string, body: string, queuedAt: Date): void {
    mkdirSync(OUTBOX_DIR, { recursive: true });
    const content = [
      `From: ${FROM}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `Date: ${new Date().toUTCString()}`,
      `X-WEWE-Queued-At: ${queuedAt.toISOString()}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      body,
      '',
    ].join('\n');
    writeFileSync(join(OUTBOX_DIR, `${Date.now()}-${id}.eml`), content, 'utf8');
  }
}

@Controller('v1/admin/email')
@UseGuards(AuthGuard)
@RequireRoles('SYSTEM_ADMIN')
export class EmailAdminController {
  constructor(private readonly email: EmailService) {}

  /** Manual trigger for testing; the register() interval also runs this every minute. */
  @Post('process-outbox')
  process() {
    return this.email.processOutbox();
  }
}
