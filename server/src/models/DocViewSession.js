'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class DocViewSession extends Model {
    static associate(models) {
      DocViewSession.belongsTo(models.DocLink, { foreignKey: 'DocLinkId', as: 'Link' });
      DocViewSession.hasMany(models.DocPageView, { foreignKey: 'DocViewSessionId', as: 'PageViews' });
    }
  }

  DocViewSession.init(
    {
      DocLinkId: { type: DataTypes.UUID, allowNull: false },
      ViewerEmail: { type: DataTypes.STRING, allowNull: true },
      IpAddress: { type: DataTypes.STRING(45), allowNull: true },
      UserAgent: { type: DataTypes.TEXT, allowNull: true },
      Country: { type: DataTypes.STRING, allowNull: true },
      City: { type: DataTypes.STRING, allowNull: true },
      Referrer: { type: DataTypes.TEXT, allowNull: true },
      StartedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      LastSeenAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      TotalSeconds: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      PagesViewed: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      Downloaded: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }
    },
    { sequelize, modelName: 'DocViewSession', tableName: 'DocViewSessions', timestamps: true }
  );

  return DocViewSession;
};
