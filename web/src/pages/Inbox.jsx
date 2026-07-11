import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { apiError } from '../lib/api.js';
import { useCompany, companyParam } from '../lib/company.js';
import { Spinner, Badge, fmtDate, useToast } from '../lib/ui.jsx';

const TERMINAL = ['completed', 'voided', 'declined'];

/**
 * Unified signatures hub. Three tabs:
 *  - Sent by me: envelopes you've sent out (cancel / open detail).
 *  - To sign: documents addressed to you, awaiting your signature.
 *  - Signed by you: ones you've already signed.
 */
export default function Inbox() {
  const [tab, setTab] = useState('sent'); // sent | pending | signed
  const [items, setItems] = useState(null);
  const nav = useNavigate();
  const toast = useToast();
  const activeId = useCompany((s) => s.activeId);

  const load = () => {
    setItems(null);
    if (tab === 'sent') {
      const q = companyParam();
      api.get(`/envelopes${q ? `?${q}` : ''}`).then((r) => setItems(r.data.data));
    } else {
      api.get(`/envelopes/inbox${tab === 'signed' ? '?status=signed' : ''}`).then((r) => setItems(r.data.data));
    }
  };
  useEffect(() => {
    load();
  }, [tab, activeId]);

  const cancel = async (e, id, status) => {
    e.stopPropagation();
    if (!confirm(status === 'draft' ? 'Delete this draft?' : 'Cancel this request? Signers will no longer be able to sign.')) return;
    try {
      await api.post(`/envelopes/${id}/void`, { reason: 'Cancelled by sender' });
      toast(status === 'draft' ? 'Draft deleted' : 'Request cancelled');
      load();
    } catch (err) {
      toast(apiError(err), 'err');
    }
  };

  const download = async (envelopeId, subject) => {
    try {
      const r = await api.get(`/envelopes/${envelopeId}/completed-file`, { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${subject}-signed.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('The signed copy was emailed to you.');
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Pending signatures</h1>
          <p className="muted">What you've sent out, and what's waiting on your signature.</p>
        </div>
        <button className="btn primary" onClick={() => nav('/send')}>
          + Send for signature
        </button>
      </div>

      <div className="flex mb">
        <button className={`btn sm ${tab === 'sent' ? 'primary' : ''}`} onClick={() => setTab('sent')}>
          Sent by me
        </button>
        <button className={`btn sm ${tab === 'pending' ? 'primary' : ''}`} onClick={() => setTab('pending')}>
          To sign
        </button>
        <button className={`btn sm ${tab === 'signed' ? 'primary' : ''}`} onClick={() => setTab('signed')}>
          Signed by you
        </button>
      </div>

      {!items ? (
        <Spinner center />
      ) : items.length === 0 ? (
        <div className="empty">
          {tab === 'sent'
            ? 'Nothing sent for signature yet.'
            : tab === 'pending'
              ? 'Nothing awaiting your signature.'
              : "You haven't signed anything yet."}
        </div>
      ) : tab === 'sent' ? (
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
                        <button className="btn sm danger" onClick={(ev) => cancel(ev, e.id, e.status)}>
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
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Document</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.envelopeId}>
                  <td>
                    <strong>{e.subject}</strong>
                    <div className="muted">{e.documentName}</div>
                  </td>
                  <td>
                    <Badge status={e.signerStatus === 'signed' ? 'signed' : e.status} />
                    {e.signedAt && <div className="muted">{fmtDate(e.signedAt)}</div>}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {tab === 'pending' ? (
                      // Same tab: after signing, the "Back to DocSign" button
                      // returns here and the list reloads with the new status.
                      <a className="btn sm primary" href={e.signUrl}>
                        Review &amp; sign
                      </a>
                    ) : e.hasCompletedFile ? (
                      <button className="btn sm" onClick={() => download(e.envelopeId, e.subject)}>
                        Download
                      </button>
                    ) : (
                      <span className="muted">Awaiting others</span>
                    )}
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
