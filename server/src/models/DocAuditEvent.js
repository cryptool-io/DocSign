'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class DocAuditEvent extends Model {
    static associate(models) {
      DocAuditEvent.belongsTo(models.DocEnvelope, { foreignKey: 'DocEnvelopeId', as: 'Envelope' });
      DocAuditEvent.belongsTo(models.DocLink, { foreignKey: 'DocLinkId', as: 'Link' });
    }
  }

  DocAuditEvent.init(
    {
      DocEnvelopeId: { type: DataTypes.UUID, allowNull: true },
      DocLinkId: { type: DataTypes.UUID, allowNull: true },
      DocDocumentId: { type: DataTypes.UUID, allowNull: true },
      Sequence: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      ActorType: {
        type: DataTypes.ENUM('owner', 'signer', 'viewer', 'system'),
        allowNull: false,
        defaultValue: 'system'
      },
      ActorId: { type: DataTypes.UUID, allowNull: true },
      ActorEmail: { type: DataTypes.STRING, allowNull: true },
      EventType: { type: DataTypes.STRING, allowNull: false },
      Metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      IpAddress: { type: DataTypes.STRING(45), allowNull: true },
      UserAgent: { type: DataTypes.TEXT, allowNull: true },
      OccurredAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      PrevHash: { type: DataTypes.STRING(64), allowNull: true },
      Hash: { type: DataTypes.STRING(64), allowNull: false }
    },
    { sequelize, modelName: 'DocAuditEvent', tableName: 'DocAuditEvents', timestamps: true }
  );

  return DocAuditEvent;
};
