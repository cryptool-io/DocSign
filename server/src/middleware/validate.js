const { badRequest } = require('../utils/http');

/**
 * Validate one part of the request against a Joi schema and replace it with the
 * coerced/defaulted value. Usage: router.post('/', validate(schema), handler)
 * validates req.body by default; pass 'query' or 'params' for the others.
 */
const validate = (schema, property = 'body') => (req, _res, next) => {
  // Path params: a route may carry extra params the schema doesn't list (e.g.
  // idParam on `/:id/connect/:provider`). Never strip those — allow + keep them.
  const isParams = property === 'params';
  const { error, value } = schema.validate(req[property], {
    abortEarly: false,
    stripUnknown: !isParams,
    allowUnknown: isParams,
    convert: true
  });
  if (error) {
    return next(badRequest(error.details.map((d) => d.message).join('; '), 'validation_error'));
  }
  req[property] = value;
  return next();
};

module.exports = validate;
