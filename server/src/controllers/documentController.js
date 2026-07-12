const { DocDocument, DocProject, DocLink, DocEnvelope } = require('../models');
const { Op } = require('sequelize');
const storage = require('../services/docroom/storage');
const pdf = require('../services/docroom/pdf');
const { asyncHandler, notFound, badRequest } = require('../utils/http');
const { paginate, meta } = require('../utils/misc');
const { resolveCompanyId } = require('../utils/companyScope');
const { listScope, canAccessRecord } = require('../utils/access');

exports.list = asyncHandler(async (req, res) => {
  const { limit, offset, page, pageSize } = paginate(req.query);
  const where = { ...(await listScope(req.userId, req.query)) };
  where.ArchivedAt = req.query.archived === '1' ? { [Op.ne]: null } : null;
  if (req.query.projectId) where.DocProjectId = req.query.projectId;

  const { rows, count } = await DocDocument.findAndCountAll({
    where,
    order: [['createdAt', 'DESC']],
    limit,
    offset
  });
  res.json({ data: rows, meta: meta(count, { page, pageSize }) });
});

// Resolve the workspace a new document belongs to (explicit companyId, else the
// project's company).
const resolveUploadCompany = async (req) => {
  let inheritedCompanyId = null;
  if (req.body.projectId) {
    const project = await DocProject.findOne({ where: { id: req.body.projectId, OwnerId: req.userId } });
    if (!project) throw badRequest('Project not found.', 'bad_project');
    inheritedCompanyId = project.DocCompanyId;
  }
  return req.body.companyId ? await resolveCompanyId(req.userId, req.body.companyId) : inheritedCompanyId;
};

exports.upload = asyncHandler(async (req, res) => {
  const storageMode = req.body.storageMode === 'sovereign' ? 'sovereign' : 'stored';

  // Sovereign: the PDF stays on the user's device. No bytes are persisted here —
  // the browser sends only metadata (it computed the hash + page count locally).
  // The file is attached transiently at send time (POST /documents/:id/attach).
  if (storageMode === 'sovereign') {
    const claimedSha = String(req.body.sha256 || '');
    if (!/^[0-9a-f]{64}$/.test(claimedSha)) throw badRequest('Sovereign upload requires a valid sha256.', 'bad_sha');
    const companyId = await resolveUploadCompany(req);
    const doc = await DocDocument.create({
      DocProjectId: req.body.projectId || null,
      DocCompanyId: companyId,
      OwnerId: req.userId,
      Name: req.body.name || 'Untitled.pdf',
      StorageDriver: storage.driverName,
      StorageMode: 'sovereign',
      FileKey: null,
      MimeType: 'application/pdf',
      SizeBytes: parseInt(req.body.sizeBytes || '0', 10) || 0,
      PageCount: parseInt(req.body.pageCount || '0', 10) || 0,
      Sha256: claimedSha,
      Version: 1,
      Encrypted: false
    });
    return res.status(201).json({ data: doc });
  }

  if (!req.file) throw badRequest('No file uploaded. Send a PDF as multipart field "file".', 'no_file');
  const buffer = req.file.buffer;

  // Encrypted uploads arrive as ciphertext: the browser has already encrypted the
  // PDF and computed its plaintext hash + page count (the server can't read it).
  const isEncrypted = req.body.encrypted === 'true' || req.body.encrypted === true;

  let pageCount;
  let sha256;
  if (isEncrypted) {
    if (!req.body.wrappedDek) throw badRequest('Encrypted upload requires wrappedDek.', 'no_wrapped_dek');
    const claimedSha = String(req.body.sha256 || '');
    if (!/^[0-9a-f]{64}$/.test(claimedSha)) throw badRequest('Encrypted upload requires a valid sha256.', 'bad_sha');
    pageCount = parseInt(req.body.pageCount || '0', 10) || 0;
    sha256 = claimedSha; // client-asserted; re-verified server-side at signing (decrypt-to-stamp)
  } else {
    if (!pdf.looksLikePdf(buffer)) throw badRequest('Only PDF files are supported.', 'not_pdf');
    try {
      pageCount = await pdf.getPageCount(buffer);
    } catch {
      throw badRequest('That file could not be read as a valid PDF.', 'bad_pdf');
    }
    sha256 = storage.sha256(buffer);
  }

  const companyId = await resolveUploadCompany(req);

  const key = storage.buildKey(`documents/${req.userId}`, `${req.file.originalname || 'document.pdf'}${isEncrypted ? '.enc' : ''}`);
  await storage.putObject(key, buffer, isEncrypted ? 'application/octet-stream' : 'application/pdf');

  const doc = await DocDocument.create({
    DocProjectId: req.body.projectId || null,
    DocCompanyId: companyId,
    OwnerId: req.userId,
    Name: req.body.name || req.file.originalname || 'Untitled.pdf',
    StorageDriver: storage.driverName,
    StorageMode: 'stored',
    FileKey: key,
    MimeType: 'application/pdf',
    SizeBytes: buffer.length,
    PageCount: pageCount,
    Sha256: sha256,
    Version: 1,
    Encrypted: isEncrypted,
    WrappedDek: isEncrypted ? req.body.wrappedDek : null,
    EncAlgo: isEncrypted ? 'AES-256-GCM' : null
  });

  res.status(201).json({ data: doc });
});

/**
 * Attach transient bytes to a sovereign document immediately before sending. The
 * file is verified against the hash on record, held only for the active signing
 * window, and purged on completion — so the PDF never lives in our storage at rest.
 */
exports.attach = asyncHandler(async (req, res) => {
  const doc = await DocDocument.findOne({ where: { id: req.params.id, OwnerId: req.userId } });
  if (!doc) throw notFound('Document not found');
  if (doc.StorageMode !== 'sovereign') throw badRequest('Only sovereign documents need a transient attach.', 'not_sovereign');
  if (!req.file) throw badRequest('No file uploaded. Send the PDF as multipart field "file".', 'no_file');
  const buffer = req.file.buffer;
  if (!pdf.looksLikePdf(buffer)) throw badRequest('Only PDF files are supported.', 'not_pdf');
  const sha = storage.sha256(buffer);
  if (sha !== doc.Sha256) {
    throw badRequest('This file does not match the document on record (fingerprint mismatch).', 'hash_mismatch');
  }
  if (doc.FileKey) await storage.deleteObject(doc.FileKey).catch(() => {}); // replace any stale transient copy
  const key = storage.buildKey(`documents/${req.userId}`, `${doc.Name}.transient.pdf`);
  await storage.putObject(key, buffer, 'application/pdf');
  await doc.update({ FileKey: key, SizeBytes: buffer.length });
  res.json({ data: { id: doc.id, attached: true } });
});

// Owner OR a member of the document's workspace may open/manage it.
const findOwned = async (req) => {
  const doc = await DocDocument.findOne({ where: { id: req.params.id } });
  if (!doc || !(await canAccessRecord(req.userId, doc))) throw notFound('Document not found');
  return doc;
};

exports.get = asyncHandler(async (req, res) => {
  const doc = await findOwned(req);
  res.json({ data: doc });
});

/** Link a document to a workspace (or clear it → personal). Owner only. */
exports.update = asyncHandler(async (req, res) => {
  const doc = await DocDocument.findOne({ where: { id: req.params.id, OwnerId: req.userId } });
  if (!doc) throw notFound('Document not found');
  if (req.body.companyId !== undefined) {
    await doc.update({ DocCompanyId: await resolveCompanyId(req.userId, req.body.companyId) });
  }
  if (req.body.archived === false) await doc.update({ ArchivedAt: null }); // restore from trash
  if (req.body.archived === true) await doc.update({ ArchivedAt: new Date() });
  res.json({ data: doc });
});

const NO_BYTES_MSG =
  'This document is sovereign — the PDF lives on your device. Re-select the local file to preview or send it.';

/** Owner-side page geometry — the field editor needs intrinsic page sizes. */
exports.pageSizes = asyncHandler(async (req, res) => {
  const doc = await findOwned(req);
  if (!doc.FileKey) throw badRequest(NO_BYTES_MSG, 'no_bytes');
  const buffer = await storage.getObject(doc.FileKey);
  res.json({ data: await pdf.getPageSizes(buffer) });
});

/** Stream the raw PDF to the authenticated owner (for the editor/preview). */
exports.download = asyncHandler(async (req, res) => {
  const doc = await findOwned(req);
  if (!doc.FileKey) throw badRequest(NO_BYTES_MSG, 'no_bytes');
  const stream = await storage.getObjectStream(doc.FileKey);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.Name)}"`);
  stream.pipe(res);
});

exports.archive = asyncHandler(async (req, res) => {
  const doc = await findOwned(req);
  const activeEnvelopes = await DocEnvelope.count({
    where: { DocDocumentId: doc.id, Status: ['sent', 'partially_signed'] }
  });
  if (activeEnvelopes > 0) {
    throw badRequest('This document has envelopes out for signature and cannot be archived.', 'in_use');
  }
  await doc.update({ ArchivedAt: new Date() });
  res.json({ ok: true });
});
