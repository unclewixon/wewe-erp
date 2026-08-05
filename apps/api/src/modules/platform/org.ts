/**
 * ADM-02 — organisation structure: departments CRUD. SYSTEM_ADMIN only; audit-logged.
 *
 * Decision (integrator note): the departments table has no `active` column, so
 * "deactivate" is a guarded hard delete. It is refused (400, blockers listed) while
 * anything still references the department — users, scoped role grants, transactions
 * or budget lines — which also keeps history intact.
 */
import {
  BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Req, UseGuards,
} from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../../db/client';
import { AuditService } from '../../audit/audit.service';
import { AuthGuard, CurrentUser, RequireRoles, type AuthedUser } from '../../auth/auth';

const CreateSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]{1,19}$/, 'code must be UPPER_SNAKE, 2-20 chars'),
  name: z.string().min(2).max(120),
});
const UpdateSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]{1,19}$/).optional(),
  name: z.string().min(2).max(120).optional(),
});

@Controller('v1/admin/departments')
@UseGuards(AuthGuard)
@RequireRoles('SYSTEM_ADMIN')
export class DepartmentsController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  async list() {
    const depts = await db.select().from(schema.departments).orderBy(schema.departments.name);
    const counts = await db.select({
      departmentId: schema.users.departmentId, n: sql<number>`count(*)`,
    }).from(schema.users).where(eq(schema.users.active, true)).groupBy(schema.users.departmentId);
    const byDept = new Map(counts.map((c) => [c.departmentId, Number(c.n)]));
    return depts.map((d) => ({ ...d, activeUsers: byDept.get(d.id) ?? 0 }));
  }

  @Post()
  async create(@Body() body: unknown, @CurrentUser() user: AuthedUser, @Req() req: any) {
    const dto = CreateSchema.parse(body);
    const existing = await db.query.departments.findFirst({ where: eq(schema.departments.code, dto.code) });
    if (existing) throw new BadRequestException(`Department code ${dto.code} is already in use`);
    const [row] = await db.insert(schema.departments).values({ code: dto.code, name: dto.name }).returning();
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'DEPARTMENT_CREATED',
      entityType: 'department', entityId: row.id, data: { code: dto.code, name: dto.name }, ip: req.ip,
    });
    return row;
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: AuthedUser, @Req() req: any) {
    const dto = UpdateSchema.parse(body);
    const dept = await db.query.departments.findFirst({ where: eq(schema.departments.id, id) });
    if (!dept) throw new NotFoundException('Department not found');
    if (dto.code && dto.code !== dept.code) {
      const clash = await db.query.departments.findFirst({ where: eq(schema.departments.code, dto.code) });
      if (clash) throw new BadRequestException(`Department code ${dto.code} is already in use`);
    }
    const [row] = await db.update(schema.departments).set({
      ...(dto.code !== undefined ? { code: dto.code } : {}),
      ...(dto.name !== undefined ? { name: dto.name } : {}),
    }).where(eq(schema.departments.id, id)).returning();
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'DEPARTMENT_UPDATED',
      entityType: 'department', entityId: id,
      data: { before: { code: dept.code, name: dept.name }, after: { code: row.code, name: row.name } }, ip: req.ip,
    });
    return row;
  }

  /** Deactivate (delete) — only when nothing references the department; else 400 listing blockers. */
  @Delete(':id')
  async deactivate(@Param('id') id: string, @CurrentUser() user: AuthedUser, @Req() req: any) {
    const dept = await db.query.departments.findFirst({ where: eq(schema.departments.id, id) });
    if (!dept) throw new NotFoundException('Department not found');

    const blockers: string[] = [];
    const attachedUsers = await db.select({ name: schema.users.name }).from(schema.users)
      .where(eq(schema.users.departmentId, id)).limit(20);
    if (attachedUsers.length) blockers.push(`${attachedUsers.length} user(s) attached: ${attachedUsers.map((u) => u.name).join(', ')}`);
    const [scoped] = await db.select({ n: sql<number>`count(*)` }).from(schema.userRoles)
      .where(eq(schema.userRoles.departmentId, id));
    if (Number(scoped?.n ?? 0) > 0) blockers.push(`${scoped.n} department-scoped role grant(s)`);
    const [txs] = await db.select({ n: sql<number>`count(*)` }).from(schema.transactions)
      .where(eq(schema.transactions.departmentId, id));
    if (Number(txs?.n ?? 0) > 0) blockers.push(`${txs.n} transaction(s) recorded against it`);
    const [bls] = await db.select({ n: sql<number>`count(*)` }).from(schema.budgetLines)
      .where(eq(schema.budgetLines.departmentId, id));
    if (Number(bls?.n ?? 0) > 0) blockers.push(`${bls.n} budget line(s) attached`);

    if (blockers.length) {
      throw new BadRequestException({
        message: `Cannot deactivate ${dept.name} — reassign or resolve these first`, blockers,
      });
    }
    await db.delete(schema.departments).where(eq(schema.departments.id, id));
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'DEPARTMENT_DEACTIVATED',
      entityType: 'department', entityId: id, data: { code: dept.code, name: dept.name }, ip: req.ip,
    });
    return { ok: true };
  }
}
