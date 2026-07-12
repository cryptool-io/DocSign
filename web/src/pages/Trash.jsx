import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { apiError } from '../lib/api.js';
import { Spinner, useToast, fmtDate } from '../lib/ui.jsx';

/** Deleted (archived) documents and signing setups, restorable in one click. */
export default function Trash() {
  const [docs, setDocs] = useState(null);
  const [setups, setSetups] = useState([]);
  const toast = useToast();
  const nav = useNavigate();

  const load = async () => {
    const [d, t] = await Promise.all([api.get('/documents?archived=1'), api.get('/templates?archived=1')]);
    setDocs(d.data.data);
    setSetups(t.data.data);
  };
  useEffect(() => {
    load();
  }, []);

  const restoreDoc = async (id) => {
    try {
      await api.patch(`/documents/${id}`, { archived: false });
      toast('Document restored');
      load();
    } catch (err) {
      toast(apiError(err), 'err');
    }
  };
  const restoreSetup = async (id) => {
    try {
      await api.post(`/templates/${id}/restore`);
      toast('Signing setup restored');
      load();
    } catch (err) {
      toast(apiError(err), 'err');
    }
  };

  if (!docs) return <Spinner center />;
  const empty = docs.length === 0 && setups.length === 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Trash</h1>
          <p className="muted">Deleted documents and signing setups — restore anything you removed by mistake.</p>
        </div>
        <button className="btn" onClick={() => nav('/documents')}>
          Back to Documents
        </button>
      </div>

      {empty ? (
        <div className="empty">Nothing in the trash.</div>
      ) : (
        <>
          {docs.length > 0 && (
            <div className="card mb" style={{ padding: 0 }}>
              <table>
                <thead>
                  <tr>
                    <th>Deleted document</th>
                    <th>Uploaded</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {docs.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <strong>{d.Name}</strong>
                        <div className="muted">{(d.SizeBytes / 1024).toFixed(0)} KB · {d.PageCount} pages</div>
                      </td>
                      <td className="muted">{fmtDate(d.createdAt)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="btn sm primary" onClick={() => restoreDoc(d.id)}>
                          Restore
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {setups.length > 0 && (
            <div className="card" style={{ padding: 0 }}>
              <table>
                <thead>
                  <tr>
                    <th>Deleted signing setup</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {setups.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <strong>{t.Name}</strong>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="btn sm primary" onClick={() => restoreSetup(t.id)}>
                          Restore
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
