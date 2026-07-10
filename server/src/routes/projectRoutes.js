const express = require('express');
const controller = require('../controllers/projectController');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { project, idParam } = require('../validation/commonValidation');

const router = express.Router();
router.use(requireAuth);

router.get('/', controller.list);
router.post('/', validate(project.create), controller.create);
router.get('/:id', validate(idParam, 'params'), controller.get);
router.patch('/:id', validate(idParam, 'params'), validate(project.update), controller.update);
router.delete('/:id', validate(idParam, 'params'), controller.archive);

module.exports = router;
