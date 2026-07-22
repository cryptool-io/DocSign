/**
 * Date-field display formats the sender can choose from. Mirrors
 * server/src/services/dateFormat.js — keep the two in sync. The chosen key is
 * stored on the field and applied on the signing screen and the stamped PDF.
 */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const DEFAULT_DATE_FORMAT = 'MMMM D, YYYY';

// value = stored key; label = what the sender sees in the dropdown (with a sample).
export const DATE_FORMAT_OPTIONS = [
  { value: 'MMMM D, YYYY', label: 'July 20, 2026' },
  { value: 'MMM D, YYYY', label: 'Jul 20, 2026' },
  { value: 'MM/DD/YYYY', label: '07/20/2026 (US)' },
  { value: 'DD/MM/YYYY', label: '20/07/2026 (UK)' },
  { value: 'D MMMM YYYY', label: '20 July 2026' },
  { value: 'YYYY-MM-DD', label: '2026-07-20 (ISO)' }
];

const pad = (n) => String(n).padStart(2, '0');

export const formatDate = (date, fmt) => {
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
