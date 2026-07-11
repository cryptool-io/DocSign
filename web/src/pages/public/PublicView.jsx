import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { Document, Page } from '../../lib/pdf.js';
import { decryptToBlob } from '../../lib/keystore.js';
import { keyFromHash } from '../../lib/linkkey.js';
import { Spinner } from '../../lib/ui.jsx';

// Standalone axios (no app auth interceptors) for the public surface.
const pub = axios.create({ baseURL: '/api' });

export default function PublicView() {
  const { token } = useParams();
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [session, setSession] = useState(null); // { viewerToken, sessionId, linkId, allowDownload }
  const [pdfUrl, setPdfUrl] = useState(null);
  const [numPages, setNumPages] = useState(0);

  // Per-page dwell tracking.
  const pageSeconds = useRef({});
  const visiblePage = useRef(1);

  useEffect(() => {
    pub
      .get(`/view/${token}/meta`)
      .then((r) => setMeta(r.data.data))
      .catch((e) => setError(e.response?.data?.error || 'This link is unavailable.'));
  }, [token]);

  const open = async (e) => {
    e?.preventDefault();
    setError(null);
    try {
      const { data } = await pub.post(`/view/${token}/open`, { email: email || null, password: password || null });
      const linkId = await resolveLinkId(data.data.viewerToken);
      setSession({ ...data.data, linkId });
    } catch (err) {
      setError(err.response?.data?.error || 'Could not open the document.');
    }
  };

  // The viewer token is bound to the link; we need the internal linkId for file
  // + heartbeat routes. Decode it from the JWT payload (unverified — just to read the id).
  const resolveLinkId = async (viewerToken) => {
    try {
      const payload = JSON.parse(atob(viewerToken.split('.')[1]));
      return payload.linkId;
    } catch {
      return null;
    }
  };

  // Fetch the PDF once we have a session. If it's encrypted, decrypt with the
  // key from the link fragment (which never reached the server).
  useEffect(() => {
    if (!session?.linkId) return;
    pub
      .get(`/view/link/${session.linkId}/file`, {
        responseType: 'arraybuffer',
        headers: { Authorization: `Bearer ${session.viewerToken}` }
      })
      .then(async (r) => {
        const encrypted = r.headers['x-docsign-encrypted'] === 'true';
        if (encrypted) {
          const dekB64 = keyFromHash();
          if (!dekB64) return setError('This link is missing its decryption key.');
          const blob = await decryptToBlob(r.data, dekB64);
          setPdfUrl(URL.createObjectURL(blob));
        } else {
          setPdfUrl(URL.createObjectURL(new Blob([r.data], { type: 'application/pdf' })));
        }
      })
      .catch(() => setError('Could not load the document.'));
  }, [session]);

  // Tick the visible page's counter every second.
  useEffect(() => {
    if (!session) return;
    const iv = setInterval(() => {
      const p = visiblePage.current;
      pageSeconds.current[p] = (pageSeconds.current[p] || 0) + 1;
    }, 1000);
    return () => clearInterval(iv);
  }, [session]);

  // Flush dwell times to the server periodically and on unload.
  const flush = useCallback(() => {
    if (!session) return;
    const pages = Object.entries(pageSeconds.current).map(([page, seconds]) => ({ page: Number(page), seconds }));
    if (!pages.length) return;
    pub
      .post(
        `/view/link/${session.linkId}/heartbeat`,
        { sessionId: session.sessionId, pages },
        { headers: { Authorization: `Bearer ${session.viewerToken}` } }
      )
      .catch(() => {});
  }, [session]);

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

  // Track which page is centered in the viewport.
  const pageRefs = useRef([]);
  useEffect(() => {
    if (!numPages) return;
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) visiblePage.current = Number(en.target.dataset.page);
        });
      },
      { threshold: 0.5 }
    );
    pageRefs.current.forEach((el) => el && obs.observe(el));
    return () => obs.disconnect();
  }, [numPages]);

  if (error && !meta) return <div className="public-center"><div className="card center-narrow"><h1>Unavailable</h1><p className="muted">{error}</p></div></div>;
  if (!meta) return <Spinner center />;

  // Gate screen.
  if (!session) {
    return (
      <div className="public-center">
        <form className="card center-narrow" onSubmit={open}>
          <div className="brand" style={{ padding: '0 0 12px' }}>
            <span>DocSign</span>
          </div>
          <h1>{meta.name}</h1>
          <p className="muted mb">You've been invited to view this document.</p>
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
          <button className="btn primary block">View document</button>
        </form>
      </div>
    );
  }

  return (
    <div className="public-wrap">
      <div className="flex between mb">
        <strong>{meta.documentName}</strong>
        <span className="muted">
          {meta.pageCount} page{meta.pageCount > 1 ? 's' : ''}
        </span>
      </div>
      {!pdfUrl ? (
        <Spinner center />
      ) : (
        <div style={{ textAlign: 'center' }}>
          <Document file={pdfUrl} onLoadSuccess={({ numPages: n }) => setNumPages(n)} loading={<Spinner center />}>
            {Array.from({ length: numPages }, (_, i) => (
              <div key={i} data-page={i + 1} ref={(el) => (pageRefs.current[i] = el)} className="pdf-stage">
                <Page pageNumber={i + 1} width={760} renderTextLayer={false} renderAnnotationLayer={false} />
              </div>
            ))}
          </Document>
        </div>
      )}
    </div>
  );
}
