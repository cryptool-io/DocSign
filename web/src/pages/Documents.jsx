import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { apiError } from '../lib/api.js';
import { useCompany, companyParam, withCompany } from '../lib/company.js';
import * as keystore from '../lib/keystore.js';
import { countPages } from '../lib/pdf.js';
import { sha256Hex } from '../lib/crypto.js';
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

// Upload setup dialog: opened from the "Upload PDF" button. The sender answers
// two questions — which workspace, and how they'll use the document — then picks
// the file. This replaces the old inline row of selects + an easy-to-miss
// "Encrypt" checkbox that silently made a document link-only (no email).
function UploadModal({ companies, defaultWs, onClose, onPick }) {
  const [ws, setWs] = useState(defaultWs || companies[0]?.id || '');
  const [purpose, setPurpose] = useState('send'); // 'send' | 'encrypted' | 'device'
  const fileRef = useRef();

  const onFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    onPick(file, {
      companyId: ws,
      mode: purpose === 'device' ? 'sovereign' : 'stored',
      encrypt: purpose === 'encrypted'
    });
  };

  const option = (value, title, desc) => (
    <label
      className="checkbox"
      style={{ alignItems: 'flex-start', marginBottom: 12, cursor: 'pointer', fontWeight: 400 }}
    >
      <input
        type="radio"
        name="upload-purpose"
        checked={purpose === value}
        onChange={() => setPurpose(value)}
        style={{ marginTop: 3 }}
      />
      <span>
        <strong>{title}</strong>
        <span className="muted" style={{ display: 'block', fontSize: 13 }}>{desc}</span>
      </span>
    </label>
  );

  return (
    <div className="public-center" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 100 }}>
      <div className="card center-narrow" style={{ maxWidth: 500 }}>
        <h1>Upload a PDF</h1>
        <p className="muted mb">Choose how you&apos;ll use this document, then pick the file.</p>
        {companies.length > 0 && (
          <div className="field">
            <label>Workspace</label>
            <select className="input" value={ws} onChange={(e) => setWs(e.target.value)}>
              <option value="" disabled>Choose a workspace…</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label>How will you use it?</label>
          {option('send', 'Email or share link', 'Send for signature by email, or hand out a link. Best for most documents.')}
          {option('encrypted', 'Encrypted — link only', "End-to-end encrypted. Can only be shared by a link, never email — the unlock key can't go in an email.")}
          {option('device', 'Keep on my device', 'The PDF never leaves your computer — only a fingerprint is stored here.')}
        </div>
        <input ref={fileRef} type="file" accept="application/pdf" style={{ display: 'none' }} onChange={onFile} />
        <div className="wrap-actions">
          <button className="btn primary" onClick={() => fileRef.current?.click()}>Choose PDF…</button>
          <button className="btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default function Documents() {
  const [items, setItems] = useState(null);
  const [links, setLinks] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [linkDoc, setLinkDoc] = useState(null);
  const [confirmAsk, setConfirmAsk] = useState(null); // { title, body, confirmLabel, onYes }
  const [uploading, setUploading] = useState(false);
  const [uploadWs, setUploadWs] = useState(''); // seeds the upload dialog's workspace
  const [showUpload, setShowUpload] = useState(false);
  const attachRef = useRef();
  const [pendingAttach, setPendingAttach] = useState(null); // { doc, then }
  const toast = useToast();
  const nav = useNavigate();
  const activeId = useCompany((s) => s.activeId);
  const companies = useCompany((s) => s.companies);

  // Default the upload workspace to the active one (or the first) so new docs
  // always land in a workspace.
  useEffect(() => {
    setUploadWs((cur) => cur || activeId || companies[0]?.id || '');
  }, [activeId, companies]);

  const load = async () => {
    const q = companyParam();
    const [d, l, t] = await Promise.all([
      api.get(`/documents${q ? `?${q}` : ''}`),
      api.get(`/links${q ? `?${q}` : ''}`),
      // All setups (not workspace-filtered) so a document's signing setups always
      // show here, even if the setup was saved under a different/ no workspace.
      api.get('/templates')
    ]);
    setItems(d.data.data);
    setLinks(l.data.data);
    setTemplates(t.data.data);
  };
  useEffect(() => {
    load();
  }, [activeId]);

  const removeTemplate = (id, name) =>
    setConfirmAsk({
      title: 'Delete signing setup?',
      body: `“${name}” — this removes the saved signing fields for this document. The document itself is not affected.`,
      confirmLabel: 'Delete setup',
      onYes: async () => {
        try {
          await api.delete(`/templates/${id}`);
          toast('Signing setup deleted');
          load();
        } catch (err) {
          toast(apiError(err), 'err');
        }
      }
    });

  const setDocWorkspace = async (id, companyId) => {
    try {
      await api.patch(`/documents/${id}`, { companyId: companyId || null });
      toast('Workspace updated');
      load();
    } catch (err) {
      toast(apiError(err), 'err');
    }
  };

  const removeDocument = (id, name) =>
    setConfirmAsk({
      title: 'Delete document?',
      body: `“${name}” — it’s removed from your Documents list. Envelopes you already sent keep their own copy.`,
      confirmLabel: 'Delete document',
      onYes: async () => {
        try {
          await api.delete(`/documents/${id}`);
          toast('Document deleted');
          load();
        } catch (err) {
          toast(apiError(err), 'err');
        }
      }
    });

  // Options come from the upload dialog: { companyId, mode: 'stored'|'sovereign', encrypt }.
  const upload = async (file, { companyId = uploadWs, mode = 'stored', encrypt = false } = {}) => {
    if (!file) return;
    if (file.type !== 'application/pdf') return toast('Please choose a PDF.', 'err');
    if (companies.length > 0 && !companyId) return toast('Pick a workspace for this document first.', 'err');
    setUploading(true);
    try {
      // Sovereign: the PDF never leaves the device. We send only the fingerprint +
      // page count and create an overlay shell; bytes are attached transiently later.
      if (mode === 'sovereign') {
        const buf = await file.arrayBuffer();
        const fd = new FormData();
        fd.append('storageMode', 'sovereign');
        fd.append('name', file.name);
        fd.append('sha256', await sha256Hex(new Uint8Array(buf)));
        fd.append('pageCount', String(await countPages(buf)));
        fd.append('sizeBytes', String(file.size));
        if (companyId) fd.append('companyId', companyId);
        await api.post('/documents', fd);
        toast('Added (sovereign — file stays on your device)');
        load();
        return;
      }
      const fd = new FormData();
      // Only encrypt when the sender chose "Encrypted" in the dialog. If they did
      // but encryption isn't set up in this browser, stop rather than silently
      // uploading it in the clear (or emailable when they wanted it locked).
      const canEncrypt = encrypt ? await keystore.ensureUnlocked() : null;
      if (encrypt && !canEncrypt) {
        return toast(
          "Encryption isn't set up in this browser — set it up in Settings, or choose 'Email or share link' to upload a normal document.",
          'err'
        );
      }
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
      if (companyId) fd.append('companyId', companyId);
      await api.post('/documents', fd);
      toast(canEncrypt ? 'Uploaded (encrypted)' : 'Uploaded');
      load();
    } catch (err) {
      toast(apiError(err), 'err');
    } finally {
      setUploading(false);
    }
  };

  // Sovereign docs keep no bytes at rest. Before an action that needs the PDF
  // (send, set up fields), re-select the local file → attach transiently → proceed.
  const needsBytes = (d) => d.StorageMode === 'sovereign' && !d.FileKey;
  const withBytes = (d, then) => {
    if (!needsBytes(d)) return then();
    setPendingAttach({ doc: d, then });
    attachRef.current?.click();
  };
  const onAttachFile = async (file) => {
    const ctx = pendingAttach;
    if (attachRef.current) attachRef.current.value = '';
    setPendingAttach(null);
    if (!file || !ctx) return;
    if (file.type !== 'application/pdf') return toast('Please choose a PDF.', 'err');
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api.post(`/documents/${ctx.doc.id}/attach`, fd);
      await load();
      ctx.then({ ...ctx.doc, FileKey: 'attached' });
    } catch (err) {
      toast(apiError(err), 'err'); // e.g. fingerprint mismatch → wrong file
    }
  };

  if (!items) return <Spinner center />;

  const linksByDoc = links.reduce((m, l) => {
    (m[l.DocDocumentId] = m[l.DocDocumentId] || []).push(l);
    return m;
  }, {});
  const templatesByDoc = templates.reduce((m, t) => {
    if (t.SourceDocumentId) (m[t.SourceDocumentId] = m[t.SourceDocumentId] || []).push(t);
    return m;
  }, {});

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Documents &amp; Templates</h1>
          <p className="muted">
            Upload PDFs, set up reusable signing fields, share tracked links, and send for signature. ·{' '}
            <a href="#" onClick={(e) => { e.preventDefault(); nav('/trash'); }}>Trash</a>
          </p>
        </div>
        <div className="flex" style={{ gap: 8, alignItems: 'center' }}>
          <input
            ref={attachRef}
            type="file"
            accept="application/pdf"
            style={{ display: 'none' }}
            onChange={(e) => onAttachFile(e.target.files[0])}
          />
          <button className="btn primary" disabled={uploading} onClick={() => setShowUpload(true)}>
            {uploading ? 'Uploading…' : '+ Upload PDF'}
          </button>
        </div>
      </div>

      {showUpload && (
        <UploadModal
          companies={companies}
          defaultWs={uploadWs}
          onClose={() => setShowUpload(false)}
          onPick={(file, opts) => {
            setShowUpload(false);
            setUploadWs(opts.companyId || '');
            upload(file, opts);
          }}
        />
      )}

      {items.length === 0 ? (
        <div className="empty">No documents yet. Upload a PDF to begin.</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Document</th>
                <th>Signing fields</th>
                <th title="Tracked view-only links you can share (via 'Share link') to see who opened the document and for how long">Share links</th>
                <th>Uploaded</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((d) => {
                const dl = linksByDoc[d.id] || [];
                const views = dl.reduce((a, l) => a + (l.views || 0), 0);
                const tpls = templatesByDoc[d.id] || [];
                return (
                  <tr key={d.id}>
                    <td>
                      <strong>{d.Name}</strong>
                      {d.StorageMode === 'sovereign' && (
                        <span
                          title="Sovereign — the PDF stays on your device. We keep only the overlay + fingerprint. You'll re-select the file to send."
                          style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: '#7c3aed', background: '#f3e8ff', border: '1px solid #e4d3fb', borderRadius: 6, padding: '1px 6px', whiteSpace: 'nowrap' }}
                        >
                          🔒 On your device
                        </span>
                      )}
                      <div className="muted">{(d.SizeBytes / 1024).toFixed(0)} KB · {d.PageCount} pages</div>
                      <select
                        className="select"
                        style={{ marginTop: 4, height: 28, fontSize: 12, padding: '2px 6px', maxWidth: 220 }}
                        value={d.DocCompanyId || ''}
                        onChange={(e) => setDocWorkspace(d.id, e.target.value)}
                        title="Link this document to a workspace"
                      >
                        <option value="">No workspace (personal)</option>
                        {companies.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {tpls.length ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {tpls.map((t) => (
                            <span
                              key={t.id}
                              style={{ display: 'inline-flex', alignItems: 'center', border: '1px solid var(--border, #dcdcdc)', borderRadius: 6, overflow: 'hidden' }}
                            >
                              <button
                                className="btn sm"
                                style={{ border: 'none', borderRadius: 0 }}
                                title="Edit this signing setup"
                                onClick={() => nav(`/templates/${t.id}`)}
                              >
                                {t.Name}{t.IsDefault ? ' ★' : ''}
                              </button>
                              <button
                                className="btn sm"
                                style={{ border: 'none', borderRadius: 0, color: '#dc2626', padding: '2px 7px', borderLeft: '1px solid var(--border, #dcdcdc)' }}
                                title="Delete this signing setup"
                                onClick={() => removeTemplate(t.id, t.Name)}
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="muted">not set up</span>
                      )}
                    </td>
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
                        <button className="btn sm primary" onClick={() => withBytes(d, () => nav('/send', { state: { documentId: d.id } }))}>
                          Send to sign
                        </button>
                        <button
                          className="btn sm"
                          title={needsBytes(d) ? 'Re-select your local PDF to place fields on it' : 'Place reusable signature fields on this document'}
                          onClick={() => withBytes(d, () => nav(`/templates/new?documentId=${d.id}`))}
                        >
                          {tpls.length ? '+ Add signing fields' : 'Set up signing fields'}
                        </button>
                        {d.StorageMode === 'sovereign' ? (
                          <button className="btn sm" disabled title="Share links host the file — not available for sovereign documents (the PDF isn't stored)">
                            Share link
                          </button>
                        ) : (
                          <button className="btn sm" onClick={() => setLinkDoc(d)}>
                            Share link
                          </button>
                        )}
                        {dl[0] && (
                          <button className="btn sm" onClick={() => nav(`/links/${dl[0].id}`)}>
                            Analytics
                          </button>
                        )}
                        <button className="btn sm danger" title="Delete this document" onClick={() => removeDocument(d.id, d.Name)}>
                          Delete
                        </button>
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

      {confirmAsk && (
        <div className="public-center" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 200 }}>
          <div className="card center-narrow" style={{ maxWidth: 440 }}>
            <h1 style={{ marginTop: 0, fontSize: 20 }}>{confirmAsk.title}</h1>
            <p className="muted mb">{confirmAsk.body}</p>
            <div className="wrap-actions" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setConfirmAsk(null)}>Cancel</button>
              <button
                className="btn danger"
                onClick={async () => {
                  const fn = confirmAsk.onYes;
                  setConfirmAsk(null);
                  await fn();
                }}
              >
                {confirmAsk.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
