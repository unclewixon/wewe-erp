import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { naira, formatDate, timeAgo } from '../lib/money';
import { StatusPill, ROLE_LABEL } from '../components/ui';
import { ApprovalTracker, type TrackerHistoryItem } from '../components/ApprovalTracker';

interface Detail {
  id: string; ref: string; title: string; status: string; currentStage: number;
  currentStageRole: string | null; chain: string[]; amountKobo: string; currency: string;
  donorCode: string | null; department: { id: string; name: string };
  initiator: { id: string; name: string; title: string | null };
  submittedAt: string | null; createdAt: string;
  lines: { id: string; description: string; qty: number; unitKobo: string; totalKobo: string; budgetLine: { code: string; name: string } | null }[];
  history: TrackerHistoryItem[];
  permissions: { canAct: boolean; canWithdraw: boolean; canResubmit: boolean; canSubmit: boolean };
}

const EVENT_LABEL: Record<string, string> = {
  SUBMITTED: 'submitted for approval', RESUBMITTED: 'resubmitted after clarification',
  APPROVED: 'approved', REJECTED: 'rejected', RETURNED: 'returned for clarification', WITHDRAWN: 'withdrawn',
};
const EVENT_CLS: Record<string, string> = { APPROVED: 'ok', REJECTED: 'danger', RETURNED: 'warn' };

export function RequisitionDetail() {
  const { id } = useParams<{ id: string }>();
  const [tx, setTx] = useState<Detail | null>(null);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (id) api.get<Detail>(`/v1/requisitions/${id}`).then(setTx).catch((e) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);

  async function doAction(path: string, body?: unknown) {
    setBusy(true); setError(null);
    try {
      const updated = await api.post<Detail>(`/v1/requisitions/${id}/${path}`, body);
      setTx(updated); setComment('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!tx) return <div className="empty"><p>{error ?? 'Loading…'}</p></div>;
  const returnedNote = tx.status === 'RETURNED'
    ? [...tx.history].reverse().find((h) => h.action === 'RETURNED')?.comment
    : null;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
        <div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <h1 className="page-title">{tx.ref}</h1>
            <StatusPill status={tx.status} />
          </div>
          <div className="page-sub">{tx.title}</div>
        </div>
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div className="stat-label">Total</div>
          <div className="stat-value">{naira(tx.amountKobo)}</div>
          <div className="stat-ctx">{tx.department.name}{tx.donorCode ? ` · ${tx.donorCode}` : ''}</div>
        </div>
      </div>

      {error ? <div className="banner danger">{error}</div> : null}
      {returnedNote ? <div className="banner warn"><b>Returned for clarification:</b> {returnedNote}</div> : null}
      {tx.status === 'REJECTED' ? <div className="banner danger"><b>Rejected.</b> {[...tx.history].reverse().find((h) => h.action === 'REJECTED')?.comment}</div> : null}
      {tx.status === 'APPROVED' ? <div className="banner ok"><b>Fully approved.</b> All five stages complete — released for processing.</div> : null}

      <div className="card" style={{ marginBottom: 14 }}>
        <ApprovalTracker chain={tx.chain} status={tx.status} currentStage={tx.currentStage} history={tx.history} initiator={tx.initiator.name} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 14 }}>
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--divider)' }}>
            <h3 style={{ fontSize: 15 }}>Line items</h3>
          </div>
          <table className="data">
            <thead>
              <tr><th>Description</th><th className="num">Qty</th><th className="num">Unit</th><th>Budget line</th><th className="num">Total</th></tr>
            </thead>
            <tbody>
              {tx.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.description}</td>
                  <td className="num">{l.qty}</td>
                  <td className="num">{naira(l.unitKobo)}</td>
                  <td style={{ fontSize: 12, color: 'var(--muted)' }}>{l.budgetLine ? `${l.budgetLine.code} · ${l.budgetLine.name}` : '—'}</td>
                  <td className="num">{naira(l.totalKobo)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={4} style={{ fontWeight: 600, color: 'var(--ink)' }}>Request total</td>
                <td className="num" style={{ fontWeight: 700, color: 'var(--ink)' }}>{naira(tx.amountKobo)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {(tx.permissions.canAct || tx.permissions.canSubmit || tx.permissions.canResubmit || tx.permissions.canWithdraw) && (
            <div className="card">
              <h3 style={{ fontSize: 15, marginBottom: 10 }}>
                {tx.permissions.canAct ? `Your action — ${ROLE_LABEL[tx.currentStageRole ?? ''] ?? ''} stage` : 'Your action'}
              </h3>
              {tx.permissions.canAct && (
                <>
                  <div className="field">
                    <label>Comment {`(required to return or reject)`}</label>
                    <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add context for the initiator or the next stage…" />
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn primary" disabled={busy} onClick={() => doAction('action', { verb: 'approve', comment: comment || undefined })}>Approve</button>
                    <button className="btn" disabled={busy || !comment.trim()} onClick={() => doAction('action', { verb: 'return', comment })}>Return</button>
                    <button className="btn danger" disabled={busy || !comment.trim()} onClick={() => doAction('action', { verb: 'reject', comment })}>Reject</button>
                  </div>
                </>
              )}
              {tx.permissions.canSubmit && (
                <button className="btn primary" disabled={busy} onClick={() => doAction('submit')}>Submit for approval</button>
              )}
              {tx.permissions.canResubmit && (
                <button className="btn primary" disabled={busy} onClick={() => doAction('resubmit')}>Resubmit — restarts the chain</button>
              )}
              {tx.permissions.canWithdraw && (
                <button className="btn" style={{ marginTop: 8 }} disabled={busy} onClick={() => doAction('withdraw')}>Withdraw</button>
              )}
            </div>
          )}

          <div className="card">
            <h3 style={{ fontSize: 15, marginBottom: 12 }}>Activity</h3>
            <div className="timeline">
              {[...tx.history].reverse().map((h, i) => (
                <div key={i} className={`timeline-item ${EVENT_CLS[h.action] ?? ''}`}>
                  <div style={{ fontSize: 13 }}>
                    <b style={{ color: 'var(--ink)' }}>{h.actor}</b> {EVENT_LABEL[h.action] ?? h.action.toLowerCase()}
                    {h.role ? <span style={{ color: 'var(--muted)' }}> · {ROLE_LABEL[h.role]}</span> : null}
                  </div>
                  {h.comment ? <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>“{h.comment}”</div> : null}
                  <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 2 }}>{timeAgo(h.at)} · {formatDate(h.at)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
