/**
 * ADM-01 + AUTH-05 — user administration. SYSTEM_ADMIN only.
 * Deactivation is the full AUTH-05 sweep: active=false, sessions destroyed,
 * delegations switched off, admins notified, USER_DEACTIVATED audited with a
 * mandatory reason.
 */
import {
  BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, Req, UseGuards,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { and, eq, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../../db/client';
import { AuditService } from '../../audit/audit.service';
import { AuthGuard, CurrentUser, RequireRoles, type AuthedUser } from '../../auth/auth';
import { NotificationsService } from './notifications';

const RoleGrantSchema = z.object({
  code: z.enum(schema.roleCode.enumValues),
  departmentId: z.string().nullable().optional(), // null/omitted = organisation-wide grant
});
const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(120),
  title: z.string().max(120).nullable().optional(),
  departmentId: z.string().nullable().optional(),
  roles: z.array(RoleGrantSchema).min(1).max(10),
});
const UpdateUserSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  title: z.string().max(120).nullable().optional(),
  departmentId: z.string().nullable().optional(),
  roles: z.array(RoleGrantSchema).min(1).max(10).optional(),
});
const DeactivateSchema = z.object({ reason: z.string().min(3).max(500) });

@Controller('v1/admin/users')
@UseGuards(AuthGuard)
@RequireRoles('SYSTEM_ADMIN')
export class AdminUsersController {
  constructor(private readonly audit: AuditService, private readonly notif: NotificationsService) {}

  /** ADM-01: all users with roles, department and last sign-in (latest session). */
  @Get()
  async list() {
    const users = await db.query.users.findMany({
      with: { roles: { with: { role: true, department: true } }, department: true },
      orderBy: [schema.users.name],
    });
    const lastRows = await db.select({
      userId: schema.sessions.userId, last: sql<Date>`max(${schema.sessions.createdAt})`,
    }).from(schema.sessions).groupBy(schema.sessions.userId);
    const lastByUser = new Map(lastRows.map((r) => [r.userId, r.last]));
    return users.map((u) => ({
      id: u.id, email: u.email, name: u.name, title: u.title, active: u.active,
      departmentId: u.departmentId, department: u.department?.name ?? null,
      roles: u.roles.map((r) => ({
        code: r.role.code, departmentId: r.departmentId, department: r.department?.name ?? null,
      })),
      lastSignInAt: lastByUser.get(u.id) ?? null,
      createdAt: u.createdAt,
    }));
  }

  /** ADM-01: create/invite a user. The generated temp password is returned ONCE, never stored in clear. */
  @Post()
  async create(@Body() body: unknown, @CurrentUser() admin: AuthedUser, @Req() req: any) {
    const dto = CreateUserSchema.parse(body);
    const email = dto.email.toLowerCase().trim();
    const existing = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
    if (existing) throw new BadRequestException('A user with that email already exists');
    await this.assertDepartment(dto.departmentId);
    for (const r of dto.roles) await this.assertDepartment(r.departmentId);

    const tempPassword = randomBytes(9).toString('base64url'); // 12 chars, returned once
    const passwordHash = await argon2.hash(tempPassword);
    const [user] = await db.insert(schema.users).values({
      email, name: dto.name, title: dto.title ?? null,
      departmentId: dto.departmentId ?? null, passwordHash,
    }).returning();
    await this.setRoles(user.id, dto.roles);
    await this.audit.log({
      actorId: admin.id, actorEmail: admin.email, action: 'USER_CREATED',
      entityType: 'user', entityId: user.id,
      data: { email, name: dto.name, departmentId: dto.departmentId ?? null, roles: dto.roles }, ip: req.ip,
    });
    return {
      id: user.id, email: user.email, name: user.name, title: user.title,
      departmentId: user.departmentId, roles: dto.roles,
      tempPassword, // shown once — the invitee signs in with it and changes it (auth module's flow)
    };
  }

  /** ADM-01: update roles / department (and name/title). */
  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: unknown, @CurrentUser() admin: AuthedUser, @Req() req: any) {
    const dto = UpdateUserSchema.parse(body);
    const user = await db.query.users.findFirst({
      where: eq(schema.users.id, id), with: { roles: { with: { role: true } } },
    });
    if (!user) throw new NotFoundException('User not found');
    await this.assertDepartment(dto.departmentId);
    for (const r of dto.roles ?? []) await this.assertDepartment(r.departmentId);

    const before = {
      name: user.name, title: user.title, departmentId: user.departmentId,
      roles: user.roles.map((r) => ({ code: r.role.code, departmentId: r.departmentId })),
    };
    // A roles-only PATCH leaves nothing to set on the user row itself, and Drizzle rejects
    // an empty .set() with "No values to set" — which surfaced as a 500 on the most common
    // use of this endpoint. Only touch the row when a scalar field actually changed.
    const scalarChanges = {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.departmentId !== undefined ? { departmentId: dto.departmentId } : {}),
    };
    if (Object.keys(scalarChanges).length > 0)
      await db.update(schema.users).set(scalarChanges).where(eq(schema.users.id, id));
    if (dto.roles) await this.setRoles(id, dto.roles);

    const after = {
      name: dto.name ?? before.name, title: dto.title !== undefined ? dto.title : before.title,
      departmentId: dto.departmentId !== undefined ? dto.departmentId : before.departmentId,
      roles: dto.roles ?? before.roles,
    };
    await this.audit.log({
      actorId: admin.id, actorEmail: admin.email, action: 'USER_UPDATED',
      entityType: 'user', entityId: id, data: { before, after }, ip: req.ip,
    });
    return { ok: true, ...after };
  }

  /** AUTH-05 in full: deactivate + kill sessions + switch off delegations + notify admins + audit with reason. */
  @Post(':id/deactivate')
  async deactivate(@Param('id') id: string, @Body() body: unknown, @CurrentUser() admin: AuthedUser, @Req() req: any) {
    const dto = DeactivateSchema.parse(body); // reason is mandatory
    if (id === admin.id) throw new BadRequestException('You cannot deactivate your own account');
    const user = await db.query.users.findFirst({ where: eq(schema.users.id, id) });
    if (!user) throw new NotFoundException('User not found');
    if (!user.active) throw new BadRequestException('User is already deactivated');

    await db.update(schema.users).set({ active: false }).where(eq(schema.users.id, id));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, id));
    await db.update(schema.delegations).set({ active: false }).where(and(
      or(eq(schema.delegations.delegatorId, id), eq(schema.delegations.delegateId, id)),
      eq(schema.delegations.active, true),
    ));
    const admins = (await this.notif.roleHolders('SYSTEM_ADMIN', null)).filter((a) => a.id !== id);
    await this.notif.notify(admins, {
      kind: 'UPDATE',
      title: `User deactivated: ${user.name}`,
      body: `${user.name} (${user.email}) was deactivated by ${admin.name}. Reason: ${dto.reason}`,
      entityType: 'user', entityId: id,
    });
    await this.audit.log({
      actorId: admin.id, actorEmail: admin.email, action: 'USER_DEACTIVATED',
      entityType: 'user', entityId: id,
      data: { email: user.email, name: user.name, reason: dto.reason }, ip: req.ip,
    });
    return { ok: true };
  }

  @Post(':id/reactivate')
  async reactivate(@Param('id') id: string, @CurrentUser() admin: AuthedUser, @Req() req: any) {
    const user = await db.query.users.findFirst({ where: eq(schema.users.id, id) });
    if (!user) throw new NotFoundException('User not found');
    if (user.active) throw new BadRequestException('User is already active');
    await db.update(schema.users).set({ active: true }).where(eq(schema.users.id, id));
    await this.audit.log({
      actorId: admin.id, actorEmail: admin.email, action: 'USER_REACTIVATED',
      entityType: 'user', entityId: id, data: { email: user.email, name: user.name }, ip: req.ip,
    });
    return { ok: true };
  }

  private async assertDepartment(departmentId: string | null | undefined): Promise<void> {
    if (!departmentId) return;
    const dept = await db.query.departments.findFirst({ where: eq(schema.departments.id, departmentId) });
    if (!dept) throw new BadRequestException(`Unknown department: ${departmentId}`);
  }

  /** Replace the user's role grants. Role codes map to roles rows; departmentId scopes the grant. */
  private async setRoles(userId: string, grants: { code: (typeof schema.roleCode.enumValues)[number]; departmentId?: string | null }[]): Promise<void> {
    const roleRows = await db.select().from(schema.roles);
    const roleId = new Map(roleRows.map((r) => [r.code, r.id]));
    for (const g of grants) {
      if (!roleId.has(g.code)) throw new BadRequestException(`Role ${g.code} is not seeded`);
    }
    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, userId));
    const seen = new Set<string>();
    const rows = grants
      .filter((g) => { const k = `${g.code}:${g.departmentId ?? ''}`; if (seen.has(k)) return false; seen.add(k); return true; })
      .map((g) => ({ userId, roleId: roleId.get(g.code)!, departmentId: g.departmentId ?? null }));
    await db.insert(schema.userRoles).values(rows);
  }
}
