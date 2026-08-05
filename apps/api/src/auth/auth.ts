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
import {
  generateTotpSecret, otpauthUri, verifyTotp, generateBackupCodes, hashBackupCode, lockoutMinutes,
} from './totp';

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

  async login(email: string, password: string, ip?: string): Promise<
    { kind: 'session'; token: string; expiresAt: Date } | { kind: '2fa'; pendingToken: string }
  > {
    const user = await db.query.users.findFirst({ where: eq(schema.users.email, email.toLowerCase().trim()) });
    // Neutral failure message — no account-status disclosure (AUTH-01)
    const fail = () => new UnauthorizedException('Invalid email or password');
    if (!user || !user.active) throw fail();
    // AUTH-04: progressive lockout
    if (user.lockedUntil && user.lockedUntil > new Date())
      throw new UnauthorizedException('Account temporarily locked — try again later or contact your administrator');
    const ok = await argon2.verify(user.passwordHash, password).catch(() => false);
    if (!ok) {
      const attempts = user.failedAttempts + 1;
      const mins = lockoutMinutes(attempts);
      await db.update(schema.users).set({
        failedAttempts: attempts,
        lockedUntil: mins > 0 ? new Date(Date.now() + mins * 60_000) : null,
      }).where(eq(schema.users.id, user.id));
      await this.audit.log({ action: 'AUTH_LOGIN_FAILED', entityType: 'user', entityId: user.id, data: { attempts, lockedMinutes: mins }, ip });
      throw fail();
    }
    if (user.failedAttempts > 0 || user.lockedUntil)
      await db.update(schema.users).set({ failedAttempts: 0, lockedUntil: null }).where(eq(schema.users.id, user.id));
    // AUTH-02: second factor when enrolled
    if (user.totpEnabledAt) {
      const pendingToken = '2fa.' + randomBytes(32).toString('hex');
      await db.insert(schema.sessions).values({
        token: pendingToken, userId: user.id, ip: ip ?? null,
        expiresAt: new Date(Date.now() + 5 * 60_000),
      });
      return { kind: '2fa', pendingToken };
    }
    return { kind: 'session', ...(await this.createSession(user.id, user.email, ip)) };
  }

  private async createSession(userId: string, email: string, ip?: string) {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600_000);
    await db.insert(schema.sessions).values({ token, userId, ip: ip ?? null, expiresAt });
    await this.audit.log({ actorId: userId, actorEmail: email, action: 'AUTH_LOGIN', entityType: 'session', entityId: userId, ip });
    return { token, expiresAt };
  }

  /** AUTH-02: complete a 2FA-pending login with a TOTP or backup code. */
  async verify2fa(pendingToken: string, code: string, ip?: string) {
    if (!pendingToken.startsWith('2fa.')) throw new UnauthorizedException('Invalid verification session');
    const pending = await db.query.sessions.findFirst({
      where: and(eq(schema.sessions.token, pendingToken), gt(schema.sessions.expiresAt, new Date())),
    });
    if (!pending) throw new UnauthorizedException('Verification expired — sign in again');
    const user = await db.query.users.findFirst({ where: eq(schema.users.id, pending.userId) });
    if (!user?.active || !user.totpSecret) throw new UnauthorizedException('Invalid verification session');
    let okCode = verifyTotp(user.totpSecret, code);
    if (!okCode) {
      // backup code path — consume on use
      const hashes = (user.backupCodes as string[] | null) ?? [];
      const h = hashBackupCode(code);
      if (hashes.includes(h)) {
        okCode = true;
        await db.update(schema.users).set({ backupCodes: hashes.filter((x) => x !== h) }).where(eq(schema.users.id, user.id));
        await this.audit.log({ actorId: user.id, actorEmail: user.email, action: 'AUTH_2FA_BACKUP_USED', entityType: 'user', entityId: user.id, data: { remaining: hashes.length - 1 }, ip });
      }
    }
    if (!okCode) {
      await this.audit.log({ action: 'AUTH_2FA_FAILED', entityType: 'user', entityId: user.id, ip });
      throw new UnauthorizedException('Invalid code');
    }
    await db.delete(schema.sessions).where(eq(schema.sessions.token, pendingToken));
    return this.createSession(user.id, user.email, ip);
  }

  /** AUTH-02: begin enrolment — returns secret + otpauth URI for the QR. */
  async setup2fa(user: AuthedUser) {
    const secret = generateTotpSecret();
    await db.update(schema.users).set({ totpSecret: secret }).where(eq(schema.users.id, user.id));
    await this.audit.log({ actorId: user.id, actorEmail: user.email, action: 'AUTH_2FA_SETUP_STARTED', entityType: 'user', entityId: user.id });
    return { secret, otpauthUri: otpauthUri(secret, user.email) };
  }

  /** AUTH-02: confirm enrolment with a first valid code; returns backup codes ONCE. */
  async confirm2fa(user: AuthedUser, code: string) {
    const row = await db.query.users.findFirst({ where: eq(schema.users.id, user.id) });
    if (!row?.totpSecret) throw new UnauthorizedException('Start 2FA setup first');
    if (!verifyTotp(row.totpSecret, code)) throw new UnauthorizedException('Invalid code — scan the QR and try again');
    const { plain, hashes } = generateBackupCodes(10);
    await db.update(schema.users).set({ totpEnabledAt: new Date(), backupCodes: hashes }).where(eq(schema.users.id, user.id));
    await this.audit.log({ actorId: user.id, actorEmail: user.email, action: 'AUTH_2FA_ENABLED', entityType: 'user', entityId: user.id });
    return { backupCodes: plain };
  }

  /** Admin: reset a user's 2FA (high-visibility) or unlock a hard-locked account. */
  async adminReset2fa(admin: AuthedUser, userId: string, ip?: string) {
    await db.update(schema.users).set({ totpSecret: null, totpEnabledAt: null, backupCodes: null }).where(eq(schema.users.id, userId));
    await this.audit.log({ actorId: admin.id, actorEmail: admin.email, action: 'AUTH_2FA_RESET_BY_ADMIN', entityType: 'user', entityId: userId, ip });
    return { ok: true };
  }
  async adminUnlock(admin: AuthedUser, userId: string, ip?: string) {
    await db.update(schema.users).set({ failedAttempts: 0, lockedUntil: null }).where(eq(schema.users.id, userId));
    await this.audit.log({ actorId: admin.id, actorEmail: admin.email, action: 'AUTH_UNLOCKED_BY_ADMIN', entityType: 'user', entityId: userId, ip });
    return { ok: true };
  }

  async logout(token: string, actor?: AuthedUser) {
    await db.delete(schema.sessions).where(eq(schema.sessions.token, token));
    if (actor) await this.audit.log({ actorId: actor.id, actorEmail: actor.email, action: 'AUTH_LOGOUT', entityType: 'session', entityId: actor.id });
  }

  async resolveSession(token: string): Promise<AuthedUser | null> {
    if (token.startsWith('2fa.')) return null; // pending 2FA rows are not sessions
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
    // AUD-06: external auditors are strictly read-only and must hold an unexpired scope
    const onlyAuditor = user.roles.length > 0 && user.roles.every((r) => r.code === 'EXTERNAL_AUDITOR');
    if (onlyAuditor) {
      const scope = await db.query.auditorScopes?.findFirst
        ? await db.query.auditorScopes.findFirst({ where: and(eq(schema.auditorScopes.userId, user.id), gt(schema.auditorScopes.expiresAt, new Date())) })
        : (await db.select().from(schema.auditorScopes).where(and(eq(schema.auditorScopes.userId, user.id), gt(schema.auditorScopes.expiresAt, new Date()))))[0];
      if (!scope) throw new UnauthorizedException('Auditor access has expired');
      if (req.method !== 'GET' && !String(req.path).startsWith('/v1/auth'))
        throw new ForbiddenException('External auditor access is read-only');
      req.auditorScope = scope;
    }
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
