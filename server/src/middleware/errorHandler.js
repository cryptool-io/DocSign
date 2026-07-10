const { ApiError } = require('../utils/http');

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, _next) => {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message, code: err.code || undefined });
  }

  // Sequelize surfaces these as validation/constraint errors — translate to 4xx.
  if (err.name === 'SequelizeUniqueConstraintError') {
    return res.status(409).json({ error: 'That record already exists.', code: 'unique_violation' });
  }
  if (err.name === 'SequelizeValidationError') {
    return res.status(400).json({ error: err.errors.map((e) => e.message).join('; ') });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Upload too large.' });
  }

  console.error('[docsign] unhandled error:', err);
  return res.status(500).json({ error: 'Internal server error' });
};

const notFoundHandler = (req, res) => {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}` });
};

module.exports = { errorHandler, notFoundHandler };
