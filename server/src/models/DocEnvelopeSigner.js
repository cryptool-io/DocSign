'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class DocEnvelopeSigner extends Model {
    static associate(models) {
      DocEnvelopeSigner.belongsTo(models.DocEnvelope, { foreignKey: 'DocEnvelopeId', as: 'Envelope' });
      DocEnvelopeSigner.belongsTo(models.DocRecipient, { foreignKey: 'DocRecipientId', as: 'Recipient' });
      DocEnvelopeSigner.belongsTo(models.User, { foreignKey: 'SignedByUserId', as: 'SignedByUser' });
      DocEnvelopeSigner.hasMany(models.DocSignatureField, {
        foreignKey: 'DocEnvelopeSignerId',
        as: 'Fields'
      });
    }
  }

  DocEnvelopeSigner.init(
    {
      DocEnvelopeId: { type: DataTypes.UUID, allowNull: false },
      DocRecipientId: { type: DataTypes.UUID, allowNull: true },
      SignedByUserId: { type: DataTypes.UUID, allowNull: true },
      Name: { type: DataTypes.STRING, allowNull: false },
      Email: {
        type: DataTypes.STRING,
        allowNull: false,
        set(value) {
          this.setDataValue('Email', String(value || '').trim().toLowerCase());
        }
      },
      SignerRole: { type: DataTypes.STRING, allowNull: true },
      SigningOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      AccessToken: { type: DataTypes.STRING, allowNull: false, unique: true },
      Status: {
        type: DataTypes.ENUM('pending', 'viewed', 'signed', 'declined'),
        allowNull: false,
        defaultValue: 'pending'
      },
      OtpCodeHash: { type: DataTypes.STRING, allowNull: true },
      OtpExpiresAt: { type: DataTypes.DATE, allowNull: true },
      OtpAttempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      EmailVerifiedAt: { type: DataTypes.DATE, allowNull: true },
      SignatureType: { type: DataTypes.ENUM('typed', 'drawn'), allowNull: true },
      SignatureImageKey: { type: DataTypes.STRING, allowNull: true },
      ConsentedAt: { type: DataTypes.DATE, allowNull: true },
      ViewedAt: { type: DataTypes.DATE, allowNull: true },
      SignedAt: { type: DataTypes.DATE, allowNull: true },
      DeclinedAt: { type: DataTypes.DATE, allowNull: true },
      DeclineReason: { type: DataTypes.TEXT, allowNull: true },
      IpAddress: { type: DataTypes.STRING(45), allowNull: true },
      UserAgent: { type: DataTypes.TEXT, allowNull: true },
      NotifiedAt: { type: DataTypes.DATE, allowNull: true },
      RemindedAt: { type: DataTypes.DATE, allowNull: true }
    },
    {
      sequelize,
      modelName: 'DocEnvelopeSigner',
      tableName: 'DocEnvelopeSigners',
      timestamps: true,
      defaultScope: { attributes: { exclude: ['OtpCodeHash', 'AccessToken'] } },
      scopes: { withSecrets: { attributes: { exclude: [] } } }
    }
  );

  return DocEnvelopeSigner;
};
