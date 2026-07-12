/* Sovereign storage: PDF never persisted at rest — overlay shell + hash only,
 * bytes attached transiently for signing, purged on completion. */
import { makeOk, api, loadCrypto, serverRequire, serverSrc, BASE } from './_harness.mjs';

export const name = 'sovereign storage (local-only PDF)';

// Create a sovereign shell (metadata only, no bytes) the way the browser does.
const createShell = async (token, { name, sha256, pageCount, sizeBytes }) => {
  const fd = new FormData();
  fd.append('storageMode', 'sovereign');
  fd.append('name', name);
  fd.append('sha256', sha256);
  fd.append('pageCount', String(pageCount));
  fd.append('sizeBytes', String(sizeBytes));
  const res = await fetch(`${BASE}/api/documents`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
  return { status: res.status, data: (await res.json()).data };
};

const attach = async (token, id, bytes) => {
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type: 'application/pdf' }), 'file.pdf');
  const res = await fetch(`${BASE}/api/documents/${id}/attach`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
  return { status: res.status, json: await res.json() };
};

export async function run() {
  const { ok, state } = makeOk();
  const C = await loadCrypto();
  const { PDFDocument } = serverRequire('pdf-lib');
  const { DocDocument } = serverSrc('models');
  const pw = 'supersecret1';

  const token = (await api('POST', '/api/auth/register', { body: { name: 'Sov', email: `sov_${Date.now()}@acme.io`, password: pw } })).json.accessToken;

  // Build a PDF locally; only its hash + page count go to the server.
  const pdfDoc = await PDFDocument.create();
  pdfDoc.addPage([612, 792]).drawText('SOVEREIGN AGREEMENT', { x: 50, y: 700, size: 18 });
  const bytes = new Uint8Array(await pdfDoc.save());
  const sha256 = await C.sha256Hex(bytes);

  // 1. Create the shell — no bytes uploaded.
  const shell = await createShell(token, { name: 'Local.pdf', sha256, pageCount: 1, sizeBytes: bytes.length });
  ok(shell.status === 201 && shell.data.StorageMode === 'sovereign', 'sovereign shell created');
  ok(!shell.data.FileKey, 'shell has no stored file');
  const docId = shell.data.id;

  // 2. Preview is refused while no bytes are attached.
  ok((await api('GET', `/api/documents/${docId}/page-sizes`, { token })).status === 400, 'preview refused with no bytes (kept on device)');

  // 3. Attaching a mismatched file is rejected by fingerprint.
  const wrong = new Uint8Array(await (async () => { const d = await PDFDocument.create(); d.addPage([612, 792]); return d.save(); })());
  ok((await attach(token, docId, wrong)).json.code === 'hash_mismatch', 'wrong file rejected (fingerprint mismatch)');

  // 4. Attach the real local file transiently.
  ok((await attach(token, docId, bytes)).json.data?.attached === true, 'correct local file attached transiently');
  ok(Boolean((await DocDocument.findByPk(docId)).FileKey), 'bytes present during active signing');

  // 5. Send + sign to completion (single signer, link, no verification).
  const memberEmail = `m_${Date.now()}@x.io`;
  const r = await api('POST', '/api/envelopes', { token, body: { documentId: docId, subject: 'Sovereign sign', deliveryMode: 'link', requireVerification: false, signers: [{ name: 'M', email: memberEmail }], fields: [{ type: 'signature', signerEmail: memberEmail, pageNumber: 1, x: 0.1, y: 0.8, width: 0.2, height: 0.05 }] } });
  const envId = r.json.data.id;
  const tok = (await api('POST', `/api/envelopes/${envId}/send`, { token })).json.links[0].url.split('/sign/')[1];
  const st = (await api('POST', `/api/sign/${tok}/start`, {})).json.data.signerToken;
  ok((await api('POST', `/api/sign/${tok}/submit`, { token: st, body: { consent: true, signatureType: 'typed', signatureData: 'M', values: [] } })).json.data.status === 'completed', 'sovereign envelope completes');

  // 6. After completion the transient bytes are purged — back to living only on the device.
  const after = await DocDocument.findByPk(docId);
  ok(!after.FileKey, 'transient bytes purged after completion (nothing retained)');
  ok(after.Sha256 === sha256 && after.StorageMode === 'sovereign', 'overlay shell + hash retained');

  // 7. Back to a byte-less shell: preview refused again until the file is re-attached.
  ok((await api('GET', `/api/documents/${docId}/page-sizes`, { token })).status === 400, 'shell has no bytes again (re-attach needed to reuse)');

  // 8. The completed signed PDF is not retained either (only hash + audit remain).
  const cf = await api('GET', `/api/envelopes/${envId}/completed-file`, { token, raw: true });
  ok(cf.status === 400, 'signed PDF not retained on server (emailed to parties)');

  return state;
}
