require('../config/env');
const crypto = require('crypto');

/**
 * At-rest encryption for server-held secrets (OAuth refresh tokens for connected
 * mailboxes). Unlike document encryption this is NOT zero-knowledge — the server
 * must use these tokens to send mail — but a database leak yields only ciphertext.
 *
 * Key comes from EMAIL_TOKEN_ENC_KEY (base64 32 bytes). In production it must be
 * set; in dev a fixed fallback keeps things working.
 */
const IV = 12;
const TAG = 16;

const getKey = () => {
  const b64 = process.env.EMAIL_TOKEN_ENC_KEY;
  if (b64) {
    const key = Buffer.from(b64, 'base64');
    if (key.length === 32) return key;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('EMAIL_TOKEN_ENC_KEY (base64 of 32 bytes) must be set in production');
  }
  // Deterministic dev-only key so restarts can still decrypt existing rows.
  return crypto.createHash('sha256').update('docsign-dev-email-token-key').digest();
};

const encryptSecret = (plaintext) => {
  if (plaintext == null) return null;
  const key = getKey();
  const iv = crypto.randomBytes(IV);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, ct, cipher.getAuthTag()]).toString('base64');
};

const decryptSecret = (blobB64) => {
  if (!blobB64) return null;
  const key = getKey();
  const buf = Buffer.from(blobB64, 'base64');
  const iv = buf.subarray(0, IV);
  const tag = buf.subarray(buf.length - TAG);
  const ct = buf.subarray(IV, buf.length - TAG);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
};

module.exports = { encryptSecret, decryptSecret };
