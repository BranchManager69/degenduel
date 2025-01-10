import boxen from 'boxen';
import figlet from 'figlet';
import gradient from 'gradient-string';
import winston from 'winston';

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

// Create a singleton instance that can be easily imported anywhere
class LoggerSingleton {
  constructor() {
    if (LoggerSingleton.instance) {
      return LoggerSingleton.instance;
    }
    LoggerSingleton.instance = this;
    this.initialized = false;
  }

  init(config = {}) {
    if (this.initialized) return this.logger;

    const logFormat = getLogFormat();
    this.logger = winston.createLogger({
      format: logFormat,
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' })
      ],
      ...config
    });

    // Add all the fancy custom methods
    this.logger = addCustomLoggers(this.logger);
    setupGracefulLogging(this.logger);

    // Display a fancy startup banner
    console.log(gradient.rainbow(figlet.textSync('Logger Suite', {
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

// Create and export the singleton instance
export const logAPI = new LoggerSingleton();

// This makes it super easy to replace existing logAPI imports
export default logAPI.getInstance();

// The rest of your existing functions, enhanced with new features...
// [previous code remains but with enhancements]

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

// Enhanced custom loggers
export function addCustomLoggers(logger) {
  // Previous custom loggers remain...
  logger.success = (message) => logger.info(`✅ ${message}`);
  logger.celebrate = (message) => {
    const celebrationBox = boxen(
      gradient.pastel(message),
      { borderStyle: 'double', padding: 1, margin: 1 }
    );
    logger.info(`🎉 ${celebrationBox}`);
  };
  
  // New fancy loggers
  logger.banner = (message, level = 'info') => {
    logger[level](createBanner(message, level));
  };
  
  logger.rainbow = (message) => {
    logger.info(gradient.rainbow(message));
  };

  logger.matrix = (message) => {
    logger.info(gradient.matrix(message));
  };

  // Add ASCII art support for non-emoji environments
  logger.ascii = (message, level = 'info') => {
    const ascii = LOG_EMOJIS[level].ascii;
    logger[level](`${ascii} ${message}`);
  };

  return logger;
}