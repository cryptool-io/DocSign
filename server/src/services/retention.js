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
  DocAuditEvent
} = require('../models');

const DRAFT_DAYS = parseInt(process.env.RETENTION_DRAFT_DAYS || '30', 10);

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

/** Entry point for the scheduler — logs a one-line summary, never throws. */
async function runRetention() {
  try {
    const purged = await purgeAbandonedDrafts();
    if (purged) console.log(`[retention] purged ${purged} abandoned draft envelope(s) older than ${DRAFT_DAYS}d`);
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

module.exports = { purgeAbandonedDrafts, runRetention, eraseAccount, DRAFT_DAYS };
