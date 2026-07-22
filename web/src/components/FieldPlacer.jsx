import { useEffect, useRef, useState } from 'react';
import { ownerFileUrl } from '../lib/keystore.js';
import { Document, Page } from '../lib/pdf.js';
import { Spinner } from '../lib/ui.jsx';
import { DATE_FORMAT_OPTIONS, DEFAULT_DATE_FORMAT } from '../lib/dateformat.js';
import { fontFamilyFor, sampleValue, CURSIVE_FONT } from '../lib/fieldpreview.js';

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

// Widest we'll ever render a page. On narrower screens the page is rendered at
// whatever the stage column actually measures — see useStageWidth.
export const MAX_PAGE_WIDTH = 680;

/**
 * Width to render PDF pages at: the container's own width, capped. Re-measures
 * on resize/rotate, so the same code covers desktop, tablet and phone.
 */
export function useStageWidth(max = MAX_PAGE_WIDTH) {
  const ref = useRef(null);
  const [width, setWidth] = useState(max);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(240, Math.min(el.clientWidth, max)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [max]);
  return [ref, width];
}

function PageOverlay({ pageNumber, pageWidth, fields, onAdd, onMove, onResize, onRemove, onSelect, selectedId, activeType, colorFor }) {
  const ref = useRef();
  // Native page size (PDF points) → screen scale, so preview text is drawn at the
  // same point size the PDF will stamp. Falls back to US-Letter width until loaded.
  const [pageDims, setPageDims] = useState(null);
  const ptToPx = pageWidth / (pageDims?.w || 612);
  const pageHeightPx = pageWidth * ((pageDims?.h || 792) / (pageDims?.w || 612));

  // Drag the bottom-right handle to resize (e.g. widen a box for long text).
  // Pointer events so this works with a mouse, a pen and a finger alike.
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
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const dropHere = (e) => {
    // Clicking empty page area: place a field if a type is active, else deselect.
    if (!activeType) return onSelect(null);
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
    // Grab offset within the field, so it doesn't jump to center under the cursor.
    const grabX = (e.clientX - rect.left) / rect.width - field.x;
    const grabY = (e.clientY - rect.top) / rect.height - field.y;
    const start = { x: e.clientX, y: e.clientY };
    let dragging = false;
    const move = (ev) => {
      // Ignore tiny movements so a plain click doesn't nudge the field.
      if (!dragging && Math.abs(ev.clientX - start.x) + Math.abs(ev.clientY - start.y) < 3) return;
      dragging = true;
      const x = (ev.clientX - rect.left) / rect.width - grabX;
      const y = (ev.clientY - rect.top) / rect.height - grabY;
      onMove(field._id, { x: Math.max(0, Math.min(x, 1 - field.width)), y: Math.max(0, Math.min(y, 1 - field.height)) });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  return (
    <div className="pdf-page-wrap pdf-stage" ref={ref} onClick={dropHere} style={{ cursor: activeType ? 'crosshair' : 'default' }}>
      <Page
        pageNumber={pageNumber}
        width={pageWidth}
        renderTextLayer={false}
        renderAnnotationLayer={false}
        onLoadSuccess={(page) => setPageDims({ w: page.originalWidth, h: page.originalHeight })}
      />
      {fields
        .filter((f) => f.pageNumber === pageNumber)
        .map((f) => {
          const color = colorFor(f);
          const boxHeightPx = f.height * pageHeightPx;
          // Signatures/initials stamp as an image fit to the box, so size the
          // preview to the box height; text/date use the field's point size.
          const previewPx =
            f.type === 'signature' || f.type === 'initials'
              ? Math.max(8, boxHeightPx * 0.62)
              : Math.max(6, (f.fontSize || 11) * ptToPx);
          const cursive = f.type === 'signature' || f.type === 'initials';
          return (
            <div
              key={f._id}
              onPointerDown={(e) => startDrag(e, f)}
              onClick={(e) => { e.stopPropagation(); onSelect(f._id); }}
              style={{
                // Stop a finger-drag on the field from scrolling the page.
                touchAction: 'none',
                position: 'absolute',
                left: `${f.x * 100}%`,
                top: `${f.y * 100}%`,
                width: `${f.width * 100}%`,
                height: `${f.height * 100}%`,
                border: `1px solid ${color}`,
                background: `${color}14`,
                borderRadius: 3,
                cursor: 'move',
                display: 'flex',
                alignItems: 'center',
                // Left-align to match the stamped PDF (drawn at the box's left edge).
                justifyContent: 'flex-start',
                padding: '0 2px',
                userSelect: 'none',
                // Clip the sample so a too-narrow box visibly cuts text off — a cue
                // to widen it before sending.
                overflow: 'hidden',
                outline: selectedId === f._id ? `2px solid ${color}` : 'none',
                outlineOffset: 2
              }}
              title={f.required === false ? `${f.label || f.type} (optional)` : `${f.label || f.type} (required)`}
            >
              {/* Field label + signer colour, floated above so it never covers the preview. */}
              <span
                style={{
                  position: 'absolute',
                  top: -14,
                  left: -1,
                  fontSize: 9,
                  lineHeight: '13px',
                  fontWeight: 600,
                  color: '#fff',
                  background: color,
                  padding: '0 4px',
                  borderRadius: 3,
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none'
                }}
              >
                {(f.label || f.type)}{f.required === false ? '' : ' *'}
              </span>
              {/* WYSIWYG sample of the filled value. */}
              <span
                style={{
                  fontSize: previewPx,
                  fontFamily: cursive ? CURSIVE_FONT : fontFamilyFor(f.font),
                  color: '#1a1a2e',
                  whiteSpace: 'nowrap',
                  lineHeight: 1
                }}
              >
                {sampleValue(f)}
              </span>
              <span
                className="fp-del"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onRemove(f._id); }}
                style={{ background: '#dc2626' }}
              >
                ×
              </span>
              <span
                className="fp-resize"
                onPointerDown={(e) => startResize(e, f)}
                onClick={(e) => e.stopPropagation()}
                title="Drag to resize"
                style={{ borderColor: color }}
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
export default function FieldPlacer({ documentId, doc, fields, setFields, activeType, setActiveType, activeSignerEmail, signers = [], colorFor }) {
  const [pdfUrl, setPdfUrl] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [err, setErr] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [stageRef, pageWidth] = useStageWidth();

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
      const stepX = mult / pageWidth;
      const stepY = mult / (pageWidth * 1.294); // ~letter aspect
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
  }, [selectedId, setFields, pageWidth]);

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
        ...(activeType === 'date' ? { dateFormat: DEFAULT_DATE_FORMAT } : {}),
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
    <div className="editor-split">
      <div className="editor-stage" ref={stageRef}>
        <Document file={pdfUrl} onLoadSuccess={({ numPages: n }) => setNumPages(n)} loading={<Spinner center />}>
          {Array.from({ length: numPages }, (_, i) => (
            <PageOverlay
              key={i}
              pageNumber={i + 1}
              pageWidth={pageWidth}
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
      <div className="editor-panel">
        <div className="card" style={{ background: 'var(--panel, #fafafa)', textAlign: 'left' }}>
          {selected ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontWeight: 600, fontSize: 13, textTransform: 'capitalize' }}>Field · {selected.type}</div>
              {signers.length > 1 && (
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Signed by</label>
                  <select
                    className="select"
                    value={selected.signerEmail || ''}
                    onChange={(e) => patchField(selected._id, { signerEmail: e.target.value, signerRole: null })}
                  >
                    {signers.map((s) => (
                      <option key={s.email} value={s.email}>{s.name || s.email}</option>
                    ))}
                  </select>
                </div>
              )}
              <label className="checkbox" style={{ margin: 0 }}>
                <input type="checkbox" checked={selected.required !== false} onChange={(e) => patchField(selected._id, { required: e.target.checked })} />
                Mandatory (required to sign)
              </label>
              {selected.type === 'signature' && (
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Signature style</label>
                  <select className="select" value={selected.signatureMode || 'any'} onChange={(e) => patchField(selected._id, { signatureMode: e.target.value })}>
                    <option value="any">Type or draw (signer chooses)</option>
                    <option value="draw">Must hand-draw</option>
                    <option value="type">Typed name only</option>
                  </select>
                </div>
              )}
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
                <>
                  <label className="checkbox" style={{ margin: 0 }}>
                    <input type="checkbox" checked={selected.autoFill !== false} onChange={(e) => patchField(selected._id, { autoFill: e.target.checked })} />
                    Auto-fill with the signing date
                  </label>
                  <div className="field" style={{ marginBottom: 0, flex: 1, minWidth: 150 }}>
                    <label>Date format</label>
                    <select
                      className="select"
                      value={selected.dateFormat || DEFAULT_DATE_FORMAT}
                      onChange={(e) => patchField(selected._id, { dateFormat: e.target.value })}
                    >
                      {DATE_FORMAT_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}
              <div className="field" style={{ marginBottom: 0, maxWidth: 130 }}>
                <label>Box height (pt)</label>
                <input
                  type="number"
                  className="input"
                  min={8}
                  max={200}
                  value={Math.round((selected.height || 0.03) * 792)}
                  onChange={(e) => patchField(selected._id, { height: Math.max(0.008, Math.min((Number(e.target.value) || 10) / 792, 0.5)) })}
                />
              </div>
              <div className="muted" style={{ fontSize: 12 }}>Tip: arrow keys nudge it 1px (Shift = 10px). Drag the corner to resize.</div>
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
