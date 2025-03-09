# DegenDuel Logging Verbosity System

## Overview

This document outlines a more sophisticated approach to controlling log verbosity in the DegenDuel platform. The current approach with hardcoded `VERBOSE_LOGS` flags and the binary `SILENT_MODE` doesn't provide enough granularity for controlling which logs appear during initialization and normal operation.

## Proposed Solution

Implement a multi-level verbosity system that allows for fine-grained control of logging output through a single environment variable.

### Verbosity Levels

The system will use a `VERBOSITY_LEVEL` environment variable with the following levels:

- **Level 0: Silent** - Errors only, complete suppression of all non-critical logs
- **Level 1: Minimal** - Important logs only (key initialization steps, service status updates, major events)
- **Level 2: Normal** - Standard logs including all info, warnings, and errors (current system behavior with `VERBOSE_LOGS=false`)
- **Level 3: Verbose** - All logs including detailed debugging information (equivalent to `VERBOSE_LOGS=true`)

### Implementation Details

#### 1. Logger Modification

```javascript
// In logger.js
const VERBOSITY_LEVEL = parseInt(process.env.VERBOSITY_LEVEL || "2", 10);

// Determine log level based on verbosity
const getLogLevel = () => {
  switch(VERBOSITY_LEVEL) {
    case 0: return 'error';
    case 1: return 'warn';  
    case 2: return 'info';
    case 3: return 'debug';
    default: return 'info';
  }
}

const CONSOLE_LEVEL = getLogLevel();

// Create the logger
const logApi = winston.createLogger({
  // ...existing config
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(winston.format.timestamp(), customFormat),
      level: CONSOLE_LEVEL,
    }),
    // ...other transports
  ],
});
```

#### 2. Important Log Prioritization

To ensure important logs are visible even at lower verbosity levels, add priority flags:

```javascript
// Add priority option to logger
logApi.priorityInfo = (message, meta = {}) => {
  if (VERBOSITY_LEVEL >= 1) { // Show at minimal level and above
    logApi.info(message, { ...meta, _priority: 'high' });
  }
};

// For less important logs
logApi.standardInfo = (message, meta = {}) => {
  if (VERBOSITY_LEVEL >= 2) { // Only show at normal level and above
    logApi.info(message, meta);
  }
};

// For very detailed logs
logApi.verboseInfo = (message, meta = {}) => {
  if (VERBOSITY_LEVEL >= 3) { // Only show at verbose level
    logApi.info(message, meta);
  }
};
```

#### 3. Initialization Logs

For initialization, set specific levels for different types of logs:

- **Critical Initialization** (Level 1+): Service registration success/failure, database connection, main service starts
- **Standard Initialization** (Level 2+): Components loading, route mounting, middleware setup
- **Verbose Initialization** (Level 3 only): Individual service details, dependency loading, detailed configs

### Example Usage

```javascript
// In service-initializer.js

// Critical initialization logs (visible at Level 1+)
logApi.priorityInfo('Services initialization starting...');

// Standard logs (visible at Level 2+)
logApi.standardInfo(`Registering service: ${serviceName}`);

// Verbose logs (visible at Level 3 only)
logApi.verboseInfo('Service dependency resolution details:', { dependencies });

// Normal info logs (visible at Level 2+)
logApi.info('Service started');

// Always visible
logApi.error('Failed to start service', { error });
```

### PM2 Configuration Update

Update the ecosystem.config.cjs to use the new verbosity system:

```javascript
// In ecosystem.config.cjs
env: {
  PORT: 3004,
  DD_API_DEBUG_MODE: 'false',
  NODE_ENV: 'production',
  NODE_OPTIONS: '--require ts-node/register',
  VERBOSITY_LEVEL: '1' // Default to minimal logging
},
```

## Benefits

- **Flexible Control**: Adjust log verbosity without code changes
- **Prioritized Logs**: Important logs remain visible even at lower verbosity
- **Environment-Specific**: Set different levels for development/testing/production
- **Backwards Compatible**: Existing log statements continue to work
- **Centralized Configuration**: Single source of truth for log verbosity

## Implementation Notes

The current system's `VERBOSE_LOGS=false` should match `VERBOSITY_LEVEL=2`, giving all the good initialization information but without excessive detail. Turning on verbose mode with `VERBOSITY_LEVEL=3` would then show absolutely everything, including all the detailed logs formerly controlled by `VERBOSE_LOGS=true`.