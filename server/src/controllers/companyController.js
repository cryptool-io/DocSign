const fs = require('fs');
const path = require('path');
const { DocCompany, DocCompanyEmail, sequelize } = require('../models');
const { asyncHandler, notFound, badRequest, conflict } = require('../utils/http');
const { slugify } = require('../utils/misc');
const { systemCanSendFrom, SYSTEM_DOMAIN, verifySmtp } = require('../services/email');
const { encryptSecret } = require('../services/secretStore');

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
      connectedAt: e.OAuthConnectedAt || null
    })),
  createdAt: company.createdAt
});

const withEmails = (id, ownerId) =>
  DocCompany.findOne({
    where: { id, OwnerId: ownerId, ArchivedAt: null },
    include: [{ model: DocCompanyEmail, as: 'Emails' }]
  });

exports.list = asyncHandler(async (req, res) => {
  const companies = await DocCompany.findAll({
    where: { OwnerId: req.userId, ArchivedAt: null },
    include: [{ model: DocCompanyEmail, as: 'Emails' }],
    order: [['createdAt', 'ASC']]
  });
  res.json({ data: companies.map(serialize) });
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
