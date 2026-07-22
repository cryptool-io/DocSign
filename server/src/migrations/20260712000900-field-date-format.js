'use strict';

/**
 * Per date field: how the signing date is displayed (e.g. "July 20, 2026" vs
 * "20/07/2026"). Chosen by the sender when placing the field. Null = the default
 * long format. Applied on the signing screen and when stamping the PDF.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('DocSignatureFields', 'DateFormat', { type: Sequelize.STRING, allowNull: true });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('DocSignatureFields', 'DateFormat');
  }
};
