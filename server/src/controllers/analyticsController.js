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
const { listScope } = require('../utils/access');

/**
 * Dashboard summary. Respects the active workspace filter: with ?companyId set
 * it counts only that workspace's records (owned or member); with ?companyId=none
 * only personal (no-workspace) records; absent → everything owned + member.
 */
exports.overview = asyncHandler(async (req, res) => {
  const ownerId = req.userId;
  const docScope = { ...(await listScope(ownerId, req.query)), ArchivedAt: null };
  const recScope = { ...(await listScope(ownerId, req.query)), ArchivedAt: null };
  const envScope = await listScope(ownerId, req.query, 'CreatedBy');

  // Links + views hang off documents, so scope them to this view's documents.
  const docRows = await DocDocument.findAll({ attributes: ['id'], where: docScope, raw: true });
  const docIds = docRows.map((d) => d.id);
  const linkIdsRows = docIds.length
    ? await DocLink.findAll({ attributes: ['id'], where: { DocDocumentId: { [Op.in]: docIds } }, raw: true })
    : [];
  const linkIds = linkIdsRows.map((r) => r.id);

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [documents, links, recipients, envByStatus, views, recentViews] = await Promise.all([
    docIds.length,
    linkIds.length,
    DocRecipient.count({ where: recScope }),
    DocEnvelope.findAll({
      attributes: ['Status', [sequelize.fn('COUNT', sequelize.col('id')), 'n']],
      where: envScope,
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
