import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import api from '../lib/api.js';
import { useAuth } from '../lib/store.js';
import { useCompany } from '../lib/company.js';

const links = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/documents', label: 'Documents & Templates' },
  { to: '/send', label: 'Send for signature' },
  { to: '/inbox', label: 'Pending signatures' },
  { to: '/data-rooms', label: 'Data rooms' },
  { to: '/recipients', label: 'Recipients' },
  { to: '/workspaces', label: 'Workspaces' },
  { to: '/settings', label: 'Settings' }
];

const adminLink = { to: '/admin', label: 'Admin' };

export default function Shell() {
  const { user, logout } = useAuth();
  const { companies, activeId, setActive, load } = useCompany();
  const nav = useNavigate();
  const loc = useLocation();
  const [pending, setPending] = useState(0);
  const navLinks = user?.role === 'admin' ? [...links, adminLink] : links;

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  // Count of signatures still pending (your sent envelopes awaiting signature +
  // documents awaiting your own signature). Refetched as you navigate.
  useEffect(() => {
    let dead = false;
    Promise.all([
      api.get('/analytics/overview').then((r) => r.data.data.pendingSignatures || 0).catch(() => 0),
      api.get('/envelopes/inbox').then((r) => r.data.data.length || 0).catch(() => 0)
    ]).then(([sent, toSign]) => {
      if (!dead) setPending(sent + toSign);
    });
    return () => { dead = true; };
  }, [loc.pathname]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span>DocSign</span>
        </div>
        <nav className="nav">
          {navLinks.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => (isActive ? 'active' : '')}>
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                {l.label}
                {l.to === '/inbox' && pending > 0 && (
                  <span
                    style={{ background: '#2563eb', color: '#fff', borderRadius: 10, fontSize: 11, fontWeight: 700, minWidth: 18, height: 18, padding: '0 5px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    {pending}
                  </span>
                )}
              </span>
            </NavLink>
          ))}
        </nav>
        <div style={{ marginTop: 'auto', fontSize: 13 }} className="muted">
          Signed in as
          <div style={{ color: 'var(--text)', fontWeight: 600 }}>{user?.name}</div>
          <div>{user?.email}</div>
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', fontSize: 12, lineHeight: 1.6 }}>
            <NavLink to="/legal" style={{ color: 'inherit' }}>Legal &amp; e-signature disclosure</NavLink>
            <div style={{ opacity: 0.7 }}>© {new Date().getFullYear()} DocSign · Cryptool</div>
          </div>
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
