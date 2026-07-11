/* Crypto primitives + browser(WebCrypto) <-> server(node:crypto) interop. No server needed. */
import { makeOk, loadCrypto, serverRequire, serverSrc } from './_harness.mjs';

export const name = 'crypto primitives + interop';
export async function run() {
  const { ok, state } = makeOk();
  const C = await loadCrypto();
  const server = serverSrc('services/docroom/crypto.js');
  const { PDFDocument } = serverRequire('pdf-lib');
  const eq = (a, b) => {
    a = new Uint8Array(a); b = new Uint8Array(b);
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
    return true;
  };

  const dek = await C.generateDek();
  const plaintext = new TextEncoder().encode('Top secret — confidential');
  const enc = await C.encryptBytes(plaintext, dek);
  ok(eq(await C.decryptBytes(enc, dek), plaintext), 'encrypt then decrypt round-trips');

  const salt = C.randomSaltB64();
  const pw = 'correct horse battery staple';
  const wrapped = await C.wrapDek(dek, await C.deriveMasterKey(pw, salt));
  ok(eq(await C.decryptBytes(enc, await C.unwrapDek(wrapped, await C.deriveMasterKey(pw, salt))), plaintext), 'DEK wrap/unwrap across devices (same password+salt)');
  let rejected = false;
  try { await C.unwrapDek(wrapped, await C.deriveMasterKey('wrong', salt)); } catch { rejected = true; }
  ok(rejected, 'wrong password cannot unwrap');

  const rec = C.generateRecoveryKeyB64();
  const wrByRec = await C.wrapDek(dek, await C.importRecoveryKey(rec));
  ok(eq(await C.decryptBytes(enc, await C.unwrapDek(wrByRec, await C.importRecoveryKey(rec))), plaintext), 'recovery key unwraps');

  // Interop: browser encrypts, server decrypts.
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]).drawText('Encrypted', { x: 50, y: 700, size: 18 });
  const pdfBytes = new Uint8Array(await doc.save());
  const hash = await C.sha256Hex(pdfBytes);
  const dekB64 = await C.exportDekB64(dek);
  const ct = await C.encryptBytes(pdfBytes, dek);
  const serverPlain = server.decryptBuffer(Buffer.from(ct), dekB64);
  ok(server.sha256Hex(serverPlain) === hash, 'server decrypts browser-encrypted PDF (hash matches)');
  ok((await PDFDocument.load(serverPlain)).getPageCount() === 1, 'server can parse the decrypted PDF');
  const reEnc = server.encryptBuffer(serverPlain, dekB64);
  ok(server.sha256Hex(Buffer.from(await C.decryptBytes(new Uint8Array(reEnc), dek))) === hash, 'server re-encrypt decrypts back in browser');
  const tampered = Buffer.from(ct); tampered[tampered.length - 1] ^= 0xff;
  let authFail = false;
  try { server.decryptBuffer(tampered, dekB64); } catch { authFail = true; }
  ok(authFail, 'GCM auth tag rejects tampering');

  return state;
}
