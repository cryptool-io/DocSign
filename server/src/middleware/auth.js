const { verifyAccessToken } = require('../services/authTokens');
const { User } = require('../models');
const { unauthorized, forbidden, asyncHandler } = require('../utils/http');

/**
 * Authenticate a sender (an app user). Reads a Bearer access token, loads the
 * user, and attaches req.user. Recipients (viewers/signers) never pass through
 * here — they authenticate with their own opaque link/signing tokens.
 */
const requireAuth = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw unauthorized('Missing access token', 'no_token');

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (err) {
    throw unauthorized(
      err.name === 'TokenExpiredError' ? 'Access token expired' : 'Invalid access token',
      'invalid_token'
    );
  }

  const user = await User.findByPk(payload.sub);
  if (!user || user.DisabledAt) throw unauthorized('Account not found or disabled', 'no_user');

  req.user = user;
  req.userId = user.id;
  next();
});

const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  if (!roles.includes(req.user.Role)) return next(forbidden('Insufficient role'));
  return next();
};

module.exports = { requireAuth, requireRole };
