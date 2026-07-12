'use strict';

/**
 * Per-document storage sovereignty.
 *  - StorageMode 'stored' (default): the PDF is kept in our storage (current behavior).
 *  - StorageMode 'sovereign': the PDF stays on the user's device; we hold only the
 *    overlay + hash. Bytes are attached transiently at send time and purged on
 *    completion, so FileKey must be allowed to be empty.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('DocDocuments', 'StorageMode', {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: 'stored'
    });
    await queryInterface.changeColumn('DocDocuments', 'FileKey', {
      type: Sequelize.STRING,
      allowNull: true
    });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('DocDocuments', 'StorageMode');
    await queryInterface.changeColumn('DocDocuments', 'FileKey', {
      type: Sequelize.STRING,
      allowNull: false
    });
  }
};
