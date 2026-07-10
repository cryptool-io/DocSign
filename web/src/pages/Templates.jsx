import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../lib/api.js';
import { useCompany, companyParam } from '../lib/company.js';
import { Spinner, Badge, fmtDate } from '../lib/ui.jsx';

export default function Templates() {
  const [items, setItems] = useState(null);
  const nav = useNavigate();
  const activeId = useCompany((s) => s.activeId);

  const load = () => {
    const q = companyParam();
    return api.get(`/templates${q ? `?${q}` : ''}`).then((r) => setItems(r.data.data));
  };
  useEffect(() => {
    load();
  }, [activeId]);

  const remove = async (id) => {
    if (!confirm('Archive this template?')) return;
    await api.delete(`/templates/${id}`);
    load();
  };

  if (!items) return <Spinner center />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Templates</h1>
          <p className="muted">Reusable field layouts and signer roles for documents you send often.</p>
        </div>
        <Link className="btn primary" to="/templates/new">
          + New template
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="empty">No templates yet. Create one to preset signature fields.</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Signature</th>
                <th>Roles</th>
                <th>Updated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/templates/${t.id}`)}>
                  <td>
                    <strong>{t.Name}</strong>
                    <div className="muted">{t.Description}</div>
                  </td>
                  <td>{t.RequiresSignature ? <Badge status="signed" /> : <span className="muted">—</span>}</td>
                  <td>{(t.SignerRoles || []).map((r) => r.label).join(', ') || '—'}</td>
                  <td className="muted">{fmtDate(t.updatedAt)}</td>
                  <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                    <button className="btn sm danger" onClick={() => remove(t.id)}>
                      Archive
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
