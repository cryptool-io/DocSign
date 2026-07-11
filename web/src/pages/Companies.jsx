import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api, { apiError } from '../lib/api.js';
import { useCompany } from '../lib/company.js';
import { Spinner, useToast } from '../lib/ui.jsx';

function CompanyCard({ company, providers, onChanged }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

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
        <button className="btn sm danger" onClick={archive}>
          Archive
        </button>
      </div>

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
                    connected · {e.provider === 'google' ? 'Gmail' : e.provider === 'microsoft' ? 'Outlook' : e.provider}
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
        {providers.map((p) => (
          <button
            key={p.provider}
            className="btn"
            disabled={busy || !p.configured}
            title={p.configured ? '' : `${p.label} sign-in isn't configured on this server yet`}
            onClick={() => connect(p.provider)}
          >
            Connect {p.provider === 'google' ? 'Gmail' : p.provider === 'microsoft' ? 'Outlook' : p.label}
            {!p.configured && ' (not configured)'}
          </button>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
        Addresses on our verified mail domain send automatically through the system mailbox — no connection needed. To send from a mailbox on another domain (e.g. a Gmail or Outlook address), connect it here so requests go out through your own account.
      </p>
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
