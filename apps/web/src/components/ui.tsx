import type { ReactNode } from 'react';

const STATUS_META: Record<string, { cls: string; label: string }> = {
  DRAFT: { cls: 'neutral', label: 'Draft' },
  PENDING: { cls: 'info', label: 'In progress' },
  RETURNED: { cls: 'warn', label: 'Returned' },
  REJECTED: { cls: 'danger', label: 'Rejected' },
  WITHDRAWN: { cls: 'neutral', label: 'Withdrawn' },
  APPROVED: { cls: 'ok', label: 'Approved' },
};

export function StatusPill({ status }: { status: string }) {
  const m = STATUS_META[status] ?? { cls: 'neutral', label: status };
  return <span className={`pill ${m.cls}`}>{m.label}</span>;
}

export function StatCard({ label, value, ctx }: { label: string; value: ReactNode; ctx?: ReactNode }) {
  return (
    <div className="card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {ctx ? <div className="stat-ctx">{ctx}</div> : null}
    </div>
  );
}

export const ROLE_LABEL: Record<string, string> = {
  INITIATOR: 'Initiator',
  SUPERVISOR: 'Supervisor',
  INTERNAL_AUDIT: 'Internal Audit',
  FINANCE: 'Finance',
  FINAL_APPROVER: 'Final Approver',
  HR_OFFICER: 'HR Officer',
  SYSTEM_ADMIN: 'System Admin',
};
