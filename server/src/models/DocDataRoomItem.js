'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class DocDataRoomItem extends Model {
    static associate(models) {
      DocDataRoomItem.belongsTo(models.DocDataRoom, { foreignKey: 'DocDataRoomId', as: 'Room' });
      DocDataRoomItem.belongsTo(models.DocDocument, { foreignKey: 'DocDocumentId', as: 'Document' });
    }
  }

  DocDataRoomItem.init(
    {
      DocDataRoomId: { type: DataTypes.UUID, allowNull: false },
      DocDocumentId: { type: DataTypes.UUID, allowNull: false },
      Folder: { type: DataTypes.STRING, allowNull: true },
      Label: { type: DataTypes.STRING, allowNull: true },
      SortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }
    },
    { sequelize, modelName: 'DocDataRoomItem', tableName: 'DocDataRoomItems', timestamps: true }
  );

  return DocDataRoomItem;
};
