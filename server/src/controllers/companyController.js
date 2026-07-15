const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const { DocCompany, DocCompanyEmail, DocCompanyMember, User, sequelize } = require('../models');
const { asyncHandler, notFound, badRequest, conflict } = require('../utils/http');
const { slugify } = require('../utils/misc');
const { systemCanSendFrom, SYSTEM_DOMAIN, verifySmtp } = require('../services/email');
const oauth = require('../services/emailOAuth');
const { encryptSecret, decryptSecret } = require('../services/secretStore');
const { flagConnectionError, clearConnectionError } = require('../services/mailboxHealth');
const { memberCompanyIds } = require('../utils/access');

const LOGO_DIR = path.resolve(__dirname, '../../storage/logos');
const APP_BASE_URL = (process.env.APP_BASE_URL || '').replace(/\/+$/, '');
const LOGO_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

const serialize = (company) => ({
  id: company.id,
  name: company.Name,
  description: company.Description,
  slug: company.Slug,
  senderName: company.SenderName,
  senderEmail: company.SenderEmail,
  replyToEmail: company.ReplyToEmail,
  logoUrl: company.LogoUrl,
  emails: (company.Emails || [])
    .slice()
    .sort((a, b) => (b.IsDefault ? 1 : 0) - (a.IsDefault ? 1 : 0))
    .map((e) => ({
      id: e.id,
      email: e.Email,
      label: e.Label,
      isDefault: e.IsDefault,
      verified: Boolean(e.VerifiedAt),
      provider: e.Provider || null,
      // canSend = OAuth-connected mailbox (sends THROUGH the user's own account).
      canSend: Boolean(e.Provider && e.VerifiedAt),
      // systemSend = the system SES/SMTP mailbox can send from this address
      // (same verified domain) without connecting anything.
      systemSend: !Boolean(e.Provider && e.VerifiedAt) && systemCanSendFrom(e.Email),
      systemDomain: SYSTEM_DOMAIN,
      smtpHost: e.SmtpHost || null,
      connectedAt: e.OAuthConnectedAt || null,
      // Set when a send through this mailbox failed (e.g. expired token) → UI shows
      // a "reconnect needed" state.
      needsReconnect: Boolean(e.ConnectionErrorAt),
      connectionError: e.ConnectionError || null
    })),
  createdAt: company.createdAt
});

const withEmails = (id, ownerId) =>
  DocCompany.findOne({
    where: { id, OwnerId: ownerId, ArchivedAt: null },
    include: [{ model: DocCompanyEmail, as: 'Emails' }]
  });

exports.list = asyncHandler(async (req, res) => {
  // Workspaces the user owns OR is a member of (shared team access).
  const memberIds = await memberCompanyIds(req.userId);
  const companies = await DocCompany.findAll({
    where: { ArchivedAt: null, [Op.or]: [{ OwnerId: req.userId }, { id: { [Op.in]: memberIds } }] },
    include: [{ model: DocCompanyEmail, as: 'Emails' }],
    order: [['createdAt', 'ASC']]
  });
  res.json({ data: companies.map((c) => ({ ...serialize(c), isOwner: c.OwnerId === req.userId })) });
});

exports.get = asyncHandler(async (req, res) => {
  const company = await withEmails(req.params.id, req.userId);
  if (!company) throw notFound('Company not found');
  res.json({ data: serialize(company) });
});

exports.create = asyncHandler(async (req, res) => {
  const { name, description, senderName, senderEmail, replyToEmail, logoUrl, emails } = req.body;
  let slug = slugify(name);
  if (await DocCompany.findOne({ where: { Slug: slug } })) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;

  const company = await sequelize.transaction(async (t) => {
    const created = await DocCompany.create(
      {
        OwnerId: req.userId,
        Name: name,
        Description: description || null,
        Slug: slug,
        SenderName: senderName || name,
        SenderEmail: senderEmail || null,
        ReplyToEmail: replyToEmail || null,
        LogoUrl: logoUrl || null
      },
      { transaction: t }
    );
    // Seed linked emails; the sender email (or first) becomes the default.
    const list = emails && emails.length ? emails : senderEmail ? [{ email: senderEmail, isDefault: true }] : [];
    if (list.length) {
      await DocCompanyEmail.bulkCreate(
        list.map((e, i) => ({
          DocCompanyId: created.id,
          Email: e.email,
          Label: e.label || null,
          IsDefault: e.isDefault ?? i === 0
        })),
        { transaction: t }
      );
    }
    return created;
  });

  res.status(201).json({ data: serialize(await withEmails(company.id, req.userId)) });
});

exports.update = asyncHandler(async (req, res) => {
  const company = await withEmails(req.params.id, req.userId);
  if (!company) throw notFound('Company not found');
  const { name, description, senderName, senderEmail, replyToEmail, logoUrl } = req.body;
  await company.update({
    Name: name ?? company.Name,
    Description: description === undefined ? company.Description : description,
    SenderName: senderName === undefined ? company.SenderName : senderName,
    SenderEmail: senderEmail === undefined ? company.SenderEmail : senderEmail,
    ReplyToEmail: replyToEmail === undefined ? company.ReplyToEmail : replyToEmail,
    LogoUrl: logoUrl === undefined ? company.LogoUrl : logoUrl
  });
  res.json({ data: serialize(await withEmails(company.id, req.userId)) });
});

exports.remove = asyncHandler(async (req, res) => {
  const company = await withEmails(req.params.id, req.userId);
  if (!company) throw notFound('Company not found');
  await company.update({ ArchivedAt: new Date() });
  res.json({ ok: true });
});

/**
 * Live health check of the mailbox this workspace would send through — used by the
 * Send page before an email send. Actually exercises the credential (refreshes the
 * OAuth token / re-verifies SMTP) and flags/clears the reconnect state accordingly.
 */
exports.mailboxHealth = asyncHandler(async (req, res) => {
  const company = await withEmails(req.params.id, req.userId);
  if (!company) throw notFound('Company not found');
  const emails = company.Emails || [];
  const pick =
    emails.find((e) => e.IsDefault && e.Provider && e.VerifiedAt) || emails.find((e) => e.Provider && e.VerifiedAt);
  // No connected mailbox → email goes via the system mailbox (nothing to reconnect).
  if (!pick) return res.json({ data: { ok: true, mode: 'system' } });

  const row = await DocCompanyEmail.scope('withTokens').findByPk(pick.id);
  try {
    if (row.Provider === 'smtp') {
      await verifySmtp({
        host: row.SmtpHost,
        port: row.SmtpPort,
        secure: row.SmtpSecure,
        user: row.SmtpUsername || row.Email,
        pass: decryptSecret(row.SmtpPasswordEnc)
      });
    } else {
      await oauth.refreshAccessToken(row.Provider, decryptSecret(row.OAuthRefreshTokenEnc));
    }
    await clearConnectionError(row.id);
    return res.json({ data: { ok: true, mode: 'workspace', email: row.Email, provider: row.Provider } });
  } catch (e) {
    await flagConnectionError(row.id, e.message);
    return res.json({
      data: { ok: false, needsReconnect: true, email: row.Email, provider: row.Provider, error: String(e.message || e).slice(0, 200) }
    });
  }
});

/* ---- Linked emails ------------------------------------------------------ */

exports.addEmail = asyncHandler(async (req, res) => {
  const company = await withEmails(req.params.id, req.userId);
  if (!company) throw notFound('Company not found');
  const { email, label, isDefault } = req.body;

  const exists = await DocCompanyEmail.findOne({ where: { DocCompanyId: company.id, Email: email.toLowerCase() } });
  if (exists) throw conflict('That email is already linked to this company.', 'email_linked');

  await sequelize.transaction(async (t) => {
    if (isDefault) {
      await DocCompanyEmail.update({ IsDefault: false }, { where: { DocCompanyId: company.id }, transaction: t });
    }
    await DocCompanyEmail.create(
      { DocCompanyId: company.id, Email: email, Label: label || null, IsDefault: Boolean(isDefault) },
      { transaction: t }
    );
  });
  res.status(201).json({ data: serialize(await withEmails(company.id, req.userId)) });
});

exports.removeEmail = asyncHandler(async (req, res) => {
  const company = await withEmails(req.params.id, req.userId);
  if (!company) throw notFound('Company not found');
  const email = await DocCompanyEmail.findOne({ where: { id: req.params.emailId, DocCompanyId: company.id } });
  if (!email) throw notFound('Email not found');
  await email.destroy();
  res.json({ data: serialize(await withEmails(company.id, req.userId)) });
});

exports.setDefaultEmail = asyncHandler(async (req, res) => {
  const company = await withEmails(req.params.id, req.userId);
  if (!company) throw notFound('Company not found');
  const email = await DocCompanyEmail.findOne({ where: { id: req.params.emailId, DocCompanyId: company.id } });
  if (!email) throw notFound('Email not found');
  await sequelize.transaction(async (t) => {
    await DocCompanyEmail.update({ IsDefault: false }, { where: { DocCompanyId: company.id }, transaction: t });
    await email.update({ IsDefault: true }, { transaction: t });
  });
  res.json({ data: serialize(await withEmails(company.id, req.userId)) });
});

/* ---- Team members ------------------------------------------------------- */

// Members of a workspace + its owner. Only the owner manages members (withEmails
// resolves owner-only).
exports.listMembers = asyncHandler(async (req, res) => {
  const company = await withEmails(req.params.id, req.userId);
  if (!company) throw notFound('Company not found');
  const [owner, members] = await Promise.all([
    User.findByPk(company.OwnerId),
    DocCompanyMember.findAll({ where: { DocCompanyId: company.id }, include: [{ model: User, as: 'User' }], order: [['createdAt', 'ASC']] })
  ]);
  res.json({
    data: {
      owner: owner ? { id: owner.id, name: owner.Name, email: owner.Email } : null,
      members: members.map((m) => ({ id: m.id, userId: m.UserId, role: m.Role, name: m.User?.Name || null, email: m.User?.Email || null, addedAt: m.createdAt }))
    }
  });
});

exports.addMember = asyncHandler(async (req, res) => {
  const company = await withEmails(req.params.id, req.userId);
  if (!company) throw notFound('Company not found');
  const email = String(req.body.email || '').trim().toLowerCase();
  const user = await User.findOne({ where: { Email: email } });
  if (!user) throw badRequest('No DocSign account with that email yet. Ask them to sign up first, then add them.', 'no_user');
  if (user.id === company.OwnerId) throw badRequest('That person already owns this workspace.', 'is_owner');
  const [m, created] = await DocCompanyMember.findOrCreate({
    where: { DocCompanyId: company.id, UserId: user.id },
    defaults: { Role: req.body.role === 'admin' ? 'admin' : 'member', InvitedByUserId: req.userId }
  });
  res.status(created ? 201 : 200).json({ data: { id: m.id, userId: user.id, name: user.Name, email: user.Email, role: m.Role } });
});

exports.removeMember = asyncHandler(async (req, res) => {
  const company = await withEmails(req.params.id, req.userId);
  if (!company) throw notFound('Company not found');
  const m = await DocCompanyMember.findOne({ where: { id: req.params.memberId, DocCompanyId: company.id } });
  if (!m) throw notFound('Member not found');
  await m.destroy();
  res.json({ ok: true });
});

/**
 * Upload a workspace logo for email branding. The browser has already resized
 * the image to email dimensions; we just validate, store it under the public
 * /logos dir, and point the workspace's LogoUrl at it.
 */
exports.uploadLogo = asyncHandler(async (req, res) => {
  const company = await withEmails(req.params.id, req.userId);
  if (!company) throw notFound('Company not found');
  if (!req.file) throw badRequest('No image uploaded (send it as multipart field "logo").', 'no_file');
  const ext = LOGO_EXT[req.file.mimetype];
  if (!ext) throw badRequest('Logo must be a PNG, JPG, WEBP or GIF image.', 'bad_type');

  fs.mkdirSync(LOGO_DIR, { recursive: true });
  const fname = `${company.id}-${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(LOGO_DIR, fname), req.file.buffer);
  await company.update({ LogoUrl: `${APP_BASE_URL}/logos/${fname}` });
  res.json({ data: serialize(await withEmails(company.id, req.userId)) });
});

/**
 * Connect a sending address via the user's OWN SMTP mailbox (app password).
 * Verifies the credentials against the SMTP server BEFORE saving, so a bad
 * password never gets stored. The password is encrypted at rest. Upserts the
 * linked-email row so the address becomes immediately sendable.
 */
exports.connectSmtp = asyncHandler(async (req, res) => {
  const company = await withEmails(req.params.id, req.userId);
  if (!company) throw notFound('Company not found');
  const { email, host, port, secure, username, password, fromName } = req.body;
  const addr = String(email).trim().toLowerCase();
  const user = username || addr;

  // Prove the credentials work before persisting anything.
  try {
    await verifySmtp({ host, port, secure, user, pass: password });
  } catch (err) {
    throw badRequest(`Could not sign in to that mailbox: ${String(err.message || err).slice(0, 200)}`, 'smtp_verify_failed');
  }

  const makeDefault = (company.Emails || []).length === 0;
  await sequelize.transaction(async (t) => {
    let row = await DocCompanyEmail.findOne({ where: { DocCompanyId: company.id, Email: addr }, transaction: t });
    const fields = {
      Provider: 'smtp',
      SmtpHost: host,
      SmtpPort: parseInt(port, 10),
      SmtpSecure: secure === true || secure === 'true' || parseInt(port, 10) === 465,
      SmtpUsername: user,
      SmtpPasswordEnc: encryptSecret(password),
      VerifiedAt: new Date(),
      OAuthConnectedAt: new Date(),
      ConnectionErrorAt: null,
      ConnectionError: null,
      Label: fromName || (row && row.Label) || null
    };
    if (row) {
      await row.update(fields, { transaction: t });
    } else {
      if (makeDefault) {
        await DocCompanyEmail.update({ IsDefault: false }, { where: { DocCompanyId: company.id }, transaction: t });
      }
      await DocCompanyEmail.create({ DocCompanyId: company.id, Email: addr, IsDefault: makeDefault, ...fields }, { transaction: t });
    }
  });
  res.json({ data: serialize(await withEmails(company.id, req.userId)) });
});
