import { formatDate } from './dateformat.js';

/**
 * Shared helpers so both field editors (the template editor's PageCanvas and the
 * send flow's FieldPlacer) preview a placed field the same way it will be filled
 * — real font, size and left-alignment — instead of just showing the field name.
 */

// Stored font choice → CSS family (mirrors the signing screen + PDF fonts).
export const fontFamilyFor = (font) =>
  font === 'Times'
    ? 'Georgia, "Times New Roman", serif'
    : font === 'Courier'
    ? '"Courier New", monospace'
    : 'Helvetica, Arial, sans-serif';

// Cursive stack for signature / initials previews.
export const CURSIVE_FONT = '"Segoe Script", "Brush Script MT", cursive';

const SAMPLE_DATE = new Date(2026, 6, 20); // 20 July 2026 — stable sample

// A realistic sample of what the filled field will contain.
export const sampleValue = (f) => {
  switch (f.type) {
    case 'date':
      return formatDate(SAMPLE_DATE, f.dateFormat);
    case 'signature':
      return 'Jordan Lee';
    case 'initials':
      return 'JL';
    case 'checkbox':
      return '✔';
    case 'text':
    default:
      return f.label ? f.label : 'Sample text';
  }
};
