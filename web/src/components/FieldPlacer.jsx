import { useEffect, useRef, useState } from 'react';
import { ownerFileUrl } from '../lib/keystore.js';
import { Document, Page } from '../lib/pdf.js';
import { Spinner } from '../lib/ui.jsx';

export const FIELD_TYPES = [
  { type: 'signature', label: 'Signature' },
  { type: 'initials', label: 'Initials' },
  { type: 'date', label: 'Date' },
  { type: 'text', label: 'Text' },
  { type: 'checkbox', label: 'Checkbox' }
];

// Default field size as a fraction of page dimensions. Text/date boxes are sized
// to their text height (not oversized) — see heightForFont.
const DEFAULT_SIZE = {
  signature: [0.24, 0.05],
  initials: [0.1, 0.04],
  date: [0.16, 0.022],
  text: [0.22, 0.022],
  checkbox: [0.035, 0.022]
};

export const FONTS = ['Helvetica', 'Times', 'Courier'];
const TEXTY = (t) => t === 'text' || t === 'date';
// Box height (page fraction) that fits `fs`pt text on a ~letter page.
const heightForFont = (fs) => Math.min(0.15, Math.max(0.014, (fs * 1.55) / 792));

// Distinct colors per signer so it's obvious who signs where.
export const SIGNER_COLORS = ['#2563eb', '#d97706', '#16a34a', '#9333ea', '#dc2626', '#0891b2'];

const PAGE_WIDTH = 680;

function PageOverlay({ pageNumber, fields, onAdd, onMove, onResize, onRemove, onSelect, selectedId, activeType, colorFor }) {
  const ref = useRef();

  // Drag the bottom-right handle to resize (e.g. widen a box for long text).
  const startResize = (e, field) => {
    e.stopPropagation();
    onSelect(field._id);
    const rect = ref.current.getBoundingClientRect();
    const move = (ev) => {
      const right = (ev.clientX - rect.left) / rect.width;
      const bottom = (ev.clientY - rect.top) / rect.height;
      onResize(field._id, {
        width: Math.max(0.03, Math.min(right - field.x, 1 - field.x)),
        height: Math.max(0.012, Math.min(bottom - field.y, 1 - field.y))
      });
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const dropHere = (e) => {
    if (!activeType) return;
    const rect = ref.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const [w, h] = DEFAULT_SIZE[activeType];
    onAdd({ pageNumber, x: Math.max(0, Math.min(x - w / 2, 1 - w)), y: Math.max(0, Math.min(y - h / 2, 1 - h)), width: w, height: h });
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
    <div className="pdf-page-wrap pdf-stage" ref={ref} onClick={dropHere} style={{ cursor: activeType ? 'crosshair' : 'default' }}>
      <Page pageNumber={pageNumber} width={PAGE_WIDTH} renderTextLayer={false} renderAnnotationLayer={false} />
      {fields
        .filter((f) => f.pageNumber === pageNumber)
        .map((f) => {
          const color = colorFor(f);
          return (
            <div
              key={f._id}
              onMouseDown={(e) => startDrag(e, f)}
              onClick={(e) => { e.stopPropagation(); onSelect(f._id); }}
              style={{
                position: 'absolute',
                left: `${f.x * 100}%`,
                top: `${f.y * 100}%`,
                width: `${f.width * 100}%`,
                height: `${f.height * 100}%`,
                border: `2px solid ${color}`,
                background: `${color}22`,
                borderRadius: 4,
                cursor: 'move',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 10,
                fontWeight: 600,
                color,
                userSelect: 'none',
                overflow: 'visible',
                outline: selectedId === f._id ? `2px solid ${color}` : 'none',
                outlineOffset: 2
              }}
              title={f.required === false ? `${f.label || f.type} (optional)` : `${f.label || f.type} (required)`}
            >
              {(f.label || f.type)}{f.required === false ? '' : ' *'}
              <span
                onClick={(e) => { e.stopPropagation(); onRemove(f._id); }}
                style={{ position: 'absolute', top: -9, right: -9, width: 18, height: 18, borderRadius: '50%', background: '#dc2626', color: '#fff', display: 'grid', placeItems: 'center', cursor: 'pointer', fontSize: 12 }}
              >
                ×
              </span>
              <span
                onMouseDown={(e) => startResize(e, f)}
                onClick={(e) => e.stopPropagation()}
                title="Drag to resize"
                style={{ position: 'absolute', bottom: -5, right: -5, width: 12, height: 12, background: '#fff', border: `2px solid ${color}`, borderRadius: 2, cursor: 'nwse-resize' }}
              />
            </div>
          );
        })}
    </div>
  );
}

/**
 * Renders a PDF and lets the user drop/drag/remove fields on it, and configure
 * each one (required, label, auto-date). Field coordinates are fractions of page
 * size so they survive any scale. `signers` supplies the assignment palette.
 */
export default function FieldPlacer({ documentId, doc, fields, setFields, activeType, setActiveType, activeSignerEmail, colorFor }) {
  const [pdfUrl, setPdfUrl] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [err, setErr] = useState(null);
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    if (!documentId) {
      setPdfUrl(null);
      return;
    }
    let dead = false;
    setPdfUrl(null);
    ownerFileUrl(`/documents/${documentId}/file`, doc)
      .then((url) => { if (!dead) setPdfUrl(url); })
      .catch(() => setErr('Could not load the PDF.'));
    return () => { dead = true; };
  }, [documentId]);

  // Nudge the selected field with the arrow keys (~1px; Shift = ~10px), for
  // pixel-precise positioning without dragging.
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
      const stepX = mult / PAGE_WIDTH;
      const stepY = mult / (PAGE_WIDTH * 1.294); // ~letter aspect
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
  }, [selectedId, setFields]);

  const addField = (partial) => {
    const _id = Math.random().toString(36).slice(2);
    const texty = TEXTY(activeType);
    setFields((cur) => [
      ...cur,
      {
        _id,
        type: activeType,
        signerEmail: activeSignerEmail || null,
        required: true,
        autoFill: activeType === 'date',
        label: '',
        ...(texty ? { fontSize: 11, font: 'Helvetica' } : {}),
        ...partial
      }
    ]);
    setSelectedId(_id); // select the new field so its options show immediately
    // Stay in "place" mode so you can drop several of the same type (e.g. a date
    // for each signer). Clicking an existing field selects it (stopPropagation);
    // click the field-type button again to stop placing.
  };
  const moveField = (id, pos) => setFields((cur) => cur.map((f) => (f._id === id ? { ...f, ...pos } : f)));
  const resizeField = (id, size) => setFields((cur) => cur.map((f) => (f._id === id ? { ...f, ...size } : f)));
  const patchField = (id, patch) => setFields((cur) => cur.map((f) => (f._id === id ? { ...f, ...patch } : f)));
  const setFieldFontSize = (id, fs) => patchField(id, { fontSize: fs, height: heightForFont(fs) });
  const removeField = (id) => setFields((cur) => cur.filter((f) => f._id !== id));

  if (err) return <div className="empty">{err}</div>;
  if (!documentId) return <div className="empty">Choose a document above to place fields.</div>;
  if (!pdfUrl) return <Spinner center />;

  const selected = fields.find((f) => f._id === selectedId) || null;

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
        <Document file={pdfUrl} onLoadSuccess={({ numPages: n }) => setNumPages(n)} loading={<Spinner center />}>
          {Array.from({ length: numPages }, (_, i) => (
            <PageOverlay
              key={i}
              pageNumber={i + 1}
              fields={fields}
              onAdd={addField}
              onMove={moveField}
              onResize={resizeField}
              onRemove={removeField}
              onSelect={setSelectedId}
              selectedId={selectedId}
              activeType={activeType}
              colorFor={colorFor}
            />
          ))}
        </Document>
      </div>

      {/* Field settings — pinned to the right so they stay in view while you
          scroll the document. Shows the selected field's options, or a hint. */}
      <div style={{ width: 290, flexShrink: 0, position: 'sticky', top: 12, alignSelf: 'flex-start' }}>
        <div className="card" style={{ background: 'var(--panel, #fafafa)', textAlign: 'left' }}>
          {selected ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontWeight: 600, fontSize: 13, textTransform: 'capitalize' }}>Field · {selected.type}</div>
              <label className="checkbox" style={{ margin: 0 }}>
                <input type="checkbox" checked={selected.required !== false} onChange={(e) => patchField(selected._id, { required: e.target.checked })} />
                Mandatory (required to sign)
              </label>
              {selected.type === 'text' && (
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>What is this box for?</label>
                  <input className="input" value={selected.label || ''} onChange={(e) => patchField(selected._id, { label: e.target.value })} placeholder="e.g. Full name, Address" />
                </div>
              )}
              {TEXTY(selected.type) && (
                <div className="flex" style={{ gap: 8 }}>
                  <div className="field" style={{ marginBottom: 0, maxWidth: 92 }}>
                    <label>Size (pt)</label>
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
                  Auto-fill with the signing date
                </label>
              )}
              <div className="muted" style={{ fontSize: 12 }}>Tip: arrow keys nudge it 1px (Shift = 10px).</div>
              <button className="btn sm danger" onClick={() => { removeField(selected._id); setSelectedId(null); }}>Remove field</button>
            </div>
          ) : (
            <div className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
              <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>Field settings</div>
              Click a placed field on the document to set whether it's required, label a text box, or remove it.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
