'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class DocRecipientGroup extends Model {
    static associate(models) {
      DocRecipientGroup.belongsTo(models.User, { foreignKey: 'OwnerId', as: 'Owner' });
      DocRecipientGroup.belongsTo(models.DocProject, { foreignKey: 'DocProjectId', as: 'Project' });
      DocRecipientGroup.belongsTo(models.DocCompany, { foreignKey: 'DocCompanyId', as: 'Company' });
      DocRecipientGroup.belongsToMany(models.DocRecipient, {
        through: models.DocRecipientGroupMember,
        foreignKey: 'DocRecipientGroupId',
        otherKey: 'DocRecipientId',
        as: 'Recipients'
      });
      DocRecipientGroup.hasMany(models.DocRecipientGroupMember, {
        foreignKey: 'DocRecipientGroupId',
        as: 'Members'
      });
    }
  }

  DocRecipientGroup.init(
    {
      OwnerId: { type: DataTypes.UUID, allowNull: false },
      DocProjectId: { type: DataTypes.UUID, allowNull: true },
      DocCompanyId: { type: DataTypes.UUID, allowNull: true },
      Name: { type: DataTypes.STRING, allowNull: false }
    },
    { sequelize, modelName: 'DocRecipientGroup', tableName: 'DocRecipientGroups', timestamps: true }
  );

  return DocRecipientGroup;
};
