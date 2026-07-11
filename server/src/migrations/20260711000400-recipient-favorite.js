'use strict';

// Lets a saved recipient be starred as a favorite so it floats to the top of the
// "From saved recipient" picker in the Send flow.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('DocRecipients', 'Favorite', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('DocRecipients', 'Favorite');
  }
};
