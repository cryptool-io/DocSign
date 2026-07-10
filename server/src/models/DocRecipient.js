'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class DocRecipient extends Model {
    static associate(models) {
      DocRecipient.belongsTo(models.User, { foreignKey: 'OwnerId', as: 'Owner' });
      DocRecipient.belongsTo(models.DocProject, { foreignKey: 'DocProjectId', as: 'Project' });
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
      ArchivedAt: { type: DataTypes.DATE, allowNull: true }
    },
    { sequelize, modelName: 'DocRecipient', tableName: 'DocRecipients', timestamps: true }
  );

  return DocRecipient;
};
