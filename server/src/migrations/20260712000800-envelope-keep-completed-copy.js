'use strict';

/** Per-send choice: keep the fully-signed PDF on the server so the sender can
 *  download it later, or drop it once it's been emailed to the parties (the
 *  SHA-256 + audit trail always remain either way). Defaults to keeping it —
 *  that's what the Privacy policy promises, and an emailed attachment is a
 *  fragile place for the only copy of an executed agreement to live. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('DocEnvelopes', 'KeepCompletedCopy', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('DocEnvelopes', 'KeepCompletedCopy');
  }
};
