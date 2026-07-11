const {
  DocEnvelope,
  DocEnvelopeSigner,
  DocSignatureField,
  DocDocument,
  DocTemplate,
  DocRecipient,
  sequelize
} = require('../models');
const { DocCompany, DocCompanyEmail } = require('../models');
const { Op } = require('sequelize');
const { generateOpaqueToken } = require('../services/docroom/tokens');
const { appendAuditEvent } = require('../services/docroom/hashChain');
const { APP_BASE_URL, signatureRequest, signatureRequestHtml, systemCanSendFrom, sendViaSmtp } = require('../services/email');
const oauth = require('../services/emailOAuth');
const { decryptSecret } = require('../services/secretStore');
const { asyncHandler, notFound, badRequest, forbidden } = require('../utils/http');
const { resolveCompanyId } = require('../utils/companyScope');
const { listScope, canAccessRecord } = require('../utils/access');

/**
 * For email delivery from a company address, resolve a CONNECTED mailbox to send
 * through, and the address the mail should appear to come FROM. Rule: the
 * workspace must have at least one connected + verified mailbox. The chosen
 * `fromEmail` doesn't have to be that mailbox — a workspace can send from any of
 * its addresses (or an alias of the connected account) THROUGH its one connected
 * mailbox. (The connected account's own address always sends natively; a true
 * alias must additionally be a verified "send mail as" on that mailbox, else the
 * provider rewrites the visible From.) Returns null when there's no company
 * (personal → global system mailbox).
 */
const connectionFromRecord = (record, fromEmail) => {
  // The user's own SMTP mailbox (app password).
  if (record.Provider === 'smtp') {
    if (!record.SmtpPasswordEnc) throw badRequest(`Reconnect the mailbox for ${record.Email}: its password is missing.`, 'sender_not_connected');
    return {
      kind: 'smtp',
      host: record.SmtpHost,
      port: record.SmtpPort,
      secure: record.SmtpSecure,
      user: record.SmtpUsername || record.Email,
      pass: decryptSecret(record.SmtpPasswordEnc),
      fromEmail
    };
  }
  // OAuth mailbox (Gmail/Outlook).
  if (!record.OAuthRefreshTokenEnc) throw badRequest(`Reconnect ${record.Email} before sending from it.`, 'sender_not_connected');
  if (!oauth.isConfigured(record.Provider)) throw badRequest(`${record.Provider} email isn't configured on this server.`, 'provider_not_configured');
  return {
    kind: 'oauth',
    provider: record.Provider,
    refreshToken: decryptSecret(record.OAuthRefreshTokenEnc),
    fromEmail
  };
};

const resolveSendingConnection = async (ownerId, companyId, fromEmail) => {
  if (!companyId || !fromEmail) return null;

  // 1) If the chosen from-address is itself a connected mailbox, send through it.
  const exact = await DocCompanyEmail.scope('withTokens').findOne({
    where: { Email: fromEmail },
    include: [{ association: 'Company', where: { id: companyId, OwnerId: ownerId }, required: true }]
  });
  if (exact && exact.Provider && exact.VerifiedAt && (exact.OAuthRefreshTokenEnc || exact.SmtpPasswordEnc)) {
    return connectionFromRecord(exact, exact.Email);
  }

  // 2) Otherwise borrow the workspace's connected mailbox and send FROM the
  //    chosen address (an alias or another address on the same domain).
  const connected = await DocCompanyEmail.scope('withTokens').findOne({
    where: { Provider: { [Op.ne]: null }, VerifiedAt: { [Op.ne]: null } },
    include: [{ association: 'Company', where: { id: companyId, OwnerId: ownerId }, required: true }],
    order: [['IsDefault', 'DESC']]
  });
  if (!connected) {
    throw badRequest(
      `Connect a mailbox for this workspace before sending from ${fromEmail} (or share a signing link instead).`,
      'sender_not_connected'
    );
  }
  return connectionFromRecord(connected, fromEmail);
};

const signUrl = (token) => `${APP_BASE_URL}/sign/${token}`;

// Resolve the sending identity (name + from address) for an envelope. Falls back
// to the app user when no company is set. Validates fromEmail against the
// company's linked addresses.
const resolveSenderIdentity = async (ownerId, companyId, fromEmail, fallbackUser) => {
  if (!companyId) {
    return { fromName: fallbackUser.Name, fromEmail: fromEmail || null, replyTo: null, logoUrl: null };
  }
  const company = await DocCompany.findOne({
    where: { id: companyId, OwnerId: ownerId },
    include: [{ model: DocCompanyEmail, as: 'Emails' }]
  });
  if (!company) throw badRequest('Company not found.', 'bad_company');
  const linked = company.Emails || [];
  // A chosen from-address doesn't have to be a stored row: a workspace can send
  // from any address on its connected mailbox's domain (e.g. an alias). If it's
  // not provided, fall back to the default/first stored address.
  const chosen = fromEmail
    ? linked.find((e) => e.Email === fromEmail) || null
    : linked.find((e) => e.IsDefault) || linked[0] || null;
  // Default Reply-To to the intended from-address. If that address is an alias
  // the connected mailbox can't yet send "as" (so the provider rewrites the
  // visible From to the signed-in account), a Reply-To still routes replies back
  // to the workspace address the sender chose.
  const fromChosen = fromEmail || (chosen ? chosen.Email : company.SenderEmail || null);
  return {
    fromName: company.SenderName || company.Name,
    fromEmail: fromChosen,
    replyTo: company.ReplyToEmail || fromChosen,
    logoUrl: company.LogoUrl || null
  };
};

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
  deliveryMode: env.DeliveryMode,
  requireVerification: env.RequireVerification,
  fromEmail: env.FromEmail,
  companyId: env.DocCompanyId,
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
  const where = { ...(await listScope(req.userId, req.query, 'CreatedBy')) };
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

  const doc = await DocDocument.findOne({ where: { id: b.documentId, ArchivedAt: null } });
  if (!doc || !(await canAccessRecord(req.userId, doc))) throw badRequest('Document not found.', 'bad_document');

  let template = null;
  if (b.templateId) {
    template = await DocTemplate.findOne({
      where: { id: b.templateId },
      include: [{ model: DocSignatureField, as: 'Fields' }]
    });
    if (!template || !(await canAccessRecord(req.userId, template))) throw badRequest('Template not found.', 'bad_template');
  }

  // Validate any referenced recipients belong to this owner.
  const recipientIds = b.signers.map((s) => s.recipientId).filter(Boolean);
  if (recipientIds.length) {
    const owned = await DocRecipient.count({ where: { id: recipientIds, OwnerId: req.userId } });
    if (owned !== new Set(recipientIds).size) throw badRequest('Unknown recipient.', 'bad_recipient');
  }

  // Resolve company (explicit, else inherit from document) + sending identity.
  const companyId = b.companyId
    ? await resolveCompanyId(req.userId, b.companyId)
    : doc.DocCompanyId || (template ? template.DocCompanyId : null);
  const sender = await resolveSenderIdentity(req.userId, companyId, b.fromEmail, req.user);
  // In link mode, verification is optional (default off unless explicitly set).
  const requireVerification =
    b.deliveryMode === 'link' ? b.requireVerification === true : b.requireVerification !== false;

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
      autoFill: f.AutoFill,
      fontSize: f.FontSize,
      font: f.Font,
      label: f.Label
    }));

  const env = await sequelize.transaction(async (t) => {
    const envelope = await DocEnvelope.create(
      {
        DocDocumentId: doc.id,
        DocProjectId: b.projectId || doc.DocProjectId || null,
        DocCompanyId: companyId,
        DocTemplateId: b.templateId || null,
        CreatedBy: req.userId,
        Subject: b.subject,
        Message: b.message || null,
        Status: 'draft',
        SigningOrder: b.signingOrder || 'parallel',
        DeliveryMode: b.deliveryMode || 'email',
        RequireVerification: requireVerification,
        FromEmail: sender.fromEmail,
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
        AutoFill: f.autoFill === true,
        FontSize: f.fontSize || null,
        Font: f.font || null,
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

  // Auto-fill the address book: remember each signer as a saved recipient so they
  // show up in the "From saved recipient" picker (and favorites) next time.
  // Best-effort — never block sending on this.
  try {
    for (const s of b.signers) {
      if (!s.email) continue;
      const email = String(s.email).trim().toLowerCase();
      const [rec, created] = await DocRecipient.findOrCreate({
        where: { OwnerId: req.userId, Email: email, ArchivedAt: null },
        defaults: {
          OwnerId: req.userId,
          Name: s.name || email,
          Email: email,
          Title: s.signerRole || null,
          DocCompanyId: companyId || null
        }
      });
      // Touch existing entries (changed:true forces updatedAt) so "recently used"
      // ordering surfaces them.
      if (!created) {
        rec.Name = s.name || rec.Name;
        rec.changed('updatedAt', true);
        await rec.save();
      }
    }
  } catch {
    /* address book is best-effort */
  }

  res.status(201).json({ data: serialize(await withGraph(env.id, req.userId)) });
});

/**
 * Send a draft. In 'email' mode, the first signer(s) per signing order are
 * emailed from the company identity. In 'link' mode nothing is emailed — the
 * response includes copyable signing links for the sender to share manually.
 */
exports.send = asyncHandler(async (req, res) => {
  const env = await withGraph(req.params.id, req.userId);
  if (!env) throw notFound('Envelope not found');
  if (env.Status !== 'draft') throw badRequest('Only draft envelopes can be sent.', 'not_draft');
  if (!env.Signers?.length) throw badRequest('Add at least one signer first.', 'no_signers');

  // The default signer scope hides AccessToken; reload with it to build sign URLs.
  const signers = (
    await DocEnvelopeSigner.scope('withSecrets').findAll({ where: { DocEnvelopeId: env.id } })
  ).sort((a, b) => a.SigningOrder - b.SigningOrder);
  // Sequential: only the lowest signing order is active first. Parallel: all.
  const firstOrder = signers[0].SigningOrder;
  const active = env.SigningOrder === 'sequential' ? signers.filter((s) => s.SigningOrder === firstOrder) : signers;

  const isLink = env.DeliveryMode === 'link';

  // Resolve (and gate on) the sending mailbox BEFORE marking the envelope sent,
  // so a "not connected" error leaves it as a draft the user can fix.
  const identity = isLink ? null : await resolveSenderIdentity(req.userId, env.DocCompanyId, env.FromEmail, req.user);
  let connection = null;
  if (!isLink) {
    try {
      connection = await resolveSendingConnection(req.userId, env.DocCompanyId, env.FromEmail);
    } catch (err) {
      // Not connected via OAuth. If the system mailbox can legitimately send from
      // this address (its domain is verified with our provider — e.g.
      // info@cryptool.io via cryptool.io's SES), fall back to sending through it.
      // Otherwise (a different domain, or no transport) require an OAuth mailbox.
      if (!systemCanSendFrom(identity && identity.fromEmail)) throw err;
      connection = null;
    }
    if (connection) connection.fromName = identity.fromName;
  }

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
        metadata: { order: env.SigningOrder, deliveryMode: env.DeliveryMode, active: active.map((s) => s.Email) }
      },
      { transaction: t }
    );
    // In email mode we mark who was notified; in link mode nothing is emailed.
    if (!isLink) {
      for (const s of active) await s.update({ NotifiedAt: new Date() }, { transaction: t });
    }
  });

  if (!isLink) {
    await Promise.allSettled(
      active.map((s) => {
        if (connection) {
          const msg = {
            to: s.Email,
            subject: env.Subject || `${identity.fromName} requested your signature`,
            html: signatureRequestHtml({ signerName: s.Name, senderName: identity.fromName, message: env.Message, signUrl: signUrl(s.AccessToken), logoUrl: identity.logoUrl }),
            replyTo: identity.replyTo
          };
          // Send through the user's own connected mailbox: SMTP or OAuth.
          if (connection.kind === 'smtp') return sendViaSmtp(connection, msg);
          return oauth.sendViaConnection(connection, msg);
        }
        return signatureRequest({
          to: s.Email,
          signerName: s.Name,
          senderName: identity.fromName,
          fromEmail: identity.fromEmail,
          replyTo: identity.replyTo,
          subject: env.Subject,
          message: env.Message,
          signUrl: signUrl(s.AccessToken),
          logoUrl: identity.logoUrl
        });
      })
    );
  }

  // Always return the signing links (all signers) so the sender can copy them —
  // essential in link mode, handy in email mode.
  const links = signers.map((s) => ({
    signerId: s.id,
    name: s.Name,
    email: s.Email,
    signingOrder: s.SigningOrder,
    active: active.some((a) => a.id === s.id),
    url: signUrl(s.AccessToken)
  }));

  res.json({ data: serialize(await withGraph(env.id, req.userId)), deliveryMode: env.DeliveryMode, links });
});

/**
 * Envelopes addressed to the logged-in user as a SIGNER (not as sender) — their
 * personal signing inbox. `status=pending` = still to sign; `status=signed` =
 * already signed by them. Matches on the account email OR an explicit
 * SignedByUserId attribution.
 */
exports.inbox = asyncHandler(async (req, res) => {
  const { Op } = require('sequelize');
  const wantSigned = req.query.status === 'signed';
  const signerWhere = {
    [Op.or]: [{ Email: req.user.Email }, { SignedByUserId: req.userId }]
  };
  signerWhere.Status = wantSigned ? 'signed' : { [Op.in]: ['pending', 'viewed'] };

  const signers = await DocEnvelopeSigner.findAll({
    where: signerWhere,
    include: [{ model: DocEnvelope, as: 'Envelope' }],
    order: [['createdAt', 'DESC']]
  });

  const data = [];
  for (const s of signers) {
    const env = s.Envelope;
    if (!env) continue;
    // For "to sign", only surface envelopes that are actually out for signature.
    if (!wantSigned && !['sent', 'partially_signed'].includes(env.Status)) continue;
    const doc = await DocDocument.findByPk(env.DocDocumentId);
    // Reload the signer with its access token so the frontend can deep-link.
    const withTok = await DocEnvelopeSigner.scope('withSecrets').findByPk(s.id);
    data.push({
      envelopeId: env.id,
      subject: env.Subject,
      status: env.Status,
      documentName: doc?.Name,
      signerStatus: s.Status,
      signedAt: s.SignedAt,
      completedAt: env.CompletedAt,
      hasCompletedFile: Boolean(env.CompletedFileKey),
      signUrl: signUrl(withTok.AccessToken)
    });
  }
  res.json({ data });
});

/** Return the per-signer signing links for an already-created envelope. */
exports.links = asyncHandler(async (req, res) => {
  const env = await DocEnvelope.findOne({ where: { id: req.params.id, CreatedBy: req.userId } });
  if (!env) throw notFound('Envelope not found');
  const signers = await DocEnvelopeSigner.scope('withSecrets').findAll({ where: { DocEnvelopeId: env.id } });
  res.json({
    data: signers
      .sort((a, b) => a.SigningOrder - b.SigningOrder)
      .map((s) => ({
        signerId: s.id,
        name: s.Name,
        email: s.Email,
        status: s.Status,
        signingOrder: s.SigningOrder,
        url: signUrl(s.AccessToken)
      }))
  });
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

// Shared so the OTP email can be sent from the SAME workspace mailbox + brand as
// the signing request (see publicSignController.requestOtp).
exports.resolveSenderIdentity = resolveSenderIdentity;
exports.resolveSendingConnection = resolveSendingConnection;
