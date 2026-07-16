'use strict';

/**
 * GDPR retention + erasure.
 *
 * Two concerns live here:
 *  1. purgeAbandonedDrafts() — a scheduled sweep that deletes envelopes that were
 *     started but never sent, after RETENTION_DRAFT_DAYS. Data minimization: we
 *     don't keep half-finished drafts forever. Completed/sent envelopes are the
 *     legal record and are NEVER touched here.
 *  2. eraseAccount() — a user-initiated right-to-erasure. It removes the account's
 *     personal/ancillary data (sessions, address book, unsent drafts) and
 *     anonymizes the account row, while retaining completed/sent agreements and
 *     their audit trail, which we are legally obliged to keep. GDPR's erasure
 *     right explicitly yields to that retention obligation.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const {
  sequelize,
  User,
  UserRefreshToken,
  DocRecipient,
  DocRecipientGroup,
  DocRecipientGroupMember,
  DocEnvelope,
  DocEnvelopeSigner,
  DocSignatureField,
  DocAuditEvent,
  DocDocument
} = require('../models');
const storage = require('./docroom/storage');

const DRAFT_DAYS = parseInt(process.env.RETENTION_DRAFT_DAYS || '30', 10);
const TERMINAL = ['completed', 'declined', 'voided', 'expired'];

/** Delete an envelope's child rows then the envelopes themselves (FK-safe). */
async function destroyEnvelopes(ids, t) {
  if (!ids.length) return;
  const opts = { where: { DocEnvelopeId: ids }, transaction: t };
  await DocSignatureField.destroy(opts);
  await DocEnvelopeSigner.destroy(opts);
  await DocAuditEvent.destroy(opts);
  await DocEnvelope.destroy({ where: { id: ids }, transaction: t });
}

/**
 * Remove draft envelopes that were never sent and are older than the retention
 * window. Returns the number purged.
 */
async function purgeAbandonedDrafts() {
  const cutoff = new Date(Date.now() - DRAFT_DAYS * 86400000);
  const drafts = await DocEnvelope.findAll({
    where: { Status: 'draft', SentAt: null, createdAt: { [Op.lt]: cutoff } },
    attributes: ['id']
  });
  const ids = drafts.map((d) => d.id);
  if (!ids.length) return 0;
  await sequelize.transaction((t) => destroyEnvelopes(ids, t));
  return ids.length;
}

/**
 * Remove the PDF bytes of a terminal envelope from storage. We keep only the
 * SHA-256 hashes + audit trail as tamper-evidence — never the file itself.
 *
 *  - The finished signed PDF is always dropped (all parties hold the emailed copy,
 *    and CompletedSha256 stays behind to prove any copy is authentic).
 *  - The source PDF is dropped too, unless another consumer still needs the bytes:
 *    an active envelope, a DocSend share link, or a data-room item.
 *
 * Safe to call more than once. Returns what was purged.
 */
async function purgeEnvelopeStorage(envelopeId) {
  const env = await DocEnvelope.findByPk(envelopeId);
  if (!env) return { completed: false, source: false };

  const doc = await DocDocument.findByPk(env.DocDocumentId);
  // Encrypted documents are already zero-knowledge (we can't read the bytes) AND
  // their signed copy is never emailed — the owner retrieves it only via in-app
  // download. Purging those would strand the owner, so we retain them. We only
  // purge readable (non-encrypted) PDFs, which were delivered to every party by email.
  if (doc && doc.Encrypted) return { completed: false, source: false };

  let completed = false;
  let source = false;

  if (env.CompletedFileKey) {
    await storage.deleteObject(env.CompletedFileKey).catch(() => {});
    await env.update({ CompletedFileKey: null }); // CompletedSha256 remains as proof
    completed = true;
  }

  // Sovereign documents: drop the transiently-attached bytes so the PDF returns to
  // living only on the user's device. The overlay shell (hash + fields) stays.
  // Guard against a concurrent active send of the same document.
  if (doc && doc.StorageMode === 'sovereign' && doc.FileKey) {
    const otherActive = await DocEnvelope.count({
      where: { DocDocumentId: doc.id, id: { [Op.ne]: env.id }, Status: { [Op.notIn]: TERMINAL } }
    });
    if (otherActive === 0) {
      await storage.deleteObject(doc.FileKey).catch(() => {});
      await doc.update({ FileKey: null });
      source = true;
    }
  }

  // NB: STORED documents are deliberately left in place — they're reusable and also
  // back DocSend links + data rooms.
  return { completed, source };
}

/**
 * Sweep sovereign documents that still have transient bytes attached but no active
 * envelope needing them (e.g. after a decline/void, or an attach that never sent).
 * The 1-hour guard on updatedAt ensures we never race an in-progress attach→send.
 */
async function purgeSovereignLeftovers() {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000);
  const docs = await DocDocument.findAll({
    where: { StorageMode: 'sovereign', FileKey: { [Op.ne]: null }, updatedAt: { [Op.lt]: cutoff } },
    attributes: ['id', 'FileKey'],
    limit: 500
  });
  let n = 0;
  for (const doc of docs) {
    const active = await DocEnvelope.count({ where: { DocDocumentId: doc.id, Status: { [Op.notIn]: TERMINAL } } });
    if (active === 0) {
      await storage.deleteObject(doc.FileKey).catch(() => {});
      await doc.update({ FileKey: null });
      n += 1;
    }
  }
  return n;
}

/** Entry point for the scheduler — logs a one-line summary, never throws. */
async function runRetention() {
  try {
    const purged = await purgeAbandonedDrafts();
    if (purged) console.log(`[retention] purged ${purged} abandoned draft envelope(s) older than ${DRAFT_DAYS}d`);
    // NB: we deliberately do NOT blanket-purge completed envelopes' PDFs here. The
    // signed PDF is purged inline once it has actually been delivered to the parties
    // (see publicSignController). Sweeping them unconditionally would delete copies
    // that never got delivered — e.g. when a workspace mailbox is down and we refuse
    // to send cross-brand.
    const sov = await purgeSovereignLeftovers();
    if (sov) console.log(`[retention] purged transient bytes for ${sov} sovereign document(s)`);
    // Proactively catch dead workspace mailboxes and alert their owner.
    const broken = await require('./mailboxHealth').sweepMailboxHealth();
    if (broken) console.log(`[retention] ${broken} workspace mailbox(es) need reconnecting`);
  } catch (err) {
    console.error('[retention] sweep failed:', err.message);
  }
}

/**
 * Right-to-erasure for one account. Purges personal/ancillary data and
 * anonymizes the account row inside a single transaction. Completed/sent
 * agreements + their audit trail are intentionally retained (legal obligation);
 * they now reference an anonymized account, so no personal data of the account
 * holder remains beyond what the signed record itself legally requires.
 *
 * Returns a summary of what was removed vs. retained.
 */
async function eraseAccount(userId) {
  return sequelize.transaction(async (t) => {
    // 1. Unsent drafts created by this user (never became a legal record).
    const drafts = await DocEnvelope.findAll({
      where: { CreatedBy: userId, Status: 'draft', SentAt: null },
      attributes: ['id'],
      transaction: t
    });
    const draftIds = drafts.map((d) => d.id);
    await destroyEnvelopes(draftIds, t);

    // How many agreements we're keeping for the legal retention period.
    const retainedAgreements = await DocEnvelope.count({
      where: { CreatedBy: userId, Status: { [Op.ne]: 'draft' } },
      transaction: t
    });

    // 2. Personal address book (recipients + groups + membership).
    const groups = await DocRecipientGroup.findAll({
      where: { OwnerId: userId },
      attributes: ['id'],
      transaction: t
    });
    const groupIds = groups.map((g) => g.id);
    if (groupIds.length) {
      await DocRecipientGroupMember.destroy({ where: { DocRecipientGroupId: groupIds }, transaction: t });
    }
    await DocRecipientGroup.destroy({ where: { OwnerId: userId }, transaction: t });
    await DocRecipient.destroy({ where: { OwnerId: userId }, transaction: t });

    // 3. Active sessions.
    await UserRefreshToken.destroy({ where: { UserId: userId }, transaction: t });

    // 4. Anonymize the account row (keeps FK integrity for retained records).
    const anonEmail = `deleted+${crypto.randomBytes(9).toString('hex')}@deleted.invalid`;
    const user = await User.scope('withSecrets').findByPk(userId, { transaction: t });
    await user.update(
      {
        Name: 'Deleted account',
        Email: anonEmail,
        Company: null,
        PasswordHash: await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 12),
        KdfSalt: null,
        WrappedAccountKey: null,
        RecoveryWrappedAccountKey: null,
        VerificationToken: null,
        ResetToken: null,
        ResetTokenExpiresAt: null,
        DisabledAt: new Date()
      },
      { transaction: t }
    );

    return { draftsPurged: draftIds.length, retainedAgreements };
  });
}

module.exports = { purgeAbandonedDrafts, purgeEnvelopeStorage, runRetention, eraseAccount, DRAFT_DAYS };
