import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import api, { apiError } from '../lib/api.js';
import { withCompany } from '../lib/company.js';
import { ownerFileUrl } from '../lib/keystore.js';
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
// Distinct colors per signer so it's obvious who signs where.
const SIGNER_COLORS = ['#2563eb', '#d97706', '#16a34a', '#9333ea', '#dc2626', '#0891b2'];
const uid = () => Math.random().toString(36).slice(2, 9);

function PageCanvas({ pageNumber, width, fields, activeType, colorFor, labelFor, onAdd, onMove, onRemove, onSelect, selectedId }) {
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
    onSelect(field._id);
    const rect = ref.current.getBoundingClientRect();
    const move = (ev) => {
      const x = (ev.clientX - rect.left) / rect.width - field.width / 2;
      const y = (ev.clientY - rect.top) / rect.height - field.height / 2;
      onMove(field._id, { x: Math.max(0, Math.min(x, 1 - field.width)), y: Math.max(0, Math.min(y, 1 - field.height)) });
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
        .map((f) => {
          const color = colorFor(f.signerRole);
          return (
            <div
              key={f._id}
              className="field-box"
              onMouseDown={(e) => startDrag(e, f)}
              style={{
                left: `${f.x * 100}%`,
                top: `${f.y * 100}%`,
                width: `${f.width * 100}%`,
                height: `${f.height * 100}%`,
                border: `2px solid ${color}`,
                background: `${color}22`,
                color,
                outline: selectedId === f._id ? `2px solid ${color}` : 'none',
                outlineOffset: 2
              }}
              title={`${labelFor(f)} · ${f.type}`}
            >
              <span style={{ fontSize: 10, lineHeight: 1.1, overflow: 'hidden' }}>{f.label || f.type}</span>
              <span className="del" onClick={(e) => { e.stopPropagation(); onRemove(f._id); }}>×</span>
            </div>
          );
        })}
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
  const [signers, setSigners] = useState([{ key: uid(), label: '' }]);
  const [activeSigner, setActiveSigner] = useState(null);
  const [fields, setFields] = useState([]);
  const [activeType, setActiveType] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [pdfData, setPdfData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const d = await api.get('/documents');
      setDocs(d.data.data);
      if (id) {
        const t = await api.get(`/templates/${id}`);
        setName(t.data.data.Name);
        setDocumentId(t.data.data.SourceDocumentId || '');
        const roles = (t.data.data.SignerRoles || []).map((r) => ({ key: r.key, label: r.label }));
        setSigners(roles.length ? roles : [{ key: uid(), label: '' }]);
        setActiveSigner(roles[0]?.key || null);
        setFields(t.data.data.fields.map((f) => ({ ...f, _id: f.id || uid() })));
      } else {
        setActiveSigner((s) => s);
      }
      setLoading(false);
    })();
  }, [id]);

  useEffect(() => {
    // Keep an active signer selected as the list changes.
    if (signers.length && !signers.some((s) => s.key === activeSigner)) setActiveSigner(signers[0].key);
  }, [signers]);

  useEffect(() => {
    if (!documentId) return setPdfData(null);
    let revoked = false;
    const doc = docs.find((d) => d.id === documentId);
    ownerFileUrl(`/documents/${documentId}/file`, doc)
      .then((url) => { if (!revoked) setPdfData(url); })
      .catch(() => toast('Could not load PDF', 'err'));
    return () => { revoked = true; };
  }, [documentId, docs]);

  const signerLabel = (key) => {
    const i = signers.findIndex((s) => s.key === key);
    return i < 0 ? 'Unassigned' : signers[i].label || `Signer ${i + 1}`;
  };
  const colorFor = (key) => {
    const i = signers.findIndex((s) => s.key === key);
    return i < 0 ? '#697280' : SIGNER_COLORS[i % SIGNER_COLORS.length];
  };

  const addSigner = () => setSigners((cur) => [...cur, { key: uid(), label: '' }]);
  const removeSigner = (key) => {
    setSigners((cur) => (cur.length === 1 ? cur : cur.filter((s) => s.key !== key)));
    setFields((cur) => cur.map((f) => (f.signerRole === key ? { ...f, signerRole: null } : f)));
  };
  const setSignerLabel = (key, label) => setSigners((cur) => cur.map((s) => (s.key === key ? { ...s, label } : s)));

  const addField = (f) => {
    if (!activeSigner) return toast('Add and select a signer first.', 'err');
    const _id = uid();
    setFields((cur) => [...cur, { ...f, _id, signerRole: activeSigner, required: true, autoFill: f.type === 'date', label: '' }]);
    setSelectedId(_id);
    setActiveType(null);
  };
  const moveField = (fid, pos) => setFields((cur) => cur.map((f) => (f._id === fid ? { ...f, ...pos } : f)));
  const patchField = (fid, patch) => setFields((cur) => cur.map((f) => (f._id === fid ? { ...f, ...patch } : f)));
  const removeField = (fid) => setFields((cur) => cur.filter((f) => f._id !== fid));

  const save = async () => {
    if (!name.trim()) return toast('Give the template a name.', 'err');
    if (!documentId) return toast('Choose a source document.', 'err');
    if (signers.some((s) => !s.label.trim())) return toast('Give every signer a role name (e.g. Company, Contractor).', 'err');
    const orphan = fields.find((f) => !f.signerRole || !signers.some((s) => s.key === f.signerRole));
    if (orphan) return toast('Every field must be assigned to a signer.', 'err');
    setSaving(true);
    try {
      const payload = {
        name,
        sourceDocumentId: documentId,
        requiresSignature: fields.some((f) => f.type === 'signature' || f.type === 'initials'),
        signerRoles: signers.map((s, i) => ({ key: s.key, label: s.label.trim(), order: i + 1 })),
        fields: fields.map((f) => ({
          type: f.type,
          signerRole: f.signerRole,
          pageNumber: f.pageNumber,
          x: f.x,
          y: f.y,
          width: f.width,
          height: f.height,
          required: f.required !== false,
          autoFill: f.type === 'date' ? f.autoFill === true : false,
          label: f.label || null
        }))
      };
      if (id) await api.patch(`/templates/${id}`, payload);
      else await api.post('/templates', withCompany(payload));
      toast('Template saved');
      nav('/templates');
    } catch (err) {
      toast(apiError(err), 'err');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spinner center />;
  const selected = fields.find((f) => f._id === selectedId) || null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{id ? 'Edit template' : 'New template'}</h1>
          <p className="muted">Define the signers, then place each signer's fields on the document.</p>
        </div>
        <div className="wrap-actions">
          <button className="btn" onClick={() => nav('/templates')}>Cancel</button>
          <button className="btn primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save template'}</button>
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
              {docs.map((d) => (<option key={d.id} value={d.id}>{d.Name}</option>))}
            </select>
          </div>
        </div>
      </div>

      {/* 1 · Signers */}
      <div className="card mb">
        <div className="flex between">
          <h2 style={{ margin: 0 }}>Signers <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>· who signs, and how many</span></h2>
          <button className="btn sm" onClick={addSigner}>+ Add signer</button>
        </div>
        <div className="mt">
          {signers.map((s, i) => (
            <div key={s.key} className="flex" style={{ gap: 10, alignItems: 'center', marginBottom: 8 }}>
              <span style={{ width: 14, height: 14, borderRadius: 3, background: SIGNER_COLORS[i % SIGNER_COLORS.length], flex: '0 0 auto' }} />
              <input
                className="input"
                style={{ maxWidth: 260 }}
                value={s.label}
                onChange={(e) => setSignerLabel(s.key, e.target.value)}
                placeholder={`Signer ${i + 1} role (e.g. Company, Contractor)`}
              />
              <button
                className={`btn sm ${activeSigner === s.key ? 'primary' : ''}`}
                onClick={() => setActiveSigner(s.key)}
                title="Place new fields for this signer"
              >
                {activeSigner === s.key ? 'Placing for this signer' : 'Place fields'}
              </button>
              <button className="btn sm danger" disabled={signers.length === 1} onClick={() => removeSigner(s.key)}>Remove</button>
            </div>
          ))}
        </div>
      </div>

      {/* 2 · Fields toolbar */}
      <div className="card mb">
        <div className="flex" style={{ flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <span className="muted">Add field for <strong style={{ color: colorFor(activeSigner) }}>{signerLabel(activeSigner)}</strong>:</span>
          {FIELD_TYPES.map((ft) => (
            <button key={ft.type} className={`btn sm ${activeType === ft.type ? 'primary' : ''}`} onClick={() => setActiveType(activeType === ft.type ? null : ft.type)}>
              {ft.label}
            </button>
          ))}
          {activeType && <span className="badge blue">Click on the page to place</span>}
        </div>
      </div>

      {!pdfData ? (
        <div className="empty">Choose a source document to place fields.</div>
      ) : (
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
            <Document file={pdfData} onLoadSuccess={({ numPages: n }) => setNumPages(n)} loading={<Spinner center />}>
              {Array.from({ length: numPages }, (_, i) => (
                <PageCanvas
                  key={i}
                  pageNumber={i + 1}
                  width={640}
                  fields={fields}
                  activeType={activeType}
                  colorFor={colorFor}
                  labelFor={(f) => signerLabel(f.signerRole)}
                  onAdd={addField}
                  onMove={moveField}
                  onRemove={removeField}
                  onSelect={setSelectedId}
                  selectedId={selectedId}
                />
              ))}
            </Document>
          </div>

          {/* Field settings — pinned right so they stay in view while scrolling. */}
          <div style={{ width: 290, flexShrink: 0, position: 'sticky', top: 12, alignSelf: 'flex-start' }}>
            <div className="card" style={{ background: 'var(--panel, #fafafa)', textAlign: 'left' }}>
              {selected ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label style={{ textTransform: 'capitalize' }}>Field · {selected.type} — who signs it?</label>
                    <select className="select" value={selected.signerRole || ''} onChange={(e) => patchField(selected._id, { signerRole: e.target.value })}>
                      {signers.map((s, i) => (<option key={s.key} value={s.key}>{s.label || `Signer ${i + 1}`}</option>))}
                    </select>
                  </div>
                  {selected.type === 'text' && (
                    <div className="field" style={{ marginBottom: 0 }}>
                      <label>What is this box for?</label>
                      <input className="input" value={selected.label || ''} onChange={(e) => patchField(selected._id, { label: e.target.value })} placeholder="e.g. Full name, Address, Company" />
                    </div>
                  )}
                  {selected.type === 'date' && (
                    <label className="checkbox" style={{ margin: 0 }}>
                      <input type="checkbox" checked={selected.autoFill !== false} onChange={(e) => patchField(selected._id, { autoFill: e.target.checked })} />
                      Auto-fill with the signing date (locked)
                    </label>
                  )}
                  <label className="checkbox" style={{ margin: 0 }}>
                    <input type="checkbox" checked={selected.required !== false} onChange={(e) => patchField(selected._id, { required: e.target.checked })} />
                    Required
                  </label>
                  <button className="btn sm danger" onClick={() => { removeField(selected._id); setSelectedId(null); }}>Remove field</button>
                </div>
              ) : (
                <div className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
                  <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>Field settings</div>
                  Click a placed field on the page to choose who signs it, label a text box, set required, or remove it.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
