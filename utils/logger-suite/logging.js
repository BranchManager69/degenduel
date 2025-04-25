// /utils/logger-suite/logging.js
import boxen from 'boxen';
import chalk from 'chalk';
import cliProgress from 'cli-progress';
import figlet from 'figlet';
import gradient from 'gradient-string';
import ora from 'ora';
import winston from 'winston';

// Create base logger instance first
const baseLogger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json(),
    winston.format.prettyPrint()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new winston.transports.File({ 
      filename: 'error.log', 
      level: 'error' 
    }),
    new winston.transports.File({ 
      filename: 'combined.log' 
    })
  ]
});

// Create singleton class
class LoggerSingleton {
  constructor() {
    if (LoggerSingleton.instance) {
      return LoggerSingleton.instance;
    }
    LoggerSingleton.instance = this;
    this.logger = baseLogger;
    this.initialized = false;
    return this;
  }

  init(config = {}) {
    if (this.initialized) return this.logger;

    // Add all the fancy custom methods
    this.logger = addCustomLoggers(this.logger);
    setupGracefulLogging(this.logger);

    // Display a fancy startup banner
    console.log(gradient.rainbow(figlet.textSync('DEGENDUEL MAINFRAME', {
      font: 'ANSI Shadow',
      horizontalLayout: 'full'
    })));

    this.initialized = true;
    return this.logger;
  }

  getInstance() {
    if (!this.initialized) {
      return this.init();
    }
    return this.logger;
  }
}

// Create the singleton instance
const loggerInstance = new LoggerSingleton();
export const logAPI = loggerInstance.init();
export const logApi = logAPI; // Backwards compatibility
export default logAPI;

// Advanced styling configurations
const STYLES = {
  separators: {
    thin: '─',
    thick: '━',
    double: '═',
    fancy: '❯❯❯'
  },
  boxes: {
    error: { borderStyle: 'double', borderColor: 'red', padding: 1 },
    warn: { borderStyle: 'single', borderColor: 'yellow', padding: 1 },
    info: { borderStyle: 'round', borderColor: 'blue', padding: 1 }
  }
};

// Enhanced emoji mappings with alternative ASCII art for environments that don't support emoji
const LOG_EMOJIS = {
  error: { emoji: '🚨', ascii: '(×_×)' },
  warn: { emoji: '⚠️', ascii: '(·.·)' },
  info: { emoji: '💡', ascii: '(^‿^)' },
  http: { emoji: '🌐', ascii: '<○>' },
  verbose: { emoji: '📝', ascii: '[...]' },
  debug: { emoji: '🔍', ascii: '{⚡}' },
  silly: { emoji: '🦄', ascii: '(*^▽^*)' }
};

// Expanded color schemes with gradients
const LOG_STYLES = {
  error: {
    color: 'red',
    gradient: ['#FF0000', '#FF6B6B'],
    figletFont: 'ANSI Shadow'
  },
  warn: {
    color: 'yellow',
    gradient: ['#FFD700', '#FFA500'],
    figletFont: 'Standard'
  },
  info: {
    color: 'cyan',
    gradient: ['#00CED1', '#20B2AA'],
    figletFont: 'Slant'
  },
  // ... other levels
};

// Add these new utility functions
export function createBanner(text, level = 'info') {
  const style = LOG_STYLES[level];
  return boxen(
    gradient[style.gradient](
      figlet.textSync(text, { font: style.figletFont })
    ),
    STYLES.boxes[level]
  );
}

export function setupGracefulLogging(logger) {
  // Previous error handling remains...
  process.on('uncaughtException', (error) => {
    logger.error('💥 Uncaught exception:', {
      error: error.message,
      stack: error.stack
    });
    console.log(chalk.red.bold('\n🔥 Application crashed! Check the logs for details 🔥\n'));
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('⚡ Unhandled rejection:', {
      reason: reason instanceof Error ? reason.message : reason,
      stack: reason instanceof Error ? reason.stack : undefined
    });
    console.log(chalk.yellow.bold('\n⚡ Unhandled Promise rejection! Check the logs for details ⚡\n'));
    process.exit(1);
  });

  // Enhanced shutdown and startup handlers
  process.on('SIGTERM', () => {
    logger.info(gradient.rainbow('🌅 Gracefully shutting down DEGENDUEL services...'));
    process.exit(0);
  });

  process.on('SIGINT', () => {
    logger.info(gradient.pastel('👋 Caught interrupt signal, cleaning up...'));
    process.exit(0);
  });

  // Log startup message with style
  logger.info(boxen(
    gradient.cristal('🚀 DEGENDUEL Logger initialized successfully! 🎉\n') +
    gradient.passion('Ready to track your epic gaming moments! 🎮'),
    { padding: 1, margin: 1, borderStyle: 'double' }
  ));
}

// Enhanced utility functions
export function createProgressBar(total, message = 'Progress') {
  const bar = new cliProgress.SingleBar({
    format: `${gradient.rainbow(message)} |${chalk.cyan('{bar}')}| {percentage}% || {value}/{total}`,
    barCompleteChar: '█',
    barIncompleteChar: '░',
    hideCursor: true
  });
  bar.start(total, 0);
  return bar;
}

export function createSpinner(text) {
  return ora({
    text: gradient.rainbow(text),
    spinner: 'dots12'
  }).start();
}

// Enhanced custom loggers with all the fancy features
export function addCustomLoggers(logger) {
  // Previous custom loggers
  logger.success = (message) => logger.info(`✅ ${message}`);
  logger.celebrate = (message) => {
    const celebrationBox = boxen(
      gradient.pastel(message),
      { borderStyle: 'double', padding: 1, margin: 1 }
    );
    logger.info(`🎉 ${celebrationBox}`);
  };

  // New enhanced loggers
  logger.banner = (message, level = 'info') => {
    logger[level](createBanner(message, level));
  };

  logger.rainbow = (message) => {
    logger.info(gradient.rainbow(message));
  };

  logger.matrix = (message) => {
    logger.info(gradient.matrix(message));
  };

  logger.gaming = (message) => {
    logger.info(gradient.teen(message));
  };

  // Add progress tracking
  logger.progress = (total, message) => createProgressBar(total, message);
  logger.spinner = (message) => createSpinner(message);

  // Add themed loggers for different contexts
  logger.battle = (message) => {
    logger.info(boxen(
      gradient.vice(message),
      { borderStyle: 'battle', padding: 1, title: '⚔️ BATTLE', titleAlignment: 'center' }
    ));
  };

  logger.reward = (message) => {
    logger.info(boxen(
      gradient.morning(message),
      { borderStyle: 'classic', padding: 1, title: '🏆 REWARD', titleAlignment: 'center' }
    ));
  };

  logger.critical = (message) => {
    logger.error(boxen(
      gradient.passion(message),
      { borderStyle: 'double', padding: 1, title: '🔥 CRITICAL', titleAlignment: 'center' }
    ));
  };

  // Add ASCII art support for non-emoji environments
  logger.ascii = (message, level = 'info') => {
    const ascii = LOG_EMOJIS[level].ascii;
    logger[level](`${ascii} ${message}`);
  };

  // Add fancy separators
  logger.section = (title) => {
    logger.info(gradient.morning(`\n${STYLES.separators.fancy} ${title} ${STYLES.separators.fancy}\n`));
  };

  // Add multi-line fancy logging
  logger.fancy = (messages, style = 'rainbow') => {
    const box = boxen(
      messages.map(msg => gradient[style](msg)).join('\n'),
      { padding: 1, margin: 1, borderStyle: 'round' }
    );
    logger.info(box);
  };

  // Add timestamp variations
  logger.timeStamp = () => {
    const now = new Date();
    logger.info(gradient.cristal(now.toLocaleTimeString()));
  };

  // Add game-specific loggers
  logger.playerAction = (player, action) => {
    logger.info(boxen(
      gradient.atlas(`Player: ${player}\nAction: ${action}`),
      { padding: 1, title: '🎮 PLAYER ACTION', titleAlignment: 'center' }
    ));
  };

  return logger;
}