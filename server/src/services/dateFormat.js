'use strict';

/**
 * Sender-chosen display format for date fields. The chosen key is stored on the
 * field (DocSignatureFields.DateFormat) and applied both on the signing screen
 * and when the value is stamped into the PDF, so the two always match.
 */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Keys are the stored values; labels/samples drive the sender's dropdown (mirrored
// in web/src/lib/dateformat.js — keep the two in sync).
const DATE_FORMATS = ['MMMM D, YYYY', 'MMM D, YYYY', 'MM/DD/YYYY', 'DD/MM/YYYY', 'D MMMM YYYY', 'YYYY-MM-DD'];
const DEFAULT_DATE_FORMAT = 'MMMM D, YYYY';

const pad = (n) => String(n).padStart(2, '0');

const formatDate = (date, fmt) => {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const D = d.getDate();
  const M = d.getMonth();
  const Y = d.getFullYear();
  switch (fmt) {
    case 'MMM D, YYYY':
      return `${MON[M]} ${D}, ${Y}`;
    case 'MM/DD/YYYY':
      return `${pad(M + 1)}/${pad(D)}/${Y}`;
    case 'DD/MM/YYYY':
      return `${pad(D)}/${pad(M + 1)}/${Y}`;
    case 'D MMMM YYYY':
      return `${D} ${MONTHS[M]} ${Y}`;
    case 'YYYY-MM-DD':
      return `${Y}-${pad(M + 1)}-${pad(D)}`;
    case 'MMMM D, YYYY':
    default:
      return `${MONTHS[M]} ${D}, ${Y}`;
  }
};

module.exports = { formatDate, DATE_FORMATS, DEFAULT_DATE_FORMAT };
