import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api, type User } from '../lib/api';
import { ROLE_LABEL } from './ui';

const NAV = [
  {
    group: 'Transactions',
    items: [
      { to: '/dashboard', icon: '▦', label: 'Dashboard' },
      { to: '/requisitions', icon: '☰', label: 'Requisitions' },
      { to: '/advances', icon: '₦', label: 'Advances & Retirement', soon: true },
    ],
  },
  {
    group: 'Money',
    items: [
      { to: '/budgets', icon: '◫', label: 'Budgets', soon: true },
      { to: '/quickbooks', icon: '⇄', label: 'QuickBooks', soon: true },
    ],
  },
  {
    group: 'Governance',
    items: [
      { to: '/audit', icon: '✓', label: 'Audit & Compliance', soon: true },
      { to: '/reports', icon: '◔', label: 'Reports', soon: true },
    ],
  },
  {
    group: 'System',
    items: [{ to: '/admin', icon: '⚙', label: 'Administration', soon: true }],
  },
];

export function Shell({ user, queueCount, onSignOut }: { user: User; queueCount: number; onSignOut: () => void }) {
  const navigate = useNavigate();
  async function signOut() {
    await api.post('/v1/auth/logout').catch(() => undefined);
    onSignOut();
    navigate('/signin');
  }
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">W</div>
          <div>
            <div className="brand-name">WEWE ERP</div>
            <div className="brand-sub">Widows &amp; Orphans Empowerment</div>
          </div>
        </div>
        {NAV.map((g) => (
          <div className="nav-group" key={g.group}>
            <div className="nav-group-label">{g.group}</div>
            {g.items.map((it) =>
              it.soon ? (
                <div key={it.to} className="nav-item" style={{ opacity: 0.45, cursor: 'default' }} title="Coming in a later phase">
                  <span className="nav-icon">{it.icon}</span>{it.label}
                  <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--faint)' }}>soon</span>
                </div>
              ) : (
                <NavLink key={it.to} to={it.to} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
                  <span className="nav-icon">{it.icon}</span>{it.label}
                  {it.to === '/requisitions' && queueCount > 0 ? <span className="badge">{queueCount}</span> : null}
                </NavLink>
              ),
            )}
          </div>
        ))}
        <div className="signed-in">
          <div className="who">{user.name}</div>
          <div className="title">
            {user.title ?? user.roles.map((r) => ROLE_LABEL[r.code]).join(', ')}
            {user.departmentName ? ` · ${user.departmentName}` : ''}
          </div>
          <button className="btn small" style={{ marginTop: 10, width: '100%' }} onClick={signOut}>Sign out</button>
        </div>
      </aside>
      <div className="main-col">
        <div className="topbar">
          <input
            placeholder="Search transactions, documents, people…"
            style={{
              flex: 1, height: 36, border: '1px solid var(--border)', borderRadius: 9,
              background: 'var(--input-fill)', padding: '0 12px', outline: 'none',
            }}
          />
          <button className="btn primary" onClick={() => navigate('/requisitions/new')}>+ New requisition</button>
        </div>
        <div className="content">
          <div className="content-inner">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  );
}
