const { DocCompany, DocCompanyEmail, sequelize } = require('../models');
const { asyncHandler, notFound, badRequest, conflict } = require('../utils/http');
const { slugify } = require('../utils/misc');

const serialize = (company) => ({
  id: company.id,
  name: company.Name,
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
      // Only a connected + verified mailbox can send signature-request emails.
      canSend: Boolean(e.Provider && e.VerifiedAt),
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
  const { name, senderName, senderEmail, replyToEmail, logoUrl, emails } = req.body;
  let slug = slugify(name);
  if (await DocCompany.findOne({ where: { Slug: slug } })) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;

  const company = await sequelize.transaction(async (t) => {
    const created = await DocCompany.create(
      {
        OwnerId: req.userId,
        Name: name,
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
  const { name, senderName, senderEmail, replyToEmail, logoUrl } = req.body;
  await company.update({
    Name: name ?? company.Name,
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
