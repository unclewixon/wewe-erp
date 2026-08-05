/**
 * Roles & Permissions module (backend): permissions catalog, role→permission matrix,
 * effective-permissions resolver, change log. Matrix changes are SYSTEM_ADMIN-only,
 * SoD-validated (permissions.logic.ts), and audit-logged as PERMISSION_CHANGED.
 */
import {
  BadRequestException, Body, Controller, Get, NotFoundException, Param, Put, Req, UseGuards,
} from '@nestjs/common';
import { and, desc, eq, gt, inArray, like, lte } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../../db/client';
import { AuditService } from '../../audit/audit.service';
import { AuthGuard, CurrentUser, RequireRoles, type AuthedUser } from '../../auth/auth';
import type { RoleCode } from '../../db/schema';
import {
  DEFAULT_ROLE_GRANTS, PERMISSION_ACTIONS, PERMISSION_MODULES, PERMISSION_SCOPES,
  sodViolations, widerScope, type PermGrant, type PermissionScope,
} from './permissions.logic';

/** Idempotent: catalog rows on conflict do nothing; default grants only for roles with no grants yet. */
export async function seedPermissions(): Promise<void> {
  const catalog = PERMISSION_MODULES.flatMap((module) => PERMISSION_ACTIONS.map((action) => ({ module, action })));
  await db.insert(schema.permissions).values(catalog).onConflictDoNothing();

  const perms = await db.select().from(schema.permissions);
  const permId = new Map(perms.map((p) => [`${p.module}:${p.action}`, p.id]));
  const roles = await db.select().from(schema.roles);
  const granted = await db.select({ roleId: schema.rolePermissions.roleId }).from(schema.rolePermissions);
  const rolesWithGrants = new Set(granted.map((g) => g.roleId));

  for (const role of roles) {
    if (rolesWithGrants.has(role.id)) continue; // admin-managed already — never clobber
    const grants = DEFAULT_ROLE_GRANTS[role.code] ?? [];
    const rows = grants
      .map((g) => ({ roleId: role.id, permissionId: permId.get(`${g.module}:${g.action}`), scope: g.scope }))
      .filter((r): r is { roleId: string; permissionId: string; scope: PermissionScope } => !!r.permissionId);
    if (rows.length) await db.insert(schema.rolePermissions).values(rows).onConflictDoNothing();
  }
}

const RoleCodeSchema = z.enum(schema.roleCode.enumValues);
const GrantSchema = z.object({
  module: z.string().min(1),
  action: z.string().min(1),
  scope: z.enum(PERMISSION_SCOPES), // validates known scope values: own | department | organisation
});
const SetMatrixSchema = z.object({ roleCode: RoleCodeSchema, grants: z.array(GrantSchema).max(200) });

@Controller('v1/admin/permissions')
@UseGuards(AuthGuard)
export class PermissionsController {
  constructor(private readonly audit: AuditService) {}

  /** Full matrix: every role with its grants, plus the catalog axes for the UI. */
  @Get('matrix')
  @RequireRoles('SYSTEM_ADMIN', 'INTERNAL_AUDIT')
  async matrix() {
    const rows = await db.select({
      role: schema.roles.code,
      module: schema.permissions.module, action: schema.permissions.action,
      scope: schema.rolePermissions.scope,
    })
      .from(schema.rolePermissions)
      .innerJoin(schema.roles, eq(schema.rolePermissions.roleId, schema.roles.id))
      .innerJoin(schema.permissions, eq(schema.rolePermissions.permissionId, schema.permissions.id));
    const byRole = new Map<string, { module: string; action: string; scope: string }[]>();
    for (const r of rows) {
      const list = byRole.get(r.role) ?? [];
      list.push({ module: r.module, action: r.action, scope: r.scope });
      byRole.set(r.role, list);
    }
    const roles = await db.select().from(schema.roles);
    return {
      modules: PERMISSION_MODULES, actions: PERMISSION_ACTIONS, scopes: PERMISSION_SCOPES,
      roles: roles.map((r) => ({ role: r.code, name: r.name, grants: byRole.get(r.code) ?? [] })),
    };
  }

  /** Replace one role's grant set. SoD-conflicting pairs are blocked with an explanation. */
  @Put('matrix')
  @RequireRoles('SYSTEM_ADMIN')
  async setMatrix(@Body() body: unknown, @CurrentUser() user: AuthedUser, @Req() req: any) {
    const dto = SetMatrixSchema.parse(body);
    const modules = new Set<string>(PERMISSION_MODULES);
    const actions = new Set<string>(PERMISSION_ACTIONS);
    for (const g of dto.grants) {
      if (!modules.has(g.module)) throw new BadRequestException(`Unknown module: ${g.module}`);
      if (!actions.has(g.action)) throw new BadRequestException(`Unknown action: ${g.action}`);
    }
    const dupes = new Set<string>();
    for (const g of dto.grants) {
      const key = `${g.module}:${g.action}`;
      if (dupes.has(key)) throw new BadRequestException(`Duplicate grant for ${key} — one scope per module/action`);
      dupes.add(key);
    }
    const violations = sodViolations(dto.grants as PermGrant[]);
    if (violations.length) {
      throw new BadRequestException({ message: 'Segregation-of-duties conflict — change rejected', violations });
    }

    const role = await db.query.roles.findFirst({ where: eq(schema.roles.code, dto.roleCode) });
    if (!role) throw new NotFoundException(`Role ${dto.roleCode} not found`);
    const before = await db.select({
      module: schema.permissions.module, action: schema.permissions.action, scope: schema.rolePermissions.scope,
    })
      .from(schema.rolePermissions)
      .innerJoin(schema.permissions, eq(schema.rolePermissions.permissionId, schema.permissions.id))
      .where(eq(schema.rolePermissions.roleId, role.id));

    const perms = await db.select().from(schema.permissions);
    const permId = new Map(perms.map((p) => [`${p.module}:${p.action}`, p.id]));
    await db.delete(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, role.id));
    if (dto.grants.length) {
      await db.insert(schema.rolePermissions).values(dto.grants.map((g) => ({
        roleId: role.id, permissionId: permId.get(`${g.module}:${g.action}`)!, scope: g.scope,
      })));
    }
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'PERMISSION_CHANGED',
      entityType: 'role', entityId: dto.roleCode,
      data: { before, after: dto.grants }, ip: req.ip,
    });
    return { role: dto.roleCode, grants: dto.grants };
  }

  /** Effective permissions for a user: union of their roles' grants (widest scope wins) + delegation note. */
  @Get('resolve/:userId')
  @RequireRoles('SYSTEM_ADMIN', 'INTERNAL_AUDIT')
  async resolve(@Param('userId') userId: string) {
    const user = await db.query.users.findFirst({
      where: eq(schema.users.id, userId),
      with: { roles: { with: { role: true } } },
    });
    if (!user) throw new NotFoundException('User not found');
    const roleIds = user.roles.map((r) => r.roleId);
    const rows = roleIds.length ? await db.select({
      role: schema.roles.code,
      module: schema.permissions.module, action: schema.permissions.action,
      scope: schema.rolePermissions.scope,
    })
      .from(schema.rolePermissions)
      .innerJoin(schema.roles, eq(schema.rolePermissions.roleId, schema.roles.id))
      .innerJoin(schema.permissions, eq(schema.rolePermissions.permissionId, schema.permissions.id))
      .where(inArray(schema.rolePermissions.roleId, roleIds)) : [];

    const effective = new Map<string, { module: string; action: string; scope: PermissionScope; via: RoleCode[] }>();
    for (const r of rows) {
      const key = `${r.module}:${r.action}`;
      const cur = effective.get(key);
      if (!cur) {
        effective.set(key, { module: r.module, action: r.action, scope: r.scope as PermissionScope, via: [r.role] });
      } else {
        cur.scope = widerScope(cur.scope, r.scope as PermissionScope);
        if (!cur.via.includes(r.role)) cur.via.push(r.role);
      }
    }

    const now = new Date();
    const dels = await db.select().from(schema.delegations).where(and(
      eq(schema.delegations.delegateId, userId),
      eq(schema.delegations.active, true),
      lte(schema.delegations.startsAt, now),
      gt(schema.delegations.endsAt, now),
    ));
    const delegations = [];
    for (const d of dels) {
      const delegator = await db.query.users.findFirst({ where: eq(schema.users.id, d.delegatorId) });
      delegations.push({ from: delegator?.name ?? d.delegatorId, until: d.endsAt });
    }
    return {
      user: { id: user.id, name: user.name, email: user.email },
      roles: user.roles.map((r) => ({ code: r.role.code, departmentId: r.departmentId })),
      permissions: [...effective.values()].sort((a, b) => a.module.localeCompare(b.module) || a.action.localeCompare(b.action)),
      delegations,
      delegationNote: delegations.length
        ? 'Delegated approval authority (WFE-05) is exercised through the workflow engine on the delegator\'s behalf; it does not widen this user\'s own permission grants.'
        : null,
    };
  }

  /** Change log: PERMISSION_* events from the append-only audit chain. */
  @Get('changes')
  @RequireRoles('SYSTEM_ADMIN', 'INTERNAL_AUDIT')
  changes() {
    return db.select().from(schema.auditEvents)
      .where(like(schema.auditEvents.action, 'PERMISSION\\_%'))
      .orderBy(desc(schema.auditEvents.id)).limit(200);
  }
}
