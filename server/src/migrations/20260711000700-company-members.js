'use strict';

// Team access: a workspace (DocCompany) can have members besides its owner, so
// several users share the same workspace, documents, templates, envelopes, etc.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('DocCompanyMembers', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      DocCompanyId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'DocCompanies', key: 'id' },
        onDelete: 'CASCADE'
      },
      UserId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'Users', key: 'id' },
        onDelete: 'CASCADE'
      },
      Role: { type: Sequelize.STRING, allowNull: false, defaultValue: 'member' },
      InvitedByUserId: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    });
    await queryInterface.addConstraint('DocCompanyMembers', {
      fields: ['DocCompanyId', 'UserId'],
      type: 'unique',
      name: 'doc_company_members_company_user_unique'
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('DocCompanyMembers');
  }
};
