'use strict';

// Let a workspace sending address be connected via the user's own SMTP mailbox
// (app password) — an alternative to OAuth for clients who send from their own
// email. Password is stored encrypted at rest (secretStore), like OAuth tokens.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('DocCompanyEmails', 'SmtpHost', { type: Sequelize.STRING, allowNull: true });
    await queryInterface.addColumn('DocCompanyEmails', 'SmtpPort', { type: Sequelize.INTEGER, allowNull: true });
    await queryInterface.addColumn('DocCompanyEmails', 'SmtpSecure', { type: Sequelize.BOOLEAN, allowNull: true });
    await queryInterface.addColumn('DocCompanyEmails', 'SmtpUsername', { type: Sequelize.STRING, allowNull: true });
    await queryInterface.addColumn('DocCompanyEmails', 'SmtpPasswordEnc', { type: Sequelize.TEXT, allowNull: true });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('DocCompanyEmails', 'SmtpPasswordEnc');
    await queryInterface.removeColumn('DocCompanyEmails', 'SmtpUsername');
    await queryInterface.removeColumn('DocCompanyEmails', 'SmtpSecure');
    await queryInterface.removeColumn('DocCompanyEmails', 'SmtpPort');
    await queryInterface.removeColumn('DocCompanyEmails', 'SmtpHost');
  }
};
