const express = require('express');
const multer = require('multer');
const controller = require('../controllers/companyController');
const oauthController = require('../controllers/emailOAuthController');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { idParam } = require('../validation/commonValidation');
const schemas = require('../validation/companyValidation');

const router = express.Router();
router.use(requireAuth);

// Workspace logo upload (already resized client-side; cap at 2 MB just in case).
const logoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });

// Which OAuth email providers this server can connect (Gmail/Outlook).
router.get('/email-providers', oauthController.providers);

router.get('/', controller.list);
router.post('/', validate(schemas.create), controller.create);
router.get('/:id', validate(idParam, 'params'), controller.get);
router.patch('/:id', validate(idParam, 'params'), validate(schemas.update), controller.update);
router.delete('/:id', validate(idParam, 'params'), controller.remove);

// Team members (shared workspace access) — owner-managed.
router.get('/:id/members', validate(idParam, 'params'), controller.listMembers);
router.post('/:id/members', validate(idParam, 'params'), controller.addMember);
router.delete('/:id/members/:memberId', validate(idParam, 'params'), controller.removeMember);

router.post('/:id/logo', validate(idParam, 'params'), logoUpload.single('logo'), controller.uploadLogo);
router.post('/:id/emails', validate(idParam, 'params'), validate(schemas.addEmail), controller.addEmail);
router.delete('/:id/emails/:emailId', validate(idParam, 'params'), controller.removeEmail);
router.post('/:id/emails/:emailId/default', validate(idParam, 'params'), controller.setDefaultEmail);

// Live health check of the workspace's sending mailbox (used before an email send).
router.get('/:id/mailbox/health', validate(idParam, 'params'), controller.mailboxHealth);

// Connect / disconnect a real mailbox to send from.
router.get('/:id/connect/:provider', validate(idParam, 'params'), oauthController.authorize);
router.post('/:id/smtp', validate(idParam, 'params'), validate(schemas.connectSmtp), controller.connectSmtp);
router.delete('/:id/emails/:emailId/connection', validate(idParam, 'params'), oauthController.disconnect);

module.exports = router;
