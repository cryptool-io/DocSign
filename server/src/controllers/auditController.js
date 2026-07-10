const { DocEnvelope, DocAuditEvent } = require('../models');
const storage = require('../services/docroom/storage');
const { verifyChain } = require('../services/docroom/hashChain');
const { asyncHandler, notFound, badRequest } = require('../utils/http');

const ownEnvelope = async (req) => {
  const env = await DocEnvelope.findOne({ where: { id: req.params.id, CreatedBy: req.userId } });
  if (!env) throw notFound('Envelope not found');
  return env;
};

/** Full audit trail for an envelope, plus a live chain-integrity verdict. */
exports.trail = asyncHandler(async (req, res) => {
  const env = await ownEnvelope(req);
  const result = await verifyChain({ envelopeId: env.id });
  res.json({
    data: {
      integrity: { valid: result.valid, reason: result.reason, brokenAtSequence: result.atSequence },
      events: result.events.map((e) => ({
        sequence: e.Sequence,
        eventType: e.EventType,
        actorType: e.ActorType,
        actorEmail: e.ActorEmail,
        occurredAt: e.OccurredAt,
        ipAddress: e.IpAddress,
        metadata: e.Metadata,
        hash: e.Hash,
        prevHash: e.PrevHash
      }))
    }
  });
});

/** Download the completed (stamped + certificate) PDF. */
exports.completedFile = asyncHandler(async (req, res) => {
  const env = await ownEnvelope(req);
  if (!env.CompletedFileKey) throw badRequest('This envelope is not completed yet.', 'not_completed');
  const buffer = await storage.getObject(env.CompletedFileKey);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(env.Subject)}-signed.pdf"`);
  res.send(buffer);
});

module.exports = exports;
