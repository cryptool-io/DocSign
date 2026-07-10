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
