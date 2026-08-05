/**
 * AUD-04: audit evidence pack — a self-contained JSON bundle of transactions,
 * their lines, full stage history and matching audit events for a filter set.
 * Written under apps/api/var/exports and returned as a download; the export
 * itself is audit-logged with the filters and row counts.
 */
import { Body, Controller, Injectable, Post, Req, Res, UseGuards } from '@nestjs/common';
import { and, asc, eq, gte, inArray, lte, notInArray } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import { db, schema } from '../../db/client';
import { AuditService } from '../../audit/audit.service';
import { AuthGuard, CurrentUser, RequireRoles, type AuthedUser } from '../../auth/auth';

const FiltersSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  donorCode: z.string().max(40).optional(),
  departmentId: z.string().max(60).optional(),
});

// src/modules/governance → apps/api (same depth from dist/ when compiled)
const EXPORT_DIR = join(__dirname, '..', '..', '..', 'var', 'exports');

@Injectable()
export class EvidencePackService {
  constructor(private readonly audit: AuditService) {}

  async build(user: AuthedUser, filters: z.infer<typeof FiltersSchema>, ip?: string) {
    const where = [notInArray(schema.transactions.status, ['DRAFT'])];
    if (filters.from) where.push(gte(schema.transactions.createdAt, filters.from));
    if (filters.to) where.push(lte(schema.transactions.createdAt, filters.to));
    if (filters.donorCode) where.push(eq(schema.transactions.donorCode, filters.donorCode));
    if (filters.departmentId) where.push(eq(schema.transactions.departmentId, filters.departmentId));

    const txs = await db.query.transactions.findMany({
      where: and(...where),
      with: {
        department: true,
        initiator: { columns: { id: true, name: true, email: true } },
        lines: { with: { budgetLine: true } },
        stageEvents: { with: { actor: { columns: { id: true, name: true } } } },
      },
      orderBy: [asc(schema.transactions.createdAt)],
    });

    const refs = txs.map((t) => t.ref);
    const auditRows = refs.length
      ? await db.select().from(schema.auditEvents)
          .where(and(eq(schema.auditEvents.entityType, 'transaction'), inArray(schema.auditEvents.entityId, refs)))
          .orderBy(asc(schema.auditEvents.id))
      : [];

    const bundle = {
      kind: 'WEWE_EVIDENCE_PACK',
      generatedAt: new Date().toISOString(),
      generatedBy: { id: user.id, email: user.email, name: user.name },
      filters: {
        from: filters.from?.toISOString() ?? null,
        to: filters.to?.toISOString() ?? null,
        donorCode: filters.donorCode ?? null,
        departmentId: filters.departmentId ?? null,
      },
      counts: {
        transactions: txs.length,
        requisitionLines: txs.reduce((n, t) => n + t.lines.length, 0),
        stageEvents: txs.reduce((n, t) => n + t.stageEvents.length, 0),
        auditEvents: auditRows.length,
      },
      transactions: txs.map((tx) => ({
        id: tx.id, ref: tx.ref, typeCode: tx.typeCode, title: tx.title,
        status: tx.status, currentStage: tx.currentStage,
        amountKobo: tx.amountKobo.toString(), currency: tx.currency, donorCode: tx.donorCode,
        department: { id: tx.departmentId, name: tx.department.name },
        initiator: tx.initiator,
        submittedAt: tx.submittedAt?.toISOString() ?? null,
        createdAt: tx.createdAt.toISOString(),
        updatedAt: tx.updatedAt.toISOString(),
        lines: tx.lines.map((l) => ({
          id: l.id, description: l.description, qty: l.qty,
          unitKobo: l.unitKobo.toString(), totalKobo: (BigInt(l.qty) * l.unitKobo).toString(),
          budgetLine: l.budgetLine ? { id: l.budgetLine.id, code: l.budgetLine.code, name: l.budgetLine.name } : null,
        })),
        stageHistory: tx.stageEvents
          .slice()
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map((e) => ({
            action: e.action, stageIndex: e.stageIndex, role: e.role,
            actor: e.actor, comment: e.comment, at: e.createdAt.toISOString(),
          })),
      })),
      auditEvents: auditRows.map((a) => ({
        id: a.id, actorId: a.actorId, actorEmail: a.actorEmail, action: a.action,
        entityType: a.entityType, entityId: a.entityId, data: a.data, ip: a.ip,
        prevHash: a.prevHash, hash: a.hash, createdAt: a.createdAt.toISOString(),
      })),
    };

    // Server-generated name only — never derived from client input.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const name = `evidence-pack-${stamp}-${randomBytes(4).toString('hex')}`;
    mkdirSync(EXPORT_DIR, { recursive: true });
    const filePath = join(EXPORT_DIR, `${name}.json`);
    const json = JSON.stringify(bundle, null, 2);
    writeFileSync(filePath, json, 'utf8');

    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'EVIDENCE_PACK_EXPORTED',
      entityType: 'evidence_pack', entityId: name,
      data: { filters: bundle.filters, counts: bundle.counts, file: `var/exports/${name}.json` }, ip,
    });
    return { name, json };
  }
}

@Controller('v1/evidence-packs')
@UseGuards(AuthGuard)
@RequireRoles('INTERNAL_AUDIT', 'SYSTEM_ADMIN')
export class EvidencePackController {
  constructor(private readonly svc: EvidencePackService) {}

  @Post()
  async create(@CurrentUser() user: AuthedUser, @Body() body: unknown, @Req() req: any, @Res() res: any) {
    const filters = FiltersSchema.parse(body ?? {});
    const { name, json } = await this.svc.build(user, filters, req.ip);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.json"`);
    res.send(json);
  }
}
