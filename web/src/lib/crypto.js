/**
 * Client-side (zero-knowledge) encryption primitives, built on WebCrypto so the
 * exact same code runs in the browser and under Node 22 (for tests).
 *
 * Model:
 *  - Each document is encrypted with a random 256-bit Data Encryption Key (DEK).
 *  - The DEK is wrapped (encrypted) with a Master Key derived from the user's
 *    password (PBKDF2). The server stores only ciphertext + the wrapped DEK; it
 *    never has the Master Key, so it can't unwrap the DEK at rest.
 *  - For sharing/signing, the raw DEK travels in the link's URL fragment, which
 *    browsers never transmit to the server.
 *
 * Blob format for encrypted payloads:  [ 12-byte IV | AES-256-GCM ciphertext+tag ]
 * This is interoperable with Node's crypto (aes-256-gcm) on the server, which
 * decrypts transiently only to stamp signatures.
 */

const subtle = globalThis.crypto.subtle;
const PBKDF2_ITERATIONS = 210000;
const IV_BYTES = 12;

const b64 = {
  encode(bytes) {
    let s = '';
    const arr = new Uint8Array(bytes);
    for (let i = 0; i < arr.length; i += 1) s += String.fromCharCode(arr[i]);
    return btoa(s);
  },
  decode(str) {
    const s = atob(str);
    const arr = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i += 1) arr[i] = s.charCodeAt(i);
    return arr;
  }
};

const randomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

/** A fresh per-user KDF salt (store on the server; it's not secret). */
const randomSaltB64 = () => b64.encode(randomBytes(16));

/** A random recovery key (shown once) that can also unwrap the DEKs. */
const generateRecoveryKeyB64 = () => b64.encode(randomBytes(32));

/**
 * Derive the wrapping (Master) key from a password + salt. Returned as a
 * non-extractable AES-GCM key used only to wrap/unwrap DEKs.
 */
const deriveMasterKey = async (password, saltB64) => {
  const baseKey = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', salt: b64.decode(saltB64), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
};

/** Import a raw 32-byte recovery key (base64) as an AES-GCM wrapping key. */
const importRecoveryKey = (recoveryKeyB64) =>
  subtle.importKey('raw', b64.decode(recoveryKeyB64), { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);

/** A fresh, extractable per-document DEK. */
const generateDek = () => subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);

/** Raw DEK bytes as base64 — used to put the key into a link fragment. */
const exportDekB64 = async (dek) => b64.encode(await subtle.exportKey('raw', dek));
const importDekB64 = (dekB64) =>
  subtle.importKey('raw', b64.decode(dekB64), { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);

// Wrap = AES-GCM encrypt the raw DEK bytes under a wrapping key. Output base64 of [iv|ct+tag].
const wrapDek = async (dek, wrappingKey) => {
  const raw = await subtle.exportKey('raw', dek);
  const iv = randomBytes(IV_BYTES);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, wrappingKey, raw);
  return b64.encode(concat(iv, new Uint8Array(ct)));
};

const unwrapDek = async (wrappedB64, wrappingKey) => {
  const buf = b64.decode(wrappedB64);
  const iv = buf.slice(0, IV_BYTES);
  const ct = buf.slice(IV_BYTES);
  const raw = await subtle.decrypt({ name: 'AES-GCM', iv }, wrappingKey, ct);
  return subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
};

function concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Encrypt bytes with a DEK. Returns Uint8Array [iv | ciphertext+tag]. */
const encryptBytes = async (bytes, dek) => {
  const iv = randomBytes(IV_BYTES);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, dek, bytes);
  return concat(iv, new Uint8Array(ct));
};

/** Decrypt [iv | ciphertext+tag] with a DEK. Returns ArrayBuffer of plaintext. */
const decryptBytes = async (blobBytes, dek) => {
  const buf = blobBytes instanceof Uint8Array ? blobBytes : new Uint8Array(blobBytes);
  const iv = buf.slice(0, IV_BYTES);
  const ct = buf.slice(IV_BYTES);
  return subtle.decrypt({ name: 'AES-GCM', iv }, dek, ct);
};

const sha256Hex = async (bytes) => {
  const digest = await subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

export {
  b64,
  randomSaltB64,
  generateRecoveryKeyB64,
  importRecoveryKey,
  deriveMasterKey,
  generateDek,
  exportDekB64,
  importDekB64,
  wrapDek,
  unwrapDek,
  encryptBytes,
  decryptBytes,
  sha256Hex,
  IV_BYTES
};
