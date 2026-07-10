'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class UserRefreshToken extends Model {
    static associate(models) {
      UserRefreshToken.belongsTo(models.User, { foreignKey: 'UserId', as: 'User' });
    }

    isActive() {
      return !this.RevokedAt && new Date(this.ExpiresAt).getTime() > Date.now();
    }
  }

  UserRefreshToken.init(
    {
      UserId: { type: DataTypes.UUID, allowNull: false },
      TokenHash: { type: DataTypes.STRING, allowNull: false, unique: true },
      UserAgent: { type: DataTypes.TEXT, allowNull: true },
      IpAddress: { type: DataTypes.STRING(45), allowNull: true },
      ExpiresAt: { type: DataTypes.DATE, allowNull: false },
      RevokedAt: { type: DataTypes.DATE, allowNull: true }
    },
    { sequelize, modelName: 'UserRefreshToken', tableName: 'UserRefreshTokens', timestamps: true }
  );

  return UserRefreshToken;
};
