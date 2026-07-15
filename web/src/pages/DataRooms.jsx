import { useEffect, useState } from 'react';
import api, { apiError } from '../lib/api.js';
import { documentKeyB64 } from '../lib/keystore.js';
import { appendKeyMap } from '../lib/linkkey.js';
import { Spinner, useToast, fmtDate, fmtDuration } from '../lib/ui.jsx';

// Build a room's shareable URL, embedding a {documentId: dek} key map in the
// fragment for any encrypted documents so recipients can decrypt them.
const roomShareUrl = async (room) => {
  const encItems = (room.items || []).filter((it) => it.encrypted && it.wrappedDek);
  if (encItems.length === 0) return room.url;
  const map = {};
  for (const it of encItems) {
    map[it.documentId] = await documentKeyB64(it.wrappedDek);
  }
  return appendKeyMap(room.url, map);
};

function RoomModal({ docs, existing, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(
    existing || {
      name: '',
      description: '',
      requireEmail: true,
      watermark: true,
      allowDownload: false,
      password: '',
      allowedEmails: '',
      expiresAt: ''
    }
  );
  const [picked, setPicked] = useState(existing ? existing.items.map((i) => i.documentId) : []);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const toggleDoc = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const save = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return toast('Name the data room.', 'err');
    if (picked.length === 0) return toast('Add at least one document.', 'err');
    setBusy(true);
    try {
      const payload = {
        name: form.name,
        description: form.description || null,
        requireEmail: form.requireEmail,
        watermark: form.watermark,
        allowDownload: form.allowDownload,
        password: form.password || null,
        allowedEmails: form.allowedEmails ? form.allowedEmails.split(',').map((s) => s.trim()).filter(Boolean) : [],
        expiresAt: form.expiresAt || null,
        documents: picked.map((id, i) => ({ documentId: id, sortOrder: i }))
      };
      if (existing) await api.patch(`/data-rooms/${existing.id}`, payload);
      else await api.post('/data-rooms', payload);
      toast(existing ? 'Data room updated' : 'Data room created');
      onSaved();
    } catch (err) {
      toast(apiError(err), 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="public-center" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 100, overflow: 'auto' }}>
      <form className="card" style={{ maxWidth: 560, width: '100%', margin: 20 }} onSubmit={save}>
        <h1>{existing ? 'Edit data room' : 'New data room'}</h1>
        <p className="muted mb">Share multiple documents behind one gated link.</p>
        <div className="field">
          <label>Name</label>
          <input className="input" value={form.name} onChange={set('name')} placeholder="e.g. Series A Data Room" />
        </div>
        <div className="field">
          <label>Description (optional)</label>
          <input className="input" value={form.description} onChange={set('description')} />
        </div>

        <div className="field">
          <label>Documents ({picked.length} selected)</label>
          <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 8 }}>
            {docs.length === 0 && <div className="muted">Upload documents first.</div>}
            {docs.filter((d) => d.StorageMode !== 'sovereign').map((d) => (
              <label key={d.id} className="checkbox" style={{ marginBottom: 6 }}>
                <input type="checkbox" checked={picked.includes(d.id)} onChange={() => toggleDoc(d.id)} />
                {d.Name} <span className="muted">· {d.PageCount}p</span>
              </label>
            ))}
          </div>
          {docs.some((d) => d.StorageMode === 'sovereign') && (
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              🔒 Sovereign documents (kept on your device) aren’t shown — a data room hosts the file, so it can’t include documents we don’t store.
            </div>
          )}
        </div>

        <div className="row">
          <label className="checkbox"><input type="checkbox" checked={form.requireEmail} onChange={set('requireEmail')} /> Require email</label>
          <label className="checkbox"><input type="checkbox" checked={form.watermark} onChange={set('watermark')} /> Watermark</label>
          <label className="checkbox"><input type="checkbox" checked={form.allowDownload} onChange={set('allowDownload')} /> Allow download</label>
        </div>
        <div className="field">
          <label>Password (optional)</label>
          <input className="input" value={form.password} onChange={set('password')} placeholder={existing?.hasPassword ? '•••••• (unchanged)' : ''} />
        </div>
        <div className="field">
          <label>Allowed emails / domains (comma-separated)</label>
          <input className="input" value={form.allowedEmails} onChange={set('allowedEmails')} placeholder="@fund.vc, lp@x.com" />
        </div>
        <div className="field">
          <label>Expires (optional)</label>
          <input className="input" type="datetime-local" value={form.expiresAt} onChange={set('expiresAt')} />
        </div>

        <div className="wrap-actions">
          <button className="btn primary" disabled={busy}>
            {busy ? 'Saving…' : existing ? 'Save changes' : 'Create data room'}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function Analytics({ roomId, onClose }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api.get(`/data-rooms/${roomId}/analytics`).then((r) => setData(r.data.data));
  }, [roomId]);

  return (
    <div className="public-center" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 100, overflow: 'auto' }}>
      <div className="card" style={{ maxWidth: 640, width: '100%', margin: 20 }}>
        {!data ? (
          <Spinner center />
        ) : (
          <>
            <div className="flex between mb">
              <h1 style={{ margin: 0 }}>{data.room.Name}</h1>
              <button className="btn" onClick={onClose}>Close</button>
            </div>
            <div className="stats">
              <div className="stat"><div className="n">{data.totals.views}</div><div className="l">Document views</div></div>
              <div className="stat"><div className="n">{data.totals.uniqueViewers}</div><div className="l">Unique viewers</div></div>
              <div className="stat"><div className="n">{fmtDuration(data.totals.totalSeconds)}</div><div className="l">Total time</div></div>
            </div>
            <h2>Time per document</h2>
            <table className="mb">
              <tbody>
                {data.perDocument.map((d) => (
                  <tr key={d.documentId}>
                    <td>{d.name}</td>
                    <td className="muted">{d.views} view{d.views > 1 ? 's' : ''}</td>
                    <td>{fmtDuration(d.seconds)}</td>
                  </tr>
                ))}
                {data.perDocument.length === 0 && <tr><td className="muted">No views yet.</td></tr>}
              </tbody>
            </table>
            <h2>Viewers</h2>
            <table>
              <tbody>
                {data.sessions.map((s) => (
                  <tr key={s.id}>
                    <td>{s.viewerEmail || 'Anonymous'}</td>
                    <td className="muted">{s.documentName}</td>
                    <td>{fmtDuration(s.totalSeconds)}</td>
                    <td className="muted">{fmtDate(s.startedAt)}</td>
                  </tr>
                ))}
                {data.sessions.length === 0 && <tr><td className="muted">No sessions yet.</td></tr>}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}

export default function DataRooms() {
  const [rooms, setRooms] = useState(null);
  const [docs, setDocs] = useState([]);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [analyticsId, setAnalyticsId] = useState(null);
  const toast = useToast();

  const load = async () => {
    const [r, d] = await Promise.all([api.get('/data-rooms'), api.get('/documents')]);
    setRooms(r.data.data);
    setDocs(d.data.data);
  };
  useEffect(() => {
    load();
  }, []);

  const revoke = async (id) => {
    if (!confirm('Revoke this data room? The link will stop working.')) return;
    await api.post(`/data-rooms/${id}/revoke`);
    load();
  };
  const remove = async (id) => {
    if (!confirm('Delete this data room permanently?')) return;
    await api.delete(`/data-rooms/${id}`);
    load();
  };

  if (!rooms) return <Spinner center />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Data rooms</h1>
          <p className="muted">Share multiple documents behind one gated, tracked link.</p>
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}>
          + New data room
        </button>
      </div>

      {rooms.length === 0 ? (
        <div className="empty">No data rooms yet.</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Documents</th>
                <th>Views</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rooms.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.Name}</strong>
                    <div className="muted">{r.Description}</div>
                  </td>
                  <td>{r.items.length}</td>
                  <td>
                    {r.views || 0} · {r.uniqueViewers || 0} unique
                  </td>
                  <td>
                    {r.isRevoked ? (
                      <span className="badge red">revoked</span>
                    ) : r.isExpired ? (
                      <span className="badge gray">expired</span>
                    ) : (
                      <span className="badge green">live</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div className="wrap-actions" style={{ justifyContent: 'flex-end' }}>
                      <button
                        className="btn sm primary"
                        onClick={async () => {
                          try {
                            const url = await roomShareUrl(r);
                            navigator.clipboard?.writeText(url);
                            toast('Link copied');
                          } catch {
                            toast('Could not build the encrypted link', 'err');
                          }
                        }}
                      >
                        Copy link
                      </button>
                      <button className="btn sm" onClick={() => setAnalyticsId(r.id)}>
                        Analytics
                      </button>
                      <button className="btn sm" onClick={() => setEditing(r)}>
                        Edit
                      </button>
                      {!r.isRevoked && (
                        <button className="btn sm danger" onClick={() => revoke(r.id)}>
                          Revoke
                        </button>
                      )}
                      <button className="btn sm danger" onClick={() => remove(r.id)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(creating || editing) && (
        <RoomModal
          docs={docs}
          existing={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            load();
          }}
        />
      )}
      {analyticsId && <Analytics roomId={analyticsId} onClose={() => setAnalyticsId(null)} />}
    </>
  );
}
