const Joi = require('joi');

const email = Joi.string().email().max(254).lowercase().trim().required();
const password = Joi.string().min(8).max(128).required();

const register = Joi.object({
  name: Joi.string().min(1).max(120).trim().required(),
  email,
  password,
  company: Joi.string().max(160).trim().allow('', null)
});

const login = Joi.object({
  email,
  password: Joi.string().max(128).required()
});

const refresh = Joi.object({
  refreshToken: Joi.string().max(1024).optional()
});

const forgotPassword = Joi.object({ email });

const resetPassword = Joi.object({
  token: Joi.string().max(256).required(),
  password
});

const verifyEmail = Joi.object({
  token: Joi.string().max(256).required()
});

module.exports = { register, login, refresh, forgotPassword, resetPassword, verifyEmail };
