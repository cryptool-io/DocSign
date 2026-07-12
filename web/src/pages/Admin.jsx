import { useEffect, useState } from 'react';
import api, { apiError } from '../lib/api.js';
import { useAuth } from '../lib/store.js';
import { Spinner } from '../lib/ui.jsx';

const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
};

export default function Admin() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [rows, setRows] = useState(null);
  const [totals, setTotals] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isAdmin) return;
    api
      .get('/admin/users')
      .then((r) => {
        setRows(r.data.data);
        setTotals(r.data.totals);
      })
      .catch((err) => setError(apiError(err)));
  }, [isAdmin]);

  if (!isAdmin || error) {
    return (
      <>
        <div className="page-head">
          <div>
            <h1>Admin</h1>
            <p className="muted">Platform usage and user statistics.</p>
          </div>
        </div>
        <div className="empty">Admins only. You don&apos;t have access to this page.</div>
      </>
    );
  }

  if (!rows) return <Spinner center />;

  const tiles = [
    { n: totals?.users ?? 0, l: 'Total users' },
    { n: totals?.documents ?? 0, l: 'Total documents' },
    { n: totals?.envelopesSent ?? 0, l: 'Envelopes sent' },
    { n: totals?.envelopesCompleted ?? 0, l: 'Envelopes completed' }
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Admin</h1>
          <p className="muted">Every user on the platform and their usage at a glance.</p>
        </div>
      </div>

      <div className="stats">
        {tiles.map((t) => (
          <div key={t.l} className="stat">
            <div className="n">{t.n}</div>
            <div className="l">{t.l}</div>
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="empty">No users yet.</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Documents</th>
                <th>Sent</th>
                <th>Completed</th>
                <th>Joined</th>
                <th>Last activity</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id}>
                  <td>
                    <strong>{u.name}</strong>
                    <div className="muted">{u.email}</div>
                  </td>
                  <td>
                    <span className={`badge ${u.role === 'admin' ? 'blue' : 'gray'}`}>{u.role}</span>
                  </td>
                  <td>{u.documents}</td>
                  <td>{u.envelopesSent}</td>
                  <td>{u.envelopesCompleted}</td>
                  <td>{fmtDate(u.createdAt)}</td>
                  <td>{fmtDate(u.lastActivity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
