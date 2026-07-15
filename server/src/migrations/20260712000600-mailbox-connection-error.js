'use strict';

/**
 * Health flag for a workspace sending mailbox. When a send through a connected
 * mailbox fails (e.g. an expired/revoked OAuth token), we record it here so the UI
 * can surface a "reconnect needed" state instead of silently falling back.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('DocCompanyEmails', 'ConnectionErrorAt', { type: Sequelize.DATE, allowNull: true });
    await queryInterface.addColumn('DocCompanyEmails', 'ConnectionError', { type: Sequelize.STRING, allowNull: true });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('DocCompanyEmails', 'ConnectionErrorAt');
    await queryInterface.removeColumn('DocCompanyEmails', 'ConnectionError');
  }
};
