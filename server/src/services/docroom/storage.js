require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const DRIVER = (process.env.DOCROOM_STORAGE_DRIVER || 's3').toLowerCase();
const BUCKET = process.env.DOCROOM_S3_BUCKET || process.env.AWS_BUCKET;
const LOCAL_ROOT = path.resolve(process.env.DOCROOM_LOCAL_STORAGE_PATH || './storage/docroom');
const KEY_PREFIX = 'docroom';

let s3Client = null;
const getS3 = () => {
  if (!s3Client) {
    s3Client = new S3Client({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      }
    });
  }
  return s3Client;
};

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

/**
 * DocRoom objects are confidential. Unlike the public-read image uploads
 * elsewhere in this codebase, nothing here is ever world-readable: S3 objects
 * carry no ACL and are reached only through short-lived presigned URLs or by
 * streaming through an authorized route.
 */
const buildKey = (scope, filename) => {
  const safe = String(filename || 'file')
    .replace(/[^\w.\-]+/g, '_')
    .slice(-120);
  return `${KEY_PREFIX}/${scope}/${crypto.randomUUID()}-${safe}`;
};

// Reject any key that would escape LOCAL_ROOT once resolved.
const resolveLocalPath = (key) => {
  const target = path.resolve(LOCAL_ROOT, key);
  const root = LOCAL_ROOT.endsWith(path.sep) ? LOCAL_ROOT : LOCAL_ROOT + path.sep;
  if (target !== LOCAL_ROOT && !target.startsWith(root)) {
    throw new Error('Invalid storage key');
  }
  return target;
};

const streamToBuffer = async (stream) => {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
};

const drivers = {
  s3: {
    async put(key, buffer, contentType) {
      await getS3().send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: key,
          Body: buffer,
          ContentType: contentType,
          ServerSideEncryption: 'AES256'
        })
      );
      return key;
    },
    async get(key) {
      const res = await getS3().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
      return streamToBuffer(res.Body);
    },
    async getStream(key) {
      const res = await getS3().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
      return res.Body;
    },
    async remove(key) {
      await getS3().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    },
    async presign(key, expiresInSeconds = 300) {
      return getSignedUrl(getS3(), new GetObjectCommand({ Bucket: BUCKET, Key: key }), {
        expiresIn: expiresInSeconds
      });
    }
  },

  local: {
    async put(key, buffer) {
      const target = resolveLocalPath(key);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, buffer);
      return key;
    },
    async get(key) {
      return fsp.readFile(resolveLocalPath(key));
    },
    async getStream(key) {
      return fs.createReadStream(resolveLocalPath(key));
    },
    async remove(key) {
      await fsp.rm(resolveLocalPath(key), { force: true });
    },
    // No object store to presign against; callers stream through the API instead.
    async presign() {
      return null;
    }
  }
};

const driver = drivers[DRIVER];
if (!driver) {
  throw new Error(`Unknown DOCROOM_STORAGE_DRIVER "${DRIVER}" (expected "s3" or "local")`);
}

module.exports = {
  driverName: DRIVER,
  buildKey,
  sha256,
  putObject: (key, buffer, contentType = 'application/octet-stream') =>
    driver.put(key, buffer, contentType),
  getObject: (key) => driver.get(key),
  getObjectStream: (key) => driver.getStream(key),
  deleteObject: (key) => driver.remove(key),
  presignObject: (key, expiresInSeconds) => driver.presign(key, expiresInSeconds)
};
