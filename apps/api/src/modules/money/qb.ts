import {
  BadRequestException, Body, Controller, Get, Injectable, NotFoundException, Param, Post, Query, Req, Res, UseGuards,
} from '@nestjs/common';
import { desc, eq, isNotNull, sql } from 'drizzle-orm';
import { db, schema } from '../../db/client';
import { AuditService } from '../../audit/audit.service';
import { AuthGuard, CurrentUser, RequireRoles, type AuthedUser } from '../../auth/auth';
import { getSetting } from './settings.util';
import {
  buildAuthorizeUrl, disconnect as qbDisconnect, getAccounts, handleCallback,
  isConnected, postJournalEntry, qbEnvCreds, setAccounts, setMode, type QbAccounts,
} from './qb.live';

const auditLogger = new AuditService();

/**
 * QBI-02: queue a journal entry for QuickBooks. Called from approval hooks
 * (advance disbursement, retirement approval). Payload amounts are kobo strings.
 */
export async function queueJournal(txId: string | null, payload: Record<string, unknown>): Promise<string> {
  const [row] = await db.insert(schema.qbOutbox).values({
    txId, kind: 'JOURNAL', payload, status: 'PENDING',
  }).returning();
  return row.id;
}

/**
 * QBI-03 worker: process PENDING outbox entries. In sandbox mode ('qb.mode',
 * default) entries post immediately with a QB-SANDBOX-<n> reference; in 'live'
 * mode they stay PENDING with a note — real OAuth posting is a later integration.
 * Safe to call opportunistically after queuing.
 */
export async function processOutbox(): Promise<{ mode: 'sandbox' | 'live'; posted: number; pending: number }> {
  const mode = await getSetting('qb.mode');
  const pendingRows = await db.select().from(schema.qbOutbox)
    .where(eq(schema.qbOutbox.status, 'PENDING')).orderBy(schema.qbOutbox.createdAt);
  if (mode !== 'sandbox') {
    // LIVE: post each queued journal to QuickBooks Online. If the app isn't connected
    // (or credentials aren't set), leave entries PENDING with an actionable note.
    if (!(await isConnected())) {
      const note = qbEnvCreds().configured
        ? 'QuickBooks not connected — authorize via GET /v1/qb/connect'
        : 'QuickBooks app credentials not set (QBO_CLIENT_ID / QBO_CLIENT_SECRET / QBO_REDIRECT_URI)';
      for (const row of pendingRows) {
        if (row.error !== note) {
          await db.update(schema.qbOutbox).set({ error: note }).where(eq(schema.qbOutbox.id, row.id));
        }
      }
      return { mode, posted: 0, pending: pendingRows.length };
    }
    let posted = 0; let errored = 0;
    for (const row of pendingRows) {
      try {
        const qbRef = await postJournalEntry(row.payload as Record<string, any>);
        await db.update(schema.qbOutbox).set({
          status: 'POSTED', qbRef, postedAt: new Date(), attempts: row.attempts + 1, error: null,
        }).where(eq(schema.qbOutbox.id, row.id));
        posted += 1;
      } catch (e: any) {
        errored += 1;
        await db.update(schema.qbOutbox).set({
          status: 'ERROR', attempts: row.attempts + 1, error: String(e?.message ?? e),
        }).where(eq(schema.qbOutbox.id, row.id));
      }
    }
    return { mode, posted, pending: pendingRows.length - posted - errored };
  }
  // next sandbox sequence number = count of entries ever given a qbRef + 1
  const [cnt] = await db.select({ n: sql<number>`count(*)` }).from(schema.qbOutbox)
    .where(isNotNull(schema.qbOutbox.qbRef));
  let n = Number(cnt?.n ?? 0);
  let posted = 0;
  for (const row of pendingRows) {
    n += 1;
    await db.update(schema.qbOutbox).set({
      status: 'POSTED', qbRef: `QB-SANDBOX-${n}`, postedAt: new Date(),
      attempts: row.attempts + 1, error: null,
    }).where(eq(schema.qbOutbox.id, row.id));
    posted += 1;
  }
  return { mode, posted, pending: 0 };
}

@Injectable()
export class QbService {
  constructor(private readonly audit: AuditService) {}

  async list(status?: string) {
    const rows = await db.select().from(schema.qbOutbox)
      .where(status ? eq(schema.qbOutbox.status, status) : undefined)
      .orderBy(desc(schema.qbOutbox.createdAt)).limit(200);
    return rows.map((r) => ({
      id: r.id, txId: r.txId, kind: r.kind, status: r.status, qbRef: r.qbRef,
      error: r.error, attempts: r.attempts, payload: r.payload,
      postedAt: r.postedAt, createdAt: r.createdAt,
    }));
  }

  /** QBI-04: reset one entry to PENDING and run the worker again. */
  async repost(user: AuthedUser, id: string, ip?: string) {
    const row = await db.query.qbOutbox.findFirst({ where: eq(schema.qbOutbox.id, id) });
    if (!row) throw new NotFoundException('Outbox entry not found');
    await db.update(schema.qbOutbox).set({ status: 'PENDING', error: null }).where(eq(schema.qbOutbox.id, id));
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'QB_REPOST',
      entityType: 'qb_outbox', entityId: id, data: { previousStatus: row.status, qbRef: row.qbRef }, ip,
    });
    await processOutbox();
    const after = await db.query.qbOutbox.findFirst({ where: eq(schema.qbOutbox.id, id) });
    return { id, status: after?.status, qbRef: after?.qbRef ?? null };
  }

  /** QBI-05: connection status summary. */
  async status() {
    const mode = await getSetting('qb.mode');
    const rows = await db.select({
      status: schema.qbOutbox.status, n: sql<number>`count(*)`,
    }).from(schema.qbOutbox).groupBy(schema.qbOutbox.status);
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.status] = Number(r.n);
    const [lastPosted] = await db.select().from(schema.qbOutbox)
      .where(eq(schema.qbOutbox.status, 'POSTED')).orderBy(desc(schema.qbOutbox.postedAt)).limit(1);
    const creds = qbEnvCreds();
    const acc = await getAccounts();
    return {
      mode,
      connected: mode === 'sandbox' ? true : await isConnected(),
      env: creds.production ? 'production' : 'sandbox',
      credentialsConfigured: creds.configured,
      accountsMapped: !!(acc.bank && acc.staffAdvances && acc.programExpense),
      counts: { PENDING: counts.PENDING ?? 0, POSTED: counts.POSTED ?? 0, ERROR: counts.ERROR ?? 0 },
      lastPostedAt: lastPosted?.postedAt ?? null,
      lastQbRef: lastPosted?.qbRef ?? null,
    };
  }
}

@Controller('v1/qb')
@UseGuards(AuthGuard)
@RequireRoles('FINANCE', 'SYSTEM_ADMIN')
export class QbController {
  constructor(private readonly svc: QbService) {}

  @Get('outbox')
  list(@Query('status') status?: string) {
    return this.svc.list(status || undefined);
  }

  @Post('outbox/:id/repost')
  repost(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Req() req: any) {
    return this.svc.repost(user, id, req.ip);
  }

  @Post('outbox/process')
  process() {
    return processOutbox();
  }

  @Get('status')
  status() {
    return this.svc.status();
  }

  /** Start the Intuit OAuth connect flow — returns the consent URL to open. */
  @Get('connect')
  async connect() {
    return { url: await buildAuthorizeUrl() };
  }

  /** Set the QBO account mapping (QBO Account Ids) used when posting journals. */
  @Post('accounts')
  async setAccounts(@CurrentUser() user: AuthedUser, @Body() body: QbAccounts, @Req() req: any) {
    await setAccounts({
      bank: body.bank, staffAdvances: body.staffAdvances,
      programExpense: body.programExpense, reimbursementExpense: body.reimbursementExpense,
    });
    await auditLogger.log({
      actorId: user.id, actorEmail: user.email, action: 'QB_ACCOUNTS_SET',
      entityType: 'settings', entityId: 'qb.accounts', data: { keys: Object.keys(body || {}) }, ip: req.ip,
    });
    return { ok: true, accounts: await getAccounts() };
  }

  /** Switch posting mode. Refuses 'live' until credentials + connection + mapping are ready. */
  @Post('mode')
  async setMode(@CurrentUser() user: AuthedUser, @Body('mode') mode: string, @Req() req: any) {
    if (mode !== 'sandbox' && mode !== 'live') throw new BadRequestException("mode must be 'sandbox' or 'live'");
    if (mode === 'live') {
      if (!(await isConnected())) throw new BadRequestException('Connect QuickBooks first (GET /v1/qb/connect).');
      const a = await getAccounts();
      if (!(a.bank && a.staffAdvances && a.programExpense)) {
        throw new BadRequestException('Map QBO accounts first (POST /v1/qb/accounts).');
      }
    }
    await setMode(mode);
    await auditLogger.log({
      actorId: user.id, actorEmail: user.email, action: 'QB_MODE_SET',
      entityType: 'settings', entityId: 'qb.mode', data: { mode }, ip: req.ip,
    });
    return { ok: true, mode };
  }

  /** Revoke the QuickBooks connection and fall back to sandbox mode. */
  @Post('disconnect')
  async disconnect(@CurrentUser() user: AuthedUser, @Req() req: any) {
    await qbDisconnect();
    await setMode('sandbox');
    await auditLogger.log({
      actorId: user.id, actorEmail: user.email, action: 'QB_DISCONNECT',
      entityType: 'settings', entityId: 'qb.oauth', data: {}, ip: req.ip,
    });
    return { ok: true };
  }
}

/**
 * Public OAuth redirect target (Intuit posts the browser here with ?code&realmId&state).
 * No AuthGuard: the CSRF `state` we generated at /connect is validated instead.
 */
@Controller('v1/qb')
export class QbOAuthController {
  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('realmId') realmId: string,
    @Query('state') state: string,
    @Res() res: any,
  ) {
    try {
      if (!code || !realmId || !state) throw new Error('Missing code/realmId/state from QuickBooks.');
      await handleCallback(code, realmId, state);
      res.redirect('/?qb=connected');
    } catch (e: any) {
      res.status(400).send(`QuickBooks connection failed: ${String(e?.message ?? e)}`);
    }
  }
}

/** Queue a JOURNAL entry then run the worker opportunistically (per brief). */
export async function queueJournalAndProcess(txId: string | null, payload: Record<string, unknown>): Promise<void> {
  await queueJournal(txId, payload);
  try {
    await processOutbox();
  } catch (e: any) {
    await auditLogger.log({
      action: 'QB_PROCESS_ERROR', entityType: 'qb_outbox', entityId: txId ?? 'batch',
      data: { error: String(e?.message ?? e) },
    });
  }
}
