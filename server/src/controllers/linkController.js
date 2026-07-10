const bcrypt = require('bcryptjs');
const { DocLink, DocDocument, DocRecipient, DocViewSession, DocPageView, sequelize } = require('../models');
const { generateOpaqueToken } = require('../services/docroom/tokens');
const { APP_BASE_URL } = require('../services/email');
const { asyncHandler, notFound, badRequest } = require('../utils/http');

const publicUrl = (token) => `${APP_BASE_URL}/v/${token}`;

const serialize = (link) => {
  const json = link.toJSON();
  delete json.PasswordHash;
  return {
    ...json,
    hasPassword: Boolean(link.PasswordHash),
    url: publicUrl(link.Token),
    isRevoked: link.isRevoked(),
    isExpired: link.isExpired(),
    isUsable: link.isUsable()
  };
};

exports.list = asyncHandler(async (req, res) => {
  const where = { CreatedBy: req.userId };
  if (req.query.documentId) where.DocDocumentId = req.query.documentId;
  if (req.query.projectId) where.DocProjectId = req.query.projectId;

  const links = await DocLink.scope('withSecrets').findAll({ where, order: [['createdAt', 'DESC']] });
  // Attach view + unique-viewer counts in one grouped query.
  const ids = links.map((l) => l.id);
  const stats = ids.length
    ? await DocViewSession.findAll({
        attributes: [
          'DocLinkId',
          [sequelize.fn('COUNT', sequelize.col('id')), 'views'],
          [sequelize.fn('COUNT', sequelize.fn('DISTINCT', sequelize.col('ViewerEmail'))), 'uniques'],
          [sequelize.fn('MAX', sequelize.col('LastSeenAt')), 'lastViewedAt']
        ],
        where: { DocLinkId: ids },
        group: ['DocLinkId'],
        raw: true
      })
    : [];
  const byLink = Object.fromEntries(stats.map((s) => [s.DocLinkId, s]));

  res.json({
    data: links.map((l) => ({
      ...serialize(l),
      views: Number(byLink[l.id]?.views || 0),
      uniqueViewers: Number(byLink[l.id]?.uniques || 0),
      lastViewedAt: byLink[l.id]?.lastViewedAt || null
    }))
  });
});

exports.create = asyncHandler(async (req, res) => {
  const b = req.body;
  const doc = await DocDocument.findOne({ where: { id: b.documentId, OwnerId: req.userId, ArchivedAt: null } });
  if (!doc) throw badRequest('Document not found.', 'bad_document');

  if (b.recipientId) {
    const r = await DocRecipient.findOne({ where: { id: b.recipientId, OwnerId: req.userId } });
    if (!r) throw badRequest('Recipient not found.', 'bad_recipient');
  }

  const link = await DocLink.create({
    DocDocumentId: doc.id,
    DocProjectId: doc.DocProjectId,
    DocRecipientId: b.recipientId || null,
    CreatedBy: req.userId,
    Token: generateOpaqueToken(24),
    Name: b.name || null,
    RequireEmail: b.requireEmail !== false,
    PasswordHash: b.password ? await bcrypt.hash(b.password, 10) : null,
    AllowDownload: b.allowDownload || false,
    Watermark: b.watermark !== false,
    AllowedEmails: b.allowedEmails || [],
    NotifyOnView: b.notifyOnView !== false,
    ExpiresAt: b.expiresAt || null,
    MaxViews: b.maxViews || null
  });

  res.status(201).json({ data: serialize(link) });
});

const findOwned = async (req) => {
  const link = await DocLink.scope('withSecrets').findOne({
    where: { id: req.params.id, CreatedBy: req.userId }
  });
  if (!link) throw notFound('Link not found');
  return link;
};

exports.update = asyncHandler(async (req, res) => {
  const link = await findOwned(req);
  const b = req.body;
  const patch = {};
  if (b.name !== undefined) patch.Name = b.name;
  if (b.requireEmail !== undefined) patch.RequireEmail = b.requireEmail;
  if (b.allowDownload !== undefined) patch.AllowDownload = b.allowDownload;
  if (b.watermark !== undefined) patch.Watermark = b.watermark;
  if (b.allowedEmails !== undefined) patch.AllowedEmails = b.allowedEmails;
  if (b.notifyOnView !== undefined) patch.NotifyOnView = b.notifyOnView;
  if (b.expiresAt !== undefined) patch.ExpiresAt = b.expiresAt;
  if (b.maxViews !== undefined) patch.MaxViews = b.maxViews;
  if (b.password !== undefined) {
    patch.PasswordHash = b.password ? await bcrypt.hash(b.password, 10) : null;
  }
  await link.update(patch);
  res.json({ data: serialize(link) });
});

exports.revoke = asyncHandler(async (req, res) => {
  const link = await findOwned(req);
  if (!link.RevokedAt) await link.update({ RevokedAt: new Date() });
  res.json({ data: serialize(link) });
});

/** Per-link analytics: sessions with per-page dwell breakdown. */
exports.analytics = asyncHandler(async (req, res) => {
  const link = await findOwned(req);
  const sessions = await DocViewSession.findAll({
    where: { DocLinkId: link.id },
    include: [{ model: DocPageView, as: 'PageViews' }],
    order: [['StartedAt', 'DESC']]
  });

  const doc = await DocDocument.findByPk(link.DocDocumentId);
  const pageCount = doc?.PageCount || 0;

  // Aggregate average seconds per page across all sessions.
  const pageTotals = {};
  sessions.forEach((s) => {
    (s.PageViews || []).forEach((pv) => {
      pageTotals[pv.PageNumber] = (pageTotals[pv.PageNumber] || 0) + pv.Seconds;
    });
  });

  res.json({
    data: {
      link: serialize(link),
      document: doc ? { id: doc.id, name: doc.Name, pageCount } : null,
      totals: {
        views: sessions.length,
        uniqueViewers: new Set(sessions.map((s) => s.ViewerEmail).filter(Boolean)).size,
        completions: sessions.filter((s) => s.PagesViewed >= pageCount && pageCount > 0).length,
        totalSeconds: sessions.reduce((a, s) => a + s.TotalSeconds, 0)
      },
      perPageSeconds: pageTotals,
      sessions: sessions.map((s) => ({
        id: s.id,
        viewerEmail: s.ViewerEmail,
        ipAddress: s.IpAddress,
        startedAt: s.StartedAt,
        lastSeenAt: s.LastSeenAt,
        totalSeconds: s.TotalSeconds,
        pagesViewed: s.PagesViewed,
        downloaded: s.Downloaded,
        pages: (s.PageViews || [])
          .sort((a, b) => a.PageNumber - b.PageNumber)
          .map((pv) => ({ page: pv.PageNumber, seconds: pv.Seconds }))
      }))
    }
  });
});
