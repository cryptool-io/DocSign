import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { Document, Page } from '../../lib/pdf.js';
import { Spinner } from '../../lib/ui.jsx';

const pub = axios.create({ baseURL: '/api' });

export default function PublicDataRoom() {
  const { token } = useParams();
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [session, setSession] = useState(null); // { roomToken, roomId, name, documents, allowDownload }
  const [activeDoc, setActiveDoc] = useState(null);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [numPages, setNumPages] = useState(0);

  const pageSeconds = useRef({});
  const visiblePage = useRef(1);

  useEffect(() => {
    pub
      .get(`/room/${token}/meta`)
      .then((r) => setMeta(r.data.data))
      .catch((e) => setError(e.response?.data?.error || 'This data room is unavailable.'));
  }, [token]);

  const open = async (e) => {
    e?.preventDefault();
    setError(null);
    try {
      const { data } = await pub.post(`/room/${token}/open`, { email: email || null, password: password || null });
      // roomId is embedded in the room token payload.
      const roomId = JSON.parse(atob(data.data.roomToken.split('.')[1])).roomId;
      setSession({ ...data.data, roomId });
      if (data.data.documents[0]) setActiveDoc(data.data.documents[0]);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not open the data room.');
    }
  };

  // Load the active document's PDF.
  useEffect(() => {
    if (!session || !activeDoc) return;
    setPdfUrl(null);
    setNumPages(0);
    pageSeconds.current = {};
    visiblePage.current = 1;
    pub
      .get(`/room/room/${session.roomId}/document/${activeDoc.id}/file`, {
        responseType: 'blob',
        headers: { Authorization: `Bearer ${session.roomToken}` }
      })
      .then((r) => setPdfUrl(URL.createObjectURL(r.data)))
      .catch(() => setError('Could not load that document.'));
  }, [session, activeDoc]);

  // Tick visible page.
  useEffect(() => {
    if (!activeDoc) return;
    const iv = setInterval(() => {
      const p = visiblePage.current;
      pageSeconds.current[p] = (pageSeconds.current[p] || 0) + 1;
    }, 1000);
    return () => clearInterval(iv);
  }, [activeDoc]);

  const flush = useCallback(() => {
    if (!session || !activeDoc) return;
    const pages = Object.entries(pageSeconds.current).map(([page, seconds]) => ({ page: Number(page), seconds }));
    if (!pages.length) return;
    pub
      .post(
        `/room/room/${session.roomId}/heartbeat`,
        { documentId: activeDoc.id, pages },
        { headers: { Authorization: `Bearer ${session.roomToken}` } }
      )
      .catch(() => {});
  }, [session, activeDoc]);

  useEffect(() => {
    if (!session) return;
    const iv = setInterval(flush, 8000);
    const onHide = () => flush();
    window.addEventListener('beforeunload', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      clearInterval(iv);
      window.removeEventListener('beforeunload', onHide);
      document.removeEventListener('visibilitychange', onHide);
      flush();
    };
  }, [session, flush]);

  const pageRefs = useRef([]);
  useEffect(() => {
    if (!numPages) return;
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((en) => en.isIntersecting && (visiblePage.current = Number(en.target.dataset.page))),
      { threshold: 0.5 }
    );
    pageRefs.current.forEach((el) => el && obs.observe(el));
    return () => obs.disconnect();
  }, [numPages, activeDoc]);

  // Switch documents: flush current, then change.
  const switchDoc = (doc) => {
    flush();
    setActiveDoc(doc);
  };

  if (error && !meta)
    return (
      <div className="public-center">
        <div className="card center-narrow">
          <h1>Unavailable</h1>
          <p className="muted">{error}</p>
        </div>
      </div>
    );
  if (!meta) return <Spinner center />;

  if (!session) {
    return (
      <div className="public-center">
        <form className="card center-narrow" onSubmit={open}>
          <div className="brand" style={{ padding: '0 0 12px' }}>
            Cryptool <span>DocSign</span>
          </div>
          <h1>{meta.name}</h1>
          {meta.description && <p className="muted mb">{meta.description}</p>}
          <p className="muted mb">You've been invited to a data room.</p>
          {meta.requireEmail && (
            <div className="field">
              <label>Your email</label>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
          )}
          {meta.requirePassword && (
            <div className="field">
              <label>Password</label>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
          )}
          {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
          <button className="btn primary block">Enter data room</button>
        </form>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside className="sidebar" style={{ width: 280 }}>
        <div className="brand">{session.name}</div>
        <div className="muted" style={{ padding: '0 8px 12px', fontSize: 12 }}>
          {session.documents.length} document{session.documents.length > 1 ? 's' : ''}
        </div>
        <nav className="nav">
          {session.documents.map((d) => (
            <a
              key={d.id}
              onClick={() => switchDoc(d)}
              className={activeDoc?.id === d.id ? 'active' : ''}
              style={{ cursor: 'pointer' }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {d.folder ? `${d.folder} / ` : ''}
                {d.label}
              </span>
            </a>
          ))}
        </nav>
      </aside>
      <div className="main">
        <div className="public-wrap">
          {!activeDoc ? (
            <div className="empty">Select a document.</div>
          ) : !pdfUrl ? (
            <Spinner center />
          ) : (
            <>
              <div className="flex between mb">
                <strong>{activeDoc.label}</strong>
                <span className="muted">
                  {activeDoc.pageCount} page{activeDoc.pageCount > 1 ? 's' : ''}
                </span>
              </div>
              <div style={{ textAlign: 'center' }}>
                <Document file={pdfUrl} onLoadSuccess={({ numPages: n }) => setNumPages(n)} loading={<Spinner center />}>
                  {Array.from({ length: numPages }, (_, i) => (
                    <div key={i} data-page={i + 1} ref={(el) => (pageRefs.current[i] = el)} className="pdf-stage">
                      <Page pageNumber={i + 1} width={720} renderTextLayer={false} renderAnnotationLayer={false} />
                    </div>
                  ))}
                </Document>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
