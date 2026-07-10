const express = require('express');
const controller = require('../controllers/analyticsController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/overview', controller.overview);

module.exports = router;
