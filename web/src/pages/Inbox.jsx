import { useEffect, useState } from 'react';
import api from '../lib/api.js';
import { Spinner, Badge, fmtDate } from '../lib/ui.jsx';

/**
 * The logged-in user's personal signing inbox: documents addressed to their
 * email (or attributed to them) that they need to sign, and ones they've signed.
 */
export default function Inbox() {
  const [tab, setTab] = useState('pending');
  const [items, setItems] = useState(null);

  const load = (status) => {
    setItems(null);
    api.get(`/envelopes/inbox${status === 'signed' ? '?status=signed' : ''}`).then((r) => setItems(r.data.data));
  };
  useEffect(() => {
    load(tab);
  }, [tab]);

  const download = async (envelopeId, subject) => {
    // Only works if the current user is also the sender/owner; otherwise the
    // signed copy arrives by email. Attempt and ignore failures.
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
          <h1>To sign</h1>
          <p className="muted">Documents sent to you for signature.</p>
        </div>
      </div>

      <div className="flex mb">
        <button className={`btn sm ${tab === 'pending' ? 'primary' : ''}`} onClick={() => setTab('pending')}>
          Awaiting your signature
        </button>
        <button className={`btn sm ${tab === 'signed' ? 'primary' : ''}`} onClick={() => setTab('signed')}>
          Signed by you
        </button>
      </div>

      {!items ? (
        <Spinner center />
      ) : items.length === 0 ? (
        <div className="empty">{tab === 'pending' ? 'Nothing awaiting your signature.' : "You haven't signed anything yet."}</div>
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
                      <a className="btn sm primary" href={e.signUrl} target="_blank" rel="noreferrer">
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
