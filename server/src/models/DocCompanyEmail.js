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
      VerifiedAt: { type: DataTypes.DATE, allowNull: true }
    },
    { sequelize, modelName: 'DocCompanyEmail', tableName: 'DocCompanyEmails', timestamps: true }
  );

  return DocCompanyEmail;
};
