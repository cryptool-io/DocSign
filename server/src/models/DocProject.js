'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class DocProject extends Model {
    static associate(models) {
      DocProject.belongsTo(models.User, { foreignKey: 'OwnerId', as: 'Owner' });
      DocProject.belongsTo(models.DocCompany, { foreignKey: 'DocCompanyId', as: 'Company' });
      DocProject.hasMany(models.DocDocument, { foreignKey: 'DocProjectId', as: 'Documents' });
      DocProject.hasMany(models.DocTemplate, { foreignKey: 'DocProjectId', as: 'Templates' });
      DocProject.hasMany(models.DocRecipient, { foreignKey: 'DocProjectId', as: 'Recipients' });
      DocProject.hasMany(models.DocLink, { foreignKey: 'DocProjectId', as: 'Links' });
      DocProject.hasMany(models.DocEnvelope, { foreignKey: 'DocProjectId', as: 'Envelopes' });
    }
  }

  DocProject.init(
    {
      Name: { type: DataTypes.STRING, allowNull: false },
      Slug: { type: DataTypes.STRING, allowNull: false, unique: true },
      Description: { type: DataTypes.TEXT, allowNull: true },
      LogoUrl: { type: DataTypes.STRING, allowNull: true },
      OwnerId: { type: DataTypes.UUID, allowNull: false },
      DocCompanyId: { type: DataTypes.UUID, allowNull: true },
      ArchivedAt: { type: DataTypes.DATE, allowNull: true }
    },
    { sequelize, modelName: 'DocProject', tableName: 'DocProjects', timestamps: true }
  );

  return DocProject;
};
