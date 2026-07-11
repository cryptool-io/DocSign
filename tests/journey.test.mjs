/* Full platform journey: sender + two signers (sequential), share-link viewing,
 * completion, audit, inbox attribution, OTP guard, decline. */
import { makeOk, api, uploadPdf, loadCrypto, serverRequire, latestOtp } from './_harness.mjs';

export const name = 'full journey (sender + signers + edge paths)';
export async function run() {
  const { ok, state } = makeOk();
  const C = await loadCrypto();
  const { PDFDocument } = serverRequire('pdf-lib');
  const pw = 'supersecret1';

  // --- Sender setup + encrypted upload ---
  const token = (await api('POST', '/api/auth/register', { body: { name: 'Dana', email: `sender_${Date.now()}@acme.io`, password: pw } })).json.accessToken;
  const salt = C.randomSaltB64();
  const accountKey = await C.generateDek();
  await api('POST', '/api/auth/encryption/setup', { token, body: { kdfSalt: salt, wrappedAccountKey: await C.wrapDek(accountKey, await C.deriveMasterKey(pw, salt)) } });
  const companyId = (await api('POST', '/api/companies', { token, body: { name: 'Acme Capital', senderEmail: 'deals@acme.io', emails: [{ email: 'deals@acme.io', isDefault: true }] } })).json.data.id;

  const doc = await PDFDocument.create();
  doc.addPage([612, 792]).drawText('AGREEMENT', { x: 50, y: 700, size: 20 });
  doc.addPage([612, 792]).drawText('Signature Page', { x: 50, y: 700, size: 20 });
  const plain = new Uint8Array(await doc.save());
  const dek = await C.generateDek();
  const document = await uploadPdf(token, { bytes: await C.encryptBytes(plain, dek), name: 'Agreement.pdf', companyId, encrypted: true, wrappedDek: await C.wrapDek(dek, accountKey), sha256: await C.sha256Hex(plain), pageCount: 2 });
  const documentId = document.id;
  const dekB64 = await C.exportDekB64(dek);
  ok(document.Encrypted, 'sender uploaded an encrypted agreement under a company');

  // --- Share-link viewing (DocSend) ---
  let r = await api('POST', '/api/links', { token, body: { documentId, requireEmail: true, watermark: true } });
  const linkToken = r.json.data.Token;
  const linkId = r.json.data.id;
  const open = await api('POST', `/api/view/${linkToken}/open`, { body: { email: 'prospect@fund.vc' } });
  const vfile = await api('GET', `/api/view/link/${linkId}/file`, { token: open.json.data.viewerToken, raw: true });
  ok(vfile.headers.get('x-docsign-encrypted') === 'true', 'prospect gets ciphertext');
  ok((await PDFDocument.load(await C.decryptBytes(new Uint8Array(Buffer.from(await vfile.arrayBuffer())), dek))).getPageCount() === 2, 'prospect decrypts + reads the deck');
  await api('POST', `/api/view/link/${linkId}/heartbeat`, { token: open.json.data.viewerToken, body: { sessionId: open.json.data.sessionId, pages: [{ page: 1, seconds: 20 }, { page: 2, seconds: 15 }] } });
  ok((await api('GET', `/api/links/${linkId}/analytics`, { token })).json.data.totals.views >= 1, 'view analytics recorded');

  // --- Send sequential 2-signer envelope (link mode) ---
  const s1 = 'alice@investor.com';
  const s2 = 'bob@cosigner.com';
  r = await api('POST', '/api/envelopes', { token, body: {
    documentId, companyId, subject: 'Please sign', signingOrder: 'sequential', deliveryMode: 'link', requireVerification: false,
    signers: [{ name: 'Alice', email: s1, signingOrder: 1 }, { name: 'Bob', email: s2, signingOrder: 2 }],
    fields: [
      { type: 'signature', signerEmail: s1, pageNumber: 2, x: 0.12, y: 0.55, width: 0.3, height: 0.06 },
      { type: 'signature', signerEmail: s2, pageNumber: 2, x: 0.12, y: 0.7, width: 0.3, height: 0.06 }
    ] } });
  const envelopeId = r.json.data.id;
  const sent = await api('POST', `/api/envelopes/${envelopeId}/send`, { token });
  ok(sent.json.links.length === 2, 'sent: 2 signing links, no email');
  const t1 = sent.json.links.find((l) => l.email === s1).url.split('/sign/')[1];
  const t2 = sent.json.links.find((l) => l.email === s2).url.split('/sign/')[1];

  // Signer 1
  ok((await api('GET', `/api/sign/${t1}/meta`, {})).json.data.yourTurn === true, "signer 1: it's their turn");
  const st1 = (await api('POST', `/api/sign/${t1}/start`, {})).json.data.signerToken;
  ok((await api('GET', `/api/sign/${t1}/fields`, { token: st1 })).json.data.filter((f) => f.mine).length === 1, 'signer 1 has one field of their own to fill');
  ok((await api('POST', `/api/sign/${t1}/submit`, { token: st1, body: { consent: true, signatureType: 'typed', signatureData: 'Alice', documentKey: dekB64, values: [] } })).json.data.status === 'signed', 'signer 1 signs -> partially');
  ok((await api('GET', `/api/envelopes/${envelopeId}`, { token })).json.data.status === 'partially_signed', 'envelope partially_signed');
  ok((await api('GET', `/api/sign/${t2}/meta`, {})).json.data.yourTurn === true, 'signer 2 now active');

  // Signer 2 completes it
  const st2 = (await api('POST', `/api/sign/${t2}/start`, {})).json.data.signerToken;
  ok((await api('POST', `/api/sign/${t2}/submit`, { token: st2, body: { consent: true, signatureType: 'typed', signatureData: 'Bob', documentKey: dekB64, values: [] } })).json.data.status === 'completed', 'signer 2 signs -> completed');

  // Completed file + audit
  const cf = await api('GET', `/api/envelopes/${envelopeId}/completed-file`, { token, raw: true });
  ok((await PDFDocument.load(await C.decryptBytes(new Uint8Array(Buffer.from(await cf.arrayBuffer())), dek))).getPageCount() === 3, 'completed = 2 pages + certificate');
  const audit = (await api('GET', `/api/envelopes/${envelopeId}/audit`, { token })).json.data;
  const events = audit.events.map((e) => e.eventType);
  ok(audit.integrity.valid && ['envelope.created', 'envelope.sent', 'signer.signed', 'envelope.completed'].every((e) => events.includes(e)), 'audit valid + full lifecycle');

  // --- Inbox attribution ---
  const memberEmail = `member_${Date.now()}@acme.io`;
  const memberTok = (await api('POST', '/api/auth/register', { body: { name: 'Mia', email: memberEmail, password: pw } })).json.accessToken;
  const nda = await uploadPdf(token, { bytes: new Uint8Array(await (async () => { const d = await PDFDocument.create(); d.addPage([612, 792]); return d.save(); })()), name: 'NDA.pdf' });
  r = await api('POST', '/api/envelopes', { token, body: { documentId: nda.id, subject: 'Sign NDA', deliveryMode: 'link', requireVerification: false, signers: [{ name: 'Mia', email: memberEmail }], fields: [{ type: 'signature', signerEmail: memberEmail, pageNumber: 1, x: 0.1, y: 0.8, width: 0.2, height: 0.05 }] } });
  const ndaEnv = r.json.data.id;
  const ndaTok = (await api('POST', `/api/envelopes/${ndaEnv}/send`, { token })).json.links[0].url.split('/sign/')[1];
  ok((await api('GET', '/api/envelopes/inbox', { token: memberTok })).json.data.some((e) => e.envelopeId === ndaEnv), 'NDA in member inbox (to sign)');
  const mst = (await api('POST', `/api/sign/${ndaTok}/start`, {})).json.data.signerToken;
  await api('POST', `/api/sign/${ndaTok}/submit`, { token: mst, body: { consent: true, signatureType: 'typed', signatureData: 'Mia', values: [] } });
  ok((await api('GET', '/api/envelopes/inbox?status=signed', { token: memberTok })).json.data.some((e) => e.envelopeId === ndaEnv), 'moves to member signed list (attribution)');

  // --- OTP guard + decline ---
  r = await api('POST', '/api/envelopes', { token, body: { documentId: nda.id, subject: 'Verified', deliveryMode: 'link', requireVerification: true, signers: [{ name: 'Ext', email: 'ext@x.io' }], fields: [{ type: 'signature', signerEmail: 'ext@x.io', pageNumber: 1, x: 0.1, y: 0.8, width: 0.2, height: 0.05 }] } });
  const otpTok = (await api('POST', `/api/envelopes/${r.json.data.id}/send`, { token })).json.links[0].url.split('/sign/')[1];
  ok((await api('POST', `/api/sign/${otpTok}/start`, {})).status === 403, 'no-code start blocked when verification required');
  await api('POST', `/api/sign/${otpTok}/request-otp`, {});
  ok((await api('POST', `/api/sign/${otpTok}/verify-otp`, { body: { code: '000000' } })).status === 401, 'wrong code rejected');
  const code = latestOtp();
  if (code) ok((await api('POST', `/api/sign/${otpTok}/verify-otp`, { body: { code } })).json.data?.signerToken != null, 'correct code -> signer token');
  else ok(true, 'correct code path skipped (no server log captured)');

  r = await api('POST', '/api/envelopes', { token, body: { documentId: nda.id, subject: 'Decline', deliveryMode: 'link', requireVerification: false, signers: [{ name: 'No', email: 'no@x.io' }], fields: [{ type: 'signature', signerEmail: 'no@x.io', pageNumber: 1, x: 0.1, y: 0.8, width: 0.2, height: 0.05 }] } });
  const dTok = (await api('POST', `/api/envelopes/${r.json.data.id}/send`, { token })).json.links[0].url.split('/sign/')[1];
  const dst = (await api('POST', `/api/sign/${dTok}/start`, {})).json.data.signerToken;
  ok((await api('POST', `/api/sign/${dTok}/decline`, { token: dst, body: { reason: 'no' } })).json.data.status === 'declined', 'signer can decline');

  return state;
}
