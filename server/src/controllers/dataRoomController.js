const bcrypt = require('bcryptjs');
const { DocDataRoom, DocDataRoomItem, DocDocument, DocViewSession, DocPageView, sequelize } = require('../models');
const { generateOpaqueToken } = require('../services/docroom/tokens');
const { APP_BASE_URL } = require('../services/email');
const { asyncHandler, notFound, badRequest } = require('../utils/http');

const publicUrl = (token) => `${APP_BASE_URL}/room/${token}`;

const serialize = (room, items) => {
  const json = room.toJSON();
  delete json.PasswordHash;
  return {
    ...json,
    hasPassword: Boolean(room.PasswordHash),
    url: publicUrl(room.Token),
    isRevoked: room.isRevoked(),
    isExpired: room.isExpired(),
    items: (items || room.Items || [])
      .slice()
      .sort((a, b) => a.SortOrder - b.SortOrder)
      .map((it) => ({
        id: it.id,
        documentId: it.DocDocumentId,
        label: it.Label || it.Document?.Name,
        folder: it.Folder || null,
        sortOrder: it.SortOrder,
        pageCount: it.Document?.PageCount,
        sizeBytes: it.Document?.SizeBytes
      }))
  };
};

const withItems = (id, ownerId) =>
  DocDataRoom.scope('withSecrets').findOne({
    where: { id, OwnerId: ownerId },
    include: [{ model: DocDataRoomItem, as: 'Items', include: [{ model: DocDocument, as: 'Document' }] }]
  });

exports.list = asyncHandler(async (req, res) => {
  const where = { OwnerId: req.userId };
  if (req.query.projectId) where.DocProjectId = req.query.projectId;
  const rooms = await DocDataRoom.findAll({
    where,
    include: [{ model: DocDataRoomItem, as: 'Items', include: [{ model: DocDocument, as: 'Document' }] }],
    order: [['createdAt', 'DESC']]
  });

  // View counts per room in one grouped query.
  const ids = rooms.map((r) => r.id);
  const stats = ids.length
    ? await DocViewSession.findAll({
        attributes: [
          'DocDataRoomId',
          [sequelize.fn('COUNT', sequelize.col('id')), 'views'],
          [sequelize.fn('COUNT', sequelize.fn('DISTINCT', sequelize.col('ViewerEmail'))), 'uniques']
        ],
        where: { DocDataRoomId: ids },
        group: ['DocDataRoomId'],
        raw: true
      })
    : [];
  const byRoom = Object.fromEntries(stats.map((s) => [s.DocDataRoomId, s]));

  res.json({
    data: rooms.map((r) => ({
      ...serialize(r),
      views: Number(byRoom[r.id]?.views || 0),
      uniqueViewers: Number(byRoom[r.id]?.uniques || 0)
    }))
  });
});

// Validate that every documentId belongs to this owner.
const assertOwnedDocs = async (ownerId, documentIds) => {
  const ids = [...new Set(documentIds)];
  if (!ids.length) return;
  const n = await DocDocument.count({ where: { id: ids, OwnerId: ownerId, ArchivedAt: null } });
  if (n !== ids.length) throw badRequest('One or more documents were not found.', 'bad_document');
};

exports.create = asyncHandler(async (req, res) => {
  const b = req.body;
  const documentIds = (b.documents || []).map((d) => d.documentId);
  await assertOwnedDocs(req.userId, documentIds);

  const room = await sequelize.transaction(async (t) => {
    const created = await DocDataRoom.create(
      {
        OwnerId: req.userId,
        DocProjectId: b.projectId || null,
        Name: b.name,
        Description: b.description || null,
        Token: generateOpaqueToken(24),
        RequireEmail: b.requireEmail !== false,
        PasswordHash: b.password ? await bcrypt.hash(b.password, 10) : null,
        AllowDownload: b.allowDownload || false,
        Watermark: b.watermark !== false,
        AllowedEmails: b.allowedEmails || [],
        NotifyOnView: b.notifyOnView !== false,
        ExpiresAt: b.expiresAt || null
      },
      { transaction: t }
    );
    if (b.documents?.length) {
      await DocDataRoomItem.bulkCreate(
        b.documents.map((d, i) => ({
          DocDataRoomId: created.id,
          DocDocumentId: d.documentId,
          Label: d.label || null,
          Folder: d.folder || null,
          SortOrder: d.sortOrder ?? i
        })),
        { transaction: t }
      );
    }
    return created;
  });

  res.status(201).json({ data: serialize(await withItems(room.id, req.userId)) });
});

const findOwned = async (req) => {
  const room = await DocDataRoom.scope('withSecrets').findOne({
    where: { id: req.params.id, OwnerId: req.userId }
  });
  if (!room) throw notFound('Data room not found');
  return room;
};

exports.get = asyncHandler(async (req, res) => {
  const room = await withItems(req.params.id, req.userId);
  if (!room) throw notFound('Data room not found');
  res.json({ data: serialize(room) });
});

exports.update = asyncHandler(async (req, res) => {
  const room = await findOwned(req);
  const b = req.body;
  const patch = {};
  if (b.name !== undefined) patch.Name = b.name;
  if (b.description !== undefined) patch.Description = b.description;
  if (b.requireEmail !== undefined) patch.RequireEmail = b.requireEmail;
  if (b.allowDownload !== undefined) patch.AllowDownload = b.allowDownload;
  if (b.watermark !== undefined) patch.Watermark = b.watermark;
  if (b.allowedEmails !== undefined) patch.AllowedEmails = b.allowedEmails;
  if (b.notifyOnView !== undefined) patch.NotifyOnView = b.notifyOnView;
  if (b.expiresAt !== undefined) patch.ExpiresAt = b.expiresAt;
  if (b.password !== undefined) patch.PasswordHash = b.password ? await bcrypt.hash(b.password, 10) : null;
  await room.update(patch);

  // Replace the document set if provided.
  if (b.documents) {
    await assertOwnedDocs(req.userId, b.documents.map((d) => d.documentId));
    await sequelize.transaction(async (t) => {
      await DocDataRoomItem.destroy({ where: { DocDataRoomId: room.id }, transaction: t });
      if (b.documents.length) {
        await DocDataRoomItem.bulkCreate(
          b.documents.map((d, i) => ({
            DocDataRoomId: room.id,
            DocDocumentId: d.documentId,
            Label: d.label || null,
            Folder: d.folder || null,
            SortOrder: d.sortOrder ?? i
          })),
          { transaction: t }
        );
      }
    });
  }

  res.json({ data: serialize(await withItems(room.id, req.userId)) });
});

exports.revoke = asyncHandler(async (req, res) => {
  const room = await findOwned(req);
  if (!room.RevokedAt) await room.update({ RevokedAt: new Date() });
  res.json({ data: serialize(await withItems(room.id, req.userId)) });
});

exports.remove = asyncHandler(async (req, res) => {
  const room = await findOwned(req);
  await room.destroy();
  res.json({ ok: true });
});

/** Per-room analytics: sessions grouped by viewer, with per-document time. */
exports.analytics = asyncHandler(async (req, res) => {
  const room = await withItems(req.params.id, req.userId);
  if (!room) throw notFound('Data room not found');

  const sessions = await DocViewSession.findAll({
    where: { DocDataRoomId: room.id },
    include: [{ model: DocDocument, as: 'Document' }],
    order: [['StartedAt', 'DESC']]
  });

  const perDoc = {};
  sessions.forEach((s) => {
    const key = s.DocDocumentId;
    perDoc[key] = perDoc[key] || { documentId: key, name: s.Document?.Name, views: 0, seconds: 0 };
    perDoc[key].views += 1;
    perDoc[key].seconds += s.TotalSeconds;
  });

  res.json({
    data: {
      room: serialize(room),
      totals: {
        views: sessions.length,
        uniqueViewers: new Set(sessions.map((s) => s.ViewerEmail).filter(Boolean)).size,
        totalSeconds: sessions.reduce((a, s) => a + s.TotalSeconds, 0)
      },
      perDocument: Object.values(perDoc),
      sessions: sessions.map((s) => ({
        id: s.id,
        viewerEmail: s.ViewerEmail,
        documentName: s.Document?.Name,
        ipAddress: s.IpAddress,
        startedAt: s.StartedAt,
        totalSeconds: s.TotalSeconds,
        pagesViewed: s.PagesViewed
      }))
    }
  });
});
