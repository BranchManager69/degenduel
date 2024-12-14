import winston from 'winston';
import 'winston-daily-rotate-file';
import { join } from 'path';
import { createLogDirectory, getLogFormat } from '../server/utils/logging.js';
import paths from '../server/config/paths.js';

// Ensure log directory exists with correct permissions
createLogDirectory(paths.logs);

// Create separate loggers for API and Frontend
const createLogger = (service) => {
  return winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: getLogFormat(),
    defaultMeta: {
      environment: process.env.NODE_ENV,
      service
    },
    transports: [
      // Service-specific logs
      new winston.transports.DailyRotateFile({
        filename: join(paths.logs, `${service}-%DATE%.log`),
        datePattern: 'YYYY-MM-DD',
        maxSize: '20m',
        maxFiles: '14d',
        zippedArchive: true,
        handleExceptions: true,
        handleRejections: true
      }),
      // Error logs
      new winston.transports.DailyRotateFile({
        filename: join(paths.logs, `error-%DATE%.log`),
        datePattern: 'YYYY-MM-DD',
        level: 'error',
        maxSize: '20m',
        maxFiles: '14d',
        zippedArchive: true,
        handleExceptions: true,
        handleRejections: true
      })
    ]
  });
};

// Create separate loggers for API and Frontend
export const logApi = createLogger('api');
export const logFrontend = createLogger('frontend');

// Add console transport in development
if (process.env.NODE_ENV !== 'production') {
  const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.simple()
  );
  
  [logApi, logFrontend].forEach(logger => {
    logger.add(new winston.transports.Console({ format: consoleFormat }));
  });
}

// Export default logger for backward compatibility
export default logApi;