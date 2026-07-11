import { useEffect, useState } from 'react';
import api, { apiError } from '../lib/api.js';
import { Spinner, useToast } from '../lib/ui.jsx';

export default function Recipients() {
  const [items, setItems] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', company: '', title: '' });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const load = () => api.get('/recipients').then((r) => setItems(r.data.data));
  useEffect(() => {
    load();
  }, []);

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/recipients', form);
      setForm({ name: '', email: '', company: '', title: '' });
      toast('Recipient added');
      load();
    } catch (err) {
      toast(apiError(err), 'err');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    if (!confirm('Remove this recipient?')) return;
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

      <form className="card mb" onSubmit={create}>
        <h2>Add recipient</h2>
        <div className="row">
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
        <button className="btn primary" disabled={busy}>
          Add recipient
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
                <th>Company</th>
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
                    <div className="muted">{r.Title}</div>
                  </td>
                  <td>{r.Email}</td>
                  <td>{r.Company || '—'}</td>
                  <td style={{ textAlign: 'right' }}>
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
