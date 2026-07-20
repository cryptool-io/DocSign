import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../lib/api.js';
import { Spinner, fmtDate, fmtDuration } from '../lib/ui.jsx';

export default function LinkAnalytics() {
  const { id } = useParams();
  const nav = useNavigate();
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get(`/links/${id}/analytics`).then((r) => setData(r.data.data)).catch(() => setData({ error: true }));
  }, [id]);

  if (!data) return <Spinner center />;
  if (data.error) return <div className="empty">Could not load analytics.</div>;

  const { link, document: doc, totals, perPageSeconds, sessions } = data;
  const pageCount = doc?.pageCount || 0;
  const maxSecs = Math.max(1, ...Object.values(perPageSeconds || {}));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{doc?.name || 'Link analytics'}</h1>
          <p className="muted">{link?.url}</p>
        </div>
        <button className="btn" onClick={() => nav(-1)}>
          Back
        </button>
      </div>

      <div className="stats">
        <div className="stat"><div className="n">{totals.views}</div><div className="l">Total views</div></div>
        <div className="stat"><div className="n">{totals.uniqueViewers}</div><div className="l">Unique viewers</div></div>
        <div className="stat"><div className="n">{totals.completions}</div><div className="l">Read to end</div></div>
        <div className="stat"><div className="n">{fmtDuration(totals.totalSeconds)}</div><div className="l">Total time</div></div>
      </div>

      <div className="card mb">
        <h2>Time spent per page</h2>
        {pageCount === 0 ? (
          <p className="muted">No page data.</p>
        ) : (
          // A long document has more bars than fit a phone, so the chart
          // scrolls sideways inside its card rather than stretching the page.
          <div className="page-time-chart" style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 160, paddingTop: 10, overflowX: 'auto' }}>
            {Array.from({ length: pageCount }, (_, i) => {
              const secs = perPageSeconds?.[i + 1] || 0;
              const h = Math.round((secs / maxSecs) * 130);
              return (
                <div key={i} style={{ flex: '1 0 34px', minWidth: 34, textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtDuration(secs)}</div>
                  <div
                    title={`Page ${i + 1}: ${fmtDuration(secs)}`}
                    style={{
                      height: Math.max(3, h),
                      background: secs ? 'var(--primary)' : '#e3e6ea',
                      borderRadius: '4px 4px 0 0',
                      marginTop: 4
                    }}
                  />
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{i + 1}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Viewer</th>
              <th>Opened</th>
              <th>Time</th>
              <th>Pages seen</th>
              <th>Downloaded</th>
            </tr>
          </thead>
          <tbody>
            {sessions.length === 0 && (
              <tr>
                <td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                  No views yet.
                </td>
              </tr>
            )}
            {sessions.map((s) => (
              <tr key={s.id}>
                <td>
                  <strong>{s.viewerEmail || 'Anonymous'}</strong>
                  <div className="muted">{s.ipAddress}</div>
                </td>
                <td className="muted">{fmtDate(s.startedAt)}</td>
                <td>{fmtDuration(s.totalSeconds)}</td>
                <td>
                  {s.pagesViewed}/{pageCount}
                </td>
                <td>{s.downloaded ? 'Yes' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
