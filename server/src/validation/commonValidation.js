const Joi = require('joi');

const uuid = Joi.string().uuid({ version: ['uuidv4'] });
const idParam = Joi.object({ id: uuid.required() });

const project = {
  create: Joi.object({
    name: Joi.string().min(1).max(160).trim().required(),
    description: Joi.string().max(2000).allow('', null),
    logoUrl: Joi.string().uri().max(1000).allow('', null),
    companyId: uuid.allow(null)
  }),
  update: Joi.object({
    name: Joi.string().min(1).max(160).trim(),
    description: Joi.string().max(2000).allow('', null),
    logoUrl: Joi.string().uri().max(1000).allow('', null)
  }).min(1)
};

const recipient = {
  create: Joi.object({
    name: Joi.string().min(1).max(160).trim().required(),
    email: Joi.string().email().max(254).lowercase().trim().required(),
    company: Joi.string().max(160).allow('', null),
    title: Joi.string().max(160).allow('', null),
    projectId: uuid.allow(null),
    companyId: uuid.allow(null)
  }),
  update: Joi.object({
    name: Joi.string().min(1).max(160).trim(),
    email: Joi.string().email().max(254).lowercase().trim(),
    company: Joi.string().max(160).allow('', null),
    title: Joi.string().max(160).allow('', null),
    projectId: uuid.allow(null),
    companyId: uuid.allow(null),
    favorite: Joi.boolean()
  }).min(1)
};

const recipientGroup = {
  create: Joi.object({
    name: Joi.string().min(1).max(160).trim().required(),
    projectId: uuid.allow(null),
    companyId: uuid.allow(null),
    members: Joi.array()
      .items(
        Joi.object({
          recipientId: uuid.required(),
          signerRole: Joi.string().max(80).allow('', null),
          signingOrder: Joi.number().integer().min(1).max(50).default(1)
        })
      )
      .default([])
  }),
  update: Joi.object({
    name: Joi.string().min(1).max(160).trim(),
    members: Joi.array().items(
      Joi.object({
        recipientId: uuid.required(),
        signerRole: Joi.string().max(80).allow('', null),
        signingOrder: Joi.number().integer().min(1).max(50).default(1)
      })
    )
  }).min(1)
};

const field = Joi.object({
  type: Joi.string().valid('signature', 'initials', 'date', 'text', 'checkbox').required(),
  signerRole: Joi.string().max(80).allow('', null),
  pageNumber: Joi.number().integer().min(1).required(),
  x: Joi.number().min(0).max(1).required(),
  y: Joi.number().min(0).max(1).required(),
  width: Joi.number().min(0.001).max(1).required(),
  height: Joi.number().min(0.001).max(1).required(),
  required: Joi.boolean().default(true),
  autoFill: Joi.boolean().default(false),
  fontSize: Joi.number().integer().min(6).max(72).allow(null),
  font: Joi.string().valid('Helvetica', 'Times', 'Courier').allow('', null),
  signatureMode: Joi.string().valid('any', 'type', 'draw').allow('', null),
  dateFormat: Joi.string().max(20).allow('', null),
  label: Joi.string().max(160).allow('', null)
});

const template = {
  create: Joi.object({
    name: Joi.string().min(1).max(160).trim().required(),
    description: Joi.string().max(2000).allow('', null),
    projectId: uuid.allow(null),
    companyId: uuid.allow(null),
    sourceDocumentId: uuid.allow(null),
    requiresSignature: Joi.boolean().default(false),
    signerRoles: Joi.array()
      .items(
        Joi.object({
          key: Joi.string().max(80).required(),
          label: Joi.string().max(120).required(),
          order: Joi.number().integer().min(1).default(1)
        })
      )
      .default([]),
    defaultLinkSettings: Joi.object().default({}),
    defaultSubject: Joi.string().max(300).allow('', null),
    defaultMessage: Joi.string().max(5000).allow('', null),
    isDefault: Joi.boolean().default(false),
    fields: Joi.array().items(field).default([])
  }),
  update: Joi.object({
    name: Joi.string().min(1).max(160).trim(),
    description: Joi.string().max(2000).allow('', null),
    requiresSignature: Joi.boolean(),
    signerRoles: Joi.array().items(
      Joi.object({
        key: Joi.string().max(80).required(),
        label: Joi.string().max(120).required(),
        order: Joi.number().integer().min(1).default(1)
      })
    ),
    defaultLinkSettings: Joi.object(),
    defaultSubject: Joi.string().max(300).allow('', null),
    defaultMessage: Joi.string().max(5000).allow('', null),
    isDefault: Joi.boolean(),
    fields: Joi.array().items(field)
  }).min(1)
};

module.exports = { uuid, idParam, project, recipient, recipientGroup, template, field };
