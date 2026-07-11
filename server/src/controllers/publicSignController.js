const {
  DocEnvelope,
  DocEnvelopeSigner,
  DocSignatureField,
  DocDocument,
  User,
  sequelize
} = require('../models');
const storage = require('../services/docroom/storage');
const {
  generateOtpCode,
  hashOtpCode,
  verifyOtpCode,
  issueSignerToken,
  verifySignerToken
} = require('../services/docroom/tokens');
const { verifyAccessToken } = require('../services/authTokens');
const { appendAuditEvent } = require('../services/docroom/hashChain');
const { finalizeEnvelope } = require('../services/docroom/completion');
const { signerOtp, signerOtpHtml, sendEmail, sendViaSmtp, envelopeCompleted } = require('../services/email');
const oauth = require('../services/emailOAuth');
const { resolveSenderIdentity, resolveSendingConnection } = require('./envelopeController');
const { asyncHandler, notFound, badRequest, forbidden, unauthorized, tooMany, clientIp } = require('../utils/http');

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

// Resolve a signer + envelope from the opaque access token in the URL.
const loadSignerByAccessToken = async (token) => {
  const signer = await DocEnvelopeSigner.scope('withSecrets').findOne({ where: { AccessToken: token } });
  if (!signer) throw notFound('This signing link is not valid.');
  const env = await DocEnvelope.findByPk(signer.DocEnvelopeId);
  if (!env) throw notFound('Envelope not found.');
  return { signer, env };
};

const assertSignable = (env, signer) => {
  if (['voided', 'declined', 'expired'].includes(env.Status)) {
    throw forbidden(`This document has been ${env.Status}.`, env.Status);
  }
  if (env.ExpiresAt && new Date(env.ExpiresAt) <= new Date()) throw forbidden('This request has expired.', 'expired');
  if (signer.Status === 'signed') throw forbidden('You have already signed this document.', 'already_signed');
  if (signer.Status === 'declined') throw forbidden('You have declined this document.', 'declined');
};

// Sequential order: a signer can't act until everyone before them has signed.
const isSignerTurn = async (env, signer) => {
  if (env.SigningOrder !== 'sequential') return true;
  const ahead = await DocEnvelopeSigner.count({
    where: {
      DocEnvelopeId: env.id,
      SigningOrder: { [sequelize.Sequelize.Op.lt]: signer.SigningOrder },
      Status: { [sequelize.Sequelize.Op.ne]: 'signed' }
    }
  });
  return ahead === 0;
};

/** Public: metadata + gate state for a signing link. */
exports.meta = asyncHandler(async (req, res) => {
  const { signer, env } = await loadSignerByAccessToken(req.params.token);
  const doc = await DocDocument.findByPk(env.DocDocumentId);
  const yourTurn = await isSignerTurn(env, signer);
  res.json({
    data: {
      subject: env.Subject,
      message: env.Message,
      status: env.Status,
      documentName: doc?.Name,
      pageCount: doc?.PageCount || 0,
      signer: { name: signer.Name, email: signer.Email, status: signer.Status },
      emailVerified: Boolean(signer.EmailVerifiedAt),
      requireVerification: env.RequireVerification,
      yourTurn,
      expiresAt: env.ExpiresAt
    }
  });
});

/**
 * Begin signing WITHOUT an email code — only allowed when the envelope was sent
 * with verification off (typically link-delivery mode). Records the view and
 * issues a signer token directly.
 */
exports.start = asyncHandler(async (req, res) => {
  const { signer, env } = await loadSignerByAccessToken(req.params.token);
  assertSignable(env, signer);
  if (env.RequireVerification) {
    throw forbidden('This document requires email verification. Request a code instead.', 'verification_required');
  }
  if (!(await isSignerTurn(env, signer))) throw forbidden('It is not your turn to sign yet.', 'not_your_turn');

  const ip = clientIp(req);
  const ua = req.headers['user-agent'] || null;
  await sequelize.transaction(async (t) => {
    await signer.update(
      {
        Status: signer.Status === 'pending' ? 'viewed' : signer.Status,
        ViewedAt: signer.ViewedAt || new Date(),
        IpAddress: ip,
        UserAgent: ua
      },
      { transaction: t }
    );
    await appendAuditEvent(
      {
        envelopeId: env.id,
        documentId: env.DocDocumentId,
        actorType: 'signer',
        actorId: signer.id,
        actorEmail: signer.Email,
        eventType: 'signer.opened',
        metadata: { signerId: signer.id, verification: 'none' },
        ipAddress: ip,
        userAgent: ua
      },
      { transaction: t }
    );
  });

  const token = issueSignerToken({ signerId: signer.id, envelopeId: env.id, email: signer.Email });
  res.json({ data: { signerToken: token } });
});

/**
 * Send the verification code from the envelope's workspace mailbox + brand — the
 * same identity the "please sign" email used. For a workspace with a connected
 * mailbox it goes through that mailbox; otherwise (or on any failure) it falls
 * back to the system mailbox so the signer can always get their code.
 */
const sendOtpBranded = async (env, signer, code) => {
  const to = signer.Email;
  try {
    if (env.DocCompanyId) {
      const identity = await resolveSenderIdentity(env.CreatedBy, env.DocCompanyId, env.FromEmail, { Name: 'DocSign' });
      let connection = null;
      try {
        connection = await resolveSendingConnection(env.CreatedBy, env.DocCompanyId, env.FromEmail);
      } catch {
        connection = null;
      }
      const subject = `Your signing verification code: ${code}`;
      const html = signerOtpHtml(code, { name: identity.fromName, logoUrl: identity.logoUrl });
      const msg = { to, subject, html, replyTo: identity.replyTo };
      if (connection && connection.kind === 'smtp') return await sendViaSmtp(connection, msg);
      if (connection && connection.kind === 'oauth') return await oauth.sendViaConnection(connection, msg);
      // No connected mailbox → system mailbox, but keep the workspace From + brand.
      return await sendEmail({ ...msg, fromName: identity.fromName, fromEmail: identity.fromEmail });
    }
  } catch (e) {
    console.warn(`[docsign] branded OTP failed, using system mailbox: ${e.message}`);
  }
  // Personal envelope, or a failure above: plain system-mailbox code.
  return signerOtp({ to, code });
};

/** Public: send the signer a 6-digit OTP to prove mailbox control. */
exports.requestOtp = asyncHandler(async (req, res) => {
  const { signer, env } = await loadSignerByAccessToken(req.params.token);
  assertSignable(env, signer);

  const code = generateOtpCode();
  await signer.update({
    OtpCodeHash: hashOtpCode(code),
    OtpExpiresAt: new Date(Date.now() + OTP_TTL_MS),
    OtpAttempts: 0
  });

  // Send the code from the SAME workspace mailbox + brand as the signing request
  // (not the generic system mailbox). Falls back to the system mailbox on any
  // problem so verification never gets stuck.
  await sendOtpBranded(env, signer, code);
  res.json({ ok: true, email: signer.Email.replace(/(.{2}).*(@.*)/, '$1***$2') });
});

/** Public: verify the OTP, mark email verified, issue a signer token. */
exports.verifyOtp = asyncHandler(async (req, res) => {
  const { signer, env } = await loadSignerByAccessToken(req.params.token);
  assertSignable(env, signer);

  if (!signer.OtpCodeHash || !signer.OtpExpiresAt || new Date(signer.OtpExpiresAt) < new Date()) {
    throw badRequest('Your code has expired. Request a new one.', 'otp_expired');
  }
  if (signer.OtpAttempts >= OTP_MAX_ATTEMPTS) {
    throw tooMany('Too many incorrect attempts. Request a new code.', 'otp_locked');
  }
  if (!verifyOtpCode(req.body.code, signer.OtpCodeHash)) {
    await signer.increment('OtpAttempts');
    throw unauthorized('Incorrect code.', 'otp_incorrect');
  }

  const ip = clientIp(req);
  const ua = req.headers['user-agent'] || null;
  await sequelize.transaction(async (t) => {
    await signer.update(
      {
        EmailVerifiedAt: signer.EmailVerifiedAt || new Date(),
        OtpCodeHash: null,
        OtpExpiresAt: null,
        Status: signer.Status === 'pending' ? 'viewed' : signer.Status,
        ViewedAt: signer.ViewedAt || new Date(),
        IpAddress: ip,
        UserAgent: ua
      },
      { transaction: t }
    );
    await appendAuditEvent(
      {
        envelopeId: env.id,
        documentId: env.DocDocumentId,
        actorType: 'signer',
        actorId: signer.id,
        actorEmail: signer.Email,
        eventType: 'signer.verified',
        metadata: { signerId: signer.id },
        ipAddress: ip,
        userAgent: ua
      },
      { transaction: t }
    );
  });

  const token = issueSignerToken({ signerId: signer.id, envelopeId: env.id, email: signer.Email });
  res.json({ data: { signerToken: token } });
});

// Middleware-ish: require a valid signer token bound to this access token.
const authorizeSigner = async (req) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw unauthorized('Verify your email first.', 'no_signer_token');
  let payload;
  try {
    payload = verifySignerToken(token);
  } catch {
    throw unauthorized('Your signing session expired. Verify again.', 'signer_expired');
  }
  const { signer, env } = await loadSignerByAccessToken(req.params.token);
  if (payload.signerId !== signer.id) throw forbidden('Token mismatch.');
  return { signer, env };
};

/** Authorized: the fields this signer must fill, plus a link to the PDF. */
exports.fields = asyncHandler(async (req, res) => {
  const { signer, env } = await authorizeSigner(req);
  const fields = await DocSignatureField.findAll({
    where: { DocEnvelopeId: env.id, DocEnvelopeSignerId: signer.id },
    order: [['PageNumber', 'ASC']]
  });
  res.json({
    data: fields.map((f) => ({
      id: f.id,
      type: f.Type,
      pageNumber: f.PageNumber,
      x: f.X,
      y: f.Y,
      width: f.Width,
      height: f.Height,
      required: f.Required,
      autoFill: f.AutoFill,
      label: f.Label
    }))
  });
});

/** Authorized: stream the PDF to a verified signer (ciphertext if encrypted). */
exports.file = asyncHandler(async (req, res) => {
  const { env } = await authorizeSigner(req);
  const doc = await DocDocument.findByPk(env.DocDocumentId);
  const buffer = await storage.getObject(doc.FileKey);
  if (doc.Encrypted) {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-Docsign-Encrypted', 'true');
    return res.send(buffer);
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline');
  res.send(buffer);
});

/**
 * Authorized: submit the signature. Records consent, writes each field's value,
 * flips the signer to 'signed', advances sequential order (notifying the next
 * signer), and finalizes the envelope when everyone has signed.
 */
// Attribute a signature to an app user when possible: an optional logged-in
// app token (X-App-Authorization) wins; otherwise match the signer's email to
// an existing account. Either way the completed doc shows up in that user's
// "signed by me" list.
const resolveSignedByUser = async (req, signerEmail) => {
  const appHeader = req.headers['x-app-authorization'] || '';
  const appToken = appHeader.startsWith('Bearer ') ? appHeader.slice(7) : null;
  if (appToken) {
    try {
      const payload = verifyAccessToken(appToken);
      const user = await User.findByPk(payload.sub);
      if (user && !user.DisabledAt) return user.id;
    } catch {
      /* fall through to email match */
    }
  }
  const match = await User.findOne({ where: { Email: String(signerEmail).toLowerCase() } });
  return match ? match.id : null;
};

exports.submit = asyncHandler(async (req, res) => {
  const { signer, env } = await authorizeSigner(req);
  assertSignable(env, signer);
  if (!(await isSignerTurn(env, signer))) throw forbidden('It is not your turn to sign yet.', 'not_your_turn');

  const { consent, signatureType, signatureData, initialsType, initialsData, values, documentKey } = req.body;

  // An encrypted document can only be finalized (stamped) with its key.
  const doc = await DocDocument.findByPk(env.DocDocumentId);
  if (doc?.Encrypted && !documentKey) {
    throw badRequest('This document is encrypted; a document key is required to sign.', 'no_document_key');
  }
  const ip = clientIp(req);
  const ua = req.headers['user-agent'] || null;
  const signedByUserId = await resolveSignedByUser(req, signer.Email);

  const fields = await DocSignatureField.findAll({
    where: { DocEnvelopeId: env.id, DocEnvelopeSignerId: signer.id }
  });
  const valueMap = new Map(values.map((v) => [v.fieldId, v.value]));

  // Every required field must be satisfied — either by a submitted value, or by
  // being a signature/initials/date field the server fills from the signature.
  for (const f of fields) {
    const provided = valueMap.get(f.id);
    const autoFilled = ['signature', 'initials', 'date'].includes(f.Type);
    if (f.Required && !autoFilled && (provided === undefined || provided === null || provided === '')) {
      throw badRequest(`Please complete the "${f.Label || f.Type}" field.`, 'missing_field');
    }
  }

  const nowIso = new Date().toISOString().slice(0, 10);
  const typedName = signatureType === 'typed' ? String(signatureData).slice(0, 120) : signer.Name;
  // Initials default to the capitals of the signer's name (e.g. "RMZ") when the
  // signer didn't supply their own. Typed renders as text; drawn stamps an image.
  const derivedInitials = String(signer.Name || '')
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .join('')
    .toUpperCase()
    .slice(0, 6);
  const typedInitials =
    initialsType === 'typed' && initialsData ? String(initialsData).slice(0, 12) : derivedInitials;

  await sequelize.transaction(async (t) => {
    for (const f of fields) {
      let value = valueMap.get(f.id) ?? null;
      if (f.Type === 'signature') {
        // Drawn image is stored on the signer; typed renders the name as text.
        value = signatureType === 'typed' ? typedName : null;
      } else if (f.Type === 'initials') {
        value = initialsType === 'drawn' ? null : typedInitials;
      } else if (f.Type === 'date') {
        // Auto-fill dates are always stamped with the signing date; manual dates
        // use the signer's entry, falling back to today.
        value = f.AutoFill ? nowIso : value || nowIso;
      } else if (f.Type === 'checkbox') {
        value = value ? 'X' : '';
      }
      await f.update({ Value: value }, { transaction: t });
    }

    await signer.update(
      {
        Status: 'signed',
        SignedAt: new Date(),
        ConsentedAt: new Date(),
        SignatureType: signatureType,
        SignatureImageKey: signatureType === 'drawn' ? signatureData : null,
        InitialsType: initialsType || (signatureType === 'drawn' ? 'drawn' : 'typed'),
        InitialsImageKey: initialsType === 'drawn' ? initialsData : null,
        SignedByUserId: signedByUserId,
        IpAddress: ip,
        UserAgent: ua
      },
      { transaction: t }
    );

    await appendAuditEvent(
      {
        envelopeId: env.id,
        documentId: env.DocDocumentId,
        actorType: 'signer',
        actorId: signer.id,
        actorEmail: signer.Email,
        eventType: 'signer.signed',
        metadata: { signatureType, consent: consent === true },
        ipAddress: ip,
        userAgent: ua
      },
      { transaction: t }
    );

    // Are there still signers who haven't signed?
    const remaining = await DocEnvelopeSigner.count({
      where: { DocEnvelopeId: env.id, Status: { [sequelize.Sequelize.Op.ne]: 'signed' } },
      transaction: t
    });
    if (remaining > 0 && env.Status === 'sent') {
      await env.update({ Status: 'partially_signed' }, { transaction: t });
    }
  });

  // Post-commit: notify the next sequential signer, or finalize.
  // withSecrets so the next signer's AccessToken is available for the sign URL.
  const remaining = await DocEnvelopeSigner.scope('withSecrets').findAll({
    where: { DocEnvelopeId: env.id, Status: { [sequelize.Sequelize.Op.ne]: 'signed' } }
  });

  if (remaining.length === 0) {
    const finalized = await finalizeEnvelope(env.id, { documentKey: documentKey || null });
    // Notify the sender + all signers that it's complete.
    const owner = await sequelize.models.User.findByPk(env.CreatedBy);
    const allSigners = await DocEnvelopeSigner.findAll({ where: { DocEnvelopeId: env.id } });
    const recipients = [owner?.Email, ...allSigners.map((s) => s.Email)].filter(Boolean);
    await Promise.allSettled(
      [...new Set(recipients)].map((to) =>
        envelopeCompleted({ to, subject: `Completed: ${env.Subject}`, downloadUrl: null })
      )
    );
    return res.json({ data: { status: finalized?.Status || 'completed' } });
  }

  if (env.SigningOrder === 'sequential') {
    const nextOrder = Math.min(...remaining.map((s) => s.SigningOrder));
    const next = remaining.filter((s) => s.SigningOrder === nextOrder && !s.NotifiedAt);
    const { signatureRequest } = require('../services/email');
    const owner = await sequelize.models.User.findByPk(env.CreatedBy);
    await Promise.allSettled(
      next.map((s) =>
        signatureRequest({
          to: s.Email,
          signerName: s.Name,
          senderName: owner?.Name || 'The sender',
          subject: env.Subject,
          message: env.Message,
          signUrl: `${require('../services/email').APP_BASE_URL}/sign/${s.AccessToken}`
        }).then(() => s.update({ NotifiedAt: new Date() }))
      )
    );
  }

  res.json({ data: { status: 'signed' } });
});

/** Public (post-verify): decline to sign. */
exports.decline = asyncHandler(async (req, res) => {
  const { signer, env } = await authorizeSigner(req);
  assertSignable(env, signer);
  const ip = clientIp(req);

  await sequelize.transaction(async (t) => {
    await signer.update(
      { Status: 'declined', DeclinedAt: new Date(), DeclineReason: req.body?.reason || null, IpAddress: ip },
      { transaction: t }
    );
    await env.update({ Status: 'declined' }, { transaction: t });
    await appendAuditEvent(
      {
        envelopeId: env.id,
        documentId: env.DocDocumentId,
        actorType: 'signer',
        actorId: signer.id,
        actorEmail: signer.Email,
        eventType: 'signer.declined',
        metadata: { reason: req.body?.reason || null },
        ipAddress: ip,
        userAgent: req.headers['user-agent'] || null
      },
      { transaction: t }
    );
  });
  res.json({ data: { status: 'declined' } });
});
