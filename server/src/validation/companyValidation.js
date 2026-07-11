const Joi = require('joi');

const emailEntry = Joi.object({
  email: Joi.string().email().max(254).lowercase().trim().required(),
  label: Joi.string().max(120).allow('', null),
  isDefault: Joi.boolean()
});

const create = Joi.object({
  name: Joi.string().min(1).max(160).trim().required(),
  description: Joi.string().max(2000).allow('', null),
  senderName: Joi.string().max(160).allow('', null),
  senderEmail: Joi.string().email().max(254).lowercase().trim().allow('', null),
  replyToEmail: Joi.string().email().max(254).lowercase().trim().allow('', null),
  logoUrl: Joi.string().uri().max(1000).allow('', null),
  emails: Joi.array().items(emailEntry).default([])
});

const update = Joi.object({
  name: Joi.string().min(1).max(160).trim(),
  description: Joi.string().max(2000).allow('', null),
  senderName: Joi.string().max(160).allow('', null),
  senderEmail: Joi.string().email().max(254).lowercase().trim().allow('', null),
  replyToEmail: Joi.string().email().max(254).lowercase().trim().allow('', null),
  logoUrl: Joi.string().uri().max(1000).allow('', null)
}).min(1);

const addEmail = Joi.object({
  email: Joi.string().email().max(254).lowercase().trim().required(),
  label: Joi.string().max(120).allow('', null),
  isDefault: Joi.boolean().default(false)
});

const connectSmtp = Joi.object({
  email: Joi.string().email().max(254).lowercase().trim().required(),
  host: Joi.string().hostname().max(255).required(),
  port: Joi.number().integer().min(1).max(65535).default(587),
  secure: Joi.boolean().default(false),
  username: Joi.string().max(254).allow('', null),
  password: Joi.string().min(1).max(512).required(),
  fromName: Joi.string().max(160).allow('', null)
});

module.exports = { create, update, addEmail, connectSmtp };
