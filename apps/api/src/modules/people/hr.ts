/**
 * HRM-01 staff directory + profiles (field-level visibility), HRM-03 checklists,
 * HRM-05 HR letters. Everything mutation-shaped goes through AuditService.log().
 */
import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Injectable,
  NotFoundException, Param, Post, Put, Query, Req, UseGuards,
} from '@nestjs/common';
import { and, asc, desc, eq, isNotNull, lte } from 'drizzle-orm';
import { createHash, randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import { db, schema } from '../../db/client';
import { AuditService } from '../../audit/audit.service';
import { AuthGuard, CurrentUser, RequireRoles, type AuthedUser } from '../../auth/auth';
import type { RoleCode } from '../../db/schema';
import { getSetting } from './settings.util';

/* ------------------------------------------------------------------ */
/* Reference data seeded into settings (idempotent — see index.ts)     */
/* ------------------------------------------------------------------ */

export interface ChecklistTemplateItem { label: string; ownerRole: RoleCode; mandatory: boolean }

export const CHECKLIST_TEMPLATES: Record<'ONBOARDING' | 'OFFBOARDING', ChecklistTemplateItem[]> = {
  ONBOARDING: [
    { label: 'Signed employment contract on file', ownerRole: 'HR_OFFICER', mandatory: true },
    { label: 'Bank account and pension PIN captured', ownerRole: 'HR_OFFICER', mandatory: true },
    { label: 'System account created and roles assigned', ownerRole: 'SYSTEM_ADMIN', mandatory: true },
    { label: 'Orientation and policy briefing completed', ownerRole: 'SUPERVISOR', mandatory: true },
    { label: 'ID card issued', ownerRole: 'HR_OFFICER', mandatory: false },
    { label: 'Workstation / equipment assigned', ownerRole: 'SUPERVISOR', mandatory: false },
  ],
  OFFBOARDING: [
    { label: 'Exit interview conducted', ownerRole: 'HR_OFFICER', mandatory: true },
    { label: 'Assets returned and verified', ownerRole: 'SUPERVISOR', mandatory: true },
    { label: 'Outstanding advances retired or recovered', ownerRole: 'FINANCE', mandatory: true },
    { label: 'Revoke system access (AUTH-05)', ownerRole: 'SYSTEM_ADMIN', mandatory: true },
    { label: 'Final pay and entitlements processed', ownerRole: 'FINANCE', mandatory: false },
  ],
};

export const LETTER_TEMPLATES: Record<string, { name: string; html: string }> = {
  employment_confirmation: {
    name: 'Employment Confirmation',
    html: [
      '<html><body>',
      '<p>{{date}}</p>',
      '<p>TO WHOM IT MAY CONCERN</p>',
      '<h3>CONFIRMATION OF EMPLOYMENT — {{name}}</h3>',
      '<p>This is to confirm that {{name}} is a member of staff of Women Environmental Programme (WEWE), Abuja, ',
      'serving as {{title}} in the {{department}} department.</p>',
      '<p>This letter is issued at the request of the staff member and does not constitute a financial guarantee.</p>',
      '<p>Yours faithfully,</p><p>Human Resources<br/>WEWE</p>',
      '</body></html>',
    ].join('\n'),
  },
  salary_confirmation: {
    name: 'Salary Confirmation',
    html: [
      '<html><body>',
      '<p>{{date}}</p>',
      '<p>TO WHOM IT MAY CONCERN</p>',
      '<h3>SALARY CONFIRMATION — {{name}}</h3>',
      '<p>This is to confirm that {{name}}, serving as {{title}} in the {{department}} department of WEWE, ',
      'earns a gross monthly salary of {{salary}} as at {{date}}.</p>',
      '<p>This information is provided in confidence at the staff member\'s request.</p>',
      '<p>Yours faithfully,</p><p>Human Resources<br/>WEWE</p>',
      '</body></html>',
    ].join('\n'),
  },
};

/* ------------------------------------------------------------------ */

const KoboString = z.string().regex(/^\d+$/, 'must be a non-negative integer kobo string');
const ProfileUpdateSchema = z.object({
  grade: z.string().max(40).nullish(),
  hireDate: z.coerce.date().nullish(),
  contractEnd: z.coerce.date().nullish(),
  bankName: z.string().max(80).nullish(),
  bankAccount: z.string().regex(/^\d{6,20}$/, 'digits only').nullish(),
  pensionPin: z.string().min(6).max(30).nullish(),
  emergencyContact: z.object({
    name: z.string().min(1).max(120),
    phone: z.string().min(4).max(30),
    relationship: z.string().max(60).optional(),
  }).nullish(),
  salaryKobo: KoboString.nullish(),
  allowances: z.array(z.object({ name: z.string().min(1).max(80), amountKobo: KoboString })).max(20).nullish(),
}).strict();

const ChecklistCreateSchema = z.object({
  userId: z.string().min(1),
  kind: z.enum(['ONBOARDING', 'OFFBOARDING']),
});
const ChecklistTickSchema = z.object({
  index: z.number().int().min(0),
  done: z.boolean(),
});
const LetterSchema = z.object({ template: z.string().min(1).max(60) });

const SENSITIVE_VIEW_ROLES: RoleCode[] = ['HR_OFFICER', 'FINANCE', 'SYSTEM_ADMIN'];
const BANK_FIELDS = ['bankName', 'bankAccount', 'pensionPin'] as const;

const hasRole = (user: AuthedUser, ...codes: RoleCode[]) => user.roles.some((r) => codes.includes(r.code));
/** Mask to the last 4 characters — used for audit trails of bank-detail changes. */
const maskTail = (v: unknown): string | null => (v == null ? null : `****${String(v).slice(-4)}`);

interface ChecklistItem extends ChecklistTemplateItem {
  done: boolean;
  doneById: string | null;
  doneByName: string | null;
  doneAt: string | null;
}

const lagosDate = (d: Date): string =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);

const formatNaira = (kobo: bigint): string => {
  const naira = kobo / 100n;
  const cents = (kobo % 100n).toString().padStart(2, '0');
  return `₦${naira.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents}`;
};

@Injectable()
export class HrService {
  constructor(private readonly audit: AuditService) {}

  /* ---------------- HRM-01: directory + profile ---------------- */

  async directory(activeOnly: boolean) {
    const rows = await db.select({
      id: schema.users.id, name: schema.users.name, email: schema.users.email,
      title: schema.users.title, active: schema.users.active,
      departmentId: schema.users.departmentId, department: schema.departments.name,
    }).from(schema.users)
      .leftJoin(schema.departments, eq(schema.users.departmentId, schema.departments.id))
      .orderBy(asc(schema.users.name));
    return rows.filter((r) => !activeOnly || r.active);
  }

  private serialiseProfile(p: typeof schema.staffProfiles.$inferSelect | undefined, canSeeSensitive: boolean) {
    if (!p) return null;
    return {
      grade: p.grade,
      hireDate: p.hireDate,
      contractEnd: p.contractEnd,
      bankName: p.bankName,
      emergencyContact: p.emergencyContact,
      // HRM-01 field-level visibility: masked as null outside HR/Finance/Admin/self
      bankAccount: canSeeSensitive ? p.bankAccount : null,
      pensionPin: canSeeSensitive ? p.pensionPin : null,
      salaryKobo: canSeeSensitive ? (p.salaryKobo?.toString() ?? null) : null,
      allowances: canSeeSensitive ? (p.allowances ?? null) : null,
    };
  }

  async getProfile(user: AuthedUser, userId: string) {
    const target = await db.query.users.findFirst({
      where: eq(schema.users.id, userId), with: { department: true },
    });
    if (!target) throw new NotFoundException('Staff member not found');
    const profile = await db.query.staffProfiles.findFirst({ where: eq(schema.staffProfiles.userId, userId) });
    const canSeeSensitive = user.id === userId || hasRole(user, ...SENSITIVE_VIEW_ROLES);
    return {
      user: {
        id: target.id, name: target.name, email: target.email, title: target.title,
        active: target.active, department: target.department?.name ?? null,
      },
      profile: this.serialiseProfile(profile, canSeeSensitive),
    };
  }

  async updateProfile(user: AuthedUser, userId: string, body: unknown, ip?: string) {
    const dto = ProfileUpdateSchema.parse(body);
    const keys = Object.keys(dto) as (keyof typeof dto)[];
    if (keys.length === 0) throw new BadRequestException('Nothing to update');

    const target = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
    if (!target) throw new NotFoundException('Staff member not found');

    const isHr = hasRole(user, 'HR_OFFICER');
    const isAdmin = hasRole(user, 'SYSTEM_ADMIN');
    const isSelf = user.id === userId;
    const bankKeys = keys.filter((k) => (BANK_FIELDS as readonly string[]).includes(k));
    // Bank details: HR_OFFICER only — hard rule, admins included.
    if (bankKeys.length > 0 && !isHr)
      throw new ForbiddenException('Bank details can only be updated by an HR Officer');
    const nonBankKeys = keys.filter((k) => !(BANK_FIELDS as readonly string[]).includes(k));
    if (nonBankKeys.length > 0 && !isHr && !isAdmin) {
      const selfEditable = nonBankKeys.every((k) => k === 'emergencyContact');
      if (!isSelf || !selfEditable)
        throw new ForbiddenException('Only HR can update these profile fields (you may update your own emergency contact)');
    }

    const existing = await db.query.staffProfiles.findFirst({ where: eq(schema.staffProfiles.userId, userId) });
    const set: Record<string, unknown> = {};
    for (const k of keys) {
      const v = dto[k];
      set[k] = k === 'salaryKobo' ? (v == null ? null : BigInt(v as string)) : (v ?? null);
    }
    if (existing) {
      await db.update(schema.staffProfiles).set(set).where(eq(schema.staffProfiles.userId, userId));
    } else {
      await db.insert(schema.staffProfiles).values({ userId, ...set });
    }

    // Audit: bank details masked to last 4 digits; everything else recorded plainly.
    const changes: Record<string, { old: unknown; new: unknown }> = {};
    for (const k of keys) {
      const oldV = existing ? (existing as Record<string, unknown>)[k] : null;
      const newV = set[k];
      if ((BANK_FIELDS as readonly string[]).includes(k)) {
        changes[k] = { old: maskTail(oldV), new: maskTail(newV) };
      } else if (k === 'salaryKobo') {
        changes[k] = { old: (oldV as bigint | null)?.toString() ?? null, new: (newV as bigint | null)?.toString() ?? null };
      } else {
        changes[k] = { old: oldV instanceof Date ? oldV.toISOString() : oldV ?? null, new: newV instanceof Date ? newV.toISOString() : newV ?? null };
      }
    }
    await this.audit.log({
      actorId: user.id, actorEmail: user.email,
      action: bankKeys.length > 0 ? 'HR_PROFILE_BANK_UPDATED' : 'HR_PROFILE_UPDATED',
      entityType: 'staff_profile', entityId: userId, data: { changes }, ip,
    });
    return this.getProfile(user, userId);
  }

  /** HRM-01: contracts ending within `days` (default 60), for HR follow-up. */
  async expiringContracts(days: number) {
    const cutoff = new Date(Date.now() + days * 86_400_000);
    const rows = await db.select({
      userId: schema.staffProfiles.userId, contractEnd: schema.staffProfiles.contractEnd,
      grade: schema.staffProfiles.grade, name: schema.users.name, title: schema.users.title,
      active: schema.users.active, department: schema.departments.name,
    }).from(schema.staffProfiles)
      .innerJoin(schema.users, eq(schema.staffProfiles.userId, schema.users.id))
      .leftJoin(schema.departments, eq(schema.users.departmentId, schema.departments.id))
      .where(and(isNotNull(schema.staffProfiles.contractEnd), lte(schema.staffProfiles.contractEnd, cutoff)))
      .orderBy(asc(schema.staffProfiles.contractEnd));
    const now = Date.now();
    return rows.filter((r) => r.active).map((r) => ({
      userId: r.userId, name: r.name, title: r.title, department: r.department, grade: r.grade,
      contractEnd: r.contractEnd,
      daysLeft: Math.ceil(((r.contractEnd as Date).getTime() - now) / 86_400_000),
    }));
  }

  /* ---------------- HRM-05: letters ---------------- */

  async generateLetter(user: AuthedUser, userId: string, templateKey: string, ip?: string) {
    const templates = await getSetting<Record<string, { name: string; html: string }>>('hr.letterTemplates');
    const template = templates?.[templateKey];
    if (!template) throw new NotFoundException(`Letter template '${templateKey}' is not configured`);
    const target = await db.query.users.findFirst({ where: eq(schema.users.id, userId), with: { department: true } });
    if (!target) throw new NotFoundException('Staff member not found');
    const profile = await db.query.staffProfiles.findFirst({ where: eq(schema.staffProfiles.userId, userId) });

    const merge: Record<string, string> = {
      name: target.name,
      title: target.title ?? 'Staff Member',
      department: target.department?.name ?? 'WEWE',
      date: lagosDate(new Date()),
      salary: profile?.salaryKobo != null ? formatNaira(profile.salaryKobo) : '(salary not on record)',
    };
    const html = template.html.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => merge[key] ?? '');

    // Store under apps/api/var/storage with a random hex key (never a client filename).
    const dir = join(process.cwd(), 'var', 'storage');
    await fs.mkdir(dir, { recursive: true });
    const storageKey = randomBytes(16).toString('hex');
    await fs.writeFile(join(dir, storageKey), html, 'utf8');

    const [doc] = await db.insert(schema.documents).values({
      name: `${template.name} — ${target.name}.html`,
      mime: 'text/html',
      sizeBytes: Buffer.byteLength(html, 'utf8'),
      storageKey,
      sha256: createHash('sha256').update(html).digest('hex'),
      docType: 'HR_LETTER',
      confidential: true,
      uploadedById: user.id,
    }).returning();
    await db.insert(schema.docLinks).values({ documentId: doc.id, entityType: 'user', entityId: userId });
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'HR_LETTER_GENERATED',
      entityType: 'document', entityId: doc.id,
      data: { template: templateKey, forUserId: userId, forUser: target.name }, ip,
    });
    return { documentId: doc.id, template: templateKey, html };
  }

  /* ---------------- HRM-03: checklists ---------------- */

  async createChecklist(user: AuthedUser, dto: z.infer<typeof ChecklistCreateSchema>, ip?: string) {
    const target = await db.query.users.findFirst({ where: eq(schema.users.id, dto.userId) });
    if (!target) throw new NotFoundException('Staff member not found');
    const open = await db.query.staffChecklists.findFirst({
      where: and(
        eq(schema.staffChecklists.userId, dto.userId),
        eq(schema.staffChecklists.kind, dto.kind),
        eq(schema.staffChecklists.status, 'OPEN'),
      ),
    });
    if (open) throw new ConflictException(`An open ${dto.kind} checklist already exists for this staff member`);
    const templates = await getSetting<Record<string, ChecklistTemplateItem[]>>('hr.checklists');
    const template = templates?.[dto.kind];
    if (!template?.length) throw new BadRequestException(`No checklist template configured for ${dto.kind}`);
    const items: ChecklistItem[] = template.map((t) => ({
      ...t, done: false, doneById: null, doneByName: null, doneAt: null,
    }));
    const [row] = await db.insert(schema.staffChecklists)
      .values({ userId: dto.userId, kind: dto.kind, items }).returning();
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'CHECKLIST_CREATED',
      entityType: 'staff_checklist', entityId: row.id,
      data: { kind: dto.kind, forUserId: dto.userId, forUser: target.name, items: items.length }, ip,
    });
    return this.checklistOut(row, target.name);
  }

  private checklistOut(row: typeof schema.staffChecklists.$inferSelect, userName: string) {
    return {
      id: row.id, userId: row.userId, user: userName, kind: row.kind, status: row.status,
      items: row.items as ChecklistItem[], createdAt: row.createdAt,
    };
  }

  async listChecklists(user: AuthedUser, userId?: string) {
    const canSeeAll = hasRole(user, 'HR_OFFICER', 'SYSTEM_ADMIN');
    const scopeUser = canSeeAll ? userId : user.id; // non-HR only ever see their own
    const rows = await db.select({ cl: schema.staffChecklists, name: schema.users.name })
      .from(schema.staffChecklists)
      .innerJoin(schema.users, eq(schema.staffChecklists.userId, schema.users.id))
      .where(scopeUser ? eq(schema.staffChecklists.userId, scopeUser) : undefined)
      .orderBy(desc(schema.staffChecklists.createdAt));
    return rows.map((r) => this.checklistOut(r.cl, r.name));
  }

  async tickItem(user: AuthedUser, checklistId: string, body: unknown, ip?: string) {
    const dto = ChecklistTickSchema.parse(body);
    const row = await db.query.staffChecklists.findFirst({ where: eq(schema.staffChecklists.id, checklistId) });
    if (!row) throw new NotFoundException('Checklist not found');
    if (row.status !== 'OPEN') throw new BadRequestException('Checklist is already complete');
    const items = [...(row.items as ChecklistItem[])];
    const item = items[dto.index];
    if (!item) throw new BadRequestException(`No checklist item at index ${dto.index}`);
    // The item's owner role ticks it; HR and Admin can always act.
    if (!hasRole(user, 'HR_OFFICER', 'SYSTEM_ADMIN', item.ownerRole))
      throw new ForbiddenException(`This item belongs to the ${item.ownerRole} role`);
    items[dto.index] = dto.done
      ? { ...item, done: true, doneById: user.id, doneByName: user.name, doneAt: new Date().toISOString() }
      : { ...item, done: false, doneById: null, doneByName: null, doneAt: null };
    await db.update(schema.staffChecklists).set({ items }).where(eq(schema.staffChecklists.id, checklistId));
    await this.audit.log({
      actorId: user.id, actorEmail: user.email,
      action: dto.done ? 'CHECKLIST_ITEM_DONE' : 'CHECKLIST_ITEM_REOPENED',
      entityType: 'staff_checklist', entityId: checklistId,
      data: { index: dto.index, label: item.label, forUserId: row.userId }, ip,
    });
    const target = await db.query.users.findFirst({ where: eq(schema.users.id, row.userId) });
    return this.checklistOut({ ...row, items }, target?.name ?? '');
  }

  async completeChecklist(user: AuthedUser, checklistId: string, ip?: string) {
    const row = await db.query.staffChecklists.findFirst({ where: eq(schema.staffChecklists.id, checklistId) });
    if (!row) throw new NotFoundException('Checklist not found');
    if (row.status !== 'OPEN') throw new BadRequestException('Checklist is already complete');
    const items = row.items as ChecklistItem[];
    const openMandatory = items.filter((i) => i.mandatory && !i.done);
    if (openMandatory.length > 0)
      throw new BadRequestException(`Cannot complete: mandatory items still open — ${openMandatory.map((i) => i.label).join('; ')}`);
    await db.update(schema.staffChecklists).set({ status: 'COMPLETE' }).where(eq(schema.staffChecklists.id, checklistId));
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'CHECKLIST_COMPLETED',
      entityType: 'staff_checklist', entityId: checklistId,
      data: { kind: row.kind, forUserId: row.userId, openOptional: items.filter((i) => !i.mandatory && !i.done).length }, ip,
    });
    const target = await db.query.users.findFirst({ where: eq(schema.users.id, row.userId) });
    return this.checklistOut({ ...row, status: 'COMPLETE' }, target?.name ?? '');
  }
}

/* ------------------------------------------------------------------ */

@Controller('v1/staff')
@UseGuards(AuthGuard)
export class StaffController {
  constructor(private readonly svc: HrService) {}

  /** HRM-01: staff directory — all users with department + title. */
  @Get()
  directory(@Query('active') active?: string) {
    return this.svc.directory(active !== 'false');
  }

  /** HRM-01: contracts expiring within 60 days (override with ?days=). */
  @Get('expiring-contracts')
  @RequireRoles('HR_OFFICER', 'SYSTEM_ADMIN')
  expiring(@Query('days') days?: string) {
    const n = Math.min(Math.max(Number(days) || 60, 1), 365);
    return this.svc.expiringContracts(n);
  }

  @Get(':userId/profile')
  profile(@CurrentUser() user: AuthedUser, @Param('userId') userId: string) {
    return this.svc.getProfile(user, userId);
  }

  @Put(':userId/profile')
  update(@CurrentUser() user: AuthedUser, @Param('userId') userId: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.updateProfile(user, userId, body, req.ip);
  }

  /** HRM-05: generate an HR letter from a configured template. */
  @Post(':userId/letters')
  @RequireRoles('HR_OFFICER')
  letter(@CurrentUser() user: AuthedUser, @Param('userId') userId: string, @Body() body: unknown, @Req() req: any) {
    const dto = LetterSchema.parse(body);
    return this.svc.generateLetter(user, userId, dto.template, req.ip);
  }
}

@Controller('v1/checklists')
@UseGuards(AuthGuard)
export class ChecklistsController {
  constructor(private readonly svc: HrService) {}

  @Post()
  @RequireRoles('HR_OFFICER', 'SYSTEM_ADMIN')
  create(@CurrentUser() user: AuthedUser, @Body() body: unknown, @Req() req: any) {
    const dto = ChecklistCreateSchema.parse(body);
    return this.svc.createChecklist(user, dto, req.ip);
  }

  @Get()
  list(@CurrentUser() user: AuthedUser, @Query('userId') userId?: string) {
    return this.svc.listChecklists(user, userId);
  }

  @Post(':id/items')
  tick(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.tickItem(user, id, body, req.ip);
  }

  @Post(':id/complete')
  @RequireRoles('HR_OFFICER', 'SYSTEM_ADMIN')
  complete(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Req() req: any) {
    return this.svc.completeChecklist(user, id, req.ip);
  }
}
