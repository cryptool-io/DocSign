'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class DocDataRoom extends Model {
    static associate(models) {
      DocDataRoom.belongsTo(models.User, { foreignKey: 'OwnerId', as: 'Owner' });
      DocDataRoom.belongsTo(models.DocProject, { foreignKey: 'DocProjectId', as: 'Project' });
      DocDataRoom.belongsTo(models.DocCompany, { foreignKey: 'DocCompanyId', as: 'Company' });
      DocDataRoom.hasMany(models.DocDataRoomItem, { foreignKey: 'DocDataRoomId', as: 'Items' });
      DocDataRoom.hasMany(models.DocViewSession, { foreignKey: 'DocDataRoomId', as: 'Sessions' });
    }

    isExpired() {
      return Boolean(this.ExpiresAt) && new Date(this.ExpiresAt).getTime() <= Date.now();
    }
    isRevoked() {
      return Boolean(this.RevokedAt);
    }
    isUsable() {
      return !this.isRevoked() && !this.isExpired();
    }

    allowsEmail(email) {
      const list = Array.isArray(this.AllowedEmails) ? this.AllowedEmails : [];
      if (list.length === 0) return true;
      const candidate = String(email || '').trim().toLowerCase();
      if (!candidate) return false;
      return list.some((entry) => {
        const rule = String(entry || '').trim().toLowerCase();
        if (!rule) return false;
        if (rule.startsWith('@')) return candidate.endsWith(rule);
        return candidate === rule;
      });
    }
  }

  DocDataRoom.init(
    {
      OwnerId: { type: DataTypes.UUID, allowNull: false },
      DocProjectId: { type: DataTypes.UUID, allowNull: true },
      DocCompanyId: { type: DataTypes.UUID, allowNull: true },
      Name: { type: DataTypes.STRING, allowNull: false },
      Description: { type: DataTypes.TEXT, allowNull: true },
      Token: { type: DataTypes.STRING, allowNull: false, unique: true },
      RequireEmail: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      PasswordHash: { type: DataTypes.STRING, allowNull: true },
      AllowDownload: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      Watermark: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      AllowedEmails: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      NotifyOnView: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      ExpiresAt: { type: DataTypes.DATE, allowNull: true },
      RevokedAt: { type: DataTypes.DATE, allowNull: true }
    },
    {
      sequelize,
      modelName: 'DocDataRoom',
      tableName: 'DocDataRooms',
      timestamps: true,
      defaultScope: { attributes: { exclude: ['PasswordHash'] } },
      scopes: { withSecrets: { attributes: { include: ['PasswordHash'] } } }
    }
  );

  return DocDataRoom;
};
