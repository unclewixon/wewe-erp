import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { naira } from '../lib/money';

interface BudgetLine { id: string; code: string; name: string; allocatedKobo: string; donorCode: string | null }
interface Line { description: string; qty: number; unitNaira: string; budgetLineId: string }

const emptyLine = (): Line => ({ description: '', qty: 1, unitNaira: '', budgetLineId: '' });

export function NewRequisition() {
  const [title, setTitle] = useState('');
  const [donorCode, setDonorCode] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [budgetLines, setBudgetLines] = useState<BudgetLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  useEffect(() => { api.get<BudgetLine[]>('/v1/meta/budget-lines').then(setBudgetLines).catch(() => undefined); }, []);

  const totalKobo = useMemo(() => lines.reduce((sum, l) => {
    const unit = Math.round(parseFloat(l.unitNaira || '0') * 100);
    return sum + BigInt(Math.max(0, unit)) * BigInt(Math.max(0, l.qty || 0));
  }, 0n), [lines]);

  function setLine(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  async function submit(asDraft: boolean) {
    setBusy(true); setError(null);
    try {
      const payload = {
        title,
        donorCode: donorCode || null,
        submit: !asDraft,
        lines: lines
          .filter((l) => l.description.trim())
          .map((l) => ({
            description: l.description.trim(), qty: l.qty,
            unitKobo: String(Math.round(parseFloat(l.unitNaira || '0') * 100)),
            budgetLineId: l.budgetLineId || null,
          })),
      };
      const created = await api.post<{ id: string }>('/v1/requisitions', payload);
      navigate(`/requisitions/${created.id}`);
    } catch (e: any) {
      setError(e.message ?? 'Could not create requisition');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <h1 className="page-title">New requisition</h1>
      <div className="page-sub">Itemise the request; it will route Supervisor → Internal Audit → Finance → Final Approver.</div>
      {error ? <div className="banner danger" style={{ marginTop: 14 }}>{error}</div> : null}

      <div className="card" style={{ marginTop: 16 }}>
        <div className="field">
          <label>Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Field visit — Nasarawa cluster monitoring" />
        </div>
        <div className="field" style={{ maxWidth: 320 }}>
          <label>Donor / project code (optional)</label>
          <input value={donorCode} onChange={(e) => setDonorCode(e.target.value)} placeholder="e.g. USAID-LON-24" />
        </div>

        <h3 style={{ fontSize: 15, margin: '18px 0 10px' }}>Line items</h3>
        <table className="data">
          <thead>
            <tr><th style={{ width: '38%' }}>Description</th><th style={{ width: 70 }}>Qty</th><th>Unit cost (₦)</th><th>Budget line</th><th className="num">Total</th><th /></tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const lineTotal = BigInt(Math.max(0, Math.round(parseFloat(l.unitNaira || '0') * 100))) * BigInt(Math.max(0, l.qty || 0));
              return (
                <tr key={i}>
                  <td><input style={{ width: '100%', height: 34, border: '1px solid var(--border)', borderRadius: 8, padding: '0 8px', background: 'var(--input-fill)' }} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} placeholder="What is being requested" /></td>
                  <td><input type="number" min={1} style={{ width: 60, height: 34, border: '1px solid var(--border)', borderRadius: 8, padding: '0 8px', background: 'var(--input-fill)' }} value={l.qty} onChange={(e) => setLine(i, { qty: Number(e.target.value) })} /></td>
                  <td><input type="number" min={0} step="0.01" style={{ width: 130, height: 34, border: '1px solid var(--border)', borderRadius: 8, padding: '0 8px', background: 'var(--input-fill)' }} value={l.unitNaira} onChange={(e) => setLine(i, { unitNaira: e.target.value })} placeholder="0.00" /></td>
                  <td>
                    <select style={{ width: '100%', height: 34, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--input-fill)' }} value={l.budgetLineId} onChange={(e) => setLine(i, { budgetLineId: e.target.value })}>
                      <option value="">— none —</option>
                      {budgetLines.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
                    </select>
                  </td>
                  <td className="num">{naira(lineTotal)}</td>
                  <td>{lines.length > 1 && <button className="btn small" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>✕</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <button className="btn small" style={{ marginTop: 10 }} onClick={() => setLines((ls) => [...ls, emptyLine()])}>+ Add line</button>

        <div style={{ display: 'flex', alignItems: 'center', marginTop: 22, paddingTop: 16, borderTop: '1px solid var(--divider)' }}>
          <div>
            <div className="stat-label">Request total</div>
            <div className="stat-value">{naira(totalKobo)}</div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button className="btn" disabled={busy} onClick={() => navigate(-1)}>Cancel</button>
            <button className="btn" disabled={busy || !title.trim()} onClick={() => submit(true)}>Save draft</button>
            <button className="btn primary" disabled={busy || !title.trim() || totalKobo === 0n} onClick={() => submit(false)}>
              {busy ? 'Submitting…' : 'Submit for approval'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
