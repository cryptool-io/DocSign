const crypto = require('crypto');
const { DocAuditEvent, sequelize } = require('../../models');

/**
 * Tamper-evident audit trail.
 *
 * Every event is hashed together with the hash of the event before it, so the
 * chain behaves like a miniature ledger: editing or deleting any row
 * invalidates the Hash of every row after it, and `verifyChain` will say where.
 * This is what lets a completed envelope's audit trail stand up as evidence.
 *
 * Events are chained per-scope: one chain per envelope, one per link.
 */

const GENESIS = '0'.repeat(64);

/**
 * Deterministic JSON: object keys sorted at every depth, so the same logical
 * metadata always produces the same digest regardless of insertion order or of
 * how Postgres hands JSONB back to us.
 */
const stableStringify = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
};

// Only these fields are hashed. Anything outside this list (createdAt, etc.)
// must never affect the digest, or verification would drift over time.
const canonicalize = (event) =>
  JSON.stringify([
    event.Sequence,
    event.DocEnvelopeId || null,
    event.DocLinkId || null,
    event.DocDocumentId || null,
    event.ActorType,
    event.ActorId || null,
    event.ActorEmail || null,
    event.EventType,
    stableStringify(event.Metadata || {}),
    event.IpAddress || null,
    event.UserAgent || null,
    new Date(event.OccurredAt).toISOString()
  ]);

const computeHash = (prevHash, event) =>
  crypto
    .createHash('sha256')
    .update(String(prevHash || GENESIS))
    .update(canonicalize(event))
    .digest('hex');

const scopeWhere = ({ envelopeId, linkId }) => {
  if (envelopeId) return { DocEnvelopeId: envelopeId };
  if (linkId) return { DocLinkId: linkId };
  throw new Error('Audit events require either an envelopeId or a linkId scope');
};

// Postgres advisory lock keyed on the chain scope. Without it, two concurrent
// appends can read the same tail and produce a forked chain.
const lockScope = async (scopeKey, transaction) => {
  await sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:key))', {
    replacements: { key: scopeKey },
    transaction
  });
};

/**
 * Append one event to its chain. Must run inside a transaction so the advisory
 * lock is held until the insert commits.
 */
const appendAuditEvent = async (payload, { transaction } = {}) => {
  if (!transaction) {
    return sequelize.transaction((t) => appendAuditEvent(payload, { transaction: t }));
  }

  const {
    envelopeId = null,
    linkId = null,
    documentId = null,
    actorType = 'system',
    actorId = null,
    actorEmail = null,
    eventType,
    metadata = {},
    ipAddress = null,
    userAgent = null,
    occurredAt = new Date()
  } = payload;

  if (!eventType) throw new Error('appendAuditEvent requires an eventType');

  const where = scopeWhere({ envelopeId, linkId });
  await lockScope(envelopeId ? `env:${envelopeId}` : `link:${linkId}`, transaction);

  const previous = await DocAuditEvent.findOne({
    where,
    order: [['Sequence', 'DESC']],
    transaction
  });

  const draft = {
    DocEnvelopeId: envelopeId,
    DocLinkId: linkId,
    DocDocumentId: documentId,
    Sequence: previous ? previous.Sequence + 1 : 0,
    ActorType: actorType,
    ActorId: actorId,
    ActorEmail: actorEmail ? String(actorEmail).toLowerCase() : null,
    EventType: eventType,
    Metadata: metadata,
    IpAddress: ipAddress,
    UserAgent: userAgent,
    OccurredAt: occurredAt
  };

  const prevHash = previous ? previous.Hash : GENESIS;
  return DocAuditEvent.create(
    { ...draft, PrevHash: previous ? previous.Hash : null, Hash: computeHash(prevHash, draft) },
    { transaction }
  );
};

/**
 * Recompute the chain from genesis. Returns the first index that fails, so the
 * caller can report exactly which event was altered.
 */
const verifyChain = async (scope) => {
  const events = await DocAuditEvent.findAll({
    where: scopeWhere(scope),
    order: [['Sequence', 'ASC']]
  });

  let expectedPrev = GENESIS;
  for (let i = 0; i < events.length; i += 1) {
    const event = events[i];
    if (event.Sequence !== i) {
      return { valid: false, reason: 'sequence_gap', atSequence: event.Sequence, events };
    }
    const storedPrev = event.PrevHash || GENESIS;
    if (storedPrev !== expectedPrev) {
      return { valid: false, reason: 'broken_link', atSequence: event.Sequence, events };
    }
    if (computeHash(expectedPrev, event) !== event.Hash) {
      return { valid: false, reason: 'hash_mismatch', atSequence: event.Sequence, events };
    }
    expectedPrev = event.Hash;
  }

  return { valid: true, reason: null, atSequence: null, events };
};

module.exports = { GENESIS, appendAuditEvent, verifyChain, computeHash, canonicalize, stableStringify };
