const express = require('express');
const controller = require('../controllers/adminController');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/version', controller.version);
// Platform-wide user list with usage stats — admin only.
router.get('/users', requireRole('admin'), controller.listUsers);
// Only an admin may trigger a redeploy from the UI.
router.post('/update', requireRole('admin'), controller.selfUpdate);

module.exports = router;
