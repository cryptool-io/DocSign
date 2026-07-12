const express = require('express');
const multer = require('multer');
const controller = require('../controllers/documentController');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { idParam } = require('../validation/commonValidation');

const router = express.Router();
router.use(requireAuth);

// Keep uploads in memory; we hash + stream them straight to storage.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024, files: 1 }
});

router.get('/', controller.list);
router.post('/', upload.single('file'), controller.upload);
router.post('/:id/attach', validate(idParam, 'params'), upload.single('file'), controller.attach);
router.get('/:id', validate(idParam, 'params'), controller.get);
router.patch('/:id', validate(idParam, 'params'), controller.update);
router.get('/:id/page-sizes', validate(idParam, 'params'), controller.pageSizes);
router.get('/:id/file', validate(idParam, 'params'), controller.download);
router.delete('/:id', validate(idParam, 'params'), controller.archive);

module.exports = router;
