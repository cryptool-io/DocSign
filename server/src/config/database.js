require('dotenv').config();

/**
 * Sequelize reads one of these three blocks by NODE_ENV. A single DATABASE_URL
 * takes precedence when present (matches the AMT deploy convention); otherwise
 * the discrete DB_* vars are used.
 */
const common = {
  dialect: 'postgres',
  logging: false,
  define: { underscored: false, freezeTableName: false },
  pool: { max: 10, min: 0, acquire: 30000, idle: 10000 }
};

const fromEnv = () => {
  if (process.env.DATABASE_URL) {
    return {
      ...common,
      use_env_variable: 'DATABASE_URL',
      dialectOptions:
        process.env.DB_SSL === 'true'
          ? { ssl: { require: true, rejectUnauthorized: false } }
          : {}
    };
  }
  return {
    ...common,
    username: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'docsign',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10)
  };
};

module.exports = {
  development: fromEnv(),
  test: fromEnv(),
  production: fromEnv()
};
