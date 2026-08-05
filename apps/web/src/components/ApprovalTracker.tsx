import { ROLE_LABEL } from './ui';
import { timeAgo } from '../lib/money';

/**
 * The signature element of the product (WFE-07).
 * Full five-stage stepper: Initiator + the configured approval chain.
 */
export interface TrackerHistoryItem {
  action: string; stageIndex: number; role: string | null; actor: string; comment: string | null; at: string;
}

export function ApprovalTracker({ chain, status, currentStage, history, initiator }: {
  chain: string[]; status: string; currentStage: number;
  history: TrackerHistoryItem[]; initiator: string;
}) {
  const submitted = [...history].reverse().find((h) => h.action === 'SUBMITTED' || h.action === 'RESUBMITTED');
  const steps = [
    { key: 'INITIATOR', label: 'Initiator', meta: submitted ? `${initiator} · ${timeAgo(submitted.at)}` : initiator },
    ...chain.map((role, i) => {
      const ev = [...history].reverse().find((h) => h.stageIndex === i && ['APPROVED', 'REJECTED', 'RETURNED'].includes(h.action));
      return {
        key: role, label: ROLE_LABEL[role] ?? role,
        meta: ev ? `${ev.actor} · ${timeAgo(ev.at)}` : '',
        _i: i, _ev: ev,
      } as any;
    }),
  ];

  const stateFor = (idx: number): 'done' | 'current' | 'blocked' | 'upcoming' => {
    if (idx === 0) return status === 'DRAFT' || status === 'RETURNED' ? 'current' : 'done';
    const i = idx - 1;
    const ev = steps[idx]._ev;
    if (ev?.action === 'REJECTED') return 'blocked';
    if (ev?.action === 'RETURNED') return 'blocked';
    if (status === 'APPROVED') return 'done';
    if (status === 'PENDING') {
      if (i < currentStage) return 'done';
      if (i === currentStage) return 'current';
    }
    if ((status === 'REJECTED' || status === 'WITHDRAWN') && i < currentStage) return 'done';
    return 'upcoming';
  };

  return (
    <div className="tracker" aria-label="Approval progress">
      {steps.map((s, idx) => {
        const st = stateFor(idx);
        return (
          <div key={idx} className={`tracker-step ${st}`}>
            <div className="tracker-node">
              {st === 'done' ? '✓' : st === 'blocked' ? '✕' : idx === 0 ? '1' : idx + 1}
            </div>
            <div className="tracker-role">{s.label}</div>
            <div className="tracker-meta">
              {st === 'current' && status === 'PENDING' ? 'awaiting action' : s.meta}
            </div>
          </div>
        );
      })}
    </div>
  );
}
