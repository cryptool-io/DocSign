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
const { purgeEnvelopeStorage } = require('../services/retention');
const { flagConnectionError, clearConnectionError } = require('../services/mailboxHealth');
const { signerOtpHtml, sendEmail, sendViaSmtp, envelopeCompletedHtml, signatureRequestHtml, systemCanSendFrom, APP_BASE_URL } = require('../services/email');
const oauth = require('../services/emailOAuth');
const { formatDate } = require('../services/dateFormat');
const { resolveSenderIdentity, resolveSendingConnection, resolveBackupConnections } = require('./envelopeController');
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

  // A signer who is logged into DocSign with the SAME email doesn't need a code —
  // their login already proves the mailbox. Otherwise verification needs the OTP.
  let verifiedViaLogin = false;
  const appAuth = req.headers['x-app-authorization'];
  if (appAuth && appAuth.startsWith('Bearer ')) {
    try {
      const claims = verifyAccessToken(appAuth.slice(7));
      const user = await sequelize.models.User.findByPk(claims.userId);
      if (user && String(user.Email).toLowerCase() === String(signer.Email).toLowerCase()) verifiedViaLogin = true;
    } catch {
      /* invalid app token → fall through to the code requirement */
    }
  }
  if (env.RequireVerification && !verifiedViaLogin) {
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
        ...(verifiedViaLogin ? { EmailVerifiedAt: signer.EmailVerifiedAt || new Date() } : {}),
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
        metadata: { signerId: signer.id, verification: verifiedViaLogin ? 'login' : 'none' },
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
// Resolve the workspace sender identity + connected mailbox for an envelope
// (both null for a personal envelope → system mailbox).
const envelopeSender = async (env) => {
  if (!env.DocCompanyId) return { identity: null, connection: null, backups: [] };
  const identity = await resolveSenderIdentity(env.CreatedBy, env.DocCompanyId, env.FromEmail, { Name: 'DocSign' });
  let connection = null;
  try {
    connection = await resolveSendingConnection(env.CreatedBy, env.DocCompanyId, env.FromEmail);
  } catch {
    connection = null;
  }
  const backups = await resolveBackupConnections(
    env.CreatedBy,
    env.DocCompanyId,
    connection ? connection.emailId : null
  ).catch(() => []);
  return { identity, connection, backups };
};

// Send one message via the envelope's workspace mailbox, falling back to the
// system mailbox on any failure so delivery never gets stuck.
// Send through the workspace's OWN mailboxes only. A workspace's mail must never go
// out as the Cryptool system address (cross-brand). Order: the primary connection,
// then same-brand backup mailboxes (each from its own real address). The system
// mailbox is used ONLY when there's no workspace, OR the workspace's own from-address
// is on our verified domain (so the visible From is still that address, not a
// foreign brand). Otherwise we don't send — the mailbox-health alert prompts a reconnect.
const sendWithSender = async ({ identity, connection, backups = [] }, { to, subject, html, attachments }) => {
  if (!identity) return sendEmail({ to, subject, html, attachments }); // personal / no workspace

  const attempts = [];
  if (connection) attempts.push({ conn: connection, fromEmail: identity.fromEmail });
  for (const b of backups) attempts.push({ conn: b.connection, fromEmail: b.fromEmail });

  for (const a of attempts) {
    try {
      const msg = { to, subject, html, attachments, replyTo: identity.replyTo, fromName: identity.fromName, fromEmail: a.fromEmail };
      const result = a.conn.kind === 'smtp' ? await sendViaSmtp(a.conn, msg) : await oauth.sendViaConnection(a.conn, msg);
      if (a.conn.emailId) clearConnectionError(a.conn.emailId);
      return result;
    } catch (e) {
      console.warn(`[docsign] send via ${a.fromEmail} failed: ${e.message}`);
      if (a.conn.emailId) flagConnectionError(a.conn.emailId, e.message);
    }
  }

  // No working workspace mailbox.
  if (systemCanSendFrom(identity.fromEmail)) {
    // The workspace address is on our verified domain → From stays that address.
    return sendEmail({ to, subject, html, attachments, fromName: identity.fromName, fromEmail: identity.fromEmail, replyTo: identity.replyTo });
  }
  console.error(`[docsign] no working mailbox for workspace "${identity.fromName}" — skipping "${subject}" (won't send as system).`);
  return { skipped: true };
};

const brandOf = (identity) =>
  identity ? { name: identity.fromName, logoUrl: identity.logoUrl, contactEmail: identity.replyTo } : undefined;

const sendOtpBranded = async (env, signer, code) => {
  const sender = await envelopeSender(env);
  return sendWithSender(sender, {
    to: signer.Email,
    subject: `Your signing verification code: ${code}`,
    html: signerOtpHtml(code, brandOf(sender.identity))
  });
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

  // Send the code from the SAME workspace mailbox + brand as the signing request.
  // Never from the generic system mailbox — a workspace's mail must only ever come
  // from its own addresses (same-brand backups are tried first).
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

/**
 * Authorized: ALL fields on the document. The current signer's are theirs to
 * fill (`mine: true`); other signers' fields are shown read-only with whatever
 * they've already entered, so a later signer sees the earlier signers' input.
 */
exports.fields = asyncHandler(async (req, res) => {
  const { signer, env } = await authorizeSigner(req);
  const fields = await DocSignatureField.findAll({
    where: { DocEnvelopeId: env.id },
    include: [{ model: DocEnvelopeSigner, as: 'Signer', attributes: ['id', 'Name', 'Status', 'SignatureImageKey', 'InitialsImageKey'] }],
    order: [['PageNumber', 'ASC']]
  });
  res.json({
    data: fields.map((f) => {
      const mine = f.DocEnvelopeSignerId === signer.id;
      const signed = f.Signer?.Status === 'signed';
      // For another signer's signature/initials, show their actual drawn image if
      // they drew it, else their name as the rendered value.
      let value = f.Value;
      let valueImage = null;
      if (!mine && signed && (f.Type === 'signature' || f.Type === 'initials')) {
        valueImage = f.Type === 'signature' ? f.Signer?.SignatureImageKey : f.Signer?.InitialsImageKey;
        if (!valueImage && !value) value = f.Signer?.Name || '✓';
      }
      return {
        id: f.id,
        type: f.Type,
        pageNumber: f.PageNumber,
        x: f.X,
        y: f.Y,
        width: f.Width,
        height: f.Height,
        required: f.Required,
        autoFill: f.AutoFill,
        signatureMode: f.SignatureMode || 'any',
        fontSize: f.FontSize,
        font: f.Font,
        dateFormat: f.DateFormat || null,
        label: f.Label,
        mine,
        value: mine ? undefined : value || '',
        valueImage: mine ? undefined : valueImage || null,
        byName: mine ? undefined : f.Signer?.Name || null
      };
    })
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

  // Enforce the required signature style, but only for REQUIRED signature fields —
  // an optional signature may be left blank. If any required signature field demands
  // a drawn signature the signer must draw it; if it demands a typed name, they type.
  const sigModes = fields.filter((f) => f.Type === 'signature' && f.Required).map((f) => f.SignatureMode || 'any');
  if (sigModes.includes('draw') && signatureType !== 'drawn') {
    throw badRequest('This document requires a hand-drawn signature.', 'signature_must_draw');
  }
  if (sigModes.includes('type') && signatureType !== 'typed') {
    throw badRequest('This document requires your typed name as the signature.', 'signature_must_type');
  }

  // A REQUIRED signature must actually be provided (defense-in-depth; the UI also
  // enforces this). Optional signatures may be left blank.
  const hasRequiredSignature = fields.some((f) => f.Type === 'signature' && f.Required);
  const signatureProvided =
    signatureType === 'drawn' ? Boolean(signatureData) : Boolean(String(signatureData || '').trim());
  if (hasRequiredSignature && !signatureProvided) {
    throw badRequest('Please provide your signature.', 'signature_required');
  }

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
        // Auto-fill dates are stamped with the signing date in the sender's chosen
        // format; manual dates use the signer's entry, falling back to today (also
        // formatted). Formatting here means the PDF stamps the value verbatim.
        const todayFormatted = formatDate(new Date(), f.DateFormat);
        value = f.AutoFill ? todayFormatted : value || todayFormatted;
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
    // Notify the sender + all signers that it's complete — with the signed PDF
    // attached (plaintext docs only; encrypted docs are never emailed in the
    // clear, so the sender downloads them in-app), from the workspace mailbox.
    // The workspace's own send-address is copied too, so e.g. MickAI keeps a copy
    // even when only an external end-user signed.
    const owner = await sequelize.models.User.findByPk(env.CreatedBy);
    const allSigners = await DocEnvelopeSigner.findAll({ where: { DocEnvelopeId: env.id } });
    const sender = await envelopeSender(env);
    const recipients = [
      ...new Set(
        [owner?.Email, sender.identity?.fromEmail, env.FromEmail, ...allSigners.map((s) => s.Email)]
          .filter(Boolean)
          .map((e) => e.toLowerCase())
      )
    ];
    const attachments =
      finalized?.pdfBuffer && !finalized.encrypted
        ? [{ filename: finalized.fileName || 'signed.pdf', content: finalized.pdfBuffer, contentType: 'application/pdf' }]
        : undefined;
    // Who signed and when, in signing order — so the mail says who executed the
    // document without anyone having to open the certificate of completion.
    const signedBy = allSigners
      .filter((s) => s.Status === 'signed')
      .sort((a, b) => (a.SigningOrder || 0) - (b.SigningOrder || 0) || new Date(a.SignedAt || 0) - new Date(b.SignedAt || 0))
      .map((s) => ({ name: s.Name, email: s.Email, signedAt: s.SignedAt }));
    const html = envelopeCompletedHtml(Boolean(attachments), null, brandOf(sender.identity), signedBy);
    const results = await Promise.allSettled(
      recipients.map((to) => sendWithSender(sender, { to, subject: `Completed: ${env.Subject}`, html, attachments }))
    );
    // Privacy: once the signed PDF has actually reached the parties, drop the stored
    // bytes (only the SHA-256 + audit trail remain as tamper-evidence). If NOTHING
    // could be delivered (e.g. the workspace mailbox is down and we refuse to send
    // cross-brand), keep the file so it isn't lost — the owner is alerted to
    // reconnect and can still download it from Completed.
    const delivered = results.some((r) => r.status === 'fulfilled' && r.value && !r.value.skipped);
    if (delivered) await purgeEnvelopeStorage(env.id).catch(() => {});
    else console.error(`[docsign] completion email undelivered for ${env.id} — retaining the signed PDF.`);
    return res.json({ data: { status: finalized?.env?.Status || 'completed' } });
  }

  if (env.SigningOrder === 'sequential') {
    const nextOrder = Math.min(...remaining.map((s) => s.SigningOrder));
    const next = remaining.filter((s) => s.SigningOrder === nextOrder && !s.NotifiedAt);
    // Notify the next signer FROM the same workspace mailbox + brand as the first
    // signer's request (not the generic system mailbox).
    const sender = await envelopeSender(env);
    const senderName = sender.identity?.fromName || (await sequelize.models.User.findByPk(env.CreatedBy))?.Name || 'The sender';
    await Promise.allSettled(
      next.map((s) => {
        const html = signatureRequestHtml({
          signerName: s.Name,
          senderName,
          message: env.Message,
          signUrl: `${APP_BASE_URL}/sign/${s.AccessToken}`,
          logoUrl: sender.identity?.logoUrl,
          contactEmail: sender.identity?.replyTo
        });
        return sendWithSender(sender, {
          to: s.Email,
          subject: env.Subject || `${senderName} requested your signature`,
          html
        }).then(() => s.update({ NotifiedAt: new Date() }));
      })
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
