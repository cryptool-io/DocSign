import { useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/store.js';
import { useCompany } from '../lib/company.js';

const links = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/documents', label: 'Documents' },
  { to: '/send', label: 'Send for signature' },
  { to: '/envelopes', label: 'Pending signatures' },
  { to: '/inbox', label: 'To sign' },
  { to: '/data-rooms', label: 'Data rooms' },
  { to: '/templates', label: 'Templates' },
  { to: '/recipients', label: 'Recipients' },
  { to: '/workspaces', label: 'Workspaces' },
  { to: '/settings', label: 'Settings' }
];

export default function Shell() {
  const { user, logout } = useAuth();
  const { companies, activeId, setActive, load } = useCompany();
  const nav = useNavigate();

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span>DocSign</span>
        </div>
        <nav className="nav">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => (isActive ? 'active' : '')}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div style={{ marginTop: 'auto', fontSize: 13 }} className="muted">
          Signed in as
          <div style={{ color: 'var(--text)', fontWeight: 600 }}>{user?.name}</div>
          <div>{user?.email}</div>
        </div>
      </aside>
      <div className="main">
        <div className="topbar">
          <div className="flex">
            <span className="muted" style={{ fontSize: 13 }}>Workspace:</span>
            <select
              className="select"
              style={{ width: 200 }}
              value={activeId || ''}
              onChange={(e) => setActive(e.target.value || null)}
            >
              <option value="">All workspaces</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex">
            <button className="btn primary sm" onClick={() => nav('/send')}>
              + Send document
            </button>
            <button
              className="btn sm"
              onClick={async () => {
                await logout();
                nav('/login');
              }}
            >
              Sign out
            </button>
          </div>
        </div>
        <div className="content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
