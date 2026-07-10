import { useEffect, useState } from 'react';
import api, { apiError } from '../lib/api.js';
import { useCompany } from '../lib/company.js';
import { Spinner, useToast } from '../lib/ui.jsx';

function CompanyCard({ company, onChanged }) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);

  const addEmail = async () => {
    if (!email.trim()) return;
    setBusy(true);
    try {
      await api.post(`/companies/${company.id}/emails`, { email, label: label || null });
      setEmail('');
      setLabel('');
      onChanged();
    } catch (e) {
      toast(apiError(e), 'err');
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
  const archive = async () => {
    if (!confirm(`Archive ${company.name}?`)) return;
    await api.delete(`/companies/${company.id}`);
    onChanged();
  };

  return (
    <div className="card mb">
      <div className="flex between mb">
        <div>
          <h2 style={{ margin: 0 }}>{company.name}</h2>
          <div className="muted">
            {company.senderName || '—'} · {company.senderEmail || 'no default sender'}
          </div>
        </div>
        <button className="btn sm danger" onClick={archive}>
          Archive
        </button>
      </div>

      <label className="field" style={{ marginBottom: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>Send-as email addresses</span>
      </label>
      <table className="mb">
        <tbody>
          {company.emails.length === 0 && (
            <tr>
              <td className="muted">No linked emails yet. Add the addresses you send/sign as.</td>
            </tr>
          )}
          {company.emails.map((e) => (
            <tr key={e.id}>
              <td>
                {e.email} {e.label && <span className="muted">· {e.label}</span>}
                {e.isDefault && <span className="badge blue" style={{ marginLeft: 8 }}>default</span>}
                {!e.verified && <span className="badge amber" style={{ marginLeft: 8 }}>unverified</span>}
              </td>
              <td style={{ textAlign: 'right' }}>
                {!e.isDefault && (
                  <button className="btn sm" onClick={() => setDefault(e.id)}>
                    Make default
                  </button>
                )}{' '}
                <button className="btn sm danger" onClick={() => removeEmail(e.id)}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Add email</label>
          <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="deals@company.com" />
        </div>
        <div className="field" style={{ marginBottom: 0, flex: 0.6 }}>
          <label>Label</label>
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Deals" />
        </div>
        <button className="btn" style={{ marginBottom: 0 }} disabled={busy} onClick={addEmail}>
          Add
        </button>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
        To actually deliver mail from an address, its domain must be verified with your email provider (SES).
      </p>
    </div>
  );
}

export default function Companies() {
  const { companies, load } = useCompany();
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', senderName: '', senderEmail: '' });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const refresh = async () => {
    await load();
    setLoading(false);
  };
  useEffect(() => {
    refresh();
  }, []);

  const create = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      await api.post('/companies', {
        name: form.name,
        senderName: form.senderName || null,
        senderEmail: form.senderEmail || null
      });
      setForm({ name: '', senderName: '', senderEmail: '' });
      toast('Company created');
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
          <h1>Companies</h1>
          <p className="muted">Separate sending identities (e.g. MickAI, Cryptool), each with their own emails and templates.</p>
        </div>
      </div>

      <form className="card mb" onSubmit={create}>
        <h2>New company</h2>
        <div className="row">
          <div className="field">
            <label>Company name</label>
            <input className="input" value={form.name} onChange={set('name')} placeholder="e.g. MickAI" />
          </div>
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
          Create company
        </button>
      </form>

      {companies.length === 0 ? (
        <div className="empty">No companies yet. Create one to send as a distinct brand.</div>
      ) : (
        companies.map((c) => <CompanyCard key={c.id} company={c} onChanged={refresh} />)
      )}
    </>
  );
}
