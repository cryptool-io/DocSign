/**
 * The document key for an encrypted share/sign link travels in the URL fragment
 * (after #), which browsers never send to the server. These helpers put it there
 * and read it back.
 */
export const appendKey = (url, dekB64) => (dekB64 ? `${url}#k=${encodeURIComponent(dekB64)}` : url);

export const keyFromHash = () => {
  const h = window.location.hash || '';
  const m = h.match(/[#&]k=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : null;
};

// Data rooms carry a { documentId: dekB64 } map (multiple encrypted docs).
const b64urlEncode = (str) => btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlDecode = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

export const appendKeyMap = (url, map) => {
  if (!map || Object.keys(map).length === 0) return url;
  return `${url}#keys=${b64urlEncode(JSON.stringify(map))}`;
};

export const keyMapFromHash = () => {
  const h = window.location.hash || '';
  const m = h.match(/[#&]keys=([^&]+)/);
  if (!m) return {};
  try {
    return JSON.parse(b64urlDecode(m[1]));
  } catch {
    return {};
  }
};
