'use strict';

/**
 * OAuth email connections. A company's linked address can be "connected" to the
 * mailbox that owns it (Gmail via Google, Outlook via Microsoft). Connecting
 * proves ownership and is what lets us send signature requests FROM that address
 * through the user's own mailbox. Only connected (verified) addresses may send.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const t = await queryInterface.sequelize.transaction();
    try {
      const opts = { transaction: t };
      // 'manual' (typed, cannot send) | 'google' | 'microsoft'
      await queryInterface.addColumn('DocCompanyEmails', 'Provider', { type: Sequelize.STRING, allowNull: true }, opts);
      // Refresh token, encrypted at rest with EMAIL_TOKEN_ENC_KEY.
      await queryInterface.addColumn('DocCompanyEmails', 'OAuthRefreshTokenEnc', { type: Sequelize.TEXT, allowNull: true }, opts);
      await queryInterface.addColumn('DocCompanyEmails', 'OAuthConnectedAt', { type: Sequelize.DATE, allowNull: true }, opts);
      // Space-separated granted scopes (for diagnostics).
      await queryInterface.addColumn('DocCompanyEmails', 'OAuthScope', { type: Sequelize.TEXT, allowNull: true }, opts);
      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
  },

  async down(queryInterface) {
    const t = await queryInterface.sequelize.transaction();
    try {
      const opts = { transaction: t };
      await queryInterface.removeColumn('DocCompanyEmails', 'OAuthScope', opts);
      await queryInterface.removeColumn('DocCompanyEmails', 'OAuthConnectedAt', opts);
      await queryInterface.removeColumn('DocCompanyEmails', 'OAuthRefreshTokenEnc', opts);
      await queryInterface.removeColumn('DocCompanyEmails', 'Provider', opts);
      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
  }
};
