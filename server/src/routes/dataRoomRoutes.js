const express = require('express');
const controller = require('../controllers/dataRoomController');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { idParam } = require('../validation/commonValidation');
const schemas = require('../validation/dataRoomValidation');

const router = express.Router();
router.use(requireAuth);

router.get('/', controller.list);
router.post('/', validate(schemas.create), controller.create);
router.get('/:id', validate(idParam, 'params'), controller.get);
router.patch('/:id', validate(idParam, 'params'), validate(schemas.update), controller.update);
router.post('/:id/revoke', validate(idParam, 'params'), controller.revoke);
router.delete('/:id', validate(idParam, 'params'), controller.remove);
router.get('/:id/analytics', validate(idParam, 'params'), controller.analytics);

module.exports = router;
