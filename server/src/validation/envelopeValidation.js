const Joi = require('joi');

const uuid = Joi.string().uuid({ version: ['uuidv4'] });

const field = Joi.object({
  type: Joi.string().valid('signature', 'initials', 'date', 'text', 'checkbox').required(),
  signerRole: Joi.string().max(80).allow('', null),
  signerEmail: Joi.string().email().max(254).lowercase().allow('', null),
  pageNumber: Joi.number().integer().min(1).required(),
  x: Joi.number().min(0).max(1).required(),
  y: Joi.number().min(0).max(1).required(),
  width: Joi.number().min(0.001).max(1).required(),
  height: Joi.number().min(0.001).max(1).required(),
  required: Joi.boolean().default(true),
  autoFill: Joi.boolean().default(false),
  dateFormat: Joi.string().max(20).allow('', null),
  label: Joi.string().max(160).allow('', null)
});

const signer = Joi.object({
  recipientId: uuid.allow(null),
  name: Joi.string().min(1).max(160).required(),
  email: Joi.string().email().max(254).lowercase().trim().required(),
  signerRole: Joi.string().max(80).allow('', null),
  signingOrder: Joi.number().integer().min(1).max(50).default(1)
});

const create = Joi.object({
  documentId: uuid.required(),
  templateId: uuid.allow(null),
  projectId: uuid.allow(null),
  companyId: uuid.allow(null),
  subject: Joi.string().min(1).max(200).required(),
  message: Joi.string().max(4000).allow('', null),
  signingOrder: Joi.string().valid('sequential', 'parallel').default('parallel'),
  // 'email' emails each signer a link; 'link' returns copyable links, no email sent.
  deliveryMode: Joi.string().valid('email', 'link').default('email'),
  // Whether signers must confirm an emailed one-time code before signing.
  requireVerification: Joi.boolean().default(true),
  // Keep the signed PDF on the server after completion so the sender can download
  // it later. Off = it's emailed to the parties and then dropped.
  keepCompletedCopy: Joi.boolean().default(true),
  // The send-as address (must be one of the company's linked emails, if a company is set).
  fromEmail: Joi.string().email().max(254).lowercase().trim().allow('', null),
  expiresAt: Joi.date().iso().greater('now').allow(null),
  signers: Joi.array().items(signer).min(1).required(),
  // If omitted, fields are copied from the template (mapped by signerRole).
  fields: Joi.array().items(field).optional()
});

// --- Public signer flow --------------------------------------------------

const requestOtp = Joi.object({}); // token in URL param

const verifyOtp = Joi.object({
  code: Joi.string().length(6).pattern(/^\d{6}$/).required()
});

const submit = Joi.object({
  consent: Joi.boolean().valid(true).required(),
  signatureType: Joi.string().valid('typed', 'drawn').required(),
  // For 'drawn': a PNG data URL. For 'typed': the typed name string. May be empty
  // when the signer has no required signature field (optional signatures allowed);
  // a required signature is enforced server-side in the controller.
  signatureData: Joi.string().max(2_000_000).allow('').required(),
  // For encrypted documents: the raw DEK (base64) from the signing link fragment,
  // sent once over TLS so the server can decrypt-to-stamp. Never stored.
  documentKey: Joi.string().max(128).allow(null, ''),
  values: Joi.array()
    .items(
      Joi.object({
        fieldId: uuid.required(),
        value: Joi.string().max(4000).allow('', null)
      })
    )
    .default([])
});

const decline = Joi.object({
  reason: Joi.string().max(1000).allow('', null)
});

module.exports = { create, requestOtp, verifyOtp, submit, decline };
