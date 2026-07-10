import { useEffect, useState } from 'react';
import api, { apiError } from '../lib/api.js';
import { Spinner, useToast, fmtDate } from '../lib/ui.jsx';

export default function Projects() {
  const [items, setItems] = useState(null);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = () => api.get('/projects').then((r) => setItems(r.data.data));
  useEffect(() => {
    load();
  }, []);

  const create = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.post('/projects', { name, description: desc });
      setName('');
      setDesc('');
      toast('Project created');
      load();
    } catch (err) {
      toast(apiError(err), 'err');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    if (!confirm('Archive this project?')) return;
    await api.delete(`/projects/${id}`);
    load();
  };

  if (!items) return <Spinner center />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Projects</h1>
          <p className="muted">Group documents, recipients, and templates by venture or deal.</p>
        </div>
      </div>

      <form className="card mb" onSubmit={create}>
        <h2>New project</h2>
        <div className="row">
          <div className="field">
            <label>Name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Cryptool Seed Round" />
          </div>
          <div className="field">
            <label>Description</label>
            <input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} />
          </div>
        </div>
        <button className="btn primary" disabled={busy}>
          Create project
        </button>
      </form>

      {items.length === 0 ? (
        <div className="empty">No projects yet.</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Documents</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>{p.Name}</strong>
                    <div className="muted">{p.Description}</div>
                  </td>
                  <td>{p.documentCount ?? 0}</td>
                  <td className="muted">{fmtDate(p.createdAt)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn sm danger" onClick={() => remove(p.id)}>
                      Archive
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
