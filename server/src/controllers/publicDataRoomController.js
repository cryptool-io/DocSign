const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const {
  DocDataRoom,
  DocDataRoomItem,
  DocDocument,
  DocViewSession,
  DocPageView,
  sequelize
} = require('../models');
const storage = require('../services/docroom/storage');
const pdf = require('../services/docroom/pdf');
const { appendAuditEvent } = require('../services/docroom/hashChain');
const { asyncHandler, notFound, forbidden, badRequest, unauthorized, clientIp } = require('../utils/http');

// Data-room viewer tokens are their own audience, distinct from single-link viewers.
require('dotenv').config();
const SECRET = process.env.DOCROOM_VIEWER_SECRET || 'docroom-dev-secret-do-not-use-in-production';
const ROOM_AUDIENCE = 'docroom:room';
const ROOM_TTL = process.env.DOCROOM_VIEWER_TOKEN_TTL || '2h';

const issueRoomToken = ({ roomId, email }) =>
  jwt.sign({ roomId, email: email || null }, SECRET, { audience: ROOM_AUDIENCE, expiresIn: ROOM_TTL });
const verifyRoomToken = (token) => jwt.verify(token, SECRET, { audience: ROOM_AUDIENCE });

const loadUsableRoom = async (token) => {
  const room = await DocDataRoom.scope('withSecrets').findOne({ where: { Token: token } });
  if (!room) throw notFound('This data room does not exist.');
  if (room.isRevoked()) throw forbidden('This data room has been revoked.', 'revoked');
  if (room.isExpired()) throw forbidden('This data room has expired.', 'expired');
  return room;
};

const authorizeRoomViewer = async (req) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw unauthorized('Missing room token.', 'no_room_token');
  let payload;
  try {
    payload = verifyRoomToken(token);
  } catch {
    throw unauthorized('Room session expired. Reload the page.', 'room_expired');
  }
  if (payload.roomId !== req.params.roomId) throw forbidden('Token/room mismatch.');
  const room = await DocDataRoom.scope('withSecrets').findByPk(payload.roomId);
  if (!room || !room.isUsable()) throw forbidden('This data room is no longer available.', 'unavailable');
  return { room, payload };
};

/** Public gate metadata. */
exports.meta = asyncHandler(async (req, res) => {
  const room = await loadUsableRoom(req.params.token);
  res.json({
    data: {
      name: room.Name,
      description: room.Description,
      requireEmail: room.RequireEmail,
      requirePassword: Boolean(room.PasswordHash),
      allowDownload: room.AllowDownload
    }
  });
});

/** Unlock the room: enforce the gate, issue a room viewer token, return the file list. */
exports.open = asyncHandler(async (req, res) => {
  const room = await loadUsableRoom(req.params.token);
  const { email, password } = req.body;

  if (room.RequireEmail && !email) throw badRequest('Email is required.', 'email_required');
  if (email && !room.allowsEmail(email)) throw forbidden('This email is not permitted for this data room.', 'email_not_allowed');
  if (room.PasswordHash) {
    const ok = password && (await bcrypt.compare(password, room.PasswordHash));
    if (!ok) throw unauthorized('Incorrect password.', 'bad_password');
  }

  const items = await DocDataRoomItem.findAll({
    where: { DocDataRoomId: room.id },
    include: [{ model: DocDocument, as: 'Document' }],
    order: [['SortOrder', 'ASC']]
  });

  await appendAuditEvent({
    linkId: null,
    documentId: null,
    actorType: 'viewer',
    actorEmail: email || null,
    eventType: 'dataroom.opened',
    metadata: { roomId: room.id, roomName: room.Name },
    ipAddress: clientIp(req),
    userAgent: req.headers['user-agent'] || null
  }).catch(() => {}); // audit is best-effort here (no envelope/link scope)

  const roomToken = issueRoomToken({ roomId: room.id, email });
  res.json({
    data: {
      roomToken,
      name: room.Name,
      allowDownload: room.AllowDownload,
      documents: items.map((it) => ({
        id: it.DocDocumentId,
        label: it.Label || it.Document?.Name,
        folder: it.Folder || null,
        pageCount: it.Document?.PageCount || 0,
        encrypted: Boolean(it.Document?.Encrypted)
      }))
    }
  });
});

// Find or create the (room, document, viewer) session so per-doc time accrues.
const ensureSession = async (room, documentId, email, req) => {
  const [session] = await DocViewSession.findOrCreate({
    where: { DocDataRoomId: room.id, DocDocumentId: documentId, ViewerEmail: email || null },
    defaults: {
      DocDataRoomId: room.id,
      DocDocumentId: documentId,
      ViewerEmail: email || null,
      IpAddress: clientIp(req),
      UserAgent: req.headers['user-agent'] || null
    }
  });
  return session;
};

/** Stream one document's PDF (watermarked if the room says so). */
exports.file = asyncHandler(async (req, res) => {
  const { room, payload } = await authorizeRoomViewer(req);
  const item = await DocDataRoomItem.findOne({
    where: { DocDataRoomId: room.id, DocDocumentId: req.params.documentId },
    include: [{ model: DocDocument, as: 'Document' }]
  });
  if (!item) throw notFound('That document is not in this data room.');

  await ensureSession(room, req.params.documentId, payload.email, req);

  let buffer = await storage.getObject(item.Document.FileKey);

  if (item.Document.Encrypted) {
    // Zero-knowledge: stream ciphertext; the viewer decrypts with the key from
    // the room link fragment and watermarks client-side.
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-Docsign-Encrypted', 'true');
    return res.send(buffer);
  }

  if (room.Watermark) {
    const mark = payload.email || `Confidential • ${new Date().toISOString().slice(0, 10)}`;
    buffer = await pdf.applyWatermark(buffer, mark);
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline');
  res.send(buffer);
});

/** Per-page dwell heartbeat scoped to a document within the room. */
exports.heartbeat = asyncHandler(async (req, res) => {
  const { room, payload } = await authorizeRoomViewer(req);
  const { documentId, pages } = req.body;

  const item = await DocDataRoomItem.findOne({ where: { DocDataRoomId: room.id, DocDocumentId: documentId } });
  if (!item) throw notFound('Document not in room.');
  const session = await ensureSession(room, documentId, payload.email, req);

  await sequelize.transaction(async (t) => {
    for (const { page, seconds } of pages) {
      const [pv, created] = await DocPageView.findOrCreate({
        where: { DocViewSessionId: session.id, PageNumber: page },
        defaults: { Seconds: seconds },
        transaction: t
      });
      if (!created && seconds > pv.Seconds) await pv.update({ Seconds: seconds }, { transaction: t });
    }
    const agg = await DocPageView.findAll({
      where: { DocViewSessionId: session.id },
      attributes: [
        [sequelize.fn('COUNT', sequelize.col('id')), 'pages'],
        [sequelize.fn('SUM', sequelize.col('Seconds')), 'total']
      ],
      raw: true,
      transaction: t
    });
    await session.update(
      {
        PagesViewed: Number(agg[0]?.pages || 0),
        TotalSeconds: Number(agg[0]?.total || 0),
        LastSeenAt: new Date()
      },
      { transaction: t }
    );
  });

  res.json({ ok: true });
});
