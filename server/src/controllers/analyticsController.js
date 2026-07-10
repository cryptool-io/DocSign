const { Op } = require('sequelize');
const {
  DocDocument,
  DocLink,
  DocEnvelope,
  DocViewSession,
  DocRecipient,
  sequelize
} = require('../models');
const { asyncHandler } = require('../utils/http');

/** Dashboard summary across everything this user owns. */
exports.overview = asyncHandler(async (req, res) => {
  const ownerId = req.userId;
  const linkIdsRows = await DocLink.findAll({
    attributes: ['id'],
    where: { CreatedBy: ownerId },
    raw: true
  });
  const linkIds = linkIdsRows.map((r) => r.id);

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [documents, links, recipients, envByStatus, views, recentViews] = await Promise.all([
    DocDocument.count({ where: { OwnerId: ownerId, ArchivedAt: null } }),
    DocLink.count({ where: { CreatedBy: ownerId } }),
    DocRecipient.count({ where: { OwnerId: ownerId, ArchivedAt: null } }),
    DocEnvelope.findAll({
      attributes: ['Status', [sequelize.fn('COUNT', sequelize.col('id')), 'n']],
      where: { CreatedBy: ownerId },
      group: ['Status'],
      raw: true
    }),
    linkIds.length ? DocViewSession.count({ where: { DocLinkId: linkIds } }) : 0,
    linkIds.length
      ? DocViewSession.count({ where: { DocLinkId: linkIds, StartedAt: { [Op.gte]: since } } })
      : 0
  ]);

  const envelopes = envByStatus.reduce(
    (acc, r) => {
      acc.byStatus[r.Status] = Number(r.n);
      acc.total += Number(r.n);
      return acc;
    },
    { total: 0, byStatus: {} }
  );

  res.json({
    data: {
      documents,
      links,
      recipients,
      envelopes,
      views: { total: views, last30Days: recentViews },
      pendingSignatures: (envelopes.byStatus.sent || 0) + (envelopes.byStatus.partially_signed || 0)
    }
  });
});
