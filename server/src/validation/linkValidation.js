const Joi = require('joi');

const uuid = Joi.string().uuid({ version: ['uuidv4'] });

const create = Joi.object({
  documentId: uuid.required(),
  recipientId: uuid.allow(null),
  name: Joi.string().max(160).allow('', null),
  requireEmail: Joi.boolean().default(true),
  password: Joi.string().min(1).max(128).allow('', null),
  allowDownload: Joi.boolean().default(false),
  watermark: Joi.boolean().default(true),
  allowedEmails: Joi.array().items(Joi.string().max(254).lowercase().trim()).default([]),
  notifyOnView: Joi.boolean().default(true),
  expiresAt: Joi.date().iso().greater('now').allow(null),
  maxViews: Joi.number().integer().min(1).max(100000).allow(null)
});

const update = Joi.object({
  name: Joi.string().max(160).allow('', null),
  requireEmail: Joi.boolean(),
  password: Joi.string().min(1).max(128).allow('', null),
  allowDownload: Joi.boolean(),
  watermark: Joi.boolean(),
  allowedEmails: Joi.array().items(Joi.string().max(254).lowercase().trim()),
  notifyOnView: Joi.boolean(),
  expiresAt: Joi.date().iso().allow(null),
  maxViews: Joi.number().integer().min(1).max(100000).allow(null)
}).min(1);

// Public viewer submits this to unlock a link.
const open = Joi.object({
  email: Joi.string().email().max(254).lowercase().trim().allow('', null),
  password: Joi.string().max(128).allow('', null)
});

// Heartbeat of per-page dwell time from the viewer.
const heartbeat = Joi.object({
  sessionId: uuid.required(),
  pages: Joi.array()
    .items(
      Joi.object({
        page: Joi.number().integer().min(1).required(),
        seconds: Joi.number().integer().min(0).max(86400).required()
      })
    )
    .max(2000)
    .required()
});

module.exports = { create, update, open, heartbeat };
