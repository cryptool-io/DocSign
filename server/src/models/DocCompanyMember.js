'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class DocCompanyMember extends Model {
    static associate(models) {
      DocCompanyMember.belongsTo(models.DocCompany, { foreignKey: 'DocCompanyId', as: 'Company' });
      DocCompanyMember.belongsTo(models.User, { foreignKey: 'UserId', as: 'User' });
    }
  }

  DocCompanyMember.init(
    {
      DocCompanyId: { type: DataTypes.UUID, allowNull: false },
      UserId: { type: DataTypes.UUID, allowNull: false },
      Role: { type: DataTypes.STRING, allowNull: false, defaultValue: 'member' },
      InvitedByUserId: { type: DataTypes.UUID, allowNull: true }
    },
    { sequelize, modelName: 'DocCompanyMember', tableName: 'DocCompanyMembers', timestamps: true }
  );

  return DocCompanyMember;
};
