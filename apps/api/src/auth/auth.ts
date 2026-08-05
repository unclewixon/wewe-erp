import {
  CanActivate, ExecutionContext, Injectable, UnauthorizedException, ForbiddenException,
  SetMetadata, createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { and, eq, gt } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import * as argon2 from 'argon2';
import { db, schema } from '../db/client';
import { AuditService } from '../audit/audit.service';
import type { RoleCode } from '../db/schema';

export interface AuthedUser {
  id: string; email: string; name: string; title: string | null;
  departmentId: string | null; departmentName: string | null;
  roles: { code: RoleCode; departmentId: string | null }[];
}

export const SESSION_COOKIE = 'wewe_session';
const SESSION_HOURS = 12; // AUTH-03: sessions are short-lived

@Injectable()
export class AuthService {
  constructor(private readonly audit: AuditService) {}

  async login(email: string, password: string, ip?: string) {
    const user = await db.query.users.findFirst({ where: eq(schema.users.email, email.toLowerCase().trim()) });
    // Neutral failure message — no account-status disclosure (AUTH-01)
    const fail = () => new UnauthorizedException('Invalid email or password');
    if (!user || !user.active) throw fail();
    const ok = await argon2.verify(user.passwordHash, password).catch(() => false);
    if (!ok) {
      await this.audit.log({ action: 'AUTH_LOGIN_FAILED', entityType: 'user', entityId: user.id, ip });
      throw fail();
    }
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600_000);
    await db.insert(schema.sessions).values({ token, userId: user.id, ip: ip ?? null, expiresAt });
    await this.audit.log({ actorId: user.id, actorEmail: user.email, action: 'AUTH_LOGIN', entityType: 'session', entityId: user.id, ip });
    return { token, expiresAt };
  }

  async logout(token: string, actor?: AuthedUser) {
    await db.delete(schema.sessions).where(eq(schema.sessions.token, token));
    if (actor) await this.audit.log({ actorId: actor.id, actorEmail: actor.email, action: 'AUTH_LOGOUT', entityType: 'session', entityId: actor.id });
  }

  async resolveSession(token: string): Promise<AuthedUser | null> {
    const session = await db.query.sessions.findFirst({
      where: and(eq(schema.sessions.token, token), gt(schema.sessions.expiresAt, new Date())),
    });
    if (!session) return null;
    const user = await db.query.users.findFirst({
      where: eq(schema.users.id, session.userId),
      with: { roles: { with: { role: true } }, department: true },
    });
    if (!user || !user.active) return null;
    return {
      id: user.id, email: user.email, name: user.name, title: user.title,
      departmentId: user.departmentId, departmentName: user.department?.name ?? null,
      roles: user.roles.map((ur) => ({ code: ur.role.code, departmentId: ur.departmentId })),
    };
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService, private readonly reflector: Reflector) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) throw new UnauthorizedException('Not signed in');
    const user = await this.auth.resolveSession(token);
    if (!user) throw new UnauthorizedException('Session expired — sign in again');
    req.user = user;
    const required = this.reflector.getAllAndOverride<RoleCode[] | undefined>('roles', [ctx.getHandler(), ctx.getClass()]);
    if (required?.length) {
      const has = user.roles.some((r) => required.includes(r.code));
      if (!has) throw new ForbiddenException(`Requires one of: ${required.join(', ')}`);
    }
    return true;
  }
}

export const RequireRoles = (...roles: RoleCode[]) => SetMetadata('roles', roles);
export const CurrentUser = createParamDecorator((_d, ctx: ExecutionContext): AuthedUser => ctx.switchToHttp().getRequest().user);
