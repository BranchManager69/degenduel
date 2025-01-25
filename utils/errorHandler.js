import { config } from '../config/config.js';

export class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

export const errorHandler = (error, req, res, next) => {
  const status = error.status || 500;
  const message = error.message || 'Internal server error';

  // Get environment from request
  const currentEnv = req.environment || config.getEnvironment(req.headers.origin);

  // Add stack trace and details only in development
  const errorResponse = {
    error: message,
    status,
    ...(currentEnv === 'development' && {
      stack: error.stack,
      details: error.details
    })
  };

  res.status(status).json(errorResponse);
};