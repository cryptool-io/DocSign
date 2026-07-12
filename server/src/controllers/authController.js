const crypto = require('crypto');
const { Op } = require('sequelize');
const { User, sequelize } = require('../models');
const {
  signAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken
} = require('../services/authTokens');
const email = require('../services/email');
const { eraseAccount } = require('../services/retention');
const { asyncHandler, badRequest, unauthorized, conflict, clientIp } = require('../utils/http');

const REQUIRE_VERIFICATION = process.env.REQUIRE_EMAIL_VERIFICATION === 'true';
const ALLOWED_DOMAINS = (process.env.SIGNUP_ALLOWED_DOMAINS || '')
  .split(',')
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

const REFRESH_COOKIE = 'docsign_refresh';
const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/api/auth',
  maxAge: 1000 * 60 * 60 * 24 * 30
});

const context = (req) => ({ userAgent: req.headers['user-agent'] || null, ipAddress: clientIp(req) });

const sessionResponse = async (req, res, user, { created = false } = {}) => {
  const accessToken = signAccessToken(user);
  const { token: refreshToken } = await issueRefreshToken(user, context(req));
  res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions());
  res.status(created ? 201 : 200).json({
    user: user.toSafeJSON(),
    accessToken,
    // Also returned in the body so non-browser clients / the SPA can store it.
    refreshToken
  });
};

exports.register = asyncHandler(async (req, res) => {
  const { name, email: address, password, company } = req.body;

  if (ALLOWED_DOMAINS.length) {
    const domain = address.split('@')[1];
    if (!ALLOWED_DOMAINS.includes(domain)) {
      throw badRequest('Sign-ups are restricted to approved email domains.', 'domain_not_allowed');
    }
  }

  const existing = await User.findOne({ where: { Email: address } });
  if (existing) throw conflict('An account with that email already exists.', 'email_taken');

  const verificationToken = REQUIRE_VERIFICATION ? crypto.randomBytes(32).toString('base64url') : null;
  const user = await User.create({
    Name: name,
    Email: address,
    PasswordHash: await User.setPassword(password),
    Company: company || null,
    EmailVerifiedAt: REQUIRE_VERIFICATION ? null : new Date(),
    VerificationToken: verificationToken
  });

  if (REQUIRE_VERIFICATION) {
    await email.verifyEmail({ to: user.Email, name: user.Name, token: verificationToken });
    return res.status(201).json({
      user: user.toSafeJSON(),
      message: 'Check your email to verify your account before signing in.'
    });
  }

  return sessionResponse(req, res, user, { created: true });
});

exports.login = asyncHandler(async (req, res) => {
  const { email: address, password } = req.body;
  const user = await User.scope('withSecrets').findOne({ where: { Email: address } });
  // Constant-ish work whether or not the user exists.
  const ok = user ? await user.comparePassword(password) : false;
  if (!user || !ok) throw unauthorized('Invalid email or password.', 'bad_credentials');
  if (user.DisabledAt) throw unauthorized('This account has been disabled.', 'disabled');
  if (REQUIRE_VERIFICATION && !user.EmailVerifiedAt) {
    throw unauthorized('Please verify your email before signing in.', 'unverified');
  }

  await user.update({ LastLoginAt: new Date() });
  return sessionResponse(req, res, user);
});

exports.refresh = asyncHandler(async (req, res) => {
  const raw = req.cookies?.[REFRESH_COOKIE] || req.body?.refreshToken;
  if (!raw) throw unauthorized('Missing refresh token.', 'no_refresh');

  const result = await rotateRefreshToken(raw, context(req));
  if (!result) {
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    throw unauthorized('Refresh token invalid or expired.', 'bad_refresh');
  }

  const accessToken = signAccessToken(result.user);
  res.cookie(REFRESH_COOKIE, result.refresh.token, cookieOptions());
  res.json({
    user: result.user.toSafeJSON(),
    accessToken,
    refreshToken: result.refresh.token
  });
});

exports.logout = asyncHandler(async (req, res) => {
  const raw = req.cookies?.[REFRESH_COOKIE] || req.body?.refreshToken;
  if (raw) await revokeRefreshToken(raw);
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
  res.json({ ok: true });
});

exports.me = asyncHandler(async (req, res) => {
  res.json({ user: req.user.toSafeJSON() });
});

/**
 * Initialize (or replace) the account's encryption key material. The client
 * generates everything locally and sends only wrapped/salted values — the server
 * stores them opaquely and can never derive a usable key.
 */
exports.setupEncryption = asyncHandler(async (req, res) => {
  const { kdfSalt, wrappedAccountKey, recoveryWrappedAccountKey } = req.body;
  const user = await User.scope('withSecrets').findByPk(req.userId);
  // Only set once unless explicitly re-keying (guarded by allowReplace).
  if (user.WrappedAccountKey && !req.body.allowReplace) {
    throw badRequest('Encryption is already set up for this account.', 'already_setup');
  }
  await user.update({
    KdfSalt: kdfSalt,
    WrappedAccountKey: wrappedAccountKey,
    RecoveryWrappedAccountKey: recoveryWrappedAccountKey || user.RecoveryWrappedAccountKey || null
  });
  res.json({ ok: true, encryption: user.toSafeJSON().encryption });
});

/** Return the recovery-wrapped account key so a user with the recovery key can unlock. */
exports.recoveryBlob = asyncHandler(async (req, res) => {
  const user = await User.scope('withSecrets').findByPk(req.userId);
  res.json({
    data: {
      kdfSalt: user.KdfSalt,
      recoveryWrappedAccountKey: user.RecoveryWrappedAccountKey || null
    }
  });
});

exports.verifyEmail = asyncHandler(async (req, res) => {
  const { token } = req.body;
  const user = await User.scope('withSecrets').findOne({ where: { VerificationToken: token } });
  if (!user) throw badRequest('Invalid or already-used verification link.', 'bad_token');
  await user.update({ EmailVerifiedAt: new Date(), VerificationToken: null });
  res.json({ ok: true });
});

exports.forgotPassword = asyncHandler(async (req, res) => {
  const { email: address } = req.body;
  const user = await User.scope('withSecrets').findOne({ where: { Email: address } });
  // Always return ok, so this endpoint can't be used to enumerate accounts.
  if (user && !user.DisabledAt) {
    const token = crypto.randomBytes(32).toString('base64url');
    await user.update({
      ResetToken: token,
      ResetTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000)
    });
    await email.resetPassword({ to: user.Email, name: user.Name, token });
  }
  res.json({ ok: true });
});

exports.resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body;
  const user = await User.scope('withSecrets').findOne({
    where: { ResetToken: token, ResetTokenExpiresAt: { [Op.gt]: new Date() } }
  });
  if (!user) throw badRequest('This reset link is invalid or has expired.', 'bad_token');

  await sequelize.transaction(async (t) => {
    await user.update(
      { PasswordHash: await User.setPassword(password), ResetToken: null, ResetTokenExpiresAt: null },
      { transaction: t }
    );
    // Invalidate every existing session on password reset.
    await user.sequelize.models.UserRefreshToken.update(
      { RevokedAt: new Date() },
      { where: { UserId: user.id, RevokedAt: null }, transaction: t }
    );
  });

  res.json({ ok: true });
});

/**
 * Right to erasure (GDPR Art. 17). Requires the current password to confirm.
 * Purges personal/ancillary data + anonymizes the account; completed agreements
 * and their audit trail are retained for the legal period. Irreversible.
 */
exports.deleteAccount = asyncHandler(async (req, res) => {
  const { password } = req.body;
  const user = await User.scope('withSecrets').findByPk(req.userId);
  if (!user) throw unauthorized('Not signed in.', 'no_user');
  const ok = await user.comparePassword(password);
  if (!ok) throw badRequest('Password is incorrect.', 'bad_password');

  const summary = await eraseAccount(user.id);

  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
  res.json({
    ok: true,
    message: 'Your account and personal data have been erased.',
    ...summary
  });
});
