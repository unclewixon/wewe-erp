import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type User } from '../lib/api';
import { naira, timeAgo } from '../lib/money';
import { StatCard, StatusPill, ROLE_LABEL } from '../components/ui';

interface Summary {
  queueCount: number; myOpen: number; pipeline: Record<string, number>;
  recent: {
    id: string; ref: string; title: string; status: string; stageRole: string | null;
    currentStage: number; chainLength: number; amountKobo: string;
    department: string; initiator: string; updatedAt: string;
  }[];
}

export function Dashboard({ user }: { user: User }) {
  const [data, setData] = useState<Summary | null>(null);
  useEffect(() => { api.get<Summary>('/v1/dashboard').then(setData).catch(() => undefined); }, []);
  if (!data) return <div className="empty"><p>Loading…</p></div>;
  const p = data.pipeline;
  return (
    <div>
      <h1 className="page-title">Good {new Date().getHours() < 12 ? 'morning' : 'day'}, {user.name.split(' ')[0]}</h1>
      <div className="page-sub">Here is where the organisation's approvals stand right now.</div>

      <div className="stat-grid">
        <StatCard label="Awaiting my action" value={data.queueCount}
          ctx={data.queueCount > 0 ? <Link to="/requisitions?scope=queue">Open my queue →</Link> : 'Nothing waiting on you'} />
        <StatCard label="My open items" value={data.myOpen} ctx={<Link to="/requisitions?scope=mine">My submissions →</Link>} />
        <StatCard label="In the pipeline" value={p.PENDING ?? 0} ctx="Across all five stages" />
        <StatCard label="Approved" value={p.APPROVED ?? 0} ctx={`${p.RETURNED ?? 0} returned · ${p.REJECTED ?? 0} rejected`} />
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--divider)', display: 'flex', alignItems: 'center' }}>
          <h3 style={{ fontSize: 15 }}>Recent activity</h3>
          <Link to="/requisitions?scope=all" style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600 }}>View all</Link>
        </div>
        <table className="data">
          <thead>
            <tr>
              <th>Ref</th><th>Title</th><th>Department</th><th>Initiator</th>
              <th>Stage</th><th className="num">Amount</th><th>Status</th><th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {data.recent.map((tx) => (
              <tr key={tx.id}>
                <td><Link className="ref" to={`/requisitions/${tx.id}`}>{tx.ref}</Link></td>
                <td>{tx.title}</td>
                <td>{tx.department}</td>
                <td>{tx.initiator}</td>
                <td style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {tx.status === 'PENDING' && tx.stageRole
                    ? `${tx.currentStage + 1}/${tx.chainLength} · ${ROLE_LABEL[tx.stageRole]}`
                    : '—'}
                </td>
                <td className="num">{naira(tx.amountKobo)}</td>
                <td><StatusPill status={tx.status} /></td>
                <td style={{ color: 'var(--subtle)', fontSize: 12 }}>{timeAgo(tx.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
