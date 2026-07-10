'use strict';

const timestamps = (Sequelize) => ({
  createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
  updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
});

module.exports = {
  async up(queryInterface, Sequelize) {
    const t = await queryInterface.sequelize.transaction();
    try {
      const opts = { transaction: t };

      await queryInterface.createTable(
        'DocDataRooms',
        {
          id: {
            type: Sequelize.UUID,
            primaryKey: true,
            allowNull: false,
            defaultValue: Sequelize.literal('uuid_generate_v4()')
          },
          OwnerId: {
            type: Sequelize.UUID,
            allowNull: false,
            references: { model: 'Users', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE'
          },
          DocProjectId: {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: 'DocProjects', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL'
          },
          Name: { type: Sequelize.STRING, allowNull: false },
          Description: { type: Sequelize.TEXT, allowNull: true },
          Token: { type: Sequelize.STRING, allowNull: false, unique: true },
          RequireEmail: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
          PasswordHash: { type: Sequelize.STRING, allowNull: true },
          AllowDownload: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
          Watermark: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
          AllowedEmails: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
          NotifyOnView: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
          ExpiresAt: { type: Sequelize.DATE, allowNull: true },
          RevokedAt: { type: Sequelize.DATE, allowNull: true },
          ...timestamps(Sequelize)
        },
        opts
      );

      await queryInterface.createTable(
        'DocDataRoomItems',
        {
          id: {
            type: Sequelize.UUID,
            primaryKey: true,
            allowNull: false,
            defaultValue: Sequelize.literal('uuid_generate_v4()')
          },
          DocDataRoomId: {
            type: Sequelize.UUID,
            allowNull: false,
            references: { model: 'DocDataRooms', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE'
          },
          DocDocumentId: {
            type: Sequelize.UUID,
            allowNull: false,
            references: { model: 'DocDocuments', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE'
          },
          Folder: { type: Sequelize.STRING, allowNull: true },
          Label: { type: Sequelize.STRING, allowNull: true },
          SortOrder: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
          ...timestamps(Sequelize)
        },
        opts
      );

      await queryInterface.addIndex('DocDataRoomItems', ['DocDataRoomId', 'DocDocumentId'], {
        unique: true,
        name: 'DocDataRoomItems_Room_Document_unique',
        transaction: t
      });

      // A view session can now belong to a data-room + document instead of a link.
      // Loosen the NOT NULL on DocLinkId and add the room/document columns.
      await queryInterface.changeColumn(
        'DocViewSessions',
        'DocLinkId',
        { type: Sequelize.UUID, allowNull: true },
        opts
      );
      await queryInterface.addColumn(
        'DocViewSessions',
        'DocDataRoomId',
        {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'DocDataRooms', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE'
        },
        opts
      );
      await queryInterface.addColumn(
        'DocViewSessions',
        'DocDocumentId',
        { type: Sequelize.UUID, allowNull: true },
        opts
      );

      await queryInterface.addIndex('DocViewSessions', ['DocDataRoomId'], {
        name: 'DocViewSessions_DocDataRoomId_idx',
        transaction: t
      });

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
      await queryInterface.removeIndex('DocViewSessions', 'DocViewSessions_DocDataRoomId_idx', opts);
      await queryInterface.removeColumn('DocViewSessions', 'DocDocumentId', opts);
      await queryInterface.removeColumn('DocViewSessions', 'DocDataRoomId', opts);
      // Note: DocLinkId is left nullable on rollback; existing rows are unaffected.
      await queryInterface.dropTable('DocDataRoomItems', opts);
      await queryInterface.dropTable('DocDataRooms', opts);
      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
  }
};
