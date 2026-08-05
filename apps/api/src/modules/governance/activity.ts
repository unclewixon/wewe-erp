/**
 * AUD-05: access & activity reports over audit_events + sessions.
 * Internal Audit / System Admin only.
 */
import { Controller, Get, NotFoundException, Query, UseGuards } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, like, or } from 'drizzle-orm';
import { db, schema } from '../../db/client';
import { AuthGuard, RequireRoles } from '../../auth/auth';
import { clusterFailedLogins, isAfterHoursLagos } from './governance.logic';

function daysParam(days: string | undefined, fallback: number, max = 365): number {
  return Math.min(Math.max(Number(days) || fallback, 1), max);
}
function cutoff(days: number): Date {
  return new Date(Date.now() - days * 86400_000);
}

@Controller('v1/activity')
@UseGuards(AuthGuard)
@RequireRoles('INTERNAL_AUDIT', 'SYSTEM_ADMIN')
export class ActivityController {

  /** Sign-in history: per user when userId given, otherwise a per-user summary. */
  @Get('sign-ins')
  async signIns(@Query('userId') userId?: string, @Query('days') days?: string) {
    const since = cutoff(daysParam(days, 30));
    if (userId) {
      const user = await db.query.users.findFirst({
        where: eq(schema.users.id, userId), columns: { id: true, name: true, email: true, active: true },
      });
      if (!user) throw new NotFoundException('User not found');
      const sessions = await db.select().from(schema.sessions)
        .where(and(eq(schema.sessions.userId, userId), gte(schema.sessions.createdAt, since)))
        .orderBy(desc(schema.sessions.createdAt)).limit(500);
      return {
        user,
        sessions: sessions.map((s) => ({ id: s.id, ip: s.ip, createdAt: s.createdAt, expiresAt: s.expiresAt })),
      };
    }
    const rows = await db.select().from(schema.sessions)
      .where(gte(schema.sessions.createdAt, since))
      .orderBy(desc(schema.sessions.createdAt)).limit(2000);
    const byUser = new Map<string, { count: number; lastAt: Date; ips: Set<string> }>();
    for (const s of rows) {
      const e = byUser.get(s.userId) ?? { count: 0, lastAt: s.createdAt, ips: new Set<string>() };
      e.count += 1;
      if (s.createdAt > e.lastAt) e.lastAt = s.createdAt;
      if (s.ip) e.ips.add(s.ip);
      byUser.set(s.userId, e);
    }
    const users = byUser.size
      ? await db.query.users.findMany({
          where: inArray(schema.users.id, [...byUser.keys()]),
          columns: { id: true, name: true, email: true },
        })
      : [];
    const names = new Map(users.map((u) => [u.id, u]));
    return [...byUser.entries()]
      .map(([uid, e]) => ({
        user: names.get(uid) ?? { id: uid, name: '(unknown)', email: '' },
        signIns: e.count, lastSignInAt: e.lastAt, distinctIps: [...e.ips],
      }))
      .sort((a, b) => b.signIns - a.signIns);
  }

  /** Failed-attempt clusters: >= threshold AUTH_LOGIN_FAILED per user per (Lagos) day. */
  @Get('failed-logins')
  async failedLogins(@Query('days') days?: string, @Query('threshold') threshold?: string) {
    const since = cutoff(daysParam(days, 30));
    const min = Math.max(Number(threshold) || 3, 1);
    const events = await db.select().from(schema.auditEvents)
      .where(and(eq(schema.auditEvents.action, 'AUTH_LOGIN_FAILED'), gte(schema.auditEvents.createdAt, since)))
      .orderBy(asc(schema.auditEvents.id));
    // AUTH_LOGIN_FAILED events carry the target user id as entityId.
    const clusters = clusterFailedLogins(events.map((e) => ({ userId: e.entityId, at: e.createdAt })), min);
    const ids = [...new Set(clusters.map((c) => c.userId))];
    const users = ids.length
      ? await db.query.users.findMany({ where: inArray(schema.users.id, ids), columns: { id: true, name: true, email: true, active: true } })
      : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    return clusters.map((c) => ({
      user: byId.get(c.userId) ?? { id: c.userId, name: '(unknown)', email: '', active: null },
      day: c.day, failedAttempts: c.count,
    }));
  }

  /** Dormant accounts: active users with no session created in N days (default 30). */
  @Get('dormant')
  async dormant(@Query('days') days?: string) {
    const n = daysParam(days, 30);
    const since = cutoff(n);
    const users = await db.query.users.findMany({
      where: eq(schema.users.active, true),
      columns: { id: true, name: true, email: true, createdAt: true },
    });
    const lastSessions = await db.select({
      userId: schema.sessions.userId,
      last: schema.sessions.createdAt,
    }).from(schema.sessions).orderBy(desc(schema.sessions.createdAt)).limit(5000);
    const lastByUser = new Map<string, Date>();
    for (const s of lastSessions) {
      const cur = lastByUser.get(s.userId);
      if (!cur || s.last > cur) lastByUser.set(s.userId, s.last);
    }
    return users
      .filter((u) => {
        const last = lastByUser.get(u.id);
        return !last || last < since;
      })
      .map((u) => ({
        ...u,
        lastSignInAt: lastByUser.get(u.id) ?? null,
        dormantDays: lastByUser.has(u.id)
          ? Math.floor((Date.now() - lastByUser.get(u.id)!.getTime()) / 86400_000)
          : null, // never signed in
      }))
      .sort((a, b) => (b.dormantDays ?? Number.MAX_SAFE_INTEGER) - (a.dormantDays ?? Number.MAX_SAFE_INTEGER));
  }

  /** Permission & delegation change log (DELEGATION_*, ROLE_* audit actions). */
  @Get('permission-changes')
  async permissionChanges(@Query('days') days?: string) {
    const since = cutoff(daysParam(days, 90));
    const rows = await db.select().from(schema.auditEvents)
      .where(and(
        or(like(schema.auditEvents.action, 'DELEGATION_%'), like(schema.auditEvents.action, 'ROLE_%')),
        gte(schema.auditEvents.createdAt, since),
      ))
      .orderBy(desc(schema.auditEvents.id)).limit(1000);
    return rows.map((r) => ({
      id: r.id, action: r.action, actorId: r.actorId, actorEmail: r.actorEmail,
      entityType: r.entityType, entityId: r.entityId, data: r.data, ip: r.ip, at: r.createdAt,
    }));
  }

  /** After-hours activity: audit events outside 07:00–20:00 Africa/Lagos. */
  @Get('after-hours')
  async afterHours(@Query('days') days?: string) {
    const since = cutoff(daysParam(days, 7));
    const rows = await db.select().from(schema.auditEvents)
      .where(gte(schema.auditEvents.createdAt, since))
      .orderBy(desc(schema.auditEvents.id)).limit(5000);
    const hits = rows.filter((r) => isAfterHoursLagos(r.createdAt));
    return {
      windowDays: daysParam(days, 7),
      scanned: rows.length,
      afterHoursCount: hits.length,
      events: hits.slice(0, 500).map((r) => ({
        id: r.id, action: r.action, actorId: r.actorId, actorEmail: r.actorEmail,
        entityType: r.entityType, entityId: r.entityId, ip: r.ip, at: r.createdAt,
      })),
    };
  }
}
