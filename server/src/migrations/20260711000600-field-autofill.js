'use strict';

// A date field can be "auto-filled with the signing date" (locked, stamped with
// the day the signer signs) instead of a manually-entered value. AutoFill marks
// that behavior. Applies to date fields today; reserved for other auto fields.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('DocSignatureFields', 'AutoFill', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('DocSignatureFields', 'AutoFill');
  }
};
