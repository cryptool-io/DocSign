/* Zero-knowledge document encryption: encrypted upload -> encrypted view ->
 * decrypt-to-stamp signing -> encrypted completed file. Needs the server. */
import { makeOk, api, uploadPdf, loadCrypto, serverRequire } from './_harness.mjs';

export const name = 'zero-knowledge encryption (documents + signing)';
export async function run() {
  const { ok, state } = makeOk();
  const C = await loadCrypto();
  const { PDFDocument } = serverRequire('pdf-lib');

  const email = `enc_${Date.now()}@test.io`;
  const pw = 'supersecret1';
  let r = await api('POST', '/api/auth/register', { body: { name: 'Enc', email, password: pw } });
  const token = r.json.accessToken;

  // Set up account encryption (as the browser does).
  const salt = C.randomSaltB64();
  const accountKey = await C.generateDek();
  await api('POST', '/api/auth/encryption/setup', { token, body: { kdfSalt: salt, wrappedAccountKey: await C.wrapDek(accountKey, await C.deriveMasterKey(pw, salt)) } });

  // Encrypted upload.
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]).drawText('CONFIDENTIAL', { x: 50, y: 700, size: 18 });
  doc.addPage([612, 792]).drawText('Signature Page', { x: 50, y: 700, size: 18 });
  const plain = new Uint8Array(await doc.save());
  const dek = await C.generateDek();
  const upDoc = await uploadPdf(token, {
    bytes: await C.encryptBytes(plain, dek), name: 'Confidential.pdf', encrypted: true,
    wrappedDek: await C.wrapDek(dek, accountKey), sha256: await C.sha256Hex(plain), pageCount: 2
  });
  ok(upDoc.Encrypted === true, 'encrypted upload stored');
  const documentId = upDoc.id;
  const dekB64 = await C.exportDekB64(dek);

  // Server stores only ciphertext.
  const raw = await api('GET', `/api/documents/${documentId}/file`, { token, raw: true });
  const rawBuf = Buffer.from(await raw.arrayBuffer());
  ok(rawBuf.subarray(0, 5).toString() !== '%PDF-', 'stored bytes are ciphertext, not a readable PDF');
  ok(await C.sha256Hex(new Uint8Array(await C.decryptBytes(new Uint8Array(rawBuf), await C.unwrapDek(upDoc.WrappedDek, accountKey)))) === await C.sha256Hex(plain), 'owner decrypts back to original');

  // Link signing (no code) with decrypt-to-stamp.
  r = await api('POST', '/api/envelopes', { token, body: {
    documentId, subject: 'Sign encrypted', deliveryMode: 'link', requireVerification: false,
    signers: [{ name: 'Investor', email: 'inv@fund.vc' }],
    fields: [{ type: 'signature', signerEmail: 'inv@fund.vc', pageNumber: 2, x: 0.15, y: 0.7, width: 0.3, height: 0.06 }]
  } });
  const envelopeId = r.json.data.id;
  const signToken = (await api('POST', `/api/envelopes/${envelopeId}/send`, { token })).json.links[0].url.split('/sign/')[1];

  const st = (await api('POST', `/api/sign/${signToken}/start`, {})).json.data.signerToken;
  const sfile = await api('GET', `/api/sign/${signToken}/file`, { token: st, raw: true });
  ok(sfile.headers.get('x-docsign-encrypted') === 'true', 'signer receives ciphertext (server never decrypts to view)');
  ok((await PDFDocument.load(await C.decryptBytes(new Uint8Array(Buffer.from(await sfile.arrayBuffer())), await C.importDekB64(dekB64)))).getPageCount() === 2, 'signer decrypts + reads locally');

  r = await api('POST', `/api/sign/${signToken}/submit`, { token: st, body: { consent: true, signatureType: 'typed', signatureData: 'Investor', documentKey: dekB64, values: [] } });
  ok(r.status === 200 && r.json.data.status === 'completed', 'signed with documentKey -> completed');

  // Reject signing an encrypted doc without the key.
  r = await api('POST', '/api/envelopes', { token, body: { documentId, subject: 'No key', deliveryMode: 'link', requireVerification: false, signers: [{ name: 'X', email: 'x@y.io' }], fields: [{ type: 'signature', signerEmail: 'x@y.io', pageNumber: 2, x: 0.1, y: 0.8, width: 0.2, height: 0.05 }] } });
  const t2 = (await api('POST', `/api/envelopes/${r.json.data.id}/send`, { token })).json.links[0].url.split('/sign/')[1];
  const st2 = (await api('POST', `/api/sign/${t2}/start`, {})).json.data.signerToken;
  ok((await api('POST', `/api/sign/${t2}/submit`, { token: st2, body: { consent: true, signatureType: 'typed', signatureData: 'X', values: [] } })).status === 400, 'signing encrypted doc without key rejected');

  // Completed file stays encrypted; owner decrypts to 3 pages (doc + certificate).
  const cf = await api('GET', `/api/envelopes/${envelopeId}/completed-file`, { token, raw: true });
  ok(cf.headers.get('x-docsign-encrypted') === 'true', 'completed file stored encrypted');
  ok((await PDFDocument.load(await C.decryptBytes(new Uint8Array(Buffer.from(await cf.arrayBuffer())), await C.unwrapDek(upDoc.WrappedDek, accountKey)))).getPageCount() === 3, 'owner decrypts completed: 2 pages + certificate');
  ok((await api('GET', `/api/envelopes/${envelopeId}/audit`, { token })).json.data.integrity.valid === true, 'audit chain valid on encrypted envelope');

  return state;
}
