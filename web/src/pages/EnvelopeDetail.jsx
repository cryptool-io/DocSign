import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api, { apiError } from '../lib/api.js';
import { ownerDecryptToBlob, documentKeyB64 } from '../lib/keystore.js';
import { appendKey } from '../lib/linkkey.js';
import { Spinner, Badge, useToast, fmtDate } from '../lib/ui.jsx';

export default function EnvelopeDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [env, setEnv] = useState(null);
  const [audit, setAudit] = useState(null);
  const [busy, setBusy] = useState(false);
  const [signLink, setSignLink] = useState(null); // { name, url }

  const load = async () => {
    const e = await api.get(`/envelopes/${id}`);
    setEnv(e.data.data);
    try {
      const a = await api.get(`/envelopes/${id}/audit`);
      setAudit(a.data.data);
    } catch {
      setAudit(null);
    }
  };
  useEffect(() => {
    load();
  }, [id]);

  const send = async () => {
    setBusy(true);
    try {
      await api.post(`/envelopes/${id}/send`);
      toast('Sent');
      load();
    } catch (err) {
      toast(apiError(err), 'err');
    } finally {
      setBusy(false);
    }
  };

  const remind = async (signerId) => {
    try {
      await api.post(`/envelopes/${id}/signers/${signerId}/remind`);
      toast('Reminder sent');
    } catch (err) {
      toast(apiError(err), 'err');
    }
  };

  // Get a signer's personal signing link to share directly (e.g. WhatsApp).
  const getLink = async (signer) => {
    try {
      const { data } = await api.get(`/envelopes/${id}/links`);
      const row = data.data.find((r) => r.signerId === signer.id);
      if (!row) return toast('No link for this signer.', 'err');
      let url = row.url;
      // Encrypted document: carry the decryption key in the link fragment.
      try {
        const { data: doc } = await api.get(`/documents/${env.documentId}`);
        if (doc.data.Encrypted && doc.data.WrappedDek) {
          url = appendKey(url, await documentKeyB64(doc.data.WrappedDek));
        }
      } catch {
        /* non-encrypted or doc unavailable — use the plain link */
      }
      setSignLink({ name: signer.name, url });
      try {
        await navigator.clipboard?.writeText(url);
        toast('Signing link copied');
      } catch {
        toast('Signing link ready — copy it below');
      }
    } catch (err) {
      toast(apiError(err), 'err');
    }
  };

  const voidEnv = async () => {
    if (!confirm('Void this envelope? Signers can no longer sign.')) return;
    await api.post(`/envelopes/${id}/void`, { reason: 'Voided by sender' });
    load();
  };

  const download = async () => {
    const r = await api.get(`/envelopes/${id}/completed-file`, { responseType: 'arraybuffer' });
    let blob;
    if (r.headers['x-docsign-encrypted'] === 'true') {
      // Fetch the document to get its wrapped key, then decrypt the signed copy.
      const { data } = await api.get(`/documents/${env.documentId}`);
      blob = await ownerDecryptToBlob(r.data, data.data.WrappedDek);
    } else {
      blob = new Blob([r.data], { type: 'application/pdf' });
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${env.subject}-signed.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!env) return <Spinner center />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{env.subject}</h1>
          <p className="muted">
            <Badge status={env.status} /> · created {fmtDate(env.createdAt)}
          </p>
        </div>
        <div className="wrap-actions">
          <button className="btn" onClick={() => nav('/envelopes')}>
            Back
          </button>
          {env.status === 'draft' && (
            <button className="btn primary" disabled={busy} onClick={send}>
              Send now
            </button>
          )}
          {env.hasCompletedFile && (
            <button className="btn primary" onClick={download}>
              Download signed PDF
            </button>
          )}
          {!['completed', 'voided', 'declined'].includes(env.status) && (
            <button className="btn danger" onClick={voidEnv}>
              Void
            </button>
          )}
        </div>
      </div>

      <div className="card mb">
        <h2>Signers</h2>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Order</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {env.signers.map((s) => (
              <tr key={s.id}>
                <td>
                  <strong>{s.name}</strong>
                </td>
                <td>{s.email}</td>
                <td>{s.signerRole || '—'}</td>
                <td>{s.signingOrder}</td>
                <td>
                  <Badge status={s.status} />
                  {s.signedAt && <div className="muted">{fmtDate(s.signedAt)}</div>}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {['sent', 'partially_signed'].includes(env.status) && s.status !== 'signed' && (
                    <div className="wrap-actions" style={{ justifyContent: 'flex-end' }}>
                      <button className="btn sm" onClick={() => getLink(s)} title="Get this signer's link to share directly">
                        Copy link
                      </button>
                      <button className="btn sm" onClick={() => remind(s.id)}>
                        Remind
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {signLink && (
          <div className="mt" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <label style={{ fontSize: 13, fontWeight: 600 }}>Signing link for {signLink.name}</label>
            <p className="muted" style={{ fontSize: 12, margin: '2px 0 6px' }}>
              Share this with the signer directly (email, WhatsApp, etc.). It opens their personal signing page
              {env.requireVerification ? ' and still asks for the email verification code.' : '.'}
            </p>
            <div className="flex" style={{ gap: 8 }}>
              <input className="input" readOnly value={signLink.url} onFocus={(e) => e.target.select()} style={{ flex: 1 }} />
              <button className="btn sm" onClick={() => { navigator.clipboard?.writeText(signLink.url); toast('Copied'); }}>
                Copy
              </button>
              <button className="btn sm" onClick={() => setSignLink(null)}>
                Close
              </button>
            </div>
          </div>
        )}
      </div>

      {audit && (
        <div className="card">
          <div className="flex between mb">
            <h2 style={{ margin: 0 }}>Audit trail</h2>
            <span className={`badge ${audit.integrity.valid ? 'green' : 'red'}`}>
              {audit.integrity.valid ? '✓ Tamper-evident chain intact' : '⚠ Chain broken'}
            </span>
          </div>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Event</th>
                <th>Actor</th>
                <th>When</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {audit.events.map((e) => (
                <tr key={e.sequence}>
                  <td className="muted">{e.sequence}</td>
                  <td>{e.eventType}</td>
                  <td>
                    {e.actorType}
                    {e.actorEmail && <div className="muted">{e.actorEmail}</div>}
                  </td>
                  <td className="muted">{fmtDate(e.occurredAt)}</td>
                  <td className="muted">{e.ipAddress || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
