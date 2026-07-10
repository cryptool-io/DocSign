const express = require('express');
const rateLimit = require('express-rate-limit');
const controller = require('../controllers/publicDataRoomController');
const validate = require('../middleware/validate');
const schemas = require('../validation/dataRoomValidation');

const router = express.Router();
const publicLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });
router.use(publicLimiter);

router.get('/:token/meta', controller.meta);
router.post('/:token/open', validate(schemas.open), controller.open);

// Authorized (room token) surface, addressed by internal room id + document id.
router.get('/room/:roomId/document/:documentId/file', controller.file);
router.post('/room/:roomId/heartbeat', validate(schemas.heartbeat), controller.heartbeat);

module.exports = router;
