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
const DEFAULT_SIZE = { signature: [0.22, 0.05], initials: [0.1, 0.04], date: [0.14, 0.022], text: [0.2, 0.022], checkbox: [0.03, 0.022] };
// Distinct colors per signer so it's obvious who signs where.
const SIGNER_COLORS = ['#2563eb', '#d97706', '#16a34a', '#9333ea', '#dc2626', '#0891b2'];
const uid = () => Math.random().toString(36).slice(2, 9);
const FONTS = ['Helvetica', 'Times', 'Courier'];
const TEXTY = (t) => t === 'text' || t === 'date';
// Box height (as a page fraction) that fits `fs` point text on a ~letter page,
// so the placed box matches the size of the text that will be stamped in it.
const heightForFont = (fs) => Math.min(0.15, Math.max(0.014, (fs * 1.55) / 792));

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
              onClick={(e) => { e.stopPropagation(); onSelect(f._id); }}
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

  // Nudge the selected field with the arrow keys (~1px; Shift = ~10px).
  useEffect(() => {
    const onKey = (e) => {
      if (!selectedId) return;
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
      const dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const d = dirs[e.key];
      if (!d) return;
      e.preventDefault();
      const mult = e.shiftKey ? 10 : 1;
      const stepX = mult / 640; // PageCanvas render width
      const stepY = mult / (640 * 1.294);
      setFields((cur) =>
        cur.map((f) =>
          f._id === selectedId
            ? {
                ...f,
                x: Math.max(0, Math.min(f.x + d[0] * stepX, 1 - f.width)),
                y: Math.max(0, Math.min(f.y + d[1] * stepY, 1 - f.height))
              }
            : f
        )
      );
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId]);

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
    const texty = TEXTY(f.type);
    setFields((cur) => [
      ...cur,
      {
        ...f,
        _id,
        signerRole: activeSigner,
        required: true,
        autoFill: f.type === 'date',
        label: '',
        ...(texty ? { fontSize: 11, font: 'Helvetica', height: heightForFont(11) } : {})
      }
    ]);
    setSelectedId(_id);
    // Stay in place mode so you can drop several of the same type (e.g. a date
    // for each signer). Click an existing field to select it; click the field
    // button again to stop placing.
  };
  // Changing the text size also resizes the box so it matches the stamped text.
  const setFieldFontSize = (fid, fs) => patchField(fid, { fontSize: fs, height: heightForFont(fs) });
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
          fontSize: TEXTY(f.type) ? f.fontSize || 11 : null,
          font: TEXTY(f.type) ? f.font || 'Helvetica' : null,
          label: f.label || null
        }))
      };
      if (id) await api.patch(`/templates/${id}`, payload);
      else await api.post('/templates', withCompany(payload));
      toast('Signing setup saved');
      nav('/documents');
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
          <h1>{id ? 'Edit signing fields' : 'Set up signing fields'}</h1>
          <p className="muted">Define the signers, then place each signer's fields on the document. This saves as a reusable setup for the document.</p>
        </div>
        <div className="wrap-actions">
          <button className="btn" onClick={() => nav('/documents')}>Cancel</button>
          <button className="btn primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save signing fields'}</button>
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

          {/* Add-field palette + field settings — pinned right so they stay in
              view while scrolling through the pages. */}
          <div style={{ width: 290, flexShrink: 0, position: 'sticky', top: 12, alignSelf: 'flex-start', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="card" style={{ background: 'var(--panel, #fafafa)', textAlign: 'left' }}>
              <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
                Add field for <strong style={{ color: colorFor(activeSigner) }}>{signerLabel(activeSigner)}</strong>
              </div>
              <div className="flex" style={{ flexWrap: 'wrap', gap: 6 }}>
                {FIELD_TYPES.map((ft) => (
                  <button key={ft.type} className={`btn sm ${activeType === ft.type ? 'primary' : ''}`} onClick={() => setActiveType(activeType === ft.type ? null : ft.type)}>
                    {ft.label}
                  </button>
                ))}
              </div>
              {activeType && <div className="badge blue" style={{ marginTop: 8, display: 'inline-block' }}>Click on the page to place</div>}
            </div>

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
                  {TEXTY(selected.type) && (
                    <div className="flex" style={{ gap: 8 }}>
                      <div className="field" style={{ marginBottom: 0, maxWidth: 100 }}>
                        <label>Text size (pt)</label>
                        <input
                          type="number"
                          className="input"
                          min={6}
                          max={72}
                          value={selected.fontSize || 11}
                          onChange={(e) => setFieldFontSize(selected._id, Math.max(6, Math.min(72, Number(e.target.value) || 11)))}
                        />
                      </div>
                      <div className="field" style={{ marginBottom: 0, flex: 1 }}>
                        <label>Font</label>
                        <select className="select" value={selected.font || 'Helvetica'} onChange={(e) => patchField(selected._id, { font: e.target.value })}>
                          {FONTS.map((f) => (
                            <option key={f} value={f}>{f}</option>
                          ))}
                        </select>
                      </div>
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
                  <div className="muted" style={{ fontSize: 12 }}>Tip: arrow keys nudge it 1px (Shift = 10px).</div>
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
