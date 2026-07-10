const express = require('express');
const rateLimit = require('express-rate-limit');
const controller = require('../controllers/publicSignController');
const validate = require('../middleware/validate');
const schemas = require('../validation/envelopeValidation');

const router = express.Router();

const publicLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });
const otpLimiter = rateLimit({ windowMs: 60 * 1000, max: 8, standardHeaders: true, legacyHeaders: false });
router.use(publicLimiter);

// Gate (opaque access token in URL).
router.get('/:token/meta', controller.meta);
router.post('/:token/request-otp', otpLimiter, controller.requestOtp);
router.post('/:token/verify-otp', otpLimiter, validate(schemas.verifyOtp), controller.verifyOtp);

// Authorized signer surface (requires signer token from verify-otp).
router.get('/:token/fields', controller.fields);
router.get('/:token/file', controller.file);
router.post('/:token/submit', validate(schemas.submit), controller.submit);
router.post('/:token/decline', validate(schemas.decline), controller.decline);

module.exports = router;
