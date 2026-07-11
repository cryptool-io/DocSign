'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class DocSignatureField extends Model {
    static associate(models) {
      DocSignatureField.belongsTo(models.DocTemplate, { foreignKey: 'DocTemplateId', as: 'Template' });
      DocSignatureField.belongsTo(models.DocEnvelope, { foreignKey: 'DocEnvelopeId', as: 'Envelope' });
      DocSignatureField.belongsTo(models.DocEnvelopeSigner, {
        foreignKey: 'DocEnvelopeSignerId',
        as: 'Signer'
      });
    }
  }

  DocSignatureField.init(
    {
      DocTemplateId: { type: DataTypes.UUID, allowNull: true },
      DocEnvelopeId: { type: DataTypes.UUID, allowNull: true },
      DocEnvelopeSignerId: { type: DataTypes.UUID, allowNull: true },
      SignerRole: { type: DataTypes.STRING, allowNull: true },
      Type: {
        type: DataTypes.ENUM('signature', 'initials', 'date', 'text', 'checkbox'),
        allowNull: false
      },
      PageNumber: { type: DataTypes.INTEGER, allowNull: false },
      X: { type: DataTypes.FLOAT, allowNull: false },
      Y: { type: DataTypes.FLOAT, allowNull: false },
      Width: { type: DataTypes.FLOAT, allowNull: false },
      Height: { type: DataTypes.FLOAT, allowNull: false },
      Required: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      // Date fields: auto-fill with the signing date (locked) vs manual entry.
      AutoFill: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      Label: { type: DataTypes.STRING, allowNull: true },
      Value: { type: DataTypes.TEXT, allowNull: true }
    },
    { sequelize, modelName: 'DocSignatureField', tableName: 'DocSignatureFields', timestamps: true }
  );

  return DocSignatureField;
};
