'use strict';

const timestamps = (Sequelize) => ({
  createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
  updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
});

// Tables that become company-scoped (a company = a full separate workspace).
const SCOPED_TABLES = [
  'DocProjects',
  'DocDocuments',
  'DocTemplates',
  'DocRecipients',
  'DocRecipientGroups',
  'DocLinks',
  'DocEnvelopes',
  'DocDataRooms'
];

module.exports = {
  async up(queryInterface, Sequelize) {
    const t = await queryInterface.sequelize.transaction();
    try {
      const opts = { transaction: t };

      await queryInterface.createTable(
        'DocCompanies',
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
          Name: { type: Sequelize.STRING, allowNull: false },
          Slug: { type: Sequelize.STRING, allowNull: false, unique: true },
          SenderName: { type: Sequelize.STRING, allowNull: true },
          SenderEmail: { type: Sequelize.STRING, allowNull: true },
          ReplyToEmail: { type: Sequelize.STRING, allowNull: true },
          LogoUrl: { type: Sequelize.STRING, allowNull: true },
          ArchivedAt: { type: Sequelize.DATE, allowNull: true },
          ...timestamps(Sequelize)
        },
        opts
      );

      await queryInterface.addIndex('DocCompanies', ['OwnerId'], {
        name: 'DocCompanies_OwnerId_idx',
        transaction: t
      });

      await queryInterface.createTable(
        'DocCompanyEmails',
        {
          id: {
            type: Sequelize.UUID,
            primaryKey: true,
            allowNull: false,
            defaultValue: Sequelize.literal('uuid_generate_v4()')
          },
          DocCompanyId: {
            type: Sequelize.UUID,
            allowNull: false,
            references: { model: 'DocCompanies', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE'
          },
          Email: { type: Sequelize.STRING, allowNull: false },
          Label: { type: Sequelize.STRING, allowNull: true },
          IsDefault: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
          // For future SES/domain verification; null = unverified but still usable in dev.
          VerifiedAt: { type: Sequelize.DATE, allowNull: true },
          ...timestamps(Sequelize)
        },
        opts
      );

      await queryInterface.addIndex('DocCompanyEmails', ['DocCompanyId', 'Email'], {
        unique: true,
        name: 'DocCompanyEmails_Company_Email_unique',
        transaction: t
      });

      // Add nullable company scope to each workspace table.
      for (const table of SCOPED_TABLES) {
        await queryInterface.addColumn(
          table,
          'DocCompanyId',
          {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: 'DocCompanies', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL'
          },
          opts
        );
      }

      // Envelope: how signers are reached + whether an email code is required.
      await queryInterface.addColumn(
        'DocEnvelopes',
        'DeliveryMode',
        {
          type: Sequelize.ENUM('email', 'link'),
          allowNull: false,
          defaultValue: 'email'
        },
        opts
      );
      await queryInterface.addColumn(
        'DocEnvelopes',
        'RequireVerification',
        { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        opts
      );
      // The chosen send-as address (one of the company's linked emails).
      await queryInterface.addColumn(
        'DocEnvelopes',
        'FromEmail',
        { type: Sequelize.STRING, allowNull: true },
        opts
      );

      // Attribution: when a signer is (or matches) a real user account.
      await queryInterface.addColumn(
        'DocEnvelopeSigners',
        'SignedByUserId',
        {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'Users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL'
        },
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
      await queryInterface.removeColumn('DocEnvelopeSigners', 'SignedByUserId', opts);
      await queryInterface.removeColumn('DocEnvelopes', 'FromEmail', opts);
      await queryInterface.removeColumn('DocEnvelopes', 'RequireVerification', opts);
      await queryInterface.removeColumn('DocEnvelopes', 'DeliveryMode', opts);
      for (const table of SCOPED_TABLES) {
        await queryInterface.removeColumn(table, 'DocCompanyId', opts);
      }
      await queryInterface.dropTable('DocCompanyEmails', opts);
      await queryInterface.dropTable('DocCompanies', opts);
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_DocEnvelopes_DeliveryMode";', opts);
      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
  }
};
