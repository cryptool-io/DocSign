const express = require('express');
const rateLimit = require('express-rate-limit');
const controller = require('../controllers/publicViewController');
const validate = require('../middleware/validate');
const linkSchemas = require('../validation/linkValidation');

const router = express.Router();

// Public surface — rate-limit to blunt token guessing / password brute force.
const publicLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });
router.use(publicLimiter);

// Gate / unlock (addressed by the opaque share token).
router.get('/:token/meta', controller.meta);
router.post('/:token/open', validate(linkSchemas.open), controller.open);

// Authorized viewer surface (addressed by internal link id + viewer token).
router.get('/link/:linkId/file', controller.file);
router.post('/link/:linkId/heartbeat', validate(linkSchemas.heartbeat), controller.heartbeat);
router.post('/link/:linkId/downloaded', controller.markDownloaded);

module.exports = router;
