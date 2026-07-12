const express = require('express');
const controller = require('../controllers/templateController');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { template, idParam } = require('../validation/commonValidation');

const router = express.Router();
router.use(requireAuth);

router.get('/', controller.list);
router.post('/', validate(template.create), controller.create);
router.get('/:id', validate(idParam, 'params'), controller.get);
router.patch('/:id', validate(idParam, 'params'), validate(template.update), controller.update);
router.post('/:id/restore', validate(idParam, 'params'), controller.restore);
router.delete('/:id', validate(idParam, 'params'), controller.remove);

module.exports = router;
