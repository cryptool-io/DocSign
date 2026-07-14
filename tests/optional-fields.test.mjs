/* Optional fields: a signer can leave non-required fields (text AND signature)
 * blank and still complete. Required fields still block. */
import { makeOk, api, uploadPdf, serverRequire } from './_harness.mjs';

export const name = 'optional fields (leave blank when not required)';

const plainPdf = async () => {
  const { PDFDocument } = serverRequire('pdf-lib');
  const d = await PDFDocument.create();
  d.addPage([612, 792]);
  return new Uint8Array(await d.save());
};

const sig = (x) => ({ type: 'signature', pageNumber: 1, x, y: 0.8, width: 0.2, height: 0.05 });
const text = (x, required) => ({ type: 'text', pageNumber: 1, x, y: 0.6, width: 0.2, height: 0.04, required });

export async function run() {
  const { ok, state } = makeOk();
  const pw = 'supersecret1';
  const token = (await api('POST', '/api/auth/register', { body: { name: 'Opt', email: `opt_${Date.now()}@x.io`, password: pw } })).json.accessToken;
  const bytes = await plainPdf();

  // Case 1: required signature + OPTIONAL text. Sign, leave text blank -> completes.
  const doc1 = await uploadPdf(token, { bytes, name: 'A.pdf' });
  const email1 = `s1_${Date.now()}@x.io`;
  let r = await api('POST', '/api/envelopes', { token, body: { documentId: doc1.id, subject: 'Optional text', deliveryMode: 'link', requireVerification: false, signers: [{ name: 'S1', email: email1 }], fields: [{ ...sig(0.1), signerEmail: email1, required: true }, { ...text(0.5, false), signerEmail: email1 }] } });
  let tok = (await api('POST', `/api/envelopes/${r.json.data.id}/send`, { token })).json.links[0].url.split('/sign/')[1];
  let st = (await api('POST', `/api/sign/${tok}/start`, {})).json.data.signerToken;
  ok((await api('POST', `/api/sign/${tok}/submit`, { token: st, body: { consent: true, signatureType: 'typed', signatureData: 'S1', values: [] } })).json.data.status === 'completed', 'optional text left blank -> completes');

  // Case 2: only an OPTIONAL signature. Submit without signing -> completes.
  const doc2 = await uploadPdf(token, { bytes, name: 'B.pdf' });
  const email2 = `s2_${Date.now()}@x.io`;
  r = await api('POST', '/api/envelopes', { token, body: { documentId: doc2.id, subject: 'Optional sig', deliveryMode: 'link', requireVerification: false, signers: [{ name: 'S2', email: email2 }], fields: [{ ...sig(0.1), signerEmail: email2, required: false }] } });
  tok = (await api('POST', `/api/envelopes/${r.json.data.id}/send`, { token })).json.links[0].url.split('/sign/')[1];
  st = (await api('POST', `/api/sign/${tok}/start`, {})).json.data.signerToken;
  ok((await api('POST', `/api/sign/${tok}/submit`, { token: st, body: { consent: true, signatureType: 'typed', signatureData: '', values: [] } })).json.data.status === 'completed', 'optional signature left blank -> completes');

  // Case 3: a REQUIRED text field still blocks when left blank.
  const doc3 = await uploadPdf(token, { bytes, name: 'C.pdf' });
  const email3 = `s3_${Date.now()}@x.io`;
  r = await api('POST', '/api/envelopes', { token, body: { documentId: doc3.id, subject: 'Required text', deliveryMode: 'link', requireVerification: false, signers: [{ name: 'S3', email: email3 }], fields: [{ ...text(0.5, true), signerEmail: email3 }] } });
  tok = (await api('POST', `/api/envelopes/${r.json.data.id}/send`, { token })).json.links[0].url.split('/sign/')[1];
  st = (await api('POST', `/api/sign/${tok}/start`, {})).json.data.signerToken;
  ok((await api('POST', `/api/sign/${tok}/submit`, { token: st, body: { consent: true, signatureType: 'typed', signatureData: 'S3', values: [] } })).status === 400, 'required text left blank -> blocked');

  return state;
}
