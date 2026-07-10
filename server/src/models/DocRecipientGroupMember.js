'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class DocRecipientGroupMember extends Model {
    static associate(models) {
      DocRecipientGroupMember.belongsTo(models.DocRecipientGroup, {
        foreignKey: 'DocRecipientGroupId',
        as: 'Group'
      });
      DocRecipientGroupMember.belongsTo(models.DocRecipient, {
        foreignKey: 'DocRecipientId',
        as: 'Recipient'
      });
    }
  }

  DocRecipientGroupMember.init(
    {
      DocRecipientGroupId: { type: DataTypes.UUID, allowNull: false },
      DocRecipientId: { type: DataTypes.UUID, allowNull: false },
      SignerRole: { type: DataTypes.STRING, allowNull: true },
      SigningOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 }
    },
    {
      sequelize,
      modelName: 'DocRecipientGroupMember',
      tableName: 'DocRecipientGroupMembers',
      timestamps: true
    }
  );

  return DocRecipientGroupMember;
};
