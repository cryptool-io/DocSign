'use strict';

/**
 * Zero-knowledge encryption columns.
 *
 * Account-key structure (never gives the server a usable key):
 *  - Users.KdfSalt: per-user PBKDF2 salt (not secret).
 *  - Users.WrappedAccountKey: the account key, encrypted by the password-derived
 *    master key. The server stores it but can't decrypt it.
 *  - Users.RecoveryWrappedAccountKey: the same account key, encrypted by a
 *    one-time recovery key the user keeps offline.
 *  - Documents.WrappedDek: the per-document key, encrypted by the account key.
 *  - Documents.Encrypted / EncAlgo: flags for the encrypted-at-rest path.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const t = await queryInterface.sequelize.transaction();
    try {
      const opts = { transaction: t };

      await queryInterface.addColumn('Users', 'KdfSalt', { type: Sequelize.STRING, allowNull: true }, opts);
      await queryInterface.addColumn('Users', 'WrappedAccountKey', { type: Sequelize.TEXT, allowNull: true }, opts);
      await queryInterface.addColumn(
        'Users',
        'RecoveryWrappedAccountKey',
        { type: Sequelize.TEXT, allowNull: true },
        opts
      );

      await queryInterface.addColumn(
        'DocDocuments',
        'Encrypted',
        { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
        opts
      );
      await queryInterface.addColumn('DocDocuments', 'WrappedDek', { type: Sequelize.TEXT, allowNull: true }, opts);
      await queryInterface.addColumn(
        'DocDocuments',
        'EncAlgo',
        { type: Sequelize.STRING, allowNull: true },
        opts
      );

      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
  },

  async down(queryInterface) {
    const t = await queryInterface.sequelize.transaction();
    try {
      const opts = { transaction: t };
      await queryInterface.removeColumn('DocDocuments', 'EncAlgo', opts);
      await queryInterface.removeColumn('DocDocuments', 'WrappedDek', opts);
      await queryInterface.removeColumn('DocDocuments', 'Encrypted', opts);
      await queryInterface.removeColumn('Users', 'RecoveryWrappedAccountKey', opts);
      await queryInterface.removeColumn('Users', 'WrappedAccountKey', opts);
      await queryInterface.removeColumn('Users', 'KdfSalt', opts);
      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
  }
};
