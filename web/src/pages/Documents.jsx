import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { apiError } from '../lib/api.js';
import { useCompany, companyParam, withCompany } from '../lib/company.js';
import * as keystore from '../lib/keystore.js';
import { countPages } from '../lib/pdf.js';
import { appendKey } from '../lib/linkkey.js';
import { Spinner, useToast, fmtDate } from '../lib/ui.jsx';

function LinkModal({ doc, onClose }) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: '',
    requireEmail: true,
    watermark: true,
    allowDownload: false,
    password: '',
    allowedEmails: '',
    expiresAt: ''
  });
  const [created, setCreated] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        documentId: doc.id,
        name: form.name || null,
        requireEmail: form.requireEmail,
        watermark: form.watermark,
        allowDownload: form.allowDownload,
        password: form.password || null,
        allowedEmails: form.allowedEmails
          ? form.allowedEmails.split(',').map((s) => s.trim()).filter(Boolean)
          : [],
        expiresAt: form.expiresAt || null
      };
      const { data } = await api.post('/links', payload);
      let created = data.data;
      // For an encrypted document, put the decryption key in the link fragment.
      if (doc.Encrypted && doc.WrappedDek) {
        const dekB64 = await keystore.documentKeyB64(doc.WrappedDek);
        created = { ...created, url: appendKey(created.url, dekB64) };
      }
      setCreated(created);
      toast('Share link created');
    } catch (err) {
      toast(apiError(err), 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="public-center" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 100 }}>
      <div className="card center-narrow" style={{ maxWidth: 480 }}>
        {created ? (
          <>
            <h1>Link ready</h1>
            <p className="muted mb">Share this URL. You'll see who opens it and for how long.</p>
            <div className="field">
              <input className="input" readOnly value={created.url} onFocus={(e) => e.target.select()} />
            </div>
            <div className="wrap-actions">
              <button
                className="btn primary"
                onClick={() => {
                  navigator.clipboard?.writeText(created.url);
                  toast('Copied');
                }}
              >
                Copy link
              </button>
              <button className="btn" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={submit}>
            <h1>Create share link</h1>
            <p className="muted mb">{doc.Name}</p>
            <div className="field">
              <label>Label (internal)</label>
              <input className="input" value={form.name} onChange={set('name')} placeholder="e.g. Sequoia intro" />
            </div>
            <label className="checkbox">
              <input type="checkbox" checked={form.requireEmail} onChange={set('requireEmail')} /> Require email to view
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={form.watermark} onChange={set('watermark')} /> Watermark with viewer email
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={form.allowDownload} onChange={set('allowDownload')} /> Allow download
            </label>
            <div className="field">
              <label>Password (optional)</label>
              <input className="input" value={form.password} onChange={set('password')} />
            </div>
            <div className="field">
              <label>Allowed emails / domains (optional, comma-separated)</label>
              <input className="input" value={form.allowedEmails} onChange={set('allowedEmails')} placeholder="@fund.vc, jane@x.com" />
            </div>
            <div className="field">
              <label>Expires (optional)</label>
              <input className="input" type="datetime-local" value={form.expiresAt} onChange={set('expiresAt')} />
            </div>
            <div className="wrap-actions">
              <button className="btn primary" disabled={busy}>
                {busy ? 'Creating…' : 'Create link'}
              </button>
              <button type="button" className="btn" onClick={onClose}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default function Documents() {
  const [items, setItems] = useState(null);
  const [links, setLinks] = useState([]);
  const [linkDoc, setLinkDoc] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef();
  const toast = useToast();
  const nav = useNavigate();
  const activeId = useCompany((s) => s.activeId);

  const load = async () => {
    const q = companyParam();
    const [d, l] = await Promise.all([
      api.get(`/documents${q ? `?${q}` : ''}`),
      api.get(`/links${q ? `?${q}` : ''}`)
    ]);
    setItems(d.data.data);
    setLinks(l.data.data);
  };
  useEffect(() => {
    load();
  }, [activeId]);

  const upload = async (file) => {
    if (!file) return;
    if (file.type !== 'application/pdf') return toast('Please choose a PDF.', 'err');
    setUploading(true);
    try {
      const fd = new FormData();
      const canEncrypt = await keystore.ensureUnlocked();
      if (canEncrypt) {
        // Encrypt in the browser; the server only ever sees ciphertext.
        const pageCount = await countPages(await file.arrayBuffer());
        const enc = await keystore.encryptDocument(file, pageCount);
        fd.append('file', enc.ciphertextBlob, `${file.name}.enc`);
        fd.append('name', file.name);
        fd.append('encrypted', 'true');
        fd.append('wrappedDek', enc.wrappedDek);
        fd.append('sha256', enc.sha256);
        fd.append('pageCount', String(enc.pageCount));
      } else {
        fd.append('file', file);
        fd.append('name', file.name);
      }
      if (activeId) fd.append('companyId', activeId);
      await api.post('/documents', fd);
      toast(canEncrypt ? 'Uploaded (encrypted)' : 'Uploaded');
      load();
    } catch (err) {
      toast(apiError(err), 'err');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  if (!items) return <Spinner center />;

  const linksByDoc = links.reduce((m, l) => {
    (m[l.DocDocumentId] = m[l.DocDocumentId] || []).push(l);
    return m;
  }, {});

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Documents</h1>
          <p className="muted">Upload PDFs, share tracked links, and send for signature.</p>
        </div>
        <div>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf"
            style={{ display: 'none' }}
            onChange={(e) => upload(e.target.files[0])}
          />
          <button className="btn primary" disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? 'Uploading…' : '+ Upload PDF'}
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="empty">No documents yet. Upload a PDF to begin.</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Document</th>
                <th>Pages</th>
                <th>Links</th>
                <th>Uploaded</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((d) => {
                const dl = linksByDoc[d.id] || [];
                const views = dl.reduce((a, l) => a + (l.views || 0), 0);
                return (
                  <tr key={d.id}>
                    <td>
                      <strong>{d.Name}</strong>
                      <div className="muted">{(d.SizeBytes / 1024).toFixed(0)} KB</div>
                    </td>
                    <td>{d.PageCount}</td>
                    <td>
                      {dl.length ? (
                        <span>
                          {dl.length} link{dl.length > 1 ? 's' : ''} · {views} views
                        </span>
                      ) : (
                        <span className="muted">none</span>
                      )}
                    </td>
                    <td className="muted">{fmtDate(d.createdAt)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="wrap-actions" style={{ justifyContent: 'flex-end' }}>
                        <button className="btn sm primary" onClick={() => setLinkDoc(d)}>
                          Share link
                        </button>
                        <button className="btn sm" onClick={() => nav('/send', { state: { documentId: d.id } })}>
                          Send to sign
                        </button>
                        <button
                          className="btn sm"
                          title="Place reusable signature fields on this document"
                          onClick={() => nav(`/templates/new?documentId=${d.id}`)}
                        >
                          Prepare fields
                        </button>
                        {dl[0] && (
                          <button className="btn sm" onClick={() => nav(`/links/${dl[0].id}`)}>
                            Analytics
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {linkDoc && <LinkModal doc={linkDoc} onClose={() => { setLinkDoc(null); load(); }} />}
    </>
  );
}
