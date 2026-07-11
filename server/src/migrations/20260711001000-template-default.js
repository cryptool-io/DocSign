'use strict';

/** Let a workspace mark one template as its default (auto-selected when sending). */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('DocTemplates', 'IsDefault', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('DocTemplates', 'IsDefault');
  }
};
