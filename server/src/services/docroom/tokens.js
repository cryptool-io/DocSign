require('dotenv').config();

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

/**
 * DocRoom viewers and signers are not Cryptool users, so they never touch the
 * UserToken table or the app's access/refresh secrets. They get their own
 * short-lived, audience-scoped JWTs signed with a dedicated secret.
 */
const VIEWER_SECRET = process.env.DOCROOM_VIEWER_SECRET;
if (!VIEWER_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('DOCROOM_VIEWER_SECRET must be set in production');
}
const SECRET = VIEWER_SECRET || 'docroom-dev-secret-do-not-use-in-production';

const VIEWER_AUDIENCE = 'docroom:viewer';
const SIGNER_AUDIENCE = 'docroom:signer';

const VIEWER_TTL = process.env.DOCROOM_VIEWER_TOKEN_TTL || '2h';
const SIGNER_TTL = process.env.DOCROOM_SIGNER_TOKEN_TTL || '1h';

/** URL-safe opaque token for share links and per-signer signing URLs. */
const generateOpaqueToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

/** Numeric one-time code emailed to a signer to prove mailbox control. */
const generateOtpCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

const hashOtpCode = (code) => crypto.createHash('sha256').update(String(code)).digest('hex');

const verifyOtpCode = (code, storedHash) => {
  if (!storedHash) return false;
  const candidate = Buffer.from(hashOtpCode(code));
  const expected = Buffer.from(storedHash);
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
};

const issueViewerToken = ({ linkId, sessionId, email }) =>
  jwt.sign({ linkId, sessionId, email: email || null }, SECRET, {
    audience: VIEWER_AUDIENCE,
    expiresIn: VIEWER_TTL
  });

const verifyViewerToken = (token) => jwt.verify(token, SECRET, { audience: VIEWER_AUDIENCE });

const issueSignerToken = ({ signerId, envelopeId, email }) =>
  jwt.sign({ signerId, envelopeId, email }, SECRET, {
    audience: SIGNER_AUDIENCE,
    expiresIn: SIGNER_TTL
  });

const verifySignerToken = (token) => jwt.verify(token, SECRET, { audience: SIGNER_AUDIENCE });

module.exports = {
  VIEWER_AUDIENCE,
  SIGNER_AUDIENCE,
  generateOpaqueToken,
  generateOtpCode,
  hashOtpCode,
  verifyOtpCode,
  issueViewerToken,
  verifyViewerToken,
  issueSignerToken,
  verifySignerToken
};
