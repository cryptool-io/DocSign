'use strict';

/** Let a signing setup (template) also store a default subject + message. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('DocTemplates', 'DefaultSubject', { type: Sequelize.STRING, allowNull: true });
    await queryInterface.addColumn('DocTemplates', 'DefaultMessage', { type: Sequelize.TEXT, allowNull: true });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('DocTemplates', 'DefaultSubject');
    await queryInterface.removeColumn('DocTemplates', 'DefaultMessage');
  }
};
