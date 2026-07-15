import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { apiError } from '../lib/api.js';
import { useCompany, companyParam } from '../lib/company.js';
import { Spinner, Badge, fmtDate, useToast } from '../lib/ui.jsx';

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

  // Reset the list on every tab switch so we never render one tab's data (whose
  // shape differs) with another tab's layout during the moment before the refetch.
  const switchTab = (t) => {
    if (t === tab) return;
    setItems(null);
    setTab(t);
  };

  const load = () => {
    setItems(null);
    if (tab === 'sent') {
      const q = companyParam();
      api.get(`/envelopes${q ? `?${q}` : ''}`).then((r) => setItems(r.data.data));
    } else if (tab === 'completed') {
      api.get('/envelopes/completed').then((r) => setItems(r.data.data));
    } else {
      api.get(`/envelopes/inbox${tab === 'signed' ? '?status=signed' : ''}`).then((r) => setItems(r.data.data));
    }
  };
  useEffect(() => {
    load();
  }, [tab, activeId]);

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

  // Remove a non-active envelope (draft/voided/declined/completed) from the list.
  const del = async (e, id) => {
    e.stopPropagation();
    if (!confirm('Delete this from your list? This can’t be undone.')) return;
    try {
      await api.delete(`/envelopes/${id}`);
      toast('Deleted');
      load();
    } catch (err) {
      toast(apiError(err), 'err');
    }
  };

  // Hide an envelope from my personal inbox (To sign / Signed by you). Does not
  // affect the sender's copy.
  const dismiss = async (envelopeId) => {
    if (!confirm('Remove this from your list? It stays with the sender; you just won’t see it here.')) return;
    try {
      await api.post(`/envelopes/${envelopeId}/inbox/dismiss`);
      toast('Removed from your list');
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
        <button className={`btn sm ${tab === 'sent' ? 'primary' : ''}`} onClick={() => switchTab('sent')}>
          Sent by me
        </button>
        <button className={`btn sm ${tab === 'pending' ? 'primary' : ''}`} onClick={() => switchTab('pending')}>
          To sign
        </button>
        <button className={`btn sm ${tab === 'signed' ? 'primary' : ''}`} onClick={() => switchTab('signed')}>
          Signed by you
        </button>
        <button className={`btn sm ${tab === 'completed' ? 'primary' : ''}`} onClick={() => switchTab('completed')}>
          Completed
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
              : tab === 'completed'
                ? 'No completed documents yet.'
                : "You haven't signed anything yet."}
        </div>
      ) : tab === 'sent' ? (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Document</th>
                <th>Signers</th>
                <th>Status</th>
                <th>Sent</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((e) => {
                const sigs = e.signers || [];
                const signed = sigs.filter((s) => s.status === 'signed').length;
                const ordered = [...sigs].sort((a, b) => a.signingOrder - b.signingOrder);
                return (
                  <tr key={e.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/envelopes/${e.id}`)}>
                    <td>
                      <strong>{e.documentName || e.subject}</strong>
                      <div className="muted">{e.subject}</div>
                    </td>
                    <td>
                      {ordered.map((s, i) => (
                        <div key={s.id} style={{ fontSize: 13 }}>
                          <span className="muted">Signer {i + 1}:</span> {s.name}
                          {s.status === 'signed' && <span style={{ color: 'var(--success)' }}> ✓</span>}
                        </div>
                      ))}
                    </td>
                    <td>
                      <Badge status={e.status} />
                      <div className="muted" style={{ fontSize: 12 }}>{signed}/{sigs.length} signed</div>
                    </td>
                    <td className="muted">{e.sentAt ? fmtDate(e.sentAt) : 'Draft'}</td>
                    <td style={{ textAlign: 'right' }} onClick={(ev) => ev.stopPropagation()}>
                      {e.status === 'sent' || e.status === 'partially_signed' ? (
                        <button className="btn sm danger" onClick={(ev) => cancel(ev, e.id)}>
                          Cancel
                        </button>
                      ) : (
                        <button className="btn sm danger" onClick={(ev) => del(ev, e.id)}>
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : tab === 'completed' ? (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Document</th>
                <th>Completed</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.envelopeId}>
                  <td>
                    <strong>{e.documentName || e.subject}</strong>
                    <div className="muted">
                      {e.subject}
                      <span className="badge" style={{ marginLeft: 8, background: '#eef2ff', color: '#3730a3', border: '1px solid #dfe3fb' }}>
                        {e.role === 'sender' ? 'you sent' : 'you signed'}
                      </span>
                    </div>
                  </td>
                  <td className="muted">{e.completedAt ? fmtDate(e.completedAt) : '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    {e.hasCompletedFile ? (
                      <button className="btn sm primary" onClick={() => download(e.envelopeId, e.subject)}>
                        Download signed PDF
                      </button>
                    ) : (
                      <span
                        className="muted"
                        title={e.completedSha256 ? `Verify any copy by its SHA-256: ${e.completedSha256}` : undefined}
                      >
                        Emailed to parties · not stored
                      </span>
                    )}
                  </td>
                </tr>
              ))}
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
                    <div className="wrap-actions" style={{ justifyContent: 'flex-end' }}>
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
                      <button className="btn sm danger" title="Remove from your list" onClick={() => dismiss(e.envelopeId)}>
                        Remove
                      </button>
                    </div>
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
