'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class DocCompanyEmail extends Model {
    static associate(models) {
      DocCompanyEmail.belongsTo(models.DocCompany, { foreignKey: 'DocCompanyId', as: 'Company' });
    }
  }

  DocCompanyEmail.init(
    {
      DocCompanyId: { type: DataTypes.UUID, allowNull: false },
      Email: {
        type: DataTypes.STRING,
        allowNull: false,
        set(v) {
          this.setDataValue('Email', String(v || '').trim().toLowerCase());
        }
      },
      Label: { type: DataTypes.STRING, allowNull: true },
      IsDefault: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      VerifiedAt: { type: DataTypes.DATE, allowNull: true },
      // Provider: 'google' | 'microsoft' (OAuth) | 'smtp' (own mailbox).
      Provider: { type: DataTypes.STRING, allowNull: true },
      OAuthRefreshTokenEnc: { type: DataTypes.TEXT, allowNull: true },
      OAuthConnectedAt: { type: DataTypes.DATE, allowNull: true },
      OAuthScope: { type: DataTypes.TEXT, allowNull: true },
      // SMTP (own-mailbox) connection. Password stored encrypted at rest.
      SmtpHost: { type: DataTypes.STRING, allowNull: true },
      SmtpPort: { type: DataTypes.INTEGER, allowNull: true },
      SmtpSecure: { type: DataTypes.BOOLEAN, allowNull: true },
      SmtpUsername: { type: DataTypes.STRING, allowNull: true },
      SmtpPasswordEnc: { type: DataTypes.TEXT, allowNull: true }
    },
    {
      sequelize,
      modelName: 'DocCompanyEmail',
      tableName: 'DocCompanyEmails',
      timestamps: true,
      // Secrets never leave the server; hide them from default reads.
      defaultScope: { attributes: { exclude: ['OAuthRefreshTokenEnc', 'SmtpPasswordEnc'] } },
      scopes: { withTokens: { attributes: { include: ['OAuthRefreshTokenEnc', 'SmtpPasswordEnc'] } } }
    }
  );

  return DocCompanyEmail;
};
