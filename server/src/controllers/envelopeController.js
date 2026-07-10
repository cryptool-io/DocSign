const {
  DocEnvelope,
  DocEnvelopeSigner,
  DocSignatureField,
  DocDocument,
  DocTemplate,
  DocRecipient,
  sequelize
} = require('../models');
const { generateOpaqueToken } = require('../services/docroom/tokens');
const { appendAuditEvent } = require('../services/docroom/hashChain');
const { APP_BASE_URL, signatureRequest } = require('../services/email');
const { asyncHandler, notFound, badRequest, forbidden } = require('../utils/http');

const signUrl = (token) => `${APP_BASE_URL}/sign/${token}`;

const serializeSigner = (s) => ({
  id: s.id,
  name: s.Name,
  email: s.Email,
  signerRole: s.SignerRole,
  signingOrder: s.SigningOrder,
  status: s.Status,
  viewedAt: s.ViewedAt,
  signedAt: s.SignedAt,
  declinedAt: s.DeclinedAt,
  declineReason: s.DeclineReason,
  emailVerifiedAt: s.EmailVerifiedAt
});

const serialize = (env) => ({
  id: env.id,
  documentId: env.DocDocumentId,
  templateId: env.DocTemplateId,
  projectId: env.DocProjectId,
  subject: env.Subject,
  message: env.Message,
  status: env.Status,
  signingOrder: env.SigningOrder,
  expiresAt: env.ExpiresAt,
  sentAt: env.SentAt,
  completedAt: env.CompletedAt,
  hasCompletedFile: Boolean(env.CompletedFileKey),
  createdAt: env.createdAt,
  signers: (env.Signers || []).sort((a, b) => a.SigningOrder - b.SigningOrder).map(serializeSigner),
  fieldCount: env.Fields ? env.Fields.length : undefined
});

const withGraph = (id, ownerId) =>
  DocEnvelope.findOne({
    where: { id, CreatedBy: ownerId },
    include: [
      { model: DocEnvelopeSigner, as: 'Signers' },
      { model: DocSignatureField, as: 'Fields' }
    ]
  });

exports.list = asyncHandler(async (req, res) => {
  const where = { CreatedBy: req.userId };
  if (req.query.projectId) where.DocProjectId = req.query.projectId;
  if (req.query.status) where.Status = req.query.status;
  const envelopes = await DocEnvelope.findAll({
    where,
    include: [{ model: DocEnvelopeSigner, as: 'Signers' }],
    order: [['createdAt', 'DESC']]
  });
  res.json({ data: envelopes.map(serialize) });
});

exports.get = asyncHandler(async (req, res) => {
  const env = await withGraph(req.params.id, req.userId);
  if (!env) throw notFound('Envelope not found');
  res.json({ data: serialize(env) });
});

/**
 * Create a draft envelope. Signers are bound now (role -> real person). Fields
 * come from the request or, if absent, are copied from the template and matched
 * to signers by signerRole. Each field row is bound to exactly one signer.
 */
exports.create = asyncHandler(async (req, res) => {
  const b = req.body;

  const doc = await DocDocument.findOne({ where: { id: b.documentId, OwnerId: req.userId, ArchivedAt: null } });
  if (!doc) throw badRequest('Document not found.', 'bad_document');

  let template = null;
  if (b.templateId) {
    template = await DocTemplate.findOne({
      where: { id: b.templateId, OwnerId: req.userId },
      include: [{ model: DocSignatureField, as: 'Fields' }]
    });
    if (!template) throw badRequest('Template not found.', 'bad_template');
  }

  // Validate any referenced recipients belong to this owner.
  const recipientIds = b.signers.map((s) => s.recipientId).filter(Boolean);
  if (recipientIds.length) {
    const owned = await DocRecipient.count({ where: { id: recipientIds, OwnerId: req.userId } });
    if (owned !== new Set(recipientIds).size) throw badRequest('Unknown recipient.', 'bad_recipient');
  }

  // Source of field definitions: explicit request fields, else template fields.
  const sourceFields =
    b.fields ||
    (template?.Fields || []).map((f) => ({
      type: f.Type,
      signerRole: f.SignerRole,
      pageNumber: f.PageNumber,
      x: f.X,
      y: f.Y,
      width: f.Width,
      height: f.Height,
      required: f.Required,
      label: f.Label
    }));

  const env = await sequelize.transaction(async (t) => {
    const envelope = await DocEnvelope.create(
      {
        DocDocumentId: doc.id,
        DocProjectId: b.projectId || doc.DocProjectId || null,
        DocTemplateId: b.templateId || null,
        CreatedBy: req.userId,
        Subject: b.subject,
        Message: b.message || null,
        Status: 'draft',
        SigningOrder: b.signingOrder || 'parallel',
        ExpiresAt: b.expiresAt || null
      },
      { transaction: t }
    );

    const signers = await DocEnvelopeSigner.bulkCreate(
      b.signers.map((s) => ({
        DocEnvelopeId: envelope.id,
        DocRecipientId: s.recipientId || null,
        Name: s.name,
        Email: s.email,
        SignerRole: s.signerRole || null,
        SigningOrder: s.signingOrder || 1,
        AccessToken: generateOpaqueToken(24),
        Status: 'pending'
      })),
      { transaction: t, returning: true }
    );

    // Map each field to a signer: by role if given, else by email, else the
    // single signer if there's only one. Fields that can't be matched are dropped.
    const byRole = new Map();
    const byEmail = new Map();
    signers.forEach((s) => {
      if (s.SignerRole) byRole.set(s.SignerRole, s);
      byEmail.set(s.Email, s);
    });

    const rows = [];
    for (const f of sourceFields) {
      let signer = null;
      if (f.signerRole && byRole.has(f.signerRole)) signer = byRole.get(f.signerRole);
      else if (f.signerEmail && byEmail.has(f.signerEmail)) signer = byEmail.get(f.signerEmail);
      else if (signers.length === 1) [signer] = signers;
      if (!signer) continue;

      rows.push({
        DocTemplateId: null,
        DocEnvelopeId: envelope.id,
        DocEnvelopeSignerId: signer.id,
        SignerRole: signer.SignerRole,
        Type: f.type,
        PageNumber: f.pageNumber,
        X: f.x,
        Y: f.y,
        Width: f.width,
        Height: f.height,
        Required: f.required !== false,
        Label: f.label || null
      });
    }
    if (rows.length) await DocSignatureField.bulkCreate(rows, { transaction: t });

    await appendAuditEvent(
      {
        envelopeId: envelope.id,
        documentId: doc.id,
        actorType: 'owner',
        actorId: req.userId,
        actorEmail: req.user.Email,
        eventType: 'envelope.created',
        metadata: { subject: envelope.Subject, signerCount: signers.length, fieldCount: rows.length }
      },
      { transaction: t }
    );

    return envelope;
  });

  res.status(201).json({ data: serialize(await withGraph(env.id, req.userId)) });
});

/** Send a draft: flip to 'sent', email the first signer(s) per signing order. */
exports.send = asyncHandler(async (req, res) => {
  const env = await withGraph(req.params.id, req.userId);
  if (!env) throw notFound('Envelope not found');
  if (env.Status !== 'draft') throw badRequest('Only draft envelopes can be sent.', 'not_draft');
  if (!env.Signers?.length) throw badRequest('Add at least one signer first.', 'no_signers');

  // The default signer scope hides AccessToken; reload with it to build sign URLs.
  const signers = (
    await DocEnvelopeSigner.scope('withSecrets').findAll({ where: { DocEnvelopeId: env.id } })
  ).sort((a, b) => a.SigningOrder - b.SigningOrder);
  // Sequential: only the lowest signing order is notified first. Parallel: all.
  const firstOrder = signers[0].SigningOrder;
  const toNotify = env.SigningOrder === 'sequential' ? signers.filter((s) => s.SigningOrder === firstOrder) : signers;

  await sequelize.transaction(async (t) => {
    await env.update({ Status: 'sent', SentAt: new Date() }, { transaction: t });
    await appendAuditEvent(
      {
        envelopeId: env.id,
        documentId: env.DocDocumentId,
        actorType: 'owner',
        actorId: req.userId,
        actorEmail: req.user.Email,
        eventType: 'envelope.sent',
        metadata: { order: env.SigningOrder, notified: toNotify.map((s) => s.Email) }
      },
      { transaction: t }
    );
    for (const s of toNotify) {
      await s.update({ NotifiedAt: new Date() }, { transaction: t });
    }
  });

  // Emails after commit.
  await Promise.allSettled(
    toNotify.map((s) =>
      signatureRequest({
        to: s.Email,
        signerName: s.Name,
        senderName: req.user.Name,
        subject: env.Subject,
        message: env.Message,
        signUrl: signUrl(s.AccessToken)
      })
    )
  );

  res.json({ data: serialize(await withGraph(env.id, req.userId)) });
});

exports.void = asyncHandler(async (req, res) => {
  const env = await withGraph(req.params.id, req.userId);
  if (!env) throw notFound('Envelope not found');
  if (env.isTerminal()) throw badRequest(`Envelope is already ${env.Status}.`, 'terminal');

  await sequelize.transaction(async (t) => {
    await env.update({ Status: 'voided', VoidedAt: new Date(), VoidReason: req.body?.reason || null }, { transaction: t });
    await appendAuditEvent(
      {
        envelopeId: env.id,
        documentId: env.DocDocumentId,
        actorType: 'owner',
        actorId: req.userId,
        actorEmail: req.user.Email,
        eventType: 'envelope.voided',
        metadata: { reason: req.body?.reason || null }
      },
      { transaction: t }
    );
  });
  res.json({ data: serialize(await withGraph(env.id, req.userId)) });
});

/** Resend the signing email to a specific pending signer. */
exports.remind = asyncHandler(async (req, res) => {
  const env = await withGraph(req.params.id, req.userId);
  if (!env) throw notFound('Envelope not found');
  const signer = await DocEnvelopeSigner.scope('withSecrets').findOne({
    where: { id: req.params.signerId, DocEnvelopeId: env.id }
  });
  if (!signer) throw notFound('Signer not found');
  if (signer.Status === 'signed') throw badRequest('That signer has already signed.', 'already_signed');

  await signatureRequest({
    to: signer.Email,
    signerName: signer.Name,
    senderName: req.user.Name,
    subject: env.Subject,
    message: env.Message,
    signUrl: signUrl(signer.AccessToken)
  });
  await signer.update({ RemindedAt: new Date() });
  res.json({ ok: true });
});
