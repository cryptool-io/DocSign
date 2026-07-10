const express = require('express');
const controller = require('../controllers/envelopeController');
const audit = require('../controllers/auditController');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { idParam } = require('../validation/commonValidation');
const schemas = require('../validation/envelopeValidation');

const router = express.Router();
router.use(requireAuth);

router.get('/', controller.list);
// Personal signing inbox — must precede /:id so "inbox" isn't read as an id.
router.get('/inbox', controller.inbox);
router.post('/', validate(schemas.create), controller.create);
router.get('/:id', validate(idParam, 'params'), controller.get);
router.post('/:id/send', validate(idParam, 'params'), controller.send);
router.get('/:id/links', validate(idParam, 'params'), controller.links);
router.post('/:id/void', validate(idParam, 'params'), validate(schemas.decline), controller.void);
router.post('/:id/signers/:signerId/remind', validate(idParam, 'params'), controller.remind);
router.get('/:id/audit', validate(idParam, 'params'), audit.trail);
router.get('/:id/completed-file', validate(idParam, 'params'), audit.completedFile);

module.exports = router;
