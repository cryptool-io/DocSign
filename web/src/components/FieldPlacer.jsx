import { useEffect, useRef, useState } from 'react';
import api from '../lib/api.js';
import { Document, Page } from '../lib/pdf.js';
import { Spinner } from '../lib/ui.jsx';

export const FIELD_TYPES = [
  { type: 'signature', label: 'Signature' },
  { type: 'initials', label: 'Initials' },
  { type: 'date', label: 'Date' },
  { type: 'text', label: 'Text' },
  { type: 'checkbox', label: 'Checkbox' }
];

// Default field size as a fraction of page dimensions.
const DEFAULT_SIZE = {
  signature: [0.24, 0.06],
  initials: [0.1, 0.05],
  date: [0.16, 0.04],
  text: [0.22, 0.04],
  checkbox: [0.035, 0.028]
};

// Distinct colors per signer so it's obvious who signs where.
export const SIGNER_COLORS = ['#2563eb', '#d97706', '#16a34a', '#9333ea', '#dc2626', '#0891b2'];

const PAGE_WIDTH = 680;

function PageOverlay({ pageNumber, fields, onAdd, onMove, onRemove, activeType, colorFor }) {
  const ref = useRef();

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
    <div
      className="pdf-page-wrap pdf-stage"
      ref={ref}
      onClick={dropHere}
      style={{ cursor: activeType ? 'crosshair' : 'default' }}
    >
      <Page pageNumber={pageNumber} width={PAGE_WIDTH} renderTextLayer={false} renderAnnotationLayer={false} />
      {fields
        .filter((f) => f.pageNumber === pageNumber)
        .map((f) => {
          const color = colorFor(f);
          return (
            <div
              key={f._id}
              onMouseDown={(e) => startDrag(e, f)}
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
                fontSize: 11,
                fontWeight: 600,
                color,
                userSelect: 'none',
                overflow: 'hidden'
              }}
            >
              {f.type}
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(f._id);
                }}
                style={{
                  position: 'absolute',
                  top: -9,
                  right: -9,
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  background: '#dc2626',
                  color: '#fff',
                  display: 'grid',
                  placeItems: 'center',
                  cursor: 'pointer',
                  fontSize: 12
                }}
              >
                ×
              </span>
            </div>
          );
        })}
    </div>
  );
}

/**
 * Renders a PDF and lets the user drop/drag/remove fields on it. Field
 * coordinates are stored as fractions of page size, so they survive any scale.
 * `documentId` is fetched with auth; `fields`/`setFields` are controlled by the
 * parent. `signers` supplies the assignment palette (each field carries a
 * `signerEmail`). `colorFor(field)` decides the box color.
 */
export default function FieldPlacer({ documentId, fields, setFields, activeType, setActiveType, activeSignerEmail, colorFor }) {
  const [pdfUrl, setPdfUrl] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!documentId) {
      setPdfUrl(null);
      return;
    }
    let dead = false;
    setPdfUrl(null);
    api
      .get(`/documents/${documentId}/file`, { responseType: 'blob' })
      .then((r) => {
        if (!dead) setPdfUrl(URL.createObjectURL(r.data));
      })
      .catch(() => setErr('Could not load the PDF.'));
    return () => {
      dead = true;
    };
  }, [documentId]);

  const addField = (partial) =>
    setFields((cur) => [
      ...cur,
      {
        _id: Math.random().toString(36).slice(2),
        type: activeType,
        signerEmail: activeSignerEmail || null,
        required: true,
        ...partial
      }
    ]);
  const moveField = (id, pos) => setFields((cur) => cur.map((f) => (f._id === id ? { ...f, ...pos } : f)));
  const removeField = (id) => setFields((cur) => cur.filter((f) => f._id !== id));

  if (err) return <div className="empty">{err}</div>;
  if (!documentId) return <div className="empty">Choose a document above to place fields.</div>;
  if (!pdfUrl) return <Spinner center />;

  return (
    <div style={{ textAlign: 'center' }}>
      <Document file={pdfUrl} onLoadSuccess={({ numPages: n }) => setNumPages(n)} loading={<Spinner center />}>
        {Array.from({ length: numPages }, (_, i) => (
          <PageOverlay
            key={i}
            pageNumber={i + 1}
            fields={fields}
            onAdd={addField}
            onMove={moveField}
            onRemove={removeField}
            activeType={activeType}
            colorFor={colorFor}
          />
        ))}
      </Document>
    </div>
  );
}
