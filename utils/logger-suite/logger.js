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
import axios from 'axios';
import { IPinfoWrapper } from 'node-ipinfo';

// Config
import { config } from '../../config/config.js';

// Load environment variables
dotenv.config();

// Logtail Config
const LOGTAIL_TOKEN = config.logtail.token;
const LOGTAIL_ENDPOINT = config.logtail.endpoint;
const LOGTAIL_SOURCE = config.logtail.source;
const LOG_DIR = config.logtail.log_dir || path.join(process.cwd(), "logs");
const SILENT_MODE = config.logtail.silent_mode === 'true';
const CONSOLE_LEVEL = SILENT_MODE ? 'error' : (config.logtail.console_log_level || "info");
const FILE_LOG_LEVEL = config.logtail.file_log_level || "info";

// IP Info config
const IPINFO_API_KEY = config.ipinfo.api_key;
const IPINFO_API_URL = config.ipinfo.full_url || `https://ipinfo.io`;

// Initialize IPinfo wrapper with built-in caching 
let ipinfoClient = null;

/**
 * Fetch detailed IP information from ipinfo.io using the official client
 * @param {string} ip - IP address to look up
 * @returns {Promise<Object>} - IP information
 */
export const getIpInfo = async (ip) => {
  // Safely skip for local/private IPs to avoid unnecessary lookups
  if (!ip || ip === '127.0.0.1' || ip === 'localhost' || 
      ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.16.')) {
    return { 
      ip,
      bogon: true,
      private: true
    };
  }

  // Initialize client only once - lazy initialization
  if (ipinfoClient === null && IPINFO_API_KEY) {
    try {
      ipinfoClient = new IPinfoWrapper(IPINFO_API_KEY);
      
      // SAFETY: Don't use our own logger here to avoid recursion
      // But use a standardized message format that matches our log style
      console.log(`${formatTimestamp()} ${LEVEL_STYLES.info.badge} ${environment !== 'production' ? chalk.bgBlue(chalk.white(` ${environment} `)) + ' ' : ''}IPinfo client initialized successfully`);
    } catch (initError) {
      // SAFETY: Don't use our own logger here to avoid recursion
      console.error('Failed to initialize IPinfo client:', initError.message);
      
      // No need to retry if initialization failed
      ipinfoClient = false; // Set to false to indicate failed initialization
    }
  }
  
  // If client initialization failed or no API key, return early
  if (ipinfoClient === false || !IPINFO_API_KEY) {
    return {
      ip,
      error: "IPinfo client not available",
      lookup_failed: true
    };
  }

  try {
    // Use the official client which has its own built-in caching
    const response = await ipinfoClient.lookupIp(ip);
    
    // Return the result - the client handles caching internally
    return response;
  } catch (error) {
    // SAFETY: Don't use our own logger here to avoid recursion!
    // Just silently return an error object
    return { 
      ip,
      error: error.message || "Unknown error in IP lookup",
      lookup_failed: true
    };
  }
};

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
  // New exotic colors from our color demo
  DDCOMMENT: { color: "#5F5FAF", icon: "💬" },      // Indigo (93)
  AI_SERVICE: { color: "#87AF5F", icon: "🤖" },     // Lime (112)
  ADMIN_TOOLS: { color: "#FF875F", icon: "🛠️" },    // Salmon (209)
  MARKET_ANALYTICS: { color: "#00D7AF", icon: "📊" }, // Teal (43)
  BALANCE_TRACKING: { color: "#00875F", icon: "💲" }, // Sea Green (29)
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
      device: getDeviceType(headers),
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
  // Handle empty user agent
  if (!ua) return { name: "Unknown", version: "0", fullInfo: "No user agent" };

  // Detect various browsers in order of specificity
  const edge = /Edg(?:e|A|iOS)?\/(\d+\.\d+)/.exec(ua);
  const opera = /OPR\/(\d+\.\d+)/.exec(ua) || /Opera\/(\d+\.\d+)/.exec(ua);
  const brave = /Brave\/(\d+\.\d+)/.exec(ua);
  const chrome = /Chrome\/(\d+\.\d+)/.exec(ua);
  const firefox = /Firefox\/(\d+\.\d+)/.exec(ua);
  const safari = /Version\/(\d+\.\d+).*Safari/.exec(ua) || /Safari\/(\d+\.\d+)/.exec(ua);
  const ie = /MSIE (\d+\.\d+)/.exec(ua) || /Trident.*rv:(\d+\.\d+)/.exec(ua);
  const samsung = /SamsungBrowser\/(\d+\.\d+)/.exec(ua);
  const ucBrowser = /UCBrowser\/(\d+\.\d+)/.exec(ua);
  const mobileFF = /Mobile.*Firefox\/(\d+\.\d+)/.exec(ua);
  
  // Detect mobile vs desktop
  const isMobile = /Mobile|Android|iPhone|iPad|iPod|Windows Phone|IEMobile/i.test(ua);
  
  // Return appropriate browser info
  if (edge) return { name: "Microsoft Edge", version: edge[1], mobile: isMobile, fullInfo: ua };
  if (opera) return { name: "Opera", version: opera[1], mobile: isMobile, fullInfo: ua };
  if (brave) return { name: "Brave", version: brave[1], mobile: isMobile, fullInfo: ua };
  if (samsung) return { name: "Samsung Browser", version: samsung[1], mobile: isMobile, fullInfo: ua };
  if (ucBrowser) return { name: "UC Browser", version: ucBrowser[1], mobile: isMobile, fullInfo: ua };
  if (mobileFF) return { name: "Firefox Mobile", version: mobileFF[1], mobile: true, fullInfo: ua };
  if (firefox) return { name: "Firefox", version: firefox[1], mobile: isMobile, fullInfo: ua };
  if (chrome && !safari) return { name: "Chrome", version: chrome[1], mobile: isMobile, fullInfo: ua };
  if (safari) return { name: "Safari", version: safari[1], mobile: isMobile, fullInfo: ua };
  if (ie) return { name: "Internet Explorer", version: ie[1], mobile: isMobile, fullInfo: ua };
  
  return { name: "Other", version: "0", mobile: isMobile, fullInfo: ua };
};

// Helper to parse OS info
const parseOS = (ua = "") => {
  if (!ua) return { name: "Unknown", version: "Unknown" };

  // Windows detection
  const windows = /Windows NT (\d+\.\d+)/.exec(ua);
  if (windows) {
    // Map Windows NT version to familiar Windows version
    const windowsVersions = {
      '10.0': '10/11', // Windows 10/11 use same NT version
      '6.3': '8.1',
      '6.2': '8',
      '6.1': '7',
      '6.0': 'Vista',
      '5.2': 'XP x64',
      '5.1': 'XP',
      '5.0': '2000'
    };
    return { 
      name: "Windows", 
      version: windowsVersions[windows[1]] || windows[1],
      ntVersion: windows[1]
    };
  }

  // macOS detection
  const mac = /Mac OS X (\d+[._]\d+(?:[._]\d+)?)/.exec(ua);
  if (mac) {
    const version = mac[1].replace(/_/g, ".");
    // Map version numbers to macOS names
    let macOSName = "macOS";
    if (parseFloat(version) >= 10.16 || parseInt(version) >= 11) {
      macOSName = "macOS Big Sur or newer";
    } else if (version.startsWith("10.15")) {
      macOSName = "macOS Catalina";
    } else if (version.startsWith("10.14")) {
      macOSName = "macOS Mojave";
    }
    return { name: macOSName, version: version };
  }

  // iOS detection
  const ios = /iPhone OS (\d+[._]\d+)/.exec(ua) || /iPad.*OS (\d+[._]\d+)/.exec(ua);
  if (ios) {
    return { name: "iOS", version: ios[1].replace(/_/g, ".") };
  }

  // Android detection
  const android = /Android (\d+(?:\.\d+)?)/.exec(ua);
  if (android) {
    return { name: "Android", version: android[1] };
  }

  // Linux detection
  const ubuntu = /Ubuntu/.exec(ua);
  const fedora = /Fedora/.exec(ua);
  const debian = /Debian/.exec(ua);
  if (ubuntu) return { name: "Ubuntu Linux", version: "N/A" };
  if (fedora) return { name: "Fedora Linux", version: "N/A" };
  if (debian) return { name: "Debian Linux", version: "N/A" };
  if (/Linux/.exec(ua)) return { name: "Linux", version: "N/A" };

  // Chrome OS
  if (/CrOS/.exec(ua)) return { name: "Chrome OS", version: "N/A" };

  return { name: "Other", version: "N/A" };
};

// Helper to determine device type and device details
const getDeviceType = (headers) => {
  const ua = headers["user-agent"] || "";
  if (!ua) return { type: "unknown", brand: "unknown", model: "unknown" };
  
  // Extract device details when possible
  let brand = "unknown";
  let model = "unknown";
  let deviceType = "unknown";
  
  // Check for common device patterns
  
  // iPhone
  const iphone = /iPhone(?:.*OS\s+(\d+[._]\d+))?/.exec(ua);
  if (iphone) {
    return {
      type: "mobile",
      brand: "Apple",
      model: "iPhone",
      osVersion: iphone[1] ? iphone[1].replace(/_/g, ".") : "unknown"
    };
  }
  
  // iPad
  const ipad = /iPad(?:.*OS\s+(\d+[._]\d+))?/.exec(ua);
  if (ipad) {
    return {
      type: "tablet",
      brand: "Apple",
      model: "iPad",
      osVersion: ipad[1] ? ipad[1].replace(/_/g, ".") : "unknown"
    };
  }
  
  // Samsung devices
  const samsung = /Samsung|SM-[A-Z0-9]+/i.exec(ua);
  const samsungModel = /SM-([A-Z0-9]+)/i.exec(ua);
  if (samsung) {
    return {
      type: /tablet/i.test(ua) ? "tablet" : "mobile",
      brand: "Samsung",
      model: samsungModel ? samsungModel[1] : "Galaxy"
    };
  }
  
  // Google devices
  const pixel = /Pixel\s+(\d+)/i.exec(ua);
  if (pixel) {
    return {
      type: "mobile",
      brand: "Google",
      model: `Pixel ${pixel[1]}`
    };
  }
  
  // Generic detection by type
  if (/mobile|android(?!.*tablet)|iphone|ipod|blackberry|iemobile|opera mini/i.test(ua)) {
    deviceType = "mobile";
  } else if (/tablet|ipad|playbook|silk|android(?!.*mobile)/i.test(ua)) {
    deviceType = "tablet";
  } else if (/TV|SmartTV|WebTV|AppleTV/i.test(ua)) {
    deviceType = "tv";
  } else if (/bot|crawler|spider|slurp|googlebot/i.test(ua)) {
    deviceType = "bot";
  } else {
    deviceType = "desktop";
  }
  
  return { 
    type: deviceType,
    brand: brand,
    model: model,
    fullUserAgent: ua
  };
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
function formatUserInteraction(user, action, details, env) {
  let userInfo = 'Anonymous';
  
  if (user) {
    // Apply role-specific colors
    let roleFormatted = user.role;
    if (user.role === 'superadmin') {
      roleFormatted = `${fancyColors.DARK_YELLOW}${user.role}${fancyColors.RESET}`;  // Gold color for superadmins
    } else if (user.role === 'admin') {
      roleFormatted = `${fancyColors.DARK_RED}${user.role}${fancyColors.RESET}`;     // Royal red for admins
    } else if (user.role === 'user') {
      roleFormatted = `${fancyColors.PURPLE}${user.role}${fancyColors.RESET}`;       // Purple for regular users
    }
    
    userInfo = `${user.nickname} (${roleFormatted})`;
  }
  
  let formattedDetails = '';
  
  if (action === 'session_check') {
    formattedDetails = details.success ? 
      `✅ Session validated (${details.session_id})` :
      `❌ Session invalid: ${details.error || 'Unknown error'}`;
  } else {
    formattedDetails = JSON.stringify(details);
  }

  // Always include environment (use shorter 'dev' instead of 'development')
  const envLabel = env === 'development' ? 'dev' : env;
  const envSystemLabel = environment === 'development' ? 'dev' : environment;
  
  const envPrefix = env ? 
    `${chalk.bgMagenta(chalk.white(` ${envLabel} `))} ` : 
    `${environment !== 'production' ? chalk.bgBlue(chalk.white(` ${envSystemLabel} `)) + ' ' : ''}`;
  
  return `${envPrefix}👤 ${userInfo} | ${action} | ${formattedDetails}`;
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
// Format WebSocket logs more concisely based on debug mode
function formatWebSocketLog(ts, levelStyle, message, service, metadata, level) {
  // Check if this is a WebSocket message and if debug mode is enabled
  const isWebSocketLog = service === 'uni-ws' || message.includes('[uni-ws]');
  const wsDebugMode = config.debug_modes?.websocket === true || config.debug_modes?.websocket === 'true';
  
  // If not a WebSocket log, return null to use normal formatting
  if (!isWebSocketLog) {
    return null;
  }
  
  // Handle different WebSocket log patterns
  const serviceInfo = SERVICE_COLORS[service] || SERVICE_COLORS.WEBSOCKET;
  
  // Use shorter "dev" instead of "development" to prevent log wrapping
  const envLabel = metadata.environment === 'development' ? 'dev' : metadata.environment;
  const envSystemLabel = environment === 'development' ? 'dev' : environment;
  const envPrefix = metadata.environment ? 
    `${chalk.bgMagenta(chalk.white(` ${envLabel} `))} ` : 
    `${environment !== 'production' ? chalk.bgBlue(chalk.white(` ${envSystemLabel} `)) + ' ' : ''}`;
  
  // In full debug mode, show everything
  if (wsDebugMode) {
    // Keep original verbose format for debugging
    const formattedMessage = envPrefix + 
      `${serviceInfo.icon} ` +
      chalk.hex(serviceInfo.color)(message);
    
    // Format metadata more compactly but still include it
    const meta = Object.keys(metadata).length
      ? chalk.gray(JSON.stringify(formatMetadata(metadata, level), null, 0))
      : "";
    
    return `${ts} ${levelStyle.badge} ${formattedMessage}${meta ? " " + meta : ""}`;
  }
  
  // For normal mode, create more concise logs
  
  // CONNECTION LOGS - simplify to just show connection status and important details
  if (message.includes('Client connected') || message.includes('Client disconnected')) {
    const ip = metadata.ip || 'unknown';
    const origin = metadata.origin || 'unknown';
    const userId = metadata.userId || 'anonymous';
    const isAuth = metadata.isAuthenticated || false;
    
    // Create concise connection message
    const connectionStatus = message.includes('connected') ? 
      chalk.green('CONNECT') : chalk.yellow('DISCONNECT');
    
    const durationInfo = metadata.connection_duration ? 
      ` (${chalk.cyan(metadata.connection_duration.human)})` : '';
      
    const userInfo = userId !== 'anonymous' ? 
      ` ${chalk.hex('#FFA500')('user:')} ${chalk.yellow(userId.slice(0, 8))}...` : '';
    
    return `${ts} ${levelStyle.badge} ${envPrefix}${chalk.hex(serviceInfo.color)('WS')} ${connectionStatus} ${chalk.gray(ip)} from ${chalk.cyan(origin.replace(/^https?:\/\//, ''))}${userInfo}${durationInfo}`;
  }
  
  // CLIENT VERIFY - just show a simple verification message
  if (message.includes('CLIENT VERIFY')) {
    const clientIP = metadata.clientConnInfo?.req?.headers?.['x-real-ip'] || 
                    metadata.clientConnInfo?.req?.headers?.['x-forwarded-for'] || 
                    'unknown';
    const origin = metadata.clientConnInfo?.origin || 'unknown';
    
    return `${ts} ${levelStyle.badge} ${envPrefix}${chalk.hex(serviceInfo.color)('WS')} ${chalk.blue('VERIFY')} ${chalk.gray(clientIP)} from ${chalk.cyan(origin.replace(/^https?:\/\//, ''))}`;
  }
  
  // RAW HEADERS - omit completely in normal mode
  if (message.includes('RAW HEADERS')) {
    // Skip completely unless in debug mode
    return null;
  }
  
  // SUBSCRIPTION messages - show topic and counts
  if (message.includes('subscribed to topics')) {
    const topics = metadata.topics || [];
    return `${ts} ${levelStyle.badge} ${envPrefix}${chalk.hex(serviceInfo.color)('WS')} ${chalk.green('SUB')} ${chalk.cyan(topics.join(', '))}`;
  }
  
  // UNSUBSCRIPTION messages
  if (message.includes('unsubscribed from topics')) {
    const topics = metadata.topics || [];
    return `${ts} ${levelStyle.badge} ${envPrefix}${chalk.hex(serviceInfo.color)('WS')} ${chalk.yellow('UNSUB')} ${chalk.cyan(topics.join(', '))}`;
  }
  
  // BROADCAST messages - just show counts
  if (message.includes('Broadcast to topic') || message.includes('Broadcast to all')) {
    const count = message.match(/(\d+) clients/) || ['0', '0'];
    const topic = message.includes('Broadcast to topic') ? 
      message.replace('Broadcast to topic ', '').split(':')[0] : 'all';
    
    return `${ts} ${levelStyle.badge} ${envPrefix}${chalk.hex(serviceInfo.color)('WS')} ${chalk.magenta('BROADCAST')} ${chalk.cyan(topic)} → ${chalk.yellow(count[1])} clients`;
  }
  
  // For other WebSocket logs, use a standard abbreviated format
  const shortMessage = message.replace('[uni-ws]', '').trim();
  return `${ts} ${levelStyle.badge} ${envPrefix}${chalk.hex(serviceInfo.color)('WS')} ${shortMessage}`;
}

// Import the startup log buffer to capture initialization logs
import { startupLogBuffer } from '../startup-log-buffer.js';

const customFormat = winston.format.printf(
  ({ level, message, timestamp, service, ...metadata }) => {
    // Add to startup log buffer first (this will only capture important logs)
    startupLogBuffer.addLog(level, message, { service, ...metadata });

    const ts = chalk.gray(formatTimestamp(timestamp));
    const levelStyle = LEVEL_STYLES[level] || LEVEL_STYLES.info;
    const serviceInfo = SERVICE_COLORS[service] || SERVICE_COLORS.DEFAULT;

    // Try WebSocket formatter first
    const wsFormatted = formatWebSocketLog(ts, levelStyle, message, service, metadata, level);
    if (wsFormatted !== null) {
      return wsFormatted;
    }

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
    // Use shorter "dev" instead of "development" to prevent log wrapping
    const envLabel = metadata.environment === 'development' ? 'dev' : metadata.environment;
    const envSystemLabel = environment === 'development' ? 'dev' : environment;
    
    const envPrefix = metadata.environment ? 
      `${chalk.bgMagenta(chalk.white(` ${envLabel} `))} ` : 
      `${environment !== 'production' ? chalk.bgBlue(chalk.white(` ${envSystemLabel} `)) + ' ' : ''}`;
    
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

    // Check for WebSocket RSV1 fix logs - make them MUCH more visible
    if (message && (
        message.includes('WS BUFFER FIX') || 
        message.includes('WEBSOCKET FIX') || 
        message.includes('SOCKET RSV1'))) {
      // Always show these logs with maximum priority, but use appropriate colors
      // based on the log level to avoid looking like errors
      let bgColor = level === 'error' ? chalk.bgRed : 
                   level === 'warn' ? chalk.bgYellow : 
                   chalk.bgBlue;
      let textColor = level === 'warn' ? chalk.black : chalk.white;
      console.log(`\n${bgColor(textColor(message))}\n`);
    }

    // Sanitize any error objects in metadata
    const cleanMetadata = sanitizeError(metadata);

    // Format circuit breaker logs
    if (message.includes('Circuit breaker opened')) {
      return `${ts} ${LEVEL_STYLES.error.badge} ${formatCircuitBreaker(service, metadata)}`;
    }

    // Format user interaction logs
    if (message === ANALYTICS_PATTERNS.USER_INTERACTION) {
      const { user, action, details, environment: env } = metadata;
      return `${ts} ${levelStyle.badge} ${formatUserInteraction(user, action, details, env || metadata.environment || environment)}`;
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
    // Ensure metadata exists and is an object
    const safeMetadata = metadata || {};
    const pattern = message ? detectLogPattern(message) : null;
    const formattedMeta = formatMetadata(safeMetadata, level);

    // Create a structured log entry that's easy to parse in the frontend
    const logEntry = {
      timestamp: timestamp || new Date().toISOString(),
      formatted_time: formatTimestamp(timestamp),
      level: level ? level.toLowerCase() : 'info',
      message: message || '',
      service,
      service_icon: service ? SERVICE_COLORS[service]?.icon : null,
      level_icon: level ? LEVEL_STYLES[level]?.icon : null,
      pattern_type: pattern?.type,
      show_in_group: pattern?.showInGroup,
      details: formattedMeta,
      environment: safeMetadata.environment || environment,
    };

    try {
      return JSON.stringify(logEntry);
    } catch (err) {
      // If JSON stringify fails, return a simplified version
      return JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'error',
        message: 'Error serializing log entry',
        error: err.message
      });
    }
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
    nodeVersion: process.version,
    appName: 'DegenDuel API'
  }
});

// Helper to strip ANSI color codes for Logtail
const stripAnsiCodes = (str) => {
  if (typeof str !== 'string') return str;
  // This regex matches all ANSI color/style codes
  return str.replace(/\x1b\[[0-9;]*m/g, '');
};

// Helper to add Logtail-specific color formatting based on log level
const addLogtailFormatting = (level, message, metadata) => {
  // Define color mapping for different log levels
  const levelColors = {
    error: { bg: '#FF0000', fg: '#FFFFFF', icon: '🔴' },    // Red
    warn: { bg: '#FFD700', fg: '#000000', icon: '⚠️' },     // Gold
    info: { bg: '#0078D7', fg: '#FFFFFF', icon: 'ℹ️' },     // Blue
    debug: { bg: '#9370DB', fg: '#FFFFFF', icon: '🔍' },    // Purple
    http: { bg: '#20B2AA', fg: '#FFFFFF', icon: '🌐' }      // Light sea green
  };

  // Get colors for this level (or default to info)
  const colors = levelColors[level] || levelColors.info;
  
  // Get service icon if available
  const serviceIcon = metadata.service ? 
    (SERVICE_COLORS[metadata.service]?.icon || '') : '';
  
  // Add Logtail-specific properties for better presentation
  return {
    ...metadata,
    _highlight: level === 'error' || level === 'warn',
    _color: colors.bg,
    _icon: metadata.icon || colors.icon || serviceIcon
    // Removed HTML message formatting - this will be handled separately in Winston formatters
  };
};

// Helper to determine if a message is a Solana rate limit error
const isSolanaRateLimit = (message) => {
  return typeof message === 'string' && 
         message.includes('429 Too Many Requests') && 
         message.includes('Retrying after');
};

// Helper to extract retry time from rate limit message
const extractRetryTime = (message) => {
  const retryMatch = /Retrying after (\d+)ms/.exec(message);
  return retryMatch ? parseInt(retryMatch[1]) : 500;
};

// Standardized function to handle Solana rate limit errors consistently
const formatRateLimitError = (message, isForConsole = false) => {
  const retryMs = extractRetryTime(message);
  
  // Extract operation name and source from the message
  let operation = "Unknown";
  let hitCount = "1";
  let sourceService = "";
  
  // Parse additional context from message
  if (message.includes("via ")) {
    const sourceMatch = /via ([a-zA-Z0-9]+)/.exec(message);
    sourceService = sourceMatch ? sourceMatch[1] : "";
  }
  
  // Check for operation name in message
  if (message.includes("Operation: ")) {
    const opMatch = /Operation: ([a-zA-Z0-9]+)/.exec(message);
    operation = opMatch ? opMatch[1] : operation;
  } else if (message.includes("TokenBatch")) {
    operation = "TokenBatch";
  } else if (message.includes("WalletBatch")) {
    operation = "WalletBatch";
  } else if (message.includes("ReclaimFunds")) {
    operation = "ReclaimFunds";
  } else if (message.includes("getAccounts")) {
    operation = "getAccounts";
  } else if (message.includes("getTokens")) {
    operation = "getTokens";
  } else {
    operation = message.split(" ")[0] || "Unknown";
  }
  
  // Check for hit count in message
  if (message.includes("Hit #")) {
    const hitMatch = /Hit #(\d+)/.exec(message);
    hitCount = hitMatch ? hitMatch[1] : hitCount;
  }
  
  // Standard metadata for all rate limit errors
  const metadata = {
    service: 'SOLANA',
    error_type: 'RATE_LIMIT',
    retry_ms: retryMs,
    operation: operation,
    hit_count: hitCount,
    source_service: sourceService,
    rpc_provider: config?.rpc_urls?.primary,
    original_message: message,
    severity: 'warning', // For Logtail filtering
    alert_type: 'rate_limit' // For Logtail filtering
  };
  
  // For console, use ANSI colors with our standardized format
  if (isForConsole) {
    const sourceText = sourceService ? ` ${fancyColors.DARK_RED}(via ${sourceService})${fancyColors.RESET}` : '';
    return {
      message: `${fancyColors.RED}[solana-rpc]${fancyColors.RESET} ${fancyColors.BG_RED} ${fancyColors.WHITE} RATE LIMIT ${fancyColors.RESET} ${fancyColors.BOLD_RED}${operation}${fancyColors.RESET} ${fancyColors.RED}Hit #${hitCount}${fancyColors.RESET} ${fancyColors.LIGHT_RED}Retry in ${retryMs}ms${fancyColors.RESET}${sourceText}`,
      metadata
    };
  }
  
  // For Logtail, add the basic metadata only
  return {
    message: `SOLANA RPC RATE LIMIT: ${operation} operation - Retry in ${retryMs}ms`,
    metadata: {
      ...metadata,
      // Add Logtail-specific color properties but no HTML
      _highlight: true,
      _color: "#FFD700", // Gold background color for warnings
      _icon: "⚠️"  // Warning icon
    }
  };
};

// Add a processor to enhance logs with additional information before they're sent to Logtail
logtail.use((log) => {
  // Make sure metadata exists
  if (!log.metadata) {
    log.metadata = {};
  }
  
  // Always ensure environment is set
  log.metadata.environment = log.metadata.environment || environment;
  
  // Parse user agent information if available
  if (log.metadata.headers && log.metadata.headers["user-agent"]) {
    const ua = log.metadata.headers["user-agent"];
    log.metadata.browser = parseBrowser(ua);
    log.metadata.os = parseOS(ua);
    log.metadata.device = getDeviceType(log.metadata.headers);
  }
  
  // Parse IP information if available
  if (log.metadata.ip || (log.metadata.headers && (log.metadata.headers["x-real-ip"] || log.metadata.headers["x-forwarded-for"]))) {
    log.metadata.clientIp = log.metadata.ip || log.metadata.headers["x-real-ip"] || log.metadata.headers["x-forwarded-for"];
  }
  
  // Add timestamp in a consistent format
  log.metadata.formattedTime = formatTimestamp(log.dt);
  
  // Process message before sending to Logtail
  if (typeof log.message === 'string') {
    // First check if it's a specially formatted message we need to handle
    if (isSolanaRateLimit(log.message)) {
      // Use our standardized formatter
      const formatted = formatRateLimitError(log.message, false);
      log.message = formatted.message;
      
      // Merge metadata without HTML formatting
      log.metadata = { ...log.metadata, ...formatted.metadata };
    } else {
      // Strip ANSI codes for normal messages
      const cleanMessage = stripAnsiCodes(log.message);
      log.message = cleanMessage;
      
      // Add Logtail-specific formatting but no HTML
      if (log.level) {
        const formattedMetadata = addLogtailFormatting(log.level, cleanMessage, { ...log.metadata });
        
        // Only add the non-HTML properties
        log.metadata = {
          ...log.metadata,
          _highlight: formattedMetadata._highlight,
          _color: formattedMetadata._color,
          _icon: formattedMetadata._icon
        };
      }
    }
  }
  
  return log;
});

// Create the logtail transport
const logtailTransport = new LogtailTransport(logtail);


/* LOGGER INITIALIZATION */

// Create the logger with clear transport descriptions
const logApi = winston.createLogger({
  level: FILE_LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    // Console transport (colorized, human-readable)
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp(),
        // Add special formatter for rate limit messages
        winston.format((info) => {
          // Handle rate limit messages from Solana
          if (isSolanaRateLimit(info.message)) {
            // Use our standardized formatter for console
            const formatted = formatRateLimitError(info.message, true);
            info.message = formatted.message;
            
            // Merge metadata with info object
            Object.assign(info, formatted.metadata);
          }
          return info;
        })(),
        customFormat
      ),
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
      environment, // Always include environment
    });
  },
  trackInteraction: (user, action, details, headers) => {
    logApi.info(ANALYTICS_PATTERNS.USER_INTERACTION, {
      user,
      action,
      details,
      headers,
      timestamp: new Date().toISOString(),
      environment, // Always include environment
      // Enhanced device info by parsing user agent
      deviceInfo: headers && headers["user-agent"] ? {
        browser: parseBrowser(headers["user-agent"]),
        os: parseOS(headers["user-agent"]),
        device: getDeviceType(headers),
        ip: headers["x-real-ip"] || headers["x-forwarded-for"] || headers["ip"]
      } : null
    });
  },
  trackPerformance: (metrics) => {
    logApi.info('API Performance Stats', { ...metrics, environment });
  },
  trackFeature: (feature, user, details) => {
    logApi.info(ANALYTICS_PATTERNS.FEATURE_USAGE, {
      feature,
      user,
      details,
      timestamp: new Date().toISOString(),
      environment, // Always include environment
    });
  },
};

// Add the IP info lookup functionality
logApi.getIpInfo = getIpInfo;

// Patch console.log and console.error to capture and reformat specific types of messages
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

// Helper function to process messages for both console.log and console.error
const processMessage = function(args) {
  // Convert arguments to a proper array
  args = Array.from(args);
  
  // Check if this is a rate limit message
  if (args.length > 0 && typeof args[0] === 'string') {
    const message = args[0];
    
    if (isSolanaRateLimit(message)) {
      // Use our standardized formatter (true = formatted for console)
      const formatted = formatRateLimitError(message, true);
      
      // Log through our proper logging system instead
      logApi.warn(formatted.message, formatted.metadata);
      
      // Signal that we've handled this message
      return true;
    }
  }
  
  // Signal that we haven't handled this message
  return false;
};

// Override console.log
console.log = function() {
  if (processMessage(arguments)) {
    // Message was handled, don't call original
    return;
  }
  
  // For all other messages, call the original console.log
  originalConsoleLog.apply(console, arguments);
};

// Override console.error
console.error = function() {
  if (processMessage(arguments)) {
    // Message was handled, don't call original
    return;
  }
  
  // For all other messages, call the original console.error
  originalConsoleError.apply(console, arguments);
};

// Removed WebSocket RSV1 fixes as they interfered with Logtail connectivity

// Export both default and named
export { ANALYTICS_PATTERNS, LOG_PATTERNS, logApi };
export default logApi;