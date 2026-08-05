/**
 * PLATFORM area — notifications (NTF-01/02/03), SLA & escalation (WFE-06),
 * user administration (ADM-01/AUTH-05), granular permissions, settings (ADM-04),
 * workflow config (WFE-10) and org structure (ADM-02).
 * The integrator wires controllers/providers into app.ts and calls seedDefaults()
 * + register() at bootstrap.
 */
import { AuditService } from '../../audit/audit.service';
import { AdminUsersController } from './admin-users';
import { EmailAdminController, EmailService } from './email';
import { NotificationsController, NotificationsService, registerNotificationHandlers } from './notifications';
import { DepartmentsController } from './org';
import { PermissionsController } from './permissions';
import { seedPermissions } from './permissions';
import { SettingsController, seedSettings } from './settings';
import { SlaAdminController, SlaService } from './sla';
import { WorkflowConfigController } from './workflow-config';

export const controllers = [
  NotificationsController,
  SlaAdminController,
  EmailAdminController,
  AdminUsersController,
  PermissionsController,
  SettingsController,
  WorkflowConfigController,
  DepartmentsController,
];

export const providers = [EmailService, NotificationsService, SlaService];

/** Idempotent reference data: platform settings + permissions catalog + default role grants. */
export async function seedDefaults(): Promise<void> {
  await seedSettings();
  await seedPermissions();
}

/** Event-bus subscriptions + background loops. Instances here are stateless twins of the DI ones. */
export function register(): void {
  const email = new EmailService();
  const notif = new NotificationsService(email);
  const sla = new SlaService(notif, new AuditService());

  registerNotificationHandlers(notif); // tx.submitted / tx.stage → notifications + outbox

  // WFE-06: scan every minute; also drain the dev email outbox. unref() keeps tests/CLIs exiting.
  setInterval(() => {
    void sla.scan().catch((e) => console.error('[platform] SLA scan failed', e));
    void email.processOutbox().catch((e) => console.error('[platform] email outbox processing failed', e));
  }, 60_000).unref();
}
