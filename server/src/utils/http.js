/** Small HTTP helpers shared by every controller. */

class ApiError extends Error {
  constructor(status, message, code = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.expose = true;
  }
}

const badRequest = (msg, code) => new ApiError(400, msg, code);
const unauthorized = (msg = 'Unauthorized', code) => new ApiError(401, msg, code);
const forbidden = (msg = 'Forbidden', code) => new ApiError(403, msg, code);
const notFound = (msg = 'Not found', code) => new ApiError(404, msg, code);
const conflict = (msg, code) => new ApiError(409, msg, code);
const tooMany = (msg = 'Too many requests', code) => new ApiError(429, msg, code);

/** Wrap an async route so thrown/rejected errors reach the error middleware. */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const clientIp = (req) => {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || null;
};

module.exports = {
  ApiError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  tooMany,
  asyncHandler,
  clientIp
};
