'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class DocRecipient extends Model {
    static associate(models) {
      DocRecipient.belongsTo(models.User, { foreignKey: 'OwnerId', as: 'Owner' });
      DocRecipient.belongsTo(models.DocProject, { foreignKey: 'DocProjectId', as: 'Project' });
      // 'Workspace' alias to avoid colliding with the recipient's own Company (employer) attribute.
      DocRecipient.belongsTo(models.DocCompany, { foreignKey: 'DocCompanyId', as: 'Workspace' });
      DocRecipient.belongsToMany(models.DocRecipientGroup, {
        through: models.DocRecipientGroupMember,
        foreignKey: 'DocRecipientId',
        otherKey: 'DocRecipientGroupId',
        as: 'Groups'
      });
      DocRecipient.hasMany(models.DocLink, { foreignKey: 'DocRecipientId', as: 'Links' });
      DocRecipient.hasMany(models.DocEnvelopeSigner, { foreignKey: 'DocRecipientId', as: 'SignerEntries' });
    }
  }

  DocRecipient.init(
    {
      OwnerId: { type: DataTypes.UUID, allowNull: false },
      DocProjectId: { type: DataTypes.UUID, allowNull: true },
      DocCompanyId: { type: DataTypes.UUID, allowNull: true },
      Name: { type: DataTypes.STRING, allowNull: false },
      Email: {
        type: DataTypes.STRING,
        allowNull: false,
        set(value) {
          this.setDataValue('Email', String(value || '').trim().toLowerCase());
        }
      },
      Company: { type: DataTypes.STRING, allowNull: true },
      Title: { type: DataTypes.STRING, allowNull: true },
      Favorite: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      ArchivedAt: { type: DataTypes.DATE, allowNull: true }
    },
    { sequelize, modelName: 'DocRecipient', tableName: 'DocRecipients', timestamps: true }
  );

  return DocRecipient;
};
