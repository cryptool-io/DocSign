const {
  DocEnvelope,
  DocEnvelopeSigner,
  DocSignatureField,
  DocDocument,
  sequelize
} = require('../../models');
const storage = require('./storage');
const pdf = require('./pdf');
const { appendAuditEvent, verifyChain } = require('./hashChain');

/**
 * Decode a signature payload into a PNG buffer suitable for stamping.
 * Drawn signatures arrive as data URLs; typed signatures are rendered as text
 * at stamp time (no image), so this returns null for those.
 */
const decodeSignatureImage = (signer) => {
  if (signer.SignatureType !== 'drawn' || !signer.SignatureImageKey) return null;
  const match = /^data:image\/png;base64,(.+)$/i.exec(signer.SignatureImageKey);
  if (!match) return null;
  return Buffer.from(match[1], 'base64');
};

/**
 * Called when the last required signer submits. Renders every field into the
 * original PDF, appends the certificate of completion, stores the result, and
 * records the terminal audit event. Idempotent-ish: guarded by envelope status.
 */
const finalizeEnvelope = async (envelopeId) => {
  return sequelize.transaction(async (t) => {
    const env = await DocEnvelope.findByPk(envelopeId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!env || env.Status === 'completed') return env;

    const [doc, signers, fields] = await Promise.all([
      DocDocument.findByPk(env.DocDocumentId, { transaction: t }),
      DocEnvelopeSigner.scope('withSecrets').findAll({ where: { DocEnvelopeId: env.id }, transaction: t }),
      DocSignatureField.findAll({ where: { DocEnvelopeId: env.id }, transaction: t })
    ]);

    let buffer = await storage.getObject(doc.FileKey);

    // Build the signature-image map keyed by field id (drawn signatures only).
    const signerById = Object.fromEntries(signers.map((s) => [s.id, s]));
    const signatureImages = {};
    for (const f of fields) {
      if ((f.Type === 'signature' || f.Type === 'initials') && f.DocEnvelopeSignerId) {
        const png = decodeSignatureImage(signerById[f.DocEnvelopeSignerId]);
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

    const completedKey = storage.buildKey(`completed/${env.CreatedBy}`, `${doc.Name}-signed.pdf`);
    await storage.putObject(completedKey, buffer, 'application/pdf');
    const completedSha = storage.sha256(buffer);

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

    return env;
  });
};

module.exports = { finalizeEnvelope };
