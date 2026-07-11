const {
  DocEnvelope,
  DocEnvelopeSigner,
  DocSignatureField,
  DocDocument,
  sequelize
} = require('../../models');
const storage = require('./storage');
const pdf = require('./pdf');
const cryptoBox = require('./crypto');
const { appendAuditEvent, verifyChain } = require('./hashChain');

/**
 * Decode a signature payload into a PNG buffer suitable for stamping.
 * Drawn signatures arrive as data URLs; typed signatures are rendered as text
 * at stamp time (no image), so this returns null for those.
 */
const decodePngDataUrl = (dataUrl) => {
  if (!dataUrl) return null;
  const match = /^data:image\/png;base64,(.+)$/i.exec(dataUrl);
  if (!match) return null;
  return Buffer.from(match[1], 'base64');
};

// The drawn image to stamp into a given field: signature fields use the
// signature scribble, initials fields use the (separate) initials scribble.
const drawnImageForField = (signer, fieldType) => {
  if (!signer) return null;
  if (fieldType === 'initials') {
    return signer.InitialsType === 'drawn' ? decodePngDataUrl(signer.InitialsImageKey) : null;
  }
  return signer.SignatureType === 'drawn' ? decodePngDataUrl(signer.SignatureImageKey) : null;
};

/**
 * Called when the last required signer submits. Renders every field into the
 * original PDF, appends the certificate of completion, stores the result, and
 * records the terminal audit event. Idempotent-ish: guarded by envelope status.
 */
const finalizeEnvelope = async (envelopeId, { documentKey = null } = {}) => {
  return sequelize.transaction(async (t) => {
    const env = await DocEnvelope.findByPk(envelopeId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!env || env.Status === 'completed') return { env, pdfBuffer: null, encrypted: false, fileName: null };

    const [doc, signers, fields] = await Promise.all([
      DocDocument.findByPk(env.DocDocumentId, { transaction: t }),
      DocEnvelopeSigner.scope('withSecrets').findAll({ where: { DocEnvelopeId: env.id }, transaction: t }),
      DocSignatureField.findAll({ where: { DocEnvelopeId: env.id }, transaction: t })
    ]);

    let buffer = await storage.getObject(doc.FileKey);

    // Decrypt-to-stamp: for an encrypted document the stored bytes are ciphertext.
    // The signer's browser supplied the document key over TLS; we decrypt in
    // memory, verify it matches the plaintext hash asserted at upload, and later
    // re-encrypt the stamped result with the SAME key. The key is never stored.
    if (doc.Encrypted) {
      if (!documentKey) throw new Error('Encrypted document requires a documentKey to finalize.');
      buffer = cryptoBox.decryptBuffer(buffer, documentKey);
      if (cryptoBox.sha256Hex(buffer) !== doc.Sha256) {
        throw new Error('Decrypted document hash does not match the hash recorded at upload.');
      }
    }

    // Build the signature-image map keyed by field id (drawn signatures only).
    const signerById = Object.fromEntries(signers.map((s) => [s.id, s]));
    const signatureImages = {};
    for (const f of fields) {
      if ((f.Type === 'signature' || f.Type === 'initials') && f.DocEnvelopeSignerId) {
        const png = drawnImageForField(signerById[f.DocEnvelopeSignerId], f.Type);
        if (png) signatureImages[f.id] = png;
      }
    }

    buffer = await pdf.stampFields(
      buffer,
      fields.map((f) => ({
        id: f.id,
        PageNumber: f.PageNumber,
        X: f.X,
        Y: f.Y,
        Width: f.Width,
        Height: f.Height,
        Type: f.Type,
        Value: f.Value
      })),
      { signatureImages }
    );

    // Audit head hash for the certificate.
    const chain = await verifyChain({ envelopeId: env.id });
    const headHash = chain.events.length ? chain.events[chain.events.length - 1].Hash : null;

    buffer = await pdf.appendCertificate(buffer, {
      envelopeId: env.id,
      documentName: doc.Name,
      documentSha256: doc.Sha256,
      completedAt: new Date(),
      auditHeadHash: headHash,
      signers: signers.map((s) => ({
        name: s.Name,
        email: s.Email,
        status: s.Status,
        signedAt: s.SignedAt,
        emailVerifiedAt: s.EmailVerifiedAt,
        ipAddress: s.IpAddress
      }))
    });

    // completedSha is always the PLAINTEXT hash of the signed PDF (what the
    // certificate attests). If encrypted, re-encrypt with the same key before storing.
    const completedSha = storage.sha256(buffer);
    let storedBuffer = buffer;
    let contentType = 'application/pdf';
    if (doc.Encrypted) {
      storedBuffer = cryptoBox.encryptBuffer(buffer, documentKey);
      contentType = 'application/octet-stream';
    }
    const completedKey = storage.buildKey(
      `completed/${env.CreatedBy}`,
      `${doc.Name}-signed.pdf${doc.Encrypted ? '.enc' : ''}`
    );
    await storage.putObject(completedKey, storedBuffer, contentType);

    await env.update(
      { Status: 'completed', CompletedAt: new Date(), CompletedFileKey: completedKey, CompletedSha256: completedSha },
      { transaction: t }
    );

    await appendAuditEvent(
      {
        envelopeId: env.id,
        documentId: doc.id,
        actorType: 'system',
        eventType: 'envelope.completed',
        metadata: { completedSha256: completedSha, pages: await pdf.getPageCount(buffer) }
      },
      { transaction: t }
    );

    // Return the PLAINTEXT signed PDF so the caller can attach it to the
    // completion email (skipped for encrypted docs — never email plaintext).
    return { env, pdfBuffer: buffer, encrypted: Boolean(doc.Encrypted), fileName: `${doc.Name}-signed.pdf` };
  });
};

module.exports = { finalizeEnvelope };
