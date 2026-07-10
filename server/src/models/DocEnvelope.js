'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class DocEnvelope extends Model {
    static associate(models) {
      DocEnvelope.belongsTo(models.User, { foreignKey: 'CreatedBy', as: 'Creator' });
      DocEnvelope.belongsTo(models.DocDocument, { foreignKey: 'DocDocumentId', as: 'Document' });
      DocEnvelope.belongsTo(models.DocProject, { foreignKey: 'DocProjectId', as: 'Project' });
      DocEnvelope.belongsTo(models.DocTemplate, { foreignKey: 'DocTemplateId', as: 'Template' });
      DocEnvelope.hasMany(models.DocEnvelopeSigner, { foreignKey: 'DocEnvelopeId', as: 'Signers' });
      DocEnvelope.hasMany(models.DocSignatureField, { foreignKey: 'DocEnvelopeId', as: 'Fields' });
      DocEnvelope.hasMany(models.DocAuditEvent, { foreignKey: 'DocEnvelopeId', as: 'AuditEvents' });
    }

    isTerminal() {
      return ['completed', 'declined', 'voided', 'expired'].includes(this.Status);
    }
  }

  DocEnvelope.init(
    {
      DocDocumentId: { type: DataTypes.UUID, allowNull: false },
      DocProjectId: { type: DataTypes.UUID, allowNull: true },
      DocTemplateId: { type: DataTypes.UUID, allowNull: true },
      CreatedBy: { type: DataTypes.UUID, allowNull: false },
      Subject: { type: DataTypes.STRING, allowNull: false },
      Message: { type: DataTypes.TEXT, allowNull: true },
      Status: {
        type: DataTypes.ENUM('draft', 'sent', 'partially_signed', 'completed', 'declined', 'voided', 'expired'),
        allowNull: false,
        defaultValue: 'draft'
      },
      SigningOrder: {
        type: DataTypes.ENUM('sequential', 'parallel'),
        allowNull: false,
        defaultValue: 'parallel'
      },
      ExpiresAt: { type: DataTypes.DATE, allowNull: true },
      SentAt: { type: DataTypes.DATE, allowNull: true },
      CompletedAt: { type: DataTypes.DATE, allowNull: true },
      CompletedFileKey: { type: DataTypes.STRING, allowNull: true },
      CompletedSha256: { type: DataTypes.STRING(64), allowNull: true },
      VoidedAt: { type: DataTypes.DATE, allowNull: true },
      VoidReason: { type: DataTypes.TEXT, allowNull: true }
    },
    { sequelize, modelName: 'DocEnvelope', tableName: 'DocEnvelopes', timestamps: true }
  );

  return DocEnvelope;
};
