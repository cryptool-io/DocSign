'use strict';

/** Per-field text style: font family + point size (used to stamp text/date). */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('DocSignatureFields', 'FontSize', { type: Sequelize.INTEGER, allowNull: true });
    await queryInterface.addColumn('DocSignatureFields', 'Font', { type: Sequelize.STRING, allowNull: true });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('DocSignatureFields', 'FontSize');
    await queryInterface.removeColumn('DocSignatureFields', 'Font');
  }
};
