import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api, { apiError } from '../lib/api.js';
import { useCompany, companyParam } from '../lib/company.js';
import { Spinner, Badge, fmtDate, useToast } from '../lib/ui.jsx';

const TERMINAL = ['completed', 'voided', 'declined'];

export default function Envelopes() {
  const [items, setItems] = useState(null);
  const nav = useNavigate();
  const toast = useToast();
  const activeId = useCompany((s) => s.activeId);

  const load = () => {
    const q = companyParam();
    return api.get(`/envelopes${q ? `?${q}` : ''}`).then((r) => setItems(r.data.data));
  };
  useEffect(() => {
    load();
  }, [activeId]);

  const cancel = async (e, id) => {
    e.stopPropagation();
    if (!confirm('Cancel this request? Signers will no longer be able to sign.')) return;
    try {
      await api.post(`/envelopes/${id}/void`, { reason: 'Cancelled by sender' });
      toast('Request cancelled');
      load();
    } catch (err) {
      toast(apiError(err), 'err');
    }
  };

  if (!items) return <Spinner center />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Envelopes</h1>
          <p className="muted">Documents out for signature.</p>
        </div>
        <Link className="btn primary" to="/send">
          + Send for signature
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="empty">Nothing out for signature yet.</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Subject</th>
                <th>Status</th>
                <th>Signers</th>
                <th>Sent</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((e) => {
                const signed = e.signers.filter((s) => s.status === 'signed').length;
                return (
                  <tr key={e.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/envelopes/${e.id}`)}>
                    <td>
                      <strong>{e.subject}</strong>
                    </td>
                    <td>
                      <Badge status={e.status} />
                    </td>
                    <td>
                      {signed}/{e.signers.length} signed
                    </td>
                    <td className="muted">{e.sentAt ? fmtDate(e.sentAt) : 'Draft'}</td>
                    <td style={{ textAlign: 'right' }} onClick={(ev) => ev.stopPropagation()}>
                      {!TERMINAL.includes(e.status) && (
                        <button className="btn sm danger" onClick={(ev) => cancel(ev, e.id)}>
                          {e.status === 'draft' ? 'Delete' : 'Cancel'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
