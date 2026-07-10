require('dotenv').config();

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { UserRefreshToken } = require('../models');

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'dev-access-secret';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret';
const ACCESS_TTL = process.env.JWT_ACCESS_TTL || '15m';
const REFRESH_TTL_DAYS = parseInt((process.env.JWT_REFRESH_TTL || '30d').replace(/\D/g, ''), 10) || 30;

if (process.env.NODE_ENV === 'production') {
  if (!process.env.JWT_ACCESS_SECRET || !process.env.JWT_REFRESH_SECRET) {
    throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be set in production');
  }
}

const signAccessToken = (user) =>
  jwt.sign({ sub: user.id, email: user.Email, role: user.Role }, ACCESS_SECRET, {
    expiresIn: ACCESS_TTL
  });

const verifyAccessToken = (token) => jwt.verify(token, ACCESS_SECRET);

const hashToken = (raw) => crypto.createHash('sha256').update(raw).digest('hex');

/**
 * A refresh token is a JWT (carrying its own DB row id as `jti`) whose SHA-256
 * hash is stored on that row. Two independent checks must pass to use it: the
 * JWT signature, and hash(presented token) === the stored hash. Storing only the
 * hash means a database leak never yields a usable token, and binding the hash
 * to the exact issued JWT means an old rotated token can't be replayed.
 */
const issueRefreshToken = async (user, { userAgent, ipAddress } = {}) => {
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
  // Create first so the row id can be embedded as the token's jti.
  const record = await UserRefreshToken.create({
    UserId: user.id,
    TokenHash: crypto.randomUUID(), // placeholder to satisfy NOT NULL/unique; overwritten below
    UserAgent: userAgent || null,
    IpAddress: ipAddress || null,
    ExpiresAt: expiresAt
  });
  const token = jwt.sign({ jti: record.id, sub: user.id }, REFRESH_SECRET, {
    expiresIn: `${REFRESH_TTL_DAYS}d`
  });
  await record.update({ TokenHash: hashToken(token) });
  return { token, expiresAt };
};

const findValidRefreshRecord = async (rawToken) => {
  let payload;
  try {
    payload = jwt.verify(rawToken, REFRESH_SECRET);
  } catch {
    return null;
  }
  const record = await UserRefreshToken.findByPk(payload.jti);
  if (!record || !record.isActive()) return null;
  if (record.TokenHash !== hashToken(rawToken)) return null;
  return record;
};

/** Verify a refresh token, then rotate it (revoke old, issue new). */
const rotateRefreshToken = async (rawToken, context = {}) => {
  const record = await findValidRefreshRecord(rawToken);
  if (!record) return null;

  await record.update({ RevokedAt: new Date() });
  const { User } = require('../models');
  const user = await User.scope('withSecrets').findByPk(record.UserId);
  if (!user || user.DisabledAt) return null;

  const next = await issueRefreshToken(user, context);
  return { user, refresh: next };
};

const revokeRefreshToken = async (rawToken) => {
  const record = await findValidRefreshRecord(rawToken);
  if (record) await record.update({ RevokedAt: new Date() });
};

module.exports = {
  ACCESS_TTL,
  signAccessToken,
  verifyAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken
};
