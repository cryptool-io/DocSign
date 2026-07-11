/* Shared test harness. Resolves the browser crypto module + server deps by
 * path so tests run from the repo without installing web dependencies. */
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import { createRequire } from 'module';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
export const SERVER_DIR = path.join(ROOT, 'server');
const require = createRequire(import.meta.url);

export const BASE = process.env.DOCSIGN_TEST_BASE || 'http://localhost:4400';

// The test runner pipes the server's stdout (which logs dry-run emails) here.
export const readServerLog = () => {
  const p = process.env.DOCSIGN_TEST_LOG;
  if (!p) return '';
  try {
    return require('fs').readFileSync(p, 'utf8');
  } catch {
    return '';
  }
};
export const latestOtp = () => [...readServerLog().matchAll(/verification code: (\d{6})/g)].pop()?.[1] || null;

// The isomorphic browser crypto module (WebCrypto only — no external deps).
export const loadCrypto = () => import(pathToFileURL(path.join(ROOT, 'web', 'src', 'lib', 'crypto.js')).href);

// Require a package from the server's node_modules (e.g. pdf-lib).
export const serverRequire = (mod) => require(path.join(SERVER_DIR, 'node_modules', mod));
// Require a server source module (e.g. src/services/emailOAuth.js).
export const serverSrc = (rel) => require(path.join(SERVER_DIR, 'src', rel));

/** Per-file pass/fail counter with an ok(cond, label) assertion. */
export const makeOk = () => {
  const state = { pass: 0, fail: 0 };
  const ok = (cond, label) => {
    if (cond) {
      state.pass += 1;
      console.log(`    ✓ ${label}`);
    } else {
      state.fail += 1;
      console.log(`    ✗ FAIL: ${label}`);
    }
  };
  return { ok, state };
};

/** Minimal JSON/raw fetch client against the running API. */
export const api = async (method, p, { token, appToken, body, raw, headers } = {}) => {
  const h = { ...(headers || {}) };
  if (token) h.Authorization = `Bearer ${token}`;
  if (appToken) h['X-App-Authorization'] = `Bearer ${appToken}`;
  let payload;
  if (body) {
    h['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + p, { method, headers: h, body: payload });
  if (raw) return res;
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { _raw: text.slice(0, 200) };
  }
  return { status: res.status, json };
};

/** Upload a (possibly encrypted) PDF the way the browser does. */
export const uploadPdf = async (token, { bytes, name = 'doc.pdf', encrypted, wrappedDek, sha256, pageCount, companyId } = {}) => {
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type: encrypted ? 'application/octet-stream' : 'application/pdf' }), encrypted ? `${name}.enc` : name);
  fd.append('name', name);
  if (companyId) fd.append('companyId', companyId);
  if (encrypted) {
    fd.append('encrypted', 'true');
    fd.append('wrappedDek', wrappedDek);
    fd.append('sha256', sha256);
    fd.append('pageCount', String(pageCount));
  }
  const res = await fetch(`${BASE}/api/documents`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
  return (await res.json()).data;
};
