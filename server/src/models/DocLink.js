'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class DocLink extends Model {
    static associate(models) {
      DocLink.belongsTo(models.User, { foreignKey: 'CreatedBy', as: 'Creator' });
      DocLink.belongsTo(models.DocDocument, { foreignKey: 'DocDocumentId', as: 'Document' });
      DocLink.belongsTo(models.DocProject, { foreignKey: 'DocProjectId', as: 'Project' });
      DocLink.belongsTo(models.DocRecipient, { foreignKey: 'DocRecipientId', as: 'Recipient' });
      DocLink.hasMany(models.DocViewSession, { foreignKey: 'DocLinkId', as: 'Sessions' });
      DocLink.hasMany(models.DocAuditEvent, { foreignKey: 'DocLinkId', as: 'AuditEvents' });
    }

    isExpired() {
      return Boolean(this.ExpiresAt) && new Date(this.ExpiresAt).getTime() <= Date.now();
    }

    isExhausted() {
      return this.MaxViews !== null && this.MaxViews !== undefined && this.ViewCount >= this.MaxViews;
    }

    isRevoked() {
      return Boolean(this.RevokedAt);
    }

    isUsable() {
      return !this.isRevoked() && !this.isExpired() && !this.isExhausted();
    }

    /**
     * AllowedEmails entries are either a full address or a "@domain.com" suffix.
     * An empty list means the link is open to anyone who has it.
     */
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

  DocLink.init(
    {
      DocDocumentId: { type: DataTypes.UUID, allowNull: false },
      DocProjectId: { type: DataTypes.UUID, allowNull: true },
      DocRecipientId: { type: DataTypes.UUID, allowNull: true },
      CreatedBy: { type: DataTypes.UUID, allowNull: false },
      Token: { type: DataTypes.STRING, allowNull: false, unique: true },
      Name: { type: DataTypes.STRING, allowNull: true },
      RequireEmail: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      PasswordHash: { type: DataTypes.STRING, allowNull: true },
      AllowDownload: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      Watermark: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      AllowedEmails: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      NotifyOnView: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      ExpiresAt: { type: DataTypes.DATE, allowNull: true },
      MaxViews: { type: DataTypes.INTEGER, allowNull: true },
      ViewCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      RevokedAt: { type: DataTypes.DATE, allowNull: true }
    },
    {
      sequelize,
      modelName: 'DocLink',
      tableName: 'DocLinks',
      timestamps: true,
      defaultScope: { attributes: { exclude: ['PasswordHash'] } },
      scopes: { withSecrets: { attributes: { include: ['PasswordHash'] } } }
    }
  );

  return DocLink;
};
