// /utils/logger-suite/logger.js - Centralized logging for DegenDuel backend services.
import { join } from 'path';
import winston from 'winston';
import 'winston-daily-rotate-file';
import paths from '../../config/paths.js';
import { createLogDirectory, getLogFormat } from './logging.js';


/* Logger Suite */

// Default logging configuration
const LOG_CONFIG = {
  rotation: {
    maxSize: '20m',
    maxFiles: '14d',
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true
  },
  levels: {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    verbose: 4,
    debug: 5,
    silly: 6
  }
};

// Ensure log directory exists
createLogDirectory(paths.logs);

// Create base logger instance
const createLogger = (service) => {  
  const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    levels: LOG_CONFIG.levels,
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.metadata({
        fillExcept: ['timestamp', 'level', 'message']
      }),
      getLogFormat()
    ),
    defaultMeta: {
      environment: process.env.NODE_ENV,
      service,
      version: process.env.APP_VERSION || '0.0.1'
    },
    transports: [
      // Service-specific logs
      new winston.transports.DailyRotateFile({
        filename: join(paths.logs, `${service}-%DATE%.log`),
        ...LOG_CONFIG.rotation,
        handleExceptions: true,
        handleRejections: true
      }),
      // Error-specific logs
      new winston.transports.DailyRotateFile({
        filename: join(paths.logs, `error-%DATE%.log`),
        level: 'error',
        ...LOG_CONFIG.rotation,
        handleExceptions: true,
        handleRejections: true
      })
    ]
  });

  // Add request context method
  logger.withRequest = (req) => {
    return {
      ...logger,
      defaultMeta: {
        ...logger.defaultMeta,
        requestId: req.id,
        userId: req.user?.id,
        path: req.path
      }
    };
  };

  // Development console output
  if (process.env.NODE_ENV !== 'production') {
    logger.add(
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple(),
          winston.format.printf(({ level, message, timestamp, ...meta }) => {
            return `${timestamp} ${level}: ${message} ${
              Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''
            }`;
          })
        )
      })
    );
  }

  return logger;
};

export const logApi = createLogger('api');
export const logFrontend = createLogger('frontend');

// Example usage:
// const log = logApi.withRequest(req);
// log.info('User action completed', { action: 'login' });

export default { logApi, logFrontend };