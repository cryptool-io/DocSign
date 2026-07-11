import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api.js';
import { useCompany, companyParam } from '../lib/company.js';
import { Spinner } from '../lib/ui.jsx';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const activeId = useCompany((s) => s.activeId);

  useEffect(() => {
    setData(null);
    const q = companyParam();
    api.get(`/analytics/overview${q ? `?${q}` : ''}`).then((r) => setData(r.data.data)).catch(() => setData({}));
  }, [activeId]);

  if (!data) return <Spinner center />;

  const tiles = [
    { l: 'Documents', n: data.documents ?? 0, to: '/documents' },
    { l: 'Share links', n: data.links ?? 0, to: '/documents' },
    { l: 'Total views', n: data.views?.total ?? 0, to: '/documents' },
    { l: 'Views (30d)', n: data.views?.last30Days ?? 0, to: '/documents' },
    { l: 'Signature requests', n: data.envelopes?.total ?? 0, to: '/envelopes' },
    { l: 'Awaiting signature', n: data.pendingSignatures ?? 0, to: '/envelopes' }
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">Your document activity at a glance.</p>
        </div>
        <Link className="btn primary" to="/send">
          + Send for signature
        </Link>
      </div>

      <div className="stats">
        {tiles.map((t) => (
          <Link key={t.l} to={t.to} className="stat" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="n">{t.n}</div>
            <div className="l">{t.l}</div>
          </Link>
        ))}
      </div>

      <div className="card">
        <h2>Get started</h2>
        <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 2 }}>
          <li>
            <Link to="/documents">Upload a PDF</Link> — a pitch deck, SAFE, NDA, or agreement.
          </li>
          <li>Create a tracked share link, or send it for signature with fields placed on the page.</li>
          <li>Watch per-page view time roll in, and download the countersigned PDF with its certificate.</li>
        </ol>
      </div>
    </>
  );
}
