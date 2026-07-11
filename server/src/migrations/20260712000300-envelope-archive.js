'use strict';

/** Let a sender remove (archive) an envelope from their list. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('DocEnvelopes', 'ArchivedAt', { type: Sequelize.DATE, allowNull: true });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('DocEnvelopes', 'ArchivedAt');
  }
};
