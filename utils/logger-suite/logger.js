// /utils/logger-suite/logger.js

/**
 * DegenDuel Logging System
 * 
 * This is the main logger for the project.
 * It handles logging to:
 * - Console (with colors and formatting)
 * - Daily rotating log files:
 *   - api-YYYY-MM-DD.log (all logs)
 *   - error-YYYY-MM-DD.log (error logs only)
 *   - debug-YYYY-MM-DD.log (debug logs only)
 * 
 * Log files are stored in the /logs directory.
 */

import dotenv from "dotenv";
import chalk from "chalk";
import path from "path";
import winston from "winston";
import "winston-daily-rotate-file";
import { Logtail } from "@logtail/node";
import { LogtailTransport } from "@logtail/winston";
import { Socket } from 'net';
import { Stream } from 'stream';
import { fancyColors, logColors, serviceColors } from '../colors.js';

// Load environment variables
dotenv.config();

// Logtail Config
const LOGTAIL_TOKEN = process.env.LOGTAIL_TOKEN;
const LOGTAIL_ENDPOINT = process.env.LOGTAIL_ENDPOINT;
const LOGTAIL_SOURCE = process.env.LOGTAIL_SOURCE;

// Constants
const LOG_DIR = process.env.LOG_DIR || path.join(process.cwd(), "logs");
const SILENT_MODE = process.env.SILENT_MODE === 'true';
const CONSOLE_LEVEL = SILENT_MODE ? 'error' : (process.env.CONSOLE_LOG_LEVEL || "info");
const FILE_LOG_LEVEL = process.env.FILE_LOG_LEVEL || "info";

// Helper function to handle circular references in objects
const getCircularReplacer = () => {
  const seen = new WeakSet();
  return (key, value) => {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) {
        return "[Circular Reference]";
      }
      seen.add(value);
    }
    return value;
  };
};

// Custom format that safely stringifies objects
const safeStringify = (obj) => {
  const seen = new WeakSet();
  return JSON.stringify(obj, (key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);
    }
    // Handle special cases
    if (value instanceof Error) {
      return {
        message: value.message,
        stack: value.stack,
        ...value
      };
    }
    if (value instanceof Socket || value instanceof Stream) {
      return '[Stream]';
    }
    return value;
  });
};

// Log patterns (matching frontend patterns)
const LOG_PATTERNS = {
  USER_QUERY: "👤 User query result:",
  DECODED_TOKEN: "🔑 Decoded token:",
  SESSION_TOKEN: "🎫 Session token:",
  CORS_REQUEST: "🔍 CORS request details:",
  CHECKING_ORIGIN: "🔎 Checking origin:",
  ALLOWED_ORIGINS: "📋 Allowed origins:",
  IS_ORIGIN_ALLOWED: "✓ Is origin allowed?",
  SETTING_CORS: "📝 Setting CORS headers",
};

// Add analytics patterns
const ANALYTICS_PATTERNS = {
  USER_SESSION: "📊 User session:",
  USER_INTERACTION: "🔄 User interaction:",
  PLATFORM_INFO: "💻 Platform info:",
  PERFORMANCE_METRIC: "⚡ Performance:",
  FEATURE_USAGE: "🎯 Feature usage:",
};

// Level styles using our standardized colors
const LEVEL_STYLES = {
  error: {
    badge: `${logColors.error}[ERROR]${fancyColors.RESET}`,
    color: (text) => `${logColors.error}${text}${fancyColors.RESET}`,
    icon: "🔴",
  },
  warn: {
    badge: `${logColors.warn}[WARN]${fancyColors.RESET}`,
    color: (text) => `${logColors.warn}${text}${fancyColors.RESET}`,
    icon: "⚠️",
  },
  info: {
    badge: `${logColors.info}[INFO]${fancyColors.RESET}`,
    color: (text) => `${logColors.info}${text}${fancyColors.RESET}`,
    icon: "ℹ️",
  },
  debug: {
    badge: `${logColors.trace}[DEBUG]${fancyColors.RESET}`,
    color: (text) => `${logColors.trace}${text}${fancyColors.RESET}`,
    icon: "🔧",
  },
  http: {
    badge: `${fancyColors.CYAN}[HTTP]${fancyColors.RESET}`,
    color: (text) => `${fancyColors.CYAN}${text}${fancyColors.RESET}`,
    icon: "🌐",
  },
};

// Service colors using our standardized colors
const SERVICE_COLORS = {
  DEFAULT: { color: "#FFFFFF", icon: "🔹" },
  API: { color: "#4CAF50", icon: "🚀" },
  AUTH: { color: "#2196F3", icon: "🔒" },
  DB: { color: "#9C27B0", icon: "💾" },
  SOLANA: { color: "#673AB7", icon: "⚡" },
  CONTEST: { color: "#FF9800", icon: "🏆" },
  WALLET: { color: "#795548", icon: "💰" },
  MARKET: { color: "#607D8B", icon: "📊" },
  WEBSOCKET: { color: "#E91E63", icon: "🔌" },
  SYSTEM: { color: "#F44336", icon: "⚙️" },
  ADMIN: { color: "#FFEB3B", icon: "👑" },
  USER: { color: "#03A9F4", icon: "👤" },
  ANALYTICS: { color: "#8BC34A", icon: "📈" },
  NOTIFICATION: { color: "#FF5722", icon: "🔔" },
};

// Helper to format timestamp in EST
const formatTimestamp = (timestamp) => {
  const date = timestamp ? new Date(timestamp) : new Date();
  return date.toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
};

// Helper to detect special log patterns
const detectLogPattern = (message) => {
  for (const [key, pattern] of Object.entries(LOG_PATTERNS)) {
    if (message.startsWith(pattern)) {
      return { type: key, showInGroup: key.includes("CORS_") };
    }
  }
  return null;
};

// Enhanced metadata formatting for analytics
const formatAnalytics = (metadata) => {
  const { ip, headers = {}, user, performance, ...rest } = metadata;

  return {
    // User identification
    user: user
      ? {
          id: user.id,
          wallet: user.wallet_address,
          role: user.role,
          // Add session analytics
          session_id: user.session_id,
          last_active: user.last_active,
          total_sessions: user.total_sessions,
        }
      : null,

    // Device & platform info
    client: {
      ip: ip || headers["x-real-ip"] || headers["x-forwarded-for"],
      user_agent: headers["user-agent"],
      platform: headers["sec-ch-ua-platform"]?.replace(/"/g, ""),
      mobile: headers["sec-ch-ua-mobile"] === "?1",
      // Parse user agent for better analytics
      browser: parseBrowser(headers["user-agent"]),
      os: parseOS(headers["user-agent"]),
      device_type: getDeviceType(headers),
    },

    // Geolocation (if available)
    geo: headers["cf-ipcountry"]
      ? {
          country: headers["cf-ipcountry"],
          city: headers["cf-ipcity"],
          continent: headers["cf-ipcontinent"],
        }
      : null,

    // Performance metrics
    performance: performance
      ? {
          page_load: performance.page_load,
          ttfb: performance.ttfb,
          api_latency: performance.api_latency,
        }
      : null,

    // Request context
    request: {
      path: rest.path,
      method: rest.method,
      status: rest.status,
      duration: rest.duration,
      query_params: rest.query,
      referer: headers.referer,
      origin: headers.origin,
    },

    // Keep any other metadata
    ...rest,
  };
};

// Helper to parse browser info from user agent
const parseBrowser = (ua = "") => {
  const chrome = /Chrome\/(\d+)/.exec(ua);
  const firefox = /Firefox\/(\d+)/.exec(ua);
  const safari = /Safari\/(\d+)/.exec(ua);

  if (chrome) return { name: "Chrome", version: chrome[1] };
  if (firefox) return { name: "Firefox", version: firefox[1] };
  if (safari) return { name: "Safari", version: safari[1] };
  return { name: "Other", version: "0" };
};

// Helper to parse OS info
const parseOS = (ua = "") => {
  const windows = /Windows NT (\d+\.\d+)/.exec(ua);
  const mac = /Mac OS X (\d+[._]\d+)/.exec(ua);
  const linux = /Linux/.exec(ua);

  if (windows) return { name: "Windows", version: windows[1] };
  if (mac) return { name: "MacOS", version: mac[1].replace("_", ".") };
  if (linux) return { name: "Linux", version: "N/A" };
  return { name: "Other", version: "N/A" };
};

// Helper to determine device type
const getDeviceType = (headers) => {
  const ua = headers["user-agent"] || "";
  if (/mobile/i.test(ua)) return "mobile";
  if (/tablet/i.test(ua)) return "tablet";
  if (/iPad|Android(?!.*Mobile)/i.test(ua)) return "tablet";
  return "desktop";
};

// Modify the existing formatMetadata function
const formatMetadata = (metadata, level) => {
  const { service, ...rest } = metadata;

  // Check if this is an analytics log
  if (
    Object.values(ANALYTICS_PATTERNS).some((pattern) =>
      rest.message?.startsWith(pattern)
    )
  ) {
    return formatAnalytics(rest);
  }

  // Special formatting for known metadata types
  if (rest.user) {
    return {
      user: {
        nickname: rest.user.nickname || "Anonymous",
        role: rest.user.role || "user",
        wallet_address: rest.user.wallet_address,
      },
    };
  }

  if (rest.headers) {
    return {
      headers: {
        "x-real-ip": rest.headers["x-real-ip"],
        "user-agent": rest.headers["user-agent"],
        "sec-ch-ua-platform": rest.headers["sec-ch-ua-platform"]?.replace(
          /"/g,
          ""
        ),
      },
    };
  }

  return rest;
};

// Sanitize error objects to prevent circular references
const sanitizeError = (obj) => {
  if (!obj) return obj;

  if (obj instanceof Error) {
    return {
      name: obj.name,
      message: obj.message,
      stack: obj.stack,
      code: obj.code,
      status: obj.status,
    };
  }

  if (typeof obj !== "object") return obj;

  const clean = {};
  for (const [key, value] of Object.entries(obj)) {
    // Skip known circular reference properties
    if (["socket", "parser", "req", "res"].includes(key)) continue;
    try {
      // Test if value can be stringified
      JSON.stringify(value);
      clean[key] = value;
    } catch (e) {
      clean[key] = "[Circular]";
    }
  }
  return clean;
};

// Format circuit breaker logs
function formatCircuitBreaker(service, details) {
  const { failures, threshold, service: serviceName } = details;
  const serviceDisplay = serviceName || service || 'Unknown Service';
  return `
${chalk.red('🚨 CIRCUIT BREAKER ALERT 🚨')}
${chalk.red('══════════════════════════')}
Service: ${chalk.red(serviceDisplay)}
Status:  ${chalk.red('OPEN')} ❌
Failures: ${chalk.red(`${failures}/${threshold}`)}
${chalk.red('══════════════════════════')}`;
}

// Format user interaction logs
function formatUserInteraction(user, action, details) {
  const userInfo = user ? `${user.nickname} (${user.role})` : 'Anonymous';
  let formattedDetails = '';
  
  if (action === 'session_check') {
    formattedDetails = details.success ? 
      `✅ Session validated (${details.session_id})` :
      `❌ Session invalid: ${details.error || 'Unknown error'}`;
  } else {
    formattedDetails = JSON.stringify(details);
  }
  
  return `👤 ${userInfo} | ${action} | ${formattedDetails}`;
}

// Format memory stats
function formatMemoryStats(stats) {
  const { heap_used_mb, heap_total_mb, rss_mb, external_mb, array_buffers_mb, uptime_hours } = stats;
  const heapUsagePercent = Math.round((heap_used_mb / heap_total_mb) * 100);
  
  return `📊 Memory Usage
    Heap: ${heap_used_mb}MB / ${heap_total_mb}MB (${heapUsagePercent}%)
    RSS: ${rss_mb}MB | External: ${external_mb}MB | Buffers: ${array_buffers_mb}MB
    Uptime: ${uptime_hours.toFixed(2)}h`;
}

// Format performance stats
function formatPerformanceStats(metrics) {
  const { total_requests, avg_response_time, max_response_time, routes } = metrics;
  
  // Format the header
  const header = `\t${fancyColors.BG_DARK_YELLOW}${fancyColors.UNDERLINE}📊 ${fancyColors.BOLD}API Performance ${fancyColors.RESET}${fancyColors.UNDERLINE}${fancyColors.BOLD}${fancyColors.BLACK}| Total: ${total_requests} |  s Avg: ${Math.round(avg_response_time)}ms | Max: ${Math.round(max_response_time)}ms${fancyColors.RESET}`;
  
  // Format routes if they exist
  if (!routes || Object.keys(routes).length === 0) {
    return `${header}${fancyColors.RESET}`;
  }

  // Get the longest route name for padding
  const maxRouteLength = Math.max(...Object.keys(routes).map(r => r.length));
  
  // Format each route's stats
  const routeStats = Object.entries(routes)
    .sort(([,a], [,b]) => b.requests - a.requests)  // Sort by most requests first
    .map(([route, stats]) => {
      const padding = ' '.repeat(maxRouteLength - route.length);
      return `${fancyColors.BG_DARK_YELLOW}${fancyColors.BLACK}\t${fancyColors.UNDERLINE}${fancyColors.BOLD}\t${route}${padding}${fancyColors.RESET} ${fancyColors.GRAY}|${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.BLACK}${stats.requests.toString().padStart(3)}${fancyColors.RESET} ${fancyColors.GRAY}reqs${fancyColors.RESET} | ${fancyColors.BOLD}${fancyColors.DARK_YELLOW}${Math.round(stats.avg_response_time).toString().padStart(4)}${fancyColors.RESET} ${fancyColors.GRAY}ms avg${fancyColors.RESET} | ${fancyColors.BOLD}${fancyColors.DARK_YELLOW}${Math.round(stats.max_response_time).toString().padStart(4)}${fancyColors.RESET} ${fancyColors.GRAY}ms max${fancyColors.RESET}`;
    })
    .join('\n');

  return `${header}${fancyColors.RESET}\n${routeStats}`;
}

// Format event loop lag logs
function formatEventLoopLag(lagMs) {
  // Only use warning colors for seriously high lag
  if (lagMs > 250) {
    return `⚡⚡⚡ Event Loop Lag: ${chalk.yellow(lagMs + 'ms')} (high)`;
  }
  // Otherwise just show the lag with appropriate indicators
  return `${lagMs > 100 ? '⚡⚡' : '⚡'} Event Loop Lag: ${lagMs}ms`;
}

// Format admin action logs
function formatAdminAction(details) {
  const { admin, action, details: actionDetails } = details;
  const formattedDetails = JSON.stringify(actionDetails, null, 2)
    .split('\n')
    .map(line => '    ' + line)
    .join('\n');
  
  return `👑 \t${fancyColors.BG_BLACK}${fancyColors.BOLD_YELLOW} Admin Action Log ${fancyColors.RESET} ${fancyColors.UNDERLINE}${fancyColors.WHITE}${fancyColors.BG_BLACK} ${action} ${fancyColors.RESET} ${fancyColors.GRAY}by${fancyColors.RESET} ${fancyColors.UNDERLINE}${fancyColors.DARK_YELLOW}${admin} ${fancyColors.RESET}`;
}

// Modify the customFormat to properly handle these special cases
const customFormat = winston.format.printf(
  ({ level, message, timestamp, service, ...metadata }) => {
    const ts = chalk.gray(formatTimestamp(timestamp));
    const levelStyle = LEVEL_STYLES[level] || LEVEL_STYLES.info;
    const serviceInfo = SERVICE_COLORS[service] || SERVICE_COLORS.DEFAULT;

    // Handle Memory Stats
    if (message.includes('Memory Stats')) {
      return `${ts} ${levelStyle.badge} ${formatMemoryStats(metadata)}`;
    }

    // Handle API Performance Stats
    if (message.includes('API Performance Stats')) {
      return `${ts} ${levelStyle.badge} ${formatPerformanceStats(metadata)}`;
    }

    // Add service icon and environment if available
    const servicePrefix = service ? `${serviceInfo.icon} ` : "";
    const envPrefix = metadata.environment ? 
      `${chalk.bgMagenta(chalk.white(` ${metadata.environment} `))} ` : 
      `${environment !== 'production' ? chalk.bgBlue(chalk.white(` ${environment} `)) + ' ' : ''}`;
    
    const formattedMessage =
      envPrefix + 
      servicePrefix +
      (service
        ? chalk.hex(serviceInfo.color)(message)
        : levelStyle.color(message));

    // Format metadata more compactly
    const meta = Object.keys(metadata).length
      ? chalk.gray(JSON.stringify(formatMetadata(metadata, level), null, 0))
      : "";

    // Sanitize any error objects in metadata
    const cleanMetadata = sanitizeError(metadata);

    // Format circuit breaker logs
    if (message.includes('Circuit breaker opened')) {
      return `${ts} ${LEVEL_STYLES.error.badge} ${formatCircuitBreaker(service, metadata)}`;
    }

    // Format user interaction logs
    if (message === ANALYTICS_PATTERNS.USER_INTERACTION) {
      const { user, action, details } = metadata;
      return `${ts} ${levelStyle.badge} ${formatUserInteraction(user, action, details)}`;
    }

    // Format event loop lag logs
    if (message.includes('Event loop lag detected')) {
      return `${ts} ${levelStyle.badge} ${formatEventLoopLag(metadata.lag_ms)}`;
    }

    // Format admin action logs
    if (message.includes('Admin action logged')) {
      return `${ts} ${levelStyle.badge} ${formatAdminAction(metadata)}`;
    }

    // Default format
    return `${ts} ${levelStyle.badge} ${formattedMessage}${meta ? " " + meta : ""}`;
  }
);

// File format (without colors, but with structured data for frontend)
const fileFormat = winston.format.printf(
  ({ level, message, timestamp, service, ...metadata }) => {
    const pattern = detectLogPattern(message);
    const formattedMeta = formatMetadata(metadata, level);

    // Create a structured log entry that's easy to parse in the frontend
    const logEntry = {
      timestamp: timestamp || new Date().toISOString(),
      formatted_time: formatTimestamp(timestamp),
      level: level.toLowerCase(),
      message,
      service,
      service_icon: service ? SERVICE_COLORS[service]?.icon : null,
      level_icon: LEVEL_STYLES[level]?.icon,
      pattern_type: pattern?.type,
      show_in_group: pattern?.showInGroup,
      details: formattedMeta,
    };

    return JSON.stringify(logEntry);
  }
);

// Create transports with clear descriptions
const dailyRotateFileTransport = new winston.transports.DailyRotateFile({
  filename: path.join(LOG_DIR, "api-%DATE%.log"),
  datePattern: "YYYY-MM-DD",
  maxSize: "20m",
  maxFiles: "14d",
  format: winston.format.combine(winston.format.timestamp(), fileFormat),
  level: FILE_LOG_LEVEL,
});

const errorRotateFileTransport = new winston.transports.DailyRotateFile({
  filename: path.join(LOG_DIR, "error-%DATE%.log"),
  datePattern: "YYYY-MM-DD",
  maxSize: "20m",
  maxFiles: "14d",
  level: "error",
  format: winston.format.combine(winston.format.timestamp(), fileFormat),
});

const debugRotateFileTransport = new winston.transports.DailyRotateFile({
  filename: path.join(LOG_DIR, "debug-%DATE%.log"),
  datePattern: "YYYY-MM-DD",
  maxSize: "20m",
  maxFiles: "3d",
  level: "debug",
  format: winston.format.combine(winston.format.timestamp(), fileFormat),
});


/* LOGTAIL TRANSPORT */

// Get environment from NODE_ENV
const environment = process.env.NODE_ENV || 'production';

// Create logtail instance with environment metadata
const logtail = new Logtail(LOGTAIL_TOKEN, {
  endpoint: LOGTAIL_ENDPOINT,
  source: LOGTAIL_SOURCE,
  // Add environment as context to all logs
  contextMetadata: {
    environment,
    port: process.env.PORT,
    nodeVersion: process.version
  }
});

const logtailTransport = new LogtailTransport(logtail);





/* LOGGER INITIALIZATION */

// Create the logger with clear transport descriptions
const logApi = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    // Console transport (colorized, human-readable)
    new winston.transports.Console({
      format: winston.format.combine(winston.format.timestamp(), customFormat),
      level: CONSOLE_LEVEL,
    }),
    // File transports (JSON formatted for parsing)
    dailyRotateFileTransport,     // All logs
    errorRotateFileTransport,     // Error logs only
    debugRotateFileTransport,     // Debug logs only
    // NEW: Logtail Transport
    logtailTransport,            // Logtail Transport
  ],
});


// Log where logs are being written to on startup
console.log(`${fancyColors.BOLD}${fancyColors.BG_DARK_CYAN} ${fancyColors.DARK_BLACK}DegenDuel Logger Initialized ${fancyColors.RESET}`);
console.log(`${fancyColors.CYAN}Console log level: ${fancyColors.UNDERLINE}${CONSOLE_LEVEL}${fancyColors.RESET}`);
console.log(`${fancyColors.CYAN}File log level: ${FILE_LOG_LEVEL}${fancyColors.RESET}`);
console.log(`${fancyColors.CYAN}Log files directory: ${LOG_DIR}${fancyColors.RESET}`);
console.log(`${fancyColors.CYAN}Log files:${fancyColors.RESET}`);
console.log(`  ${fancyColors.LIGHT_CYAN}- api-YYYY-MM-DD.log (all logs)${fancyColors.RESET}`);
console.log(`  ${fancyColors.LIGHT_CYAN}- error-YYYY-MM-DD.log (error logs only)${fancyColors.RESET}`);
console.log(`  ${fancyColors.LIGHT_CYAN}- debug-YYYY-MM-DD.log (debug logs only)${fancyColors.RESET}`);

// Helper method to log with service context
logApi.forService = (serviceName) => ({
  error: (msg, meta = {}) =>
    logApi.error(msg, { ...meta, service: serviceName }),
  warn: (msg, meta = {}) => logApi.warn(msg, { ...meta, service: serviceName }),
  info: (msg, meta = {}) => logApi.info(msg, { ...meta, service: serviceName }),
  debug: (msg, meta = {}) =>
    logApi.debug(msg, { ...meta, service: serviceName }),
  http: (msg, meta = {}) => logApi.http(msg, { ...meta, service: serviceName }),
  analytics: {
    trackSession: (user, headers) => {
      logApi.info(ANALYTICS_PATTERNS.USER_SESSION, {
        user,
        headers,
        timestamp: new Date().toISOString(),
        service: serviceName,
      });
    },
    trackInteraction: (user, action, details, headers) => {
      logApi.info(ANALYTICS_PATTERNS.USER_INTERACTION, {
        user,
        action,
        details,
        headers,
        timestamp: new Date().toISOString(),
        service: serviceName,
      });
    },
    trackPerformance: (metrics) => {
      logApi.info('API Performance Stats', metrics);
    },
    trackFeature: (feature, user, details) => {
      logApi.info(ANALYTICS_PATTERNS.FEATURE_USAGE, {
        feature,
        user,
        details,
        timestamp: new Date().toISOString(),
        service: serviceName,
      });
    },
  },
});

// Add analytics helper to logApi
logApi.analytics = {
  trackSession: (user, headers) => {
    logApi.info(ANALYTICS_PATTERNS.USER_SESSION, {
      user,
      headers,
      timestamp: new Date().toISOString(),
    });
  },
  trackInteraction: (user, action, details, headers) => {
    logApi.info(ANALYTICS_PATTERNS.USER_INTERACTION, {
      user,
      action,
      details,
      headers,
      timestamp: new Date().toISOString(),
    });
  },
  trackPerformance: (metrics) => {
    logApi.info('API Performance Stats', metrics);
  },
  trackFeature: (feature, user, details) => {
    logApi.info(ANALYTICS_PATTERNS.FEATURE_USAGE, {
      feature,
      user,
      details,
      timestamp: new Date().toISOString(),
    });
  },
};

// Export both default and named
export { ANALYTICS_PATTERNS, LOG_PATTERNS, logApi };
export default logApi;
