const crypto = require('crypto');

/**
 * Transient server-side decrypt/encrypt for the "decrypt only to stamp" flow.
 *
 * The server never stores document keys. During the signing/stamping step, the
 * signer's browser sends the raw DEK (base64) over TLS; the server decrypts the
 * PDF in memory, stamps it, re-encrypts with the SAME DEK, and discards the key.
 *
 * Payload format matches the browser (web/src/lib/crypto.js):
 *   [ 12-byte IV | AES-256-GCM ciphertext | 16-byte auth tag ]
 * WebCrypto appends the GCM tag to the ciphertext, so we split it back off here.
 */

const IV_BYTES = 12;
const TAG_BYTES = 16;

const decryptBuffer = (encryptedBuffer, dekB64) => {
  const key = Buffer.from(dekB64, 'base64');
  if (key.length !== 32) throw new Error('DEK must be 32 bytes (AES-256)');
  const buf = Buffer.isBuffer(encryptedBuffer) ? encryptedBuffer : Buffer.from(encryptedBuffer);

  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(buf.length - TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES, buf.length - TAG_BYTES);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
};

const encryptBuffer = (plainBuffer, dekB64) => {
  const key = Buffer.from(dekB64, 'base64');
  if (key.length !== 32) throw new Error('DEK must be 32 bytes (AES-256)');
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Match the browser layout: iv | ciphertext | tag  (tag appended, like WebCrypto).
  return Buffer.concat([iv, ciphertext, tag]);
};

const sha256Hex = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

module.exports = { decryptBuffer, encryptBuffer, sha256Hex, IV_BYTES, TAG_BYTES };
