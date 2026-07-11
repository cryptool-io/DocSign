/* Encrypted data rooms: mixed encrypted + plain docs behind one gated link;
 * viewer decrypts each with its per-doc key from the room key-map. */
import { makeOk, api, uploadPdf, loadCrypto, serverRequire } from './_harness.mjs';

export const name = 'encrypted data rooms (multi-doc key map)';
export async function run() {
  const { ok, state } = makeOk();
  const C = await loadCrypto();
  const { PDFDocument } = serverRequire('pdf-lib');

  const email = `renc_${Date.now()}@x.io`;
  const pw = 'supersecret1';
  const token = (await api('POST', '/api/auth/register', { body: { name: 'R', email, password: pw } })).json.accessToken;
  const salt = C.randomSaltB64();
  const accountKey = await C.generateDek();
  await api('POST', '/api/auth/encryption/setup', { token, body: { kdfSalt: salt, wrappedAccountKey: await C.wrapDek(accountKey, await C.deriveMasterKey(pw, salt)) } });

  const uploadEnc = async (title) => {
    const d = await PDFDocument.create(); d.addPage([612, 792]).drawText(title, { x: 50, y: 700, size: 16 });
    const plain = new Uint8Array(await d.save());
    const dek = await C.generateDek();
    const doc = await uploadPdf(token, { bytes: await C.encryptBytes(plain, dek), name: `${title}.pdf`, encrypted: true, wrappedDek: await C.wrapDek(dek, accountKey), sha256: await C.sha256Hex(plain), pageCount: 1 });
    return { id: doc.id, dek, title };
  };
  const uploadPlain = async (title) => {
    const d = await PDFDocument.create(); d.addPage([612, 792]).drawText(title, { x: 50, y: 700, size: 16 });
    const doc = await uploadPdf(token, { bytes: new Uint8Array(await d.save()), name: `${title}.pdf` });
    return { id: doc.id, title };
  };

  const deck = await uploadEnc('Encrypted Deck');
  const model = await uploadEnc('Encrypted Model');
  const plain = await uploadPlain('Public Onepager');

  let r = await api('POST', '/api/data-rooms', { token, body: { name: 'Diligence Room', requireEmail: true, allowedEmails: ['@fund.vc'], documents: [{ documentId: deck.id }, { documentId: model.id }, { documentId: plain.id }] } });
  ok(r.status === 201 && r.json.data.items.length === 3, 'data room with 3 docs');
  const items = r.json.data.items;
  ok(items.filter((i) => i.encrypted).length === 2 && items.filter((i) => i.encrypted).every((i) => i.wrappedDek), 'items expose encrypted flag + wrappedDek');
  const roomToken = r.json.data.Token;
  const roomId = r.json.data.id;

  // Owner builds the key map (goes in the link fragment).
  const keyMap = {};
  for (const it of items.filter((i) => i.encrypted)) keyMap[it.documentId] = await C.exportDekB64(await C.unwrapDek(it.wrappedDek, accountKey));
  ok(Object.keys(keyMap).length === 2, 'owner builds a 2-key map');

  const rt = (await api('POST', `/api/room/${roomToken}/open`, { body: { email: 'lp@fund.vc' } })).json.data.roomToken;
  for (const enc of [deck, model]) {
    const f = await api('GET', `/api/room/room/${roomId}/document/${enc.id}/file`, { token: rt, raw: true });
    const buf = Buffer.from(await f.arrayBuffer());
    ok(f.headers.get('x-docsign-encrypted') === 'true' && buf.subarray(0, 5).toString() !== '%PDF-', `${enc.title}: ciphertext streamed`);
    ok((await PDFDocument.load(await C.decryptBytes(new Uint8Array(buf), await C.importDekB64(keyMap[enc.id])))).getPageCount() === 1, `${enc.title}: viewer decrypts with map key`);
  }
  const pf = await api('GET', `/api/room/room/${roomId}/document/${plain.id}/file`, { token: rt, raw: true });
  ok(pf.headers.get('x-docsign-encrypted') !== 'true' && Buffer.from(await pf.arrayBuffer()).subarray(0, 5).toString() === '%PDF-', 'plain doc streams normally (mixed room)');

  return state;
}
