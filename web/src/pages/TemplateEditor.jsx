import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import api, { apiError, getAccessToken } from '../lib/api.js';
import { Document, Page } from '../lib/pdf.js';
import { Spinner, useToast } from '../lib/ui.jsx';

const FIELD_TYPES = [
  { type: 'signature', label: 'Signature' },
  { type: 'initials', label: 'Initials' },
  { type: 'date', label: 'Date' },
  { type: 'text', label: 'Text' },
  { type: 'checkbox', label: 'Checkbox' }
];
const DEFAULT_SIZE = { signature: [0.22, 0.06], initials: [0.1, 0.05], date: [0.16, 0.04], text: [0.2, 0.04], checkbox: [0.04, 0.03] };

/**
 * Renders one PDF page and lets the user click-to-drop and drag fields.
 * Coordinates are stored as fractions of page size so they survive any zoom.
 */
function PageCanvas({ pageNumber, width, fields, activeType, onAdd, onMove, onRemove }) {
  const ref = useRef();

  const onClick = (e) => {
    if (!activeType) return;
    const rect = ref.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const [w, h] = DEFAULT_SIZE[activeType];
    onAdd({ type: activeType, pageNumber, x: Math.min(x, 1 - w), y: Math.min(y, 1 - h), width: w, height: h });
  };

  const startDrag = (e, field) => {
    e.stopPropagation();
    const rect = ref.current.getBoundingClientRect();
    const move = (ev) => {
      const x = (ev.clientX - rect.left) / rect.width - field.width / 2;
      const y = (ev.clientY - rect.top) / rect.height - field.height / 2;
      onMove(field._id, {
        x: Math.max(0, Math.min(x, 1 - field.width)),
        y: Math.max(0, Math.min(y, 1 - field.height))
      });
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <div className="pdf-page-wrap" ref={ref} onClick={onClick} style={{ cursor: activeType ? 'crosshair' : 'default' }}>
      <Page pageNumber={pageNumber} width={width} renderTextLayer={false} renderAnnotationLayer={false} />
      {fields
        .filter((f) => f.pageNumber === pageNumber)
        .map((f) => (
          <div
            key={f._id}
            className="field-box"
            onMouseDown={(e) => startDrag(e, f)}
            style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.width * 100}%`, height: `${f.height * 100}%` }}
          >
            {f.type}
            <span className="del" onClick={(e) => { e.stopPropagation(); onRemove(f._id); }}>
              ×
            </span>
          </div>
        ))}
    </div>
  );
}

export default function TemplateEditor() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();

  const [docs, setDocs] = useState([]);
  const [documentId, setDocumentId] = useState(params.get('documentId') || '');
  const [name, setName] = useState('');
  const [fields, setFields] = useState([]);
  const [activeType, setActiveType] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [pdfData, setPdfData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Load documents for the picker, and the template if editing.
  useEffect(() => {
    (async () => {
      const d = await api.get('/documents');
      setDocs(d.data.data);
      if (id) {
        const t = await api.get(`/templates/${id}`);
        setName(t.data.data.Name);
        setDocumentId(t.data.data.SourceDocumentId || '');
        setFields(t.data.data.fields.map((f) => ({ ...f, _id: f.id || Math.random().toString(36).slice(2) })));
      }
      setLoading(false);
    })();
  }, [id]);

  // Fetch the chosen PDF as a blob (with auth header) for react-pdf.
  useEffect(() => {
    if (!documentId) return setPdfData(null);
    let revoked = false;
    api
      .get(`/documents/${documentId}/file`, { responseType: 'blob' })
      .then((r) => {
        if (revoked) return;
        setPdfData(URL.createObjectURL(r.data));
      })
      .catch(() => toast('Could not load PDF', 'err'));
    return () => {
      revoked = true;
    };
  }, [documentId]);

  const addField = (f) => {
    setFields((cur) => [...cur, { ...f, _id: Math.random().toString(36).slice(2), required: true }]);
    setActiveType(null);
  };
  const moveField = (fid, pos) => setFields((cur) => cur.map((f) => (f._id === fid ? { ...f, ...pos } : f)));
  const removeField = (fid) => setFields((cur) => cur.filter((f) => f._id !== fid));

  const save = async () => {
    if (!name.trim()) return toast('Give the template a name.', 'err');
    if (!documentId) return toast('Choose a source document.', 'err');
    setSaving(true);
    try {
      const payload = {
        name,
        sourceDocumentId: documentId,
        requiresSignature: fields.some((f) => f.type === 'signature' || f.type === 'initials'),
        fields: fields.map(({ _id, id: _ignore, ...f }) => f)
      };
      if (id) await api.patch(`/templates/${id}`, payload);
      else await api.post('/templates', payload);
      toast('Template saved');
      nav('/templates');
    } catch (err) {
      toast(apiError(err), 'err');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spinner center />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{id ? 'Edit template' : 'New template'}</h1>
          <p className="muted">Place signature and data fields on the document.</p>
        </div>
        <div className="wrap-actions">
          <button className="btn" onClick={() => nav('/templates')}>
            Cancel
          </button>
          <button className="btn primary" disabled={saving} onClick={save}>
            {saving ? 'Saving…' : 'Save template'}
          </button>
        </div>
      </div>

      <div className="card mb">
        <div className="row">
          <div className="field">
            <label>Template name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mutual NDA" />
          </div>
          <div className="field">
            <label>Source document</label>
            <select className="select" value={documentId} onChange={(e) => setDocumentId(e.target.value)} disabled={!!id}>
              <option value="">Choose a PDF…</option>
              {docs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.Name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex" style={{ flexWrap: 'wrap' }}>
          <span className="muted">Add field:</span>
          {FIELD_TYPES.map((ft) => (
            <button
              key={ft.type}
              className={`btn sm ${activeType === ft.type ? 'primary' : ''}`}
              onClick={() => setActiveType(activeType === ft.type ? null : ft.type)}
            >
              {ft.label}
            </button>
          ))}
          {activeType && <span className="badge blue">Click on the page to place</span>}
        </div>
      </div>

      {!pdfData ? (
        <div className="empty">Choose a source document to place fields.</div>
      ) : (
        <div style={{ textAlign: 'center' }}>
          <Document file={pdfData} onLoadSuccess={({ numPages: n }) => setNumPages(n)} loading={<Spinner center />}>
            {Array.from({ length: numPages }, (_, i) => (
              <PageCanvas
                key={i}
                pageNumber={i + 1}
                width={640}
                fields={fields}
                activeType={activeType}
                onAdd={addField}
                onMove={moveField}
                onRemove={removeField}
              />
            ))}
          </Document>
        </div>
      )}
    </>
  );
}
