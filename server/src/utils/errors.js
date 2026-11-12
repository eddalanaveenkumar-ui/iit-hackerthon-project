export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new AppError(400, 'BAD_REQUEST', msg, details);
export const unauthorized = (msg = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg = 'You do not have permission to perform this action') =>
  new AppError(403, 'FORBIDDEN', msg);
export const notFound = (msg = 'Resource not found') => new AppError(404, 'NOT_FOUND', msg);
export const conflict = (msg) => new AppError(409, 'CONFLICT', msg);
export const tooMany = (msg = 'Too many requests') => new AppError(429, 'RATE_LIMITED', msg);

export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
