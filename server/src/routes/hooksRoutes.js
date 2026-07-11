const express = require('express');
const controller = require('../controllers/hooksController');

// Public webhook surface (no app login). Auth is the GitHub HMAC signature,
// verified inside the controller against GITHUB_WEBHOOK_SECRET.
const router = express.Router();

router.post('/github', controller.github);

module.exports = router;
