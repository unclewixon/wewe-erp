import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { naira, timeAgo } from '../lib/money';
import { StatusPill, ROLE_LABEL } from '../components/ui';

interface Row {
  id: string; ref: string; title: string; status: string; currentStage: number;
  chain: string[]; stageRole: string | null; amountKobo: string; donorCode: string | null;
  department: string; initiator: string; submittedAt: string | null; updatedAt: string;
}

const SCOPES = [
  { key: 'queue', label: 'My queue' },
  { key: 'mine', label: 'My submissions' },
  { key: 'all', label: 'All' },
] as const;

export function Requisitions() {
  const [params, setParams] = useSearchParams();
  const scope = (params.get('scope') as 'mine' | 'queue' | 'all') || 'queue';
  const [rows, setRows] = useState<Row[] | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    setRows(null);
    api.get<Row[]>(`/v1/requisitions?scope=${scope}`).then(setRows).catch(() => setRows([]));
  }, [scope]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', marginBottom: 16 }}>
        <div>
          <h1 className="page-title">Requisitions</h1>
          <div className="page-sub">Every request, visible from initiation to final approval.</div>
        </div>
        <button className="btn primary" style={{ marginLeft: 'auto' }} onClick={() => navigate('/requisitions/new')}>
          + New requisition
        </button>
      </div>

      <div className="tabs" style={{ marginBottom: 14 }}>
        {SCOPES.map((s) => (
          <button key={s.key} className={`tab${scope === s.key ? ' active' : ''}`} onClick={() => setParams({ scope: s.key })}>
            {s.label}
          </button>
        ))}
      </div>

      <div className="card" style={{ padding: 0 }}>
        {rows === null ? (
          <div className="empty"><p>Loading…</p></div>
        ) : rows.length === 0 ? (
          <div className="empty">
            <h3>{scope === 'queue' ? 'Nothing awaiting your action' : 'No requisitions here yet'}</h3>
            <p>{scope === 'queue' ? 'When a request reaches your stage, it appears here.' : 'Raise one and watch it move through the chain.'}</p>
            {scope !== 'queue' && <button className="btn primary small" onClick={() => navigate('/requisitions/new')}>New requisition</button>}
          </div>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Ref</th><th>Title</th><th>Department</th><th>Initiator</th>
                <th>Stage</th><th className="num">Amount</th><th>Donor</th><th>Status</th><th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((tx) => (
                <tr key={tx.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/requisitions/${tx.id}`)}>
                  <td><Link className="ref" to={`/requisitions/${tx.id}`} onClick={(e) => e.stopPropagation()}>{tx.ref}</Link></td>
                  <td>{tx.title}</td>
                  <td>{tx.department}</td>
                  <td>{tx.initiator}</td>
                  <td style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {tx.status === 'PENDING' && tx.stageRole
                      ? `${tx.currentStage + 1}/${tx.chain.length} · ${ROLE_LABEL[tx.stageRole]}`
                      : '—'}
                  </td>
                  <td className="num">{naira(tx.amountKobo)}</td>
                  <td style={{ fontSize: 12, color: 'var(--muted)' }}>{tx.donorCode ?? '—'}</td>
                  <td><StatusPill status={tx.status} /></td>
                  <td style={{ color: 'var(--subtle)', fontSize: 12 }}>{timeAgo(tx.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
