'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');

    await queryInterface.createTable('Users', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal('uuid_generate_v4()')
      },
      Name: { type: Sequelize.STRING, allowNull: false },
      Email: { type: Sequelize.STRING, allowNull: false, unique: true },
      PasswordHash: { type: Sequelize.STRING, allowNull: false },
      Company: { type: Sequelize.STRING, allowNull: true },
      Role: { type: Sequelize.STRING, allowNull: false, defaultValue: 'member' },
      EmailVerifiedAt: { type: Sequelize.DATE, allowNull: true },
      VerificationToken: { type: Sequelize.STRING, allowNull: true },
      ResetToken: { type: Sequelize.STRING, allowNull: true },
      ResetTokenExpiresAt: { type: Sequelize.DATE, allowNull: true },
      LastLoginAt: { type: Sequelize.DATE, allowNull: true },
      DisabledAt: { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
    });

    await queryInterface.createTable('UserRefreshTokens', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal('uuid_generate_v4()')
      },
      UserId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      TokenHash: { type: Sequelize.STRING, allowNull: false, unique: true },
      UserAgent: { type: Sequelize.TEXT, allowNull: true },
      IpAddress: { type: Sequelize.STRING(45), allowNull: true },
      ExpiresAt: { type: Sequelize.DATE, allowNull: false },
      RevokedAt: { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
    });

    await queryInterface.addIndex('UserRefreshTokens', ['UserId'], {
      name: 'UserRefreshTokens_UserId_idx'
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('UserRefreshTokens');
    await queryInterface.dropTable('Users');
  }
};
