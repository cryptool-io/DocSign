const express = require('express');
const controller = require('../controllers/recipientGroupController');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { recipientGroup, idParam } = require('../validation/commonValidation');

const router = express.Router();
router.use(requireAuth);

router.get('/', controller.list);
router.post('/', validate(recipientGroup.create), controller.create);
router.patch('/:id', validate(idParam, 'params'), validate(recipientGroup.update), controller.update);
router.delete('/:id', validate(idParam, 'params'), controller.remove);

module.exports = router;
