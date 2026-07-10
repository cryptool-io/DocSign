'use strict';
const { Model } = require('sequelize');
const bcrypt = require('bcryptjs');

module.exports = (sequelize, DataTypes) => {
  class User extends Model {
    static associate(models) {
      User.hasMany(models.UserRefreshToken, { foreignKey: 'UserId', as: 'RefreshTokens' });
      User.hasMany(models.DocProject, { foreignKey: 'OwnerId', as: 'Projects' });
      User.hasMany(models.DocDocument, { foreignKey: 'OwnerId', as: 'Documents' });
    }

    async comparePassword(plain) {
      return bcrypt.compare(String(plain || ''), this.PasswordHash);
    }

    get isVerified() {
      return Boolean(this.EmailVerifiedAt);
    }

    toSafeJSON() {
      return {
        id: this.id,
        name: this.Name,
        email: this.Email,
        company: this.Company,
        role: this.Role,
        emailVerified: this.isVerified,
        createdAt: this.createdAt
      };
    }
  }

  User.init(
    {
      Name: { type: DataTypes.STRING, allowNull: false },
      Email: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        set(value) {
          this.setDataValue('Email', String(value || '').trim().toLowerCase());
        }
      },
      PasswordHash: { type: DataTypes.STRING, allowNull: false },
      Company: { type: DataTypes.STRING, allowNull: true },
      Role: { type: DataTypes.STRING, allowNull: false, defaultValue: 'member' },
      EmailVerifiedAt: { type: DataTypes.DATE, allowNull: true },
      VerificationToken: { type: DataTypes.STRING, allowNull: true },
      ResetToken: { type: DataTypes.STRING, allowNull: true },
      ResetTokenExpiresAt: { type: DataTypes.DATE, allowNull: true },
      LastLoginAt: { type: DataTypes.DATE, allowNull: true },
      DisabledAt: { type: DataTypes.DATE, allowNull: true }
    },
    {
      sequelize,
      modelName: 'User',
      tableName: 'Users',
      timestamps: true,
      defaultScope: {
        attributes: {
          exclude: ['PasswordHash', 'VerificationToken', 'ResetToken', 'ResetTokenExpiresAt']
        }
      },
      scopes: {
        withSecrets: { attributes: { exclude: [] } }
      }
    }
  );

  User.setPassword = async (plain) => bcrypt.hash(String(plain), 12);

  return User;
};
