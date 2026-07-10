const { DocTemplate, DocSignatureField, DocDocument, sequelize } = require('../models');
const { asyncHandler, notFound, badRequest } = require('../utils/http');
const { resolveCompanyId, companyFilter } = require('../utils/companyScope');

const serialize = (tpl) => ({
  ...tpl.toJSON(),
  fields: (tpl.Fields || []).map((f) => ({
    id: f.id,
    type: f.Type,
    signerRole: f.SignerRole,
    pageNumber: f.PageNumber,
    x: f.X,
    y: f.Y,
    width: f.Width,
    height: f.Height,
    required: f.Required,
    label: f.Label
  }))
});

const withFields = (id, ownerId) =>
  DocTemplate.findOne({
    where: { id, OwnerId: ownerId },
    include: [{ model: DocSignatureField, as: 'Fields' }]
  });

exports.list = asyncHandler(async (req, res) => {
  const where = { OwnerId: req.userId, ArchivedAt: null, ...companyFilter(req.query) };
  if (req.query.projectId) where.DocProjectId = req.query.projectId;
  const templates = await DocTemplate.findAll({ where, order: [['updatedAt', 'DESC']] });
  res.json({ data: templates });
});

exports.get = asyncHandler(async (req, res) => {
  const tpl = await withFields(req.params.id, req.userId);
  if (!tpl) throw notFound('Template not found');
  res.json({ data: serialize(tpl) });
});

// Field records for a template are addressed by signer ROLE (not a live signer),
// so the check constraint requires DocEnvelopeId to be null here.
const fieldRows = (templateId, fields) =>
  (fields || []).map((f) => ({
    DocTemplateId: templateId,
    DocEnvelopeId: null,
    DocEnvelopeSignerId: null,
    SignerRole: f.signerRole || null,
    Type: f.type,
    PageNumber: f.pageNumber,
    X: f.x,
    Y: f.y,
    Width: f.width,
    Height: f.height,
    Required: f.required !== false,
    Label: f.label || null
  }));

exports.create = asyncHandler(async (req, res) => {
  const body = req.body;
  if (body.sourceDocumentId) {
    const doc = await DocDocument.findOne({ where: { id: body.sourceDocumentId, OwnerId: req.userId } });
    if (!doc) throw badRequest('Source document not found.', 'bad_document');
  }

  const tpl = await sequelize.transaction(async (t) => {
    const created = await DocTemplate.create(
      {
        OwnerId: req.userId,
        DocProjectId: body.projectId || null,
        DocCompanyId: await resolveCompanyId(req.userId, body.companyId),
        SourceDocumentId: body.sourceDocumentId || null,
        Name: body.name,
        Description: body.description || null,
        RequiresSignature: body.requiresSignature || false,
        SignerRoles: body.signerRoles || [],
        DefaultLinkSettings: body.defaultLinkSettings || {}
      },
      { transaction: t }
    );
    if (body.fields?.length) {
      await DocSignatureField.bulkCreate(fieldRows(created.id, body.fields), { transaction: t });
    }
    return created;
  });

  res.status(201).json({ data: serialize(await withFields(tpl.id, req.userId)) });
});

exports.update = asyncHandler(async (req, res) => {
  const tpl = await DocTemplate.findOne({ where: { id: req.params.id, OwnerId: req.userId } });
  if (!tpl) throw notFound('Template not found');
  const body = req.body;

  await sequelize.transaction(async (t) => {
    await tpl.update(
      {
        Name: body.name ?? tpl.Name,
        Description: body.description === undefined ? tpl.Description : body.description,
        RequiresSignature: body.requiresSignature ?? tpl.RequiresSignature,
        SignerRoles: body.signerRoles ?? tpl.SignerRoles,
        DefaultLinkSettings: body.defaultLinkSettings ?? tpl.DefaultLinkSettings
      },
      { transaction: t }
    );
    if (body.fields) {
      await DocSignatureField.destroy({ where: { DocTemplateId: tpl.id }, transaction: t });
      if (body.fields.length) {
        await DocSignatureField.bulkCreate(fieldRows(tpl.id, body.fields), { transaction: t });
      }
    }
  });

  res.json({ data: serialize(await withFields(tpl.id, req.userId)) });
});

exports.remove = asyncHandler(async (req, res) => {
  const tpl = await DocTemplate.findOne({ where: { id: req.params.id, OwnerId: req.userId } });
  if (!tpl) throw notFound('Template not found');
  await tpl.update({ ArchivedAt: new Date() });
  res.json({ ok: true });
});
