/**
 * NTF email outbox. Queue rows in email_outbox; processOutbox() delivers.
 *
 * TRANSPORT: if SMTP is configured (SMTP_HOST set), messages are sent over SMTP via
 * nodemailer — works with Google Workspace, Microsoft 365, or any SMTP relay using a
 * mailbox/app password. If SMTP is NOT configured, delivery falls back to writing
 * .eml-style files to apps/api/var/outbox/ (dev). Queueing, retry counters, and the
 * status flow are identical either way.
 *
 *   ENV: SMTP_HOST, SMTP_PORT (default 587), SMTP_USER, SMTP_PASS,
 *        SMTP_SECURE ('1' for implicit TLS/465), MAIL_FROM (default below)
 */
import { Controller, Injectable, Post, UseGuards } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import * as nodemailer from 'nodemailer';
import { db, schema } from '../../db/client';
import { AuthGuard, RequireRoles } from '../../auth/auth';

// __dirname = <apps/api>/src/modules/platform (ts-node) or <apps/api>/dist/modules/platform (build)
const OUTBOX_DIR = join(__dirname, '..', '..', '..', 'var', 'outbox');
const MAX_ATTEMPTS = 5;
const FROM = process.env.MAIL_FROM || 'WEWE ERP <no-reply@wewe.org>';

let _transporter: nodemailer.Transporter | null = null;
let _transporterInit = false;
function getTransporter(): nodemailer.Transporter | null {
  if (_transporterInit) return _transporter;
  _transporterInit = true;
  const host = process.env.SMTP_HOST;
  if (!host) { _transporter = null; return null; }
  _transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === '1',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return _transporter;
}

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
        await this.deliver(row.id, row.toEmail, row.subject, row.body, row.createdAt);
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

  /** SMTP transport when configured; otherwise the dev file transport (see header). */
  private async deliver(id: string, to: string, subject: string, body: string, queuedAt: Date): Promise<void> {
    const tx = getTransporter();
    if (tx) {
      await tx.sendMail({ from: FROM, to, subject, text: body });
      return;
    }
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
