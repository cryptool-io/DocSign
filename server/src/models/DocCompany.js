'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class DocCompany extends Model {
    static associate(models) {
      DocCompany.belongsTo(models.User, { foreignKey: 'OwnerId', as: 'Owner' });
      DocCompany.hasMany(models.DocCompanyEmail, { foreignKey: 'DocCompanyId', as: 'Emails' });
      DocCompany.hasMany(models.DocTemplate, { foreignKey: 'DocCompanyId', as: 'Templates' });
      DocCompany.hasMany(models.DocProject, { foreignKey: 'DocCompanyId', as: 'Projects' });
      DocCompany.hasMany(models.DocDocument, { foreignKey: 'DocCompanyId', as: 'Documents' });
      DocCompany.hasMany(models.DocEnvelope, { foreignKey: 'DocCompanyId', as: 'Envelopes' });
      DocCompany.hasMany(models.DocDataRoom, { foreignKey: 'DocCompanyId', as: 'DataRooms' });
    }
  }

  DocCompany.init(
    {
      OwnerId: { type: DataTypes.UUID, allowNull: false },
      Name: { type: DataTypes.STRING, allowNull: false },
      Description: { type: DataTypes.TEXT, allowNull: true },
      Slug: { type: DataTypes.STRING, allowNull: false, unique: true },
      SenderName: { type: DataTypes.STRING, allowNull: true },
      SenderEmail: {
        type: DataTypes.STRING,
        allowNull: true,
        set(v) {
          this.setDataValue('SenderEmail', v ? String(v).trim().toLowerCase() : null);
        }
      },
      ReplyToEmail: { type: DataTypes.STRING, allowNull: true },
      LogoUrl: { type: DataTypes.STRING, allowNull: true },
      ArchivedAt: { type: DataTypes.DATE, allowNull: true }
    },
    { sequelize, modelName: 'DocCompany', tableName: 'DocCompanies', timestamps: true }
  );

  return DocCompany;
};
