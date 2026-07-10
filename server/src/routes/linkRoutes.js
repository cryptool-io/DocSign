const express = require('express');
const controller = require('../controllers/linkController');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { idParam } = require('../validation/commonValidation');
const linkSchemas = require('../validation/linkValidation');

const router = express.Router();
router.use(requireAuth);

router.get('/', controller.list);
router.post('/', validate(linkSchemas.create), controller.create);
router.patch('/:id', validate(idParam, 'params'), validate(linkSchemas.update), controller.update);
router.post('/:id/revoke', validate(idParam, 'params'), controller.revoke);
router.get('/:id/analytics', validate(idParam, 'params'), controller.analytics);

module.exports = router;
