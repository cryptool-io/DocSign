'use strict';

// Companies become the single "Workspace" entity (Projects merged in), so carry
// the Description that Projects had.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('DocCompanies', 'Description', { type: Sequelize.TEXT, allowNull: true });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('DocCompanies', 'Description');
  }
};
