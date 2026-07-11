import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api, { apiError } from '../lib/api.js';
import { useCompany } from '../lib/company.js';
import { Spinner, useToast } from '../lib/ui.jsx';

// Resize an image file to fit email-header dimensions and return a PNG Blob.
// Rasterizing to PNG also fixes email clients that block SVG logos.
function resizeToPngBlob(file, maxW = 480, maxH = 140) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(maxW / img.width, maxH / img.height, 1);
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not process image'))), 'image/png');
      };
      img.onerror = () => reject(new Error('That file is not a valid image'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}

const SMTP_PRESETS = {
  gmail: { label: 'Gmail / Google Workspace', host: 'smtp.gmail.com', port: 465, secure: true, hint: 'Requires 2-Step Verification, then an App Password (myaccount.google.com → Security → App passwords).' },
  outlook: { label: 'Outlook / Microsoft 365', host: 'smtp.office365.com', port: 587, secure: false, hint: 'Use an app password if your account has 2FA enabled.' },
  custom: { label: 'Other / custom SMTP', host: '', port: 587, secure: false, hint: 'Enter your mail host, port, and credentials.' }
};

function CompanyCard({ company, providers, onChanged }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [showSmtp, setShowSmtp] = useState(false);
  const [smtp, setSmtp] = useState({ preset: 'gmail', email: '', host: 'smtp.gmail.com', port: 465, secure: true, username: '', password: '' });
  const [brand, setBrand] = useState({ senderName: company.senderName || '', logoUrl: company.logoUrl || '' });
  const logoInputRef = useRef(null);

  const uploadLogo = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const blob = await resizeToPngBlob(file);
      const fd = new FormData();
      fd.append('logo', blob, 'logo.png');
      const { data } = await api.post(`/companies/${company.id}/logo`, fd);
      setBrand((b) => ({ ...b, logoUrl: data.data.logoUrl || '' }));
      toast('Logo uploaded — it will appear in this workspace’s emails.');
      onChanged();
    } catch (err) {
      toast(apiError(err) || err.message || 'Could not upload logo', 'err');
    } finally {
      setBusy(false);
    }
  };

  const saveBrand = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.patch(`/companies/${company.id}`, { senderName: brand.senderName || null, logoUrl: brand.logoUrl || null });
      toast('Branding saved — emails from this workspace will use it.');
      onChanged();
    } catch (err) {
      toast(apiError(err), 'err');
    } finally {
      setBusy(false);
    }
  };

  // Team members (owner-managed).
  const [members, setMembers] = useState(null);
  const [memberEmail, setMemberEmail] = useState('');
  const loadMembers = () => api.get(`/companies/${company.id}/members`).then((r) => setMembers(r.data.data)).catch(() => {});
  useEffect(() => {
    if (company.isOwner) loadMembers();
  }, [company.id]);
  const addMember = async (e) => {
    e.preventDefault();
    if (!memberEmail.trim()) return;
    setBusy(true);
    try {
      await api.post(`/companies/${company.id}/members`, { email: memberEmail.trim().toLowerCase() });
      setMemberEmail('');
      await loadMembers();
      toast('Member added — they now share this workspace.');
    } catch (err) {
      toast(apiError(err), 'err');
    } finally {
      setBusy(false);
    }
  };
  const removeMember = async (mid) => {
    if (!confirm('Remove this member from the workspace?')) return;
    await api.delete(`/companies/${company.id}/members/${mid}`);
    loadMembers();
  };

  const pickPreset = (preset) => {
    const p = SMTP_PRESETS[preset];
    setSmtp((s) => ({ ...s, preset, host: p.host, port: p.port, secure: p.secure }));
  };
  const connectSmtp = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/companies/${company.id}/smtp`, {
        email: smtp.email,
        host: smtp.host,
        port: Number(smtp.port),
        secure: smtp.secure,
        username: smtp.username || smtp.email,
        password: smtp.password
      });
      toast('Mailbox connected — it can now send signature requests.');
      setShowSmtp(false);
      setSmtp((s) => ({ ...s, email: '', username: '', password: '' }));
      onChanged();
    } catch (err) {
      toast(apiError(err), 'err');
    } finally {
      setBusy(false);
    }
  };

  const removeEmail = async (id) => {
    await api.delete(`/companies/${company.id}/emails/${id}`);
    onChanged();
  };
  const setDefault = async (id) => {
    await api.post(`/companies/${company.id}/emails/${id}/default`);
    onChanged();
  };
  const disconnect = async (id) => {
    if (!confirm('Disconnect this mailbox? It will no longer be able to send.')) return;
    await api.delete(`/companies/${company.id}/emails/${id}/connection`);
    onChanged();
  };
  const archive = async () => {
    if (!confirm(`Archive ${company.name}?`)) return;
    await api.delete(`/companies/${company.id}`);
    onChanged();
  };

  // Kick off the OAuth connect flow: get the provider URL, then redirect there.
  const connect = async (provider) => {
    setBusy(true);
    try {
      const { data } = await api.get(`/companies/${company.id}/connect/${provider}`);
      window.location.href = data.data.url;
    } catch (e) {
      toast(apiError(e), 'err');
      setBusy(false);
    }
  };

  return (
    <div className="card mb">
      <div className="flex between mb">
        <div>
          <h2 style={{ margin: 0 }}>{company.name}</h2>
          {company.description && <div className="muted">{company.description}</div>}
          <div className="muted" style={{ fontSize: 12 }}>
            {company.senderName || '—'} · {company.senderEmail || 'no default sender'}
          </div>
        </div>
        {company.isOwner && (
          <button className="btn sm danger" onClick={archive}>
            Archive
          </button>
        )}
      </div>

      {company.isOwner && (
      <form className="card mb" style={{ background: 'var(--panel, #fafafa)' }} onSubmit={saveBrand}>
        <div className="field" style={{ marginBottom: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>Email branding</span>
          <div className="muted" style={{ fontSize: 12 }}>Shown in signature-request emails sent from this workspace.</div>
        </div>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Sender name</label>
            <input className="input" value={brand.senderName} onChange={(e) => setBrand((b) => ({ ...b, senderName: e.target.value }))} placeholder={company.name} />
          </div>
          <div className="field" style={{ marginBottom: 0, flex: 1.4 }}>
            <label>Logo — upload or paste a URL</label>
            <input className="input" value={brand.logoUrl} onChange={(e) => setBrand((b) => ({ ...b, logoUrl: e.target.value }))} placeholder="https://yoursite.com/logo.png" />
          </div>
          {brand.logoUrl && (
            <img src={brand.logoUrl} alt="logo preview" style={{ maxHeight: 40, maxWidth: 120, objectFit: 'contain', border: '1px solid #eee', borderRadius: 4, padding: 2 }} />
          )}
          <input
            ref={logoInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
            style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; uploadLogo(f); }}
          />
          <button type="button" className="btn" disabled={busy} onClick={() => logoInputRef.current?.click()}>
            {busy ? 'Uploading…' : 'Upload logo'}
          </button>
          <button className="btn" disabled={busy}>Save</button>
        </div>
      </form>
      )}

      {company.isOwner ? (
        <div className="card mb" style={{ background: 'var(--panel, #fafafa)' }}>
          <div className="field" style={{ marginBottom: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>Team members</span>
            <div className="muted" style={{ fontSize: 12 }}>People who share this workspace — its documents, templates, envelopes and recipients.</div>
          </div>
          <table className="mb">
            <tbody>
              <tr>
                <td>{members?.owner?.email || '—'}{members?.owner?.name ? ` · ${members.owner.name}` : ''}</td>
                <td><span className="badge blue">owner</span></td>
                <td />
              </tr>
              {(members?.members || []).map((m) => (
                <tr key={m.id}>
                  <td>{m.email}{m.name ? ` · ${m.name}` : ''}</td>
                  <td><span className="badge">{m.role}</span></td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn sm danger" onClick={() => removeMember(m.id)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <form className="flex" style={{ gap: 8 }} onSubmit={addMember}>
            <input className="input" type="email" value={memberEmail} onChange={(e) => setMemberEmail(e.target.value)} placeholder="teammate@email.com" style={{ maxWidth: 280 }} />
            <button className="btn" disabled={busy}>Add member</button>
          </form>
          <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>They need a DocSign account first. End-to-end-encrypted documents can’t be shared (only plaintext) — the uploader alone holds the key.</p>
        </div>
      ) : (
        <div className="badge amber" style={{ marginBottom: 12 }}>Shared with you · managed by the owner</div>
      )}

      {company.isOwner && (<>
      <div className="field" style={{ marginBottom: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>Connected sending mailboxes</span>
      </div>
      <table className="mb">
        <tbody>
          {company.emails.length === 0 && (
            <tr>
              <td className="muted">No mailboxes connected yet. Connect one below to send "Please sign" emails from your own address.</td>
            </tr>
          )}
          {company.emails.map((e) => (
            <tr key={e.id}>
              <td>
                {e.email}
                {e.isDefault && <span className="badge blue" style={{ marginLeft: 8 }}>default</span>}
                {e.canSend ? (
                  <span className="badge green" style={{ marginLeft: 8 }}>
                    connected · {e.provider === 'google' ? 'Gmail' : e.provider === 'microsoft' ? 'Outlook' : e.provider === 'smtp' ? `mailbox${e.smtpHost ? ` (${e.smtpHost})` : ''}` : e.provider}
                  </span>
                ) : e.systemSend ? (
                  <span className="badge green" style={{ marginLeft: 8 }} title={`Sent through the ${e.systemDomain} system mailbox`}>
                    ready · sends via {e.systemDomain} mail
                  </span>
                ) : (
                  <span className="badge amber" style={{ marginLeft: 8 }}>connect a mailbox to send from this address</span>
                )}
              </td>
              <td style={{ textAlign: 'right' }}>
                {(e.canSend || e.systemSend) && !e.isDefault && (
                  <button className="btn sm" onClick={() => setDefault(e.id)}>
                    Make default
                  </button>
                )}{' '}
                {e.canSend ? (
                  <button className="btn sm danger" onClick={() => disconnect(e.id)}>
                    Disconnect
                  </button>
                ) : (
                  <button className="btn sm danger" onClick={() => removeEmail(e.id)}>
                    Remove
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="wrap-actions">
        <button className="btn primary" disabled={busy} onClick={() => setShowSmtp((v) => !v)}>
          {showSmtp ? 'Cancel' : '+ Connect a mailbox'}
        </button>
        {providers.map((p) => (
          <button
            key={p.provider}
            className="btn"
            disabled={busy || !p.configured}
            title={p.configured ? '' : `${p.label} sign-in isn't configured on this server yet`}
            onClick={() => connect(p.provider)}
          >
            Connect {p.provider === 'google' ? 'Gmail' : p.provider === 'microsoft' ? 'Outlook' : p.label} (one-click)
            {!p.configured && ' — soon'}
          </button>
        ))}
      </div>

      {showSmtp && (
        <form className="card mt" style={{ background: 'var(--panel, #fafafa)' }} onSubmit={connectSmtp}>
          <div className="field">
            <label>Mail provider</label>
            <select className="select" value={smtp.preset} onChange={(e) => pickPreset(e.target.value)}>
              {Object.entries(SMTP_PRESETS).map(([k, p]) => (
                <option key={k} value={k}>{p.label}</option>
              ))}
            </select>
          </div>
          <div className="row">
            <div className="field">
              <label>Send-from email</label>
              <input className="input" type="email" required value={smtp.email} onChange={(e) => setSmtp((s) => ({ ...s, email: e.target.value }))} placeholder="you@company.com" />
            </div>
            <div className="field">
              <label>App password</label>
              <input className="input" type="password" required value={smtp.password} onChange={(e) => setSmtp((s) => ({ ...s, password: e.target.value }))} placeholder="app password" autoComplete="new-password" />
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label>SMTP host</label>
              <input className="input" required value={smtp.host} onChange={(e) => setSmtp((s) => ({ ...s, host: e.target.value }))} placeholder="smtp.example.com" />
            </div>
            <div className="field" style={{ maxWidth: 110 }}>
              <label>Port</label>
              <input className="input" type="number" value={smtp.port} onChange={(e) => setSmtp((s) => ({ ...s, port: e.target.value, secure: Number(e.target.value) === 465 }))} />
            </div>
            <div className="field" style={{ maxWidth: 160 }}>
              <label>Username (optional)</label>
              <input className="input" value={smtp.username} onChange={(e) => setSmtp((s) => ({ ...s, username: e.target.value }))} placeholder="defaults to email" />
            </div>
          </div>
          <label className="checkbox">
            <input type="checkbox" checked={smtp.secure} onChange={(e) => setSmtp((s) => ({ ...s, secure: e.target.checked }))} />
            Use SSL/TLS (on for port 465; off for 587/STARTTLS)
          </label>
          <p className="muted" style={{ fontSize: 12, margin: '8px 0' }}>{SMTP_PRESETS[smtp.preset].hint}</p>
          <button className="btn primary" disabled={busy}>
            {busy ? 'Verifying…' : 'Verify & connect'}
          </button>
        </form>
      )}

      <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
        Addresses on our verified mail domain send automatically. To send from your own address, connect its mailbox: enter the email and an app password and we'll verify it, then signature requests go out through your account.
      </p>
      </>)}
    </div>
  );
}

export default function Companies() {
  const { companies, load } = useCompany();
  const [loading, setLoading] = useState(true);
  const [providers, setProviders] = useState([]);
  const [form, setForm] = useState({ name: '', description: '', senderName: '', senderEmail: '' });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const refresh = async () => {
    await load();
    setLoading(false);
  };
  useEffect(() => {
    refresh();
    api.get('/companies/email-providers').then((r) => setProviders(r.data.data)).catch(() => {});
  }, []);

  // Surface the result of an OAuth connect round-trip (?connect=success|error_*).
  useEffect(() => {
    const c = params.get('connect');
    if (!c) return;
    if (c === 'success') {
      toast('Mailbox connected');
      refresh();
    } else {
      toast(`Could not connect: ${c.replace('error_', '').replace(/_/g, ' ') || 'error'}`, 'err');
    }
    params.delete('connect');
    setParams(params, { replace: true });
  }, [params]);

  const create = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      await api.post('/companies', {
        name: form.name,
        description: form.description || null,
        senderName: form.senderName || null,
        senderEmail: form.senderEmail || null
      });
      setForm({ name: '', description: '', senderName: '', senderEmail: '' });
      toast('Workspace created');
      refresh();
    } catch (err) {
      toast(apiError(err), 'err');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Spinner center />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Workspaces</h1>
          <p className="muted">Each workspace is a brand (e.g. MickAI, Cryptool) with its own documents, templates, and connected sending mailbox.</p>
        </div>
      </div>

      <form className="card mb" onSubmit={create}>
        <h2>New workspace</h2>
        <div className="row">
          <div className="field">
            <label>Workspace name</label>
            <input className="input" value={form.name} onChange={set('name')} placeholder="e.g. MickAI" />
          </div>
          <div className="field">
            <label>Description</label>
            <input className="input" value={form.description} onChange={set('description')} placeholder="e.g. Sovereign AI Operating System" />
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label>Sender name</label>
            <input className="input" value={form.senderName} onChange={set('senderName')} placeholder="MickAI Team" />
          </div>
          <div className="field">
            <label>Default from-email</label>
            <input className="input" type="email" value={form.senderEmail} onChange={set('senderEmail')} placeholder="hi@mickai.com" />
          </div>
        </div>
        <button className="btn primary" disabled={busy}>
          Create workspace
        </button>
      </form>

      {companies.length === 0 ? (
        <div className="empty">No workspaces yet. Create one per brand to send from its own address.</div>
      ) : (
        companies.map((c) => <CompanyCard key={c.id} company={c} providers={providers} onChanged={refresh} />)
      )}
    </>
  );
}
