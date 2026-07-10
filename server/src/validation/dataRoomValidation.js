const Joi = require('joi');

const uuid = Joi.string().uuid({ version: ['uuidv4'] });

const documentItem = Joi.object({
  documentId: uuid.required(),
  label: Joi.string().max(200).allow('', null),
  folder: Joi.string().max(120).allow('', null),
  sortOrder: Joi.number().integer().min(0).max(10000)
});

const create = Joi.object({
  name: Joi.string().min(1).max(160).trim().required(),
  description: Joi.string().max(2000).allow('', null),
  projectId: uuid.allow(null),
  requireEmail: Joi.boolean().default(true),
  password: Joi.string().min(1).max(128).allow('', null),
  allowDownload: Joi.boolean().default(false),
  watermark: Joi.boolean().default(true),
  allowedEmails: Joi.array().items(Joi.string().max(254).lowercase().trim()).default([]),
  notifyOnView: Joi.boolean().default(true),
  expiresAt: Joi.date().iso().greater('now').allow(null),
  documents: Joi.array().items(documentItem).default([])
});

const update = Joi.object({
  name: Joi.string().min(1).max(160).trim(),
  description: Joi.string().max(2000).allow('', null),
  requireEmail: Joi.boolean(),
  password: Joi.string().min(1).max(128).allow('', null),
  allowDownload: Joi.boolean(),
  watermark: Joi.boolean(),
  allowedEmails: Joi.array().items(Joi.string().max(254).lowercase().trim()),
  notifyOnView: Joi.boolean(),
  expiresAt: Joi.date().iso().allow(null),
  documents: Joi.array().items(documentItem)
}).min(1);

const open = Joi.object({
  email: Joi.string().email().max(254).lowercase().trim().allow('', null),
  password: Joi.string().max(128).allow('', null)
});

const heartbeat = Joi.object({
  documentId: uuid.required(),
  pages: Joi.array()
    .items(Joi.object({ page: Joi.number().integer().min(1).required(), seconds: Joi.number().integer().min(0).max(86400).required() }))
    .max(2000)
    .required()
});

module.exports = { create, update, open, heartbeat };
