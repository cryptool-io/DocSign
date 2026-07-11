import { useEffect, useState } from 'react';
import api, { apiError } from '../lib/api.js';
import { useCompany } from '../lib/company.js';
import { Spinner, useToast } from '../lib/ui.jsx';

const EMPTY = { name: '', email: '', company: '', title: '', companyId: '' };

export default function Recipients() {
  const [items, setItems] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null); // null = adding; id = editing that row
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const { companies } = useCompany();
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const workspaceName = (id) => companies.find((c) => c.id === id)?.name || null;

  const load = () => api.get('/recipients').then((r) => setItems(r.data.data));
  useEffect(() => {
    load();
  }, []);

  const resetForm = () => {
    setForm(EMPTY);
    setEditId(null);
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        name: form.name,
        email: form.email,
        company: form.company,
        title: form.title,
        companyId: form.companyId || null
      };
      if (editId) {
        await api.patch(`/recipients/${editId}`, payload);
        toast('Recipient updated');
      } else {
        await api.post('/recipients', payload);
        toast('Recipient added');
      }
      resetForm();
      load();
    } catch (err) {
      toast(apiError(err), 'err');
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (r) => {
    setEditId(r.id);
    setForm({
      name: r.Name || '',
      email: r.Email || '',
      company: r.Company || '',
      title: r.Title || '',
      companyId: r.DocCompanyId || ''
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const remove = async (id) => {
    if (!confirm('Remove this recipient?')) return;
    if (editId === id) resetForm();
    await api.delete(`/recipients/${id}`);
    load();
  };

  const toggleFav = async (r) => {
    try {
      await api.patch(`/recipients/${r.id}`, { favorite: !r.Favorite });
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
          <h1>Recipients</h1>
          <p className="muted">People you send documents to and request signatures from.</p>
        </div>
      </div>

      <form className="card mb" onSubmit={submit}>
        <div className="flex between">
          <h2 style={{ margin: 0 }}>{editId ? 'Edit recipient' : 'Add recipient'}</h2>
          {editId && (
            <button type="button" className="btn sm" onClick={resetForm}>
              Cancel edit
            </button>
          )}
        </div>
        <div className="row mt">
          <div className="field">
            <label>Name</label>
            <input className="input" value={form.name} onChange={set('name')} required />
          </div>
          <div className="field">
            <label>Email</label>
            <input className="input" type="email" value={form.email} onChange={set('email')} required />
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label>Company</label>
            <input className="input" value={form.company} onChange={set('company')} />
          </div>
          <div className="field">
            <label>Title</label>
            <input className="input" value={form.title} onChange={set('title')} />
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label>Workspace</label>
            <select className="select" value={form.companyId} onChange={set('companyId')}>
              <option value="">No workspace (personal)</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              Link this recipient to a workspace so it shows up there.
            </p>
          </div>
        </div>
        <button className="btn primary" disabled={busy}>
          {editId ? 'Save changes' : 'Add recipient'}
        </button>
      </form>

      {items.length === 0 ? (
        <div className="empty">No recipients yet.</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 36 }} />
                <th>Name</th>
                <th>Email</th>
                <th>Workspace</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id}>
                  <td style={{ textAlign: 'center' }}>
                    <button
                      className="btn sm"
                      title={r.Favorite ? 'Unfavorite' : 'Mark as favorite'}
                      onClick={() => toggleFav(r)}
                      style={{ padding: '2px 6px', border: 'none', background: 'none', fontSize: 18, color: r.Favorite ? '#f59e0b' : '#bbb', cursor: 'pointer' }}
                    >
                      {r.Favorite ? '★' : '☆'}
                    </button>
                  </td>
                  <td>
                    <strong>{r.Name}</strong>
                    <div className="muted">{[r.Title, r.Company].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td>{r.Email}</td>
                  <td>{workspaceName(r.DocCompanyId) || <span className="muted">—</span>}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn sm" onClick={() => startEdit(r)}>
                      Edit
                    </button>{' '}
                    <button className="btn sm danger" onClick={() => remove(r.id)}>
                      Remove
                    </button>
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
