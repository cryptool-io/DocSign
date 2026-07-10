/**
 * In-browser key management for zero-knowledge encryption.
 *
 * The account key (which wraps every document key) is derived at login from the
 * user's password and held in memory + sessionStorage (raw base64). sessionStorage
 * survives a page refresh but is cleared when the tab closes — a pragmatic balance;
 * it is never sent to the server. On a cold load without it, the user re-enters
 * their password to unlock.
 */
import api from './api.js';
import * as C from './crypto.js';

const SESSION_KEY = 'docsign_ak';
let accountKey = null; // CryptoKey, in memory

const cacheToSession = async (key) => {
  try {
    const raw = await C.exportDekB64(key);
    sessionStorage.setItem(SESSION_KEY, raw);
  } catch {
    /* ignore */
  }
};

const loadFromSession = async () => {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    accountKey = await C.importDekB64(raw);
    return accountKey;
  } catch {
    return null;
  }
};

export const isUnlocked = () => Boolean(accountKey);

export const forget = () => {
  accountKey = null;
  sessionStorage.removeItem(SESSION_KEY);
};

/** Ensure the account key is available (from memory or session). */
export const ensureUnlocked = async () => {
  if (accountKey) return accountKey;
  return loadFromSession();
};

/**
 * First-time setup: generate an account key, wrap it with the password-derived
 * master key and a fresh recovery key, and register both with the server.
 * Returns the recovery key (show it once — it's the only copy).
 */
export const setupEncryption = async (password) => {
  const kdfSalt = C.randomSaltB64();
  const masterKey = await C.deriveMasterKey(password, kdfSalt);
  const ak = await C.generateDek();
  const wrappedAccountKey = await C.wrapDek(ak, masterKey);
  const recoveryKey = C.generateRecoveryKeyB64();
  const recoveryWrappedAccountKey = await C.wrapDek(ak, await C.importRecoveryKey(recoveryKey));

  await api.post('/auth/encryption/setup', { kdfSalt, wrappedAccountKey, recoveryWrappedAccountKey });
  accountKey = ak;
  await cacheToSession(ak);
  return recoveryKey;
};

/** Unlock with the password + the account's encryption blob (from /auth/me). */
export const unlock = async (password, encryption) => {
  if (!encryption?.enabled || !encryption.wrappedAccountKey || !encryption.kdfSalt) return false;
  const masterKey = await C.deriveMasterKey(password, encryption.kdfSalt);
  accountKey = await C.unwrapDek(encryption.wrappedAccountKey, masterKey);
  await cacheToSession(accountKey);
  return true;
};

/** Unlock using the offline recovery key (when the password is lost). */
export const unlockWithRecovery = async (recoveryKey) => {
  const { data } = await api.get('/auth/encryption/recovery');
  if (!data.recoveryWrappedAccountKey) throw new Error('No recovery key is set for this account.');
  accountKey = await C.unwrapDek(data.recoveryWrappedAccountKey, await C.importRecoveryKey(recoveryKey));
  await cacheToSession(accountKey);
  return true;
};

/* ---- Per-document helpers ---------------------------------------------- */

/**
 * Encrypt a PDF File in the browser. Returns everything the upload needs:
 * the ciphertext Blob, the DEK wrapped by the account key, the plaintext hash,
 * the page count, and the raw DEK (base64) for building share/sign links.
 */
export const encryptDocument = async (file, pageCount) => {
  if (!accountKey) throw new Error('Your encryption key is locked. Sign in again to unlock.');
  const plain = new Uint8Array(await file.arrayBuffer());
  const dek = await C.generateDek();
  const ciphertext = await C.encryptBytes(plain, dek);
  return {
    ciphertextBlob: new Blob([ciphertext], { type: 'application/octet-stream' }),
    wrappedDek: await C.wrapDek(dek, accountKey),
    sha256: await C.sha256Hex(plain),
    pageCount,
    dekB64: await C.exportDekB64(dek)
  };
};

/** Owner-side: unwrap a document's DEK and return the raw base64 (for links). */
export const documentKeyB64 = async (wrappedDek) => {
  await ensureUnlocked();
  if (!accountKey) throw new Error('locked');
  const dek = await C.unwrapDek(wrappedDek, accountKey);
  return C.exportDekB64(dek);
};

/** Decrypt an encrypted document's bytes given the raw DEK (base64). */
export const decryptToBlob = async (encryptedBytes, dekB64) => {
  const dek = await C.importDekB64(dekB64);
  const plain = await C.decryptBytes(new Uint8Array(encryptedBytes), dek);
  return new Blob([plain], { type: 'application/pdf' });
};

/** Owner-side convenience: fetch + decrypt one of the owner's own documents. */
export const ownerDecryptToBlob = async (encryptedBytes, wrappedDek) => {
  const dekB64 = await documentKeyB64(wrappedDek);
  return decryptToBlob(encryptedBytes, dekB64);
};

/**
 * Owner-side: fetch a document/file URL, decrypting client-side when the
 * document is encrypted. `doc` carries { Encrypted, WrappedDek }.
 */
export const ownerFileUrl = async (endpoint, doc) => {
  const res = await api.get(endpoint, { responseType: 'arraybuffer' });
  if (doc?.Encrypted && doc.WrappedDek) {
    const blob = await ownerDecryptToBlob(res.data, doc.WrappedDek);
    return URL.createObjectURL(blob);
  }
  return URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
};
