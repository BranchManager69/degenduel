// /utils/logger-suite/logger.js

/**
 * 
 * This is the main logger for the project.
 * It is used to log messages to the console and to the file system.
 * 
 * Pretty colors, timestamps, and other formatting.
 * 
 */

import chalk from "chalk";
import path from "path";
import winston from "winston";
import "winston-daily-rotate-file";
import { Socket } from 'net';
import { Stream } from 'stream';

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

// Define log directory
const LOG_DIR = path.join(process.cwd(), "logs");

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

// Service-specific colors and icons
const SERVICE_COLORS = {
  CONTEST: { color: "#6A0DAD", icon: "🎯" },     // Changed from 🏆 to 🎯
  WALLET: { color: "#228B22", icon: "💎" },      // Changed from 💰 to 💎
  TOKEN_SYNC: { color: "#4169E1", icon: "🔄" },  // Changed from 💫 to 🔄
  AUTH: { color: "#FF6B6B", icon: "🔑" },        // Changed from 🔐 to 🔑
  PORTFOLIO: { color: "#20B2AA", icon: "📈" },   // Changed from 📊 to 📈
  ADMIN: { color: "#FFD700", icon: "⭐" },       // Changed from ⚡ to ⭐
  DEFAULT: { color: "#A9A9A9", icon: "🔹" }      // Changed from 📌 to 🔹
};

// Level-specific colors and formatting
const LEVEL_STYLES = {
  error: {
    badge: chalk.bgRed.white.bold(" ERROR "),
    color: chalk.red,
    icon: "❌",
  },
  warn: {
    badge: chalk.bgYellow.black.bold(" WARN "),
    color: chalk.yellow,
    icon: "⚠️",
  },
  info: {
    badge: chalk.bgBlue.white.bold(" INFO "),
    color: chalk.blue,
    icon: "ℹ️",
  },
  debug: {
    badge: chalk.bgGray.white(" DEBUG "),
    color: chalk.gray,
    icon: "🔧",
  },
  http: {
    badge: chalk.bgGreen.white(" HTTP "),
    color: chalk.green,
    icon: "🌐",
  },
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
    // User identification (anonymized if needed)
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

function formatMemoryStats(stats) {
  const { heap_used_mb, heap_total_mb, rss_mb, external_mb, array_buffers_mb, uptime_hours } = stats;
  const heapUsagePercent = Math.round((heap_used_mb / heap_total_mb) * 100);
  
  return `📊 Memory Usage
    Heap: ${heap_used_mb}MB / ${heap_total_mb}MB (${heapUsagePercent}%)
    RSS: ${rss_mb}MB | External: ${external_mb}MB | Buffers: ${array_buffers_mb}MB
    Uptime: ${uptime_hours.toFixed(2)}h`;
}

function formatPerformanceStats(metrics) {
  const { total_requests, avg_response_time, max_response_time, routes } = metrics;
  
  // Format the header
  const header = `📊 API Performance | Total: ${total_requests} | Avg: ${Math.round(avg_response_time)}ms | Max: ${Math.round(max_response_time)}ms`;
  
  // Format routes if they exist
  if (!routes || Object.keys(routes).length === 0) {
    return header;
  }

  // Get the longest route name for padding
  const maxRouteLength = Math.max(...Object.keys(routes).map(r => r.length));
  
  // Format each route's stats
  const routeStats = Object.entries(routes)
    .sort(([,a], [,b]) => b.requests - a.requests)  // Sort by most requests first
    .map(([route, stats]) => {
      const padding = ' '.repeat(maxRouteLength - route.length);
      return `    ${route}${padding} | ${stats.requests.toString().padStart(3)} reqs | ${Math.round(stats.avg_response_time).toString().padStart(4)}ms avg | ${Math.round(stats.max_response_time).toString().padStart(4)}ms max`;
    })
    .join('\n');

  return `${header}\n${routeStats}`;
}

function formatEventLoopLag(lagMs) {
  // Only use warning colors for seriously high lag
  if (lagMs > 250) {
    return `⚡⚡⚡ Event Loop Lag: ${chalk.yellow(lagMs + 'ms')} (high)`;
  }
  // Otherwise just show the lag with appropriate indicators
  return `${lagMs > 100 ? '⚡⚡' : '⚡'} Event Loop Lag: ${lagMs}ms`;
}

function formatAdminAction(details) {
  const { admin, action, details: actionDetails } = details;
  const formattedDetails = JSON.stringify(actionDetails, null, 2)
    .split('\n')
    .map(line => '    ' + line)
    .join('\n');
  
  return `👑 Admin Action: ${action}
  By: ${admin}
  Details:${formattedDetails}`;
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

    // Add service icon if available
    const servicePrefix = service ? `${serviceInfo.icon} ` : "";
    const formattedMessage =
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

    if (message.includes('Circuit breaker opened')) {
      return `${ts} ${LEVEL_STYLES.error.badge} ${formatCircuitBreaker(service, metadata)}`;
    }

    if (message === ANALYTICS_PATTERNS.USER_INTERACTION) {
      const { user, action, details } = metadata;
      return `${ts} ${levelStyle.badge} ${formatUserInteraction(user, action, details)}`;
    }

    if (message.includes('Event loop lag detected')) {
      return `${ts} ${levelStyle.badge} ${formatEventLoopLag(metadata.lag_ms)}`;
    }

    if (message.includes('Admin action logged')) {
      return `${ts} ${levelStyle.badge} ${formatAdminAction(metadata)}`;
    }

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

// Create transports
const dailyRotateFileTransport = new winston.transports.DailyRotateFile({
  filename: path.join(LOG_DIR, "api-%DATE%.log"),
  datePattern: "YYYY-MM-DD",
  maxSize: "20m",
  maxFiles: "14d",
  format: winston.format.combine(winston.format.timestamp(), fileFormat),
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

// Check for silent mode flag
const SILENT_MODE = process.env.SILENT_MODE === 'true';
const CONSOLE_LEVEL = SILENT_MODE ? 'error' : (process.env.CONSOLE_LOG_LEVEL || "info");

// Create the logger
const logApi = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(winston.format.timestamp(), customFormat),
      level: CONSOLE_LEVEL,
    }),
    dailyRotateFileTransport,
    errorRotateFileTransport,
    debugRotateFileTransport,
  ],
});

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
