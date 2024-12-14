import fs from 'fs';
import winston from 'winston';

export function createLogDirectory(logDir) {
  try {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true, mode: 0o755 });
    } else {
      fs.chmodSync(logDir, 0o755);
    }
  } catch (error) {
    console.error('Failed to setup log directory:', error);
    process.exit(1);
  }
}

export function getLogFormat() {
  return winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  );
}

export function setupGracefulLogging(logger) {
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception:', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection:', {
      reason: reason instanceof Error ? reason.message : reason,
      stack: reason instanceof Error ? reason.stack : undefined
    });
    process.exit(1);
  });
}