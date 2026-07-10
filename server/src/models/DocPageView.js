'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class DocPageView extends Model {
    static associate(models) {
      DocPageView.belongsTo(models.DocViewSession, { foreignKey: 'DocViewSessionId', as: 'Session' });
    }
  }

  DocPageView.init(
    {
      DocViewSessionId: { type: DataTypes.UUID, allowNull: false },
      PageNumber: { type: DataTypes.INTEGER, allowNull: false },
      Seconds: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      FirstViewedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      LastViewedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
    },
    { sequelize, modelName: 'DocPageView', tableName: 'DocPageViews', timestamps: true }
  );

  return DocPageView;
};
