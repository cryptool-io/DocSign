'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class DocDocument extends Model {
    static associate(models) {
      DocDocument.belongsTo(models.User, { foreignKey: 'OwnerId', as: 'Owner' });
      DocDocument.belongsTo(models.DocProject, { foreignKey: 'DocProjectId', as: 'Project' });
      DocDocument.belongsTo(models.DocCompany, { foreignKey: 'DocCompanyId', as: 'Company' });
      DocDocument.belongsTo(models.DocDocument, { foreignKey: 'ParentDocumentId', as: 'ParentDocument' });
      DocDocument.hasMany(models.DocDocument, { foreignKey: 'ParentDocumentId', as: 'Versions' });
      DocDocument.hasMany(models.DocLink, { foreignKey: 'DocDocumentId', as: 'Links' });
      DocDocument.hasMany(models.DocEnvelope, { foreignKey: 'DocDocumentId', as: 'Envelopes' });
    }
  }

  DocDocument.init(
    {
      DocProjectId: { type: DataTypes.UUID, allowNull: true },
      DocCompanyId: { type: DataTypes.UUID, allowNull: true },
      OwnerId: { type: DataTypes.UUID, allowNull: false },
      Name: { type: DataTypes.STRING, allowNull: false },
      StorageDriver: { type: DataTypes.STRING, allowNull: false, defaultValue: 's3' },
      // 'stored' = PDF kept in our storage; 'sovereign' = PDF stays on the user's
      // device, we hold only the overlay + hash and hold bytes transiently at send.
      StorageMode: { type: DataTypes.STRING, allowNull: false, defaultValue: 'stored' },
      // Null for a sovereign shell with no bytes currently attached.
      FileKey: { type: DataTypes.STRING, allowNull: true },
      MimeType: { type: DataTypes.STRING, allowNull: false, defaultValue: 'application/pdf' },
      SizeBytes: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      PageCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      Sha256: { type: DataTypes.STRING(64), allowNull: false },
      Version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      ParentDocumentId: { type: DataTypes.UUID, allowNull: true },
      ArchivedAt: { type: DataTypes.DATE, allowNull: true },
      // Zero-knowledge encryption: FileKey points at ciphertext; WrappedDek is the
      // document key wrapped by the owner's account key (server can't unwrap it).
      Encrypted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      WrappedDek: { type: DataTypes.TEXT, allowNull: true },
      EncAlgo: { type: DataTypes.STRING, allowNull: true }
    },
    { sequelize, modelName: 'DocDocument', tableName: 'DocDocuments', timestamps: true }
  );

  return DocDocument;
};
