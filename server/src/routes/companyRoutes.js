const express = require('express');
const controller = require('../controllers/companyController');
const oauthController = require('../controllers/emailOAuthController');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { idParam } = require('../validation/commonValidation');
const schemas = require('../validation/companyValidation');

const router = express.Router();
router.use(requireAuth);

// Which OAuth email providers this server can connect (Gmail/Outlook).
router.get('/email-providers', oauthController.providers);

router.get('/', controller.list);
router.post('/', validate(schemas.create), controller.create);
router.get('/:id', validate(idParam, 'params'), controller.get);
router.patch('/:id', validate(idParam, 'params'), validate(schemas.update), controller.update);
router.delete('/:id', validate(idParam, 'params'), controller.remove);

router.post('/:id/emails', validate(idParam, 'params'), validate(schemas.addEmail), controller.addEmail);
router.delete('/:id/emails/:emailId', validate(idParam, 'params'), controller.removeEmail);
router.post('/:id/emails/:emailId/default', validate(idParam, 'params'), controller.setDefaultEmail);

// Connect / disconnect a real mailbox to send from.
router.get('/:id/connect/:provider', validate(idParam, 'params'), oauthController.authorize);
router.delete('/:id/emails/:emailId/connection', validate(idParam, 'params'), oauthController.disconnect);

module.exports = router;
