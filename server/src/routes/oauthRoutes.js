const express = require('express');
const controller = require('../controllers/emailOAuthController');

// Public OAuth redirect target (no app auth — the provider redirects the browser
// here; the signed `state` param carries and verifies the user + company).
const router = express.Router();

router.get('/:provider/callback', controller.callback);

module.exports = router;
