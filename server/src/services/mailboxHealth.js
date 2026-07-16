'use strict';

/**
 * Tracks the health of a workspace's sending mailbox. When a send through a
 * connected mailbox fails (typically an expired/revoked OAuth token), we flag the
 * mailbox so the UI can show "reconnect needed" instead of silently falling back
 * to the system mailbox — and email the owner once, when it first breaks.
 */

const { Op } = require('sequelize');
const { DocCompanyEmail } = require('../models');
const email = require('./email');
const oauth = require('./emailOAuth');
const { decryptSecret } = require('./secretStore');

/** Flag a mailbox as failing. Emails the owner only on the transition to failing. */
async function flagConnectionError(emailId, message) {
  if (!emailId) return;
  const row = await DocCompanyEmail.findByPk(emailId, {
    include: [{ association: 'Company', include: [{ association: 'Owner' }] }]
  });
  if (!row) return;
  const wasHealthy = !row.ConnectionErrorAt;
  await row.update({ ConnectionErrorAt: new Date(), ConnectionError: String(message || 'Send failed').slice(0, 240) });
  if (wasHealthy) {
    const owner = row.Company && row.Company.Owner;
    if (owner && owner.Email) {
      await email
        .mailboxDisconnected({ to: owner.Email, name: owner.Name, mailbox: row.Email, workspace: row.Company.Name, reason: message })
        .catch(() => {});
    }
  }
}

/** Clear the flag after a successful send or a reconnect. */
async function clearConnectionError(emailId) {
  if (!emailId) return;
  await DocCompanyEmail.update(
    { ConnectionErrorAt: null, ConnectionError: null },
    { where: { id: emailId, ConnectionErrorAt: { [Op.ne]: null } } }
  ).catch(() => {});
}

/** Exercise one mailbox's stored credential. Throws if it no longer works. */
async function pingMailbox(row) {
  if (row.Provider === 'smtp') {
    return email.verifySmtp({
      host: row.SmtpHost,
      port: row.SmtpPort,
      secure: row.SmtpSecure,
      user: row.SmtpUsername || row.Email,
      pass: decryptSecret(row.SmtpPasswordEnc)
    });
  }
  return oauth.refreshAccessToken(row.Provider, decryptSecret(row.OAuthRefreshTokenEnc));
}

/**
 * Proactive daily check of every connected workspace mailbox, so a dead credential
 * is caught (and the owner emailed) BEFORE it silently pauses someone's signing
 * emails — rather than only when a send happens to fail.
 */
async function sweepMailboxHealth() {
  const rows = await DocCompanyEmail.scope('withTokens').findAll({
    where: { Provider: { [Op.ne]: null }, VerifiedAt: { [Op.ne]: null } },
    limit: 500
  });
  let broken = 0;
  for (const row of rows) {
    if (!(row.OAuthRefreshTokenEnc || row.SmtpPasswordEnc)) continue;
    try {
      await pingMailbox(row);
      await clearConnectionError(row.id);
    } catch (e) {
      await flagConnectionError(row.id, e.message); // emails the owner on first failure
      broken += 1;
    }
  }
  return broken;
}

module.exports = { flagConnectionError, clearConnectionError, sweepMailboxHealth };
