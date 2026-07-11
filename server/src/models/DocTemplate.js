'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class DocTemplate extends Model {
    static associate(models) {
      DocTemplate.belongsTo(models.User, { foreignKey: 'OwnerId', as: 'Owner' });
      DocTemplate.belongsTo(models.DocProject, { foreignKey: 'DocProjectId', as: 'Project' });
      DocTemplate.belongsTo(models.DocCompany, { foreignKey: 'DocCompanyId', as: 'Company' });
      DocTemplate.belongsTo(models.DocDocument, { foreignKey: 'SourceDocumentId', as: 'SourceDocument' });
      DocTemplate.hasMany(models.DocSignatureField, { foreignKey: 'DocTemplateId', as: 'Fields' });
      DocTemplate.hasMany(models.DocEnvelope, { foreignKey: 'DocTemplateId', as: 'Envelopes' });
    }
  }

  DocTemplate.init(
    {
      DocProjectId: { type: DataTypes.UUID, allowNull: true },
      DocCompanyId: { type: DataTypes.UUID, allowNull: true },
      SourceDocumentId: { type: DataTypes.UUID, allowNull: true },
      OwnerId: { type: DataTypes.UUID, allowNull: false },
      Name: { type: DataTypes.STRING, allowNull: false },
      Description: { type: DataTypes.TEXT, allowNull: true },
      RequiresSignature: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      SignerRoles: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      DefaultLinkSettings: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      IsDefault: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      ArchivedAt: { type: DataTypes.DATE, allowNull: true }
    },
    { sequelize, modelName: 'DocTemplate', tableName: 'DocTemplates', timestamps: true }
  );

  return DocTemplate;
};
