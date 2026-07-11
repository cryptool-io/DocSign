const { DocTemplate, DocSignatureField, DocDocument, sequelize } = require('../models');
const { Op } = require('sequelize');
const { asyncHandler, notFound, badRequest } = require('../utils/http');
const { resolveCompanyId } = require('../utils/companyScope');
const { listScope, canAccessRecord } = require('../utils/access');

// A workspace (or the personal space) has at most one default template. When one
// is marked default, clear the flag on its siblings.
const clearOtherDefaults = async (ownerId, companyId, keepId, t) => {
  await DocTemplate.update(
    { IsDefault: false },
    {
      where: {
        OwnerId: ownerId,
        DocCompanyId: companyId || null,
        id: { [Op.ne]: keepId },
        IsDefault: true
      },
      transaction: t
    }
  );
};

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
    autoFill: f.AutoFill,
    label: f.Label
  }))
});

// Owner OR a member of the template's workspace.
const withFields = async (id, userId) => {
  const tpl = await DocTemplate.findOne({ where: { id }, include: [{ model: DocSignatureField, as: 'Fields' }] });
  if (!tpl || !(await canAccessRecord(userId, tpl))) return null;
  return tpl;
};

exports.list = asyncHandler(async (req, res) => {
  const where = { ...(await listScope(req.userId, req.query)), ArchivedAt: null };
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
    AutoFill: f.autoFill === true,
    Label: f.label || null
  }));

exports.create = asyncHandler(async (req, res) => {
  const body = req.body;
  if (body.sourceDocumentId) {
    const doc = await DocDocument.findOne({ where: { id: body.sourceDocumentId } });
    if (!doc || !(await canAccessRecord(req.userId, doc))) throw badRequest('Source document not found.', 'bad_document');
  }

  const companyId = await resolveCompanyId(req.userId, body.companyId);
  const tpl = await sequelize.transaction(async (t) => {
    const created = await DocTemplate.create(
      {
        OwnerId: req.userId,
        DocProjectId: body.projectId || null,
        DocCompanyId: companyId,
        SourceDocumentId: body.sourceDocumentId || null,
        Name: body.name,
        Description: body.description || null,
        RequiresSignature: body.requiresSignature || false,
        SignerRoles: body.signerRoles || [],
        DefaultLinkSettings: body.defaultLinkSettings || {},
        IsDefault: body.isDefault || false
      },
      { transaction: t }
    );
    if (body.fields?.length) {
      await DocSignatureField.bulkCreate(fieldRows(created.id, body.fields), { transaction: t });
    }
    if (created.IsDefault) await clearOtherDefaults(req.userId, companyId, created.id, t);
    return created;
  });

  res.status(201).json({ data: serialize(await withFields(tpl.id, req.userId)) });
});

exports.update = asyncHandler(async (req, res) => {
  const tpl = await DocTemplate.findOne({ where: { id: req.params.id } });
  if (!tpl || !(await canAccessRecord(req.userId, tpl))) throw notFound('Template not found');
  const body = req.body;

  await sequelize.transaction(async (t) => {
    await tpl.update(
      {
        Name: body.name ?? tpl.Name,
        Description: body.description === undefined ? tpl.Description : body.description,
        RequiresSignature: body.requiresSignature ?? tpl.RequiresSignature,
        SignerRoles: body.signerRoles ?? tpl.SignerRoles,
        DefaultLinkSettings: body.defaultLinkSettings ?? tpl.DefaultLinkSettings,
        IsDefault: body.isDefault ?? tpl.IsDefault
      },
      { transaction: t }
    );
    if (body.fields) {
      await DocSignatureField.destroy({ where: { DocTemplateId: tpl.id }, transaction: t });
      if (body.fields.length) {
        await DocSignatureField.bulkCreate(fieldRows(tpl.id, body.fields), { transaction: t });
      }
    }
    if (tpl.IsDefault) await clearOtherDefaults(tpl.OwnerId, tpl.DocCompanyId, tpl.id, t);
  });

  res.json({ data: serialize(await withFields(tpl.id, req.userId)) });
});

exports.remove = asyncHandler(async (req, res) => {
  const tpl = await DocTemplate.findOne({ where: { id: req.params.id } });
  if (!tpl || !(await canAccessRecord(req.userId, tpl))) throw notFound('Template not found');
  await tpl.update({ ArchivedAt: new Date() });
  res.json({ ok: true });
});
