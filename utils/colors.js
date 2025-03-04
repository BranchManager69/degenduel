// Shared ANSI color codes for consistent styling
export const colors = {
  neon: '\x1b[38;5;207m',
  cyan: '\x1b[38;5;51m',
  green: '\x1b[38;5;46m',
  yellow: '\x1b[38;5;226m',
  red: '\x1b[38;5;196m',
  reset: '\x1b[0m'
};

export const fancyColors = {
  // Foreground colors
  BLUE: '\x1b[38;5;21m',
  GREEN: '\x1b[38;5;46m',
  YELLOW: '\x1b[38;5;226m',
  RED: '\x1b[38;5;196m',
  CYAN: '\x1b[38;5;51m',
  NEON: '\x1b[38;5;207m',
  MAGENTA: '\x1b[38;5;201m',
  ORANGE: '\x1b[38;5;208m',
  PURPLE: '\x1b[38;5;129m',
  PINK: '\x1b[38;5;213m',
  BROWN: '\x1b[38;5;130m',
  GRAY: '\x1b[38;5;240m',
  WHITE: '\x1b[38;5;231m',
  BLACK: '\x1b[38;5;16m',
  LIGHT_GRAY: '\x1b[38;5;247m',
  LIGHT_GREEN: '\x1b[38;5;190m',
  LIGHT_YELLOW: '\x1b[38;5;228m',
  LIGHT_RED: '\x1b[38;5;210m',
  LIGHT_BLUE: '\x1b[38;5;159m',
  LIGHT_MAGENTA: '\x1b[38;5;212m',
  LIGHT_CYAN: '\x1b[38;5;153m',
  LIGHT_WHITE: '\x1b[38;5;231m',
  LIGHT_BLACK: '\x1b[38;5;16m',
  DARK_GRAY: '\x1b[38;5;232m',
  DARK_GREEN: '\x1b[38;5;22m',
  DARK_YELLOW: '\x1b[38;5;178m',
  DARK_RED: '\x1b[38;5;196m',
  DARK_BLUE: '\x1b[38;5;21m',
  DARK_MAGENTA: '\x1b[38;5;129m',
  DARK_CYAN: '\x1b[38;5;51m',
  DARK_WHITE: '\x1b[38;5;231m',
  DARK_BLACK: '\x1b[38;5;16m',
  
  // Background colors (BG prefix)
  BG_BLUE: '\x1b[48;5;21m',
  BG_GREEN: '\x1b[48;5;46m',
  BG_YELLOW: '\x1b[48;5;226m',
  BG_RED: '\x1b[48;5;196m',
  BG_CYAN: '\x1b[48;5;51m',
  BG_NEON: '\x1b[48;5;207m',
  BG_MAGENTA: '\x1b[48;5;201m',
  BG_ORANGE: '\x1b[48;5;208m',
  BG_PURPLE: '\x1b[48;5;129m',
  BG_PINK: '\x1b[48;5;213m',
  BG_BROWN: '\x1b[48;5;130m',
  BG_GRAY: '\x1b[48;5;240m',
  BG_WHITE: '\x1b[48;5;231m',
  BG_BLACK: '\x1b[48;5;16m',
  BG_LIGHT_GRAY: '\x1b[48;5;247m',
  BG_LIGHT_GREEN: '\x1b[48;5;190m',
  BG_LIGHT_YELLOW: '\x1b[48;5;228m',
  BG_LIGHT_RED: '\x1b[48;5;210m',
  BG_LIGHT_BLUE: '\x1b[48;5;159m',
  BG_LIGHT_MAGENTA: '\x1b[48;5;212m',
  BG_LIGHT_CYAN: '\x1b[48;5;153m',
  BG_LIGHT_WHITE: '\x1b[48;5;231m',
  BG_LIGHT_BLACK: '\x1b[48;5;16m',
  BG_DARK_GRAY: '\x1b[48;5;232m',
  BG_DARK_GREEN: '\x1b[48;5;22m',
  BG_DARK_YELLOW: '\x1b[48;5;178m',
  BG_DARK_RED: '\x1b[48;5;196m',
  BG_DARK_BLUE: '\x1b[48;5;21m',
  BG_DARK_MAGENTA: '\x1b[48;5;129m',
  BG_DARK_CYAN: '\x1b[48;5;51m',
  BG_DARK_WHITE: '\x1b[48;5;231m',
  BG_DARK_BLACK: '\x1b[48;5;16m',
  
  // Highlight colors (keeping for backward compatibility)
  HIGHLIGHT_GRAY: '\x1b[48;5;240m',
  HIGHLIGHT_GREEN: '\x1b[48;5;22m',
  HIGHLIGHT_YELLOW: '\x1b[48;5;178m',
  HIGHLIGHT_RED: '\x1b[48;5;196m',
  HIGHLIGHT_BLUE: '\x1b[48;5;21m',
  HIGHLIGHT_MAGENTA: '\x1b[48;5;129m',
  HIGHLIGHT_CYAN: '\x1b[48;5;51m',
  
  // Text formatting
  BOLD: '\x1b[1m',
  ITALIC: '\x1b[3m',
  UNDERLINE: '\x1b[4m',
  BLINK: '\x1b[5m',
  REVERSE: '\x1b[7m',
  HIDDEN: '\x1b[8m',
  RESET: '\x1b[0m',
  
  // Common combined variants
  ERROR: '\x1b[38;5;231m\x1b[48;5;196m', // White text on red background
  SUCCESS: '\x1b[38;5;231m\x1b[48;5;46m', // White text on green background
  WARNING: '\x1b[38;5;16m\x1b[48;5;226m', // Black text on yellow background
  INFO: '\x1b[38;5;231m\x1b[48;5;21m', // White text on blue background
  HIGHLIGHT: '\x1b[38;5;16m\x1b[48;5;51m', // Black text on cyan background
  ALERT: '\x1b[38;5;231m\x1b[48;5;201m', // White text on magenta background
  NOTICE: '\x1b[38;5;16m\x1b[48;5;208m', // Black text on orange background
  
  // Bold variants of common colors
  BOLD_RED: '\x1b[1m\x1b[38;5;196m',
  BOLD_GREEN: '\x1b[1m\x1b[38;5;46m',
  BOLD_BLUE: '\x1b[1m\x1b[38;5;21m',
  BOLD_YELLOW: '\x1b[1m\x1b[38;5;226m',
  BOLD_CYAN: '\x1b[1m\x1b[38;5;51m',
  BOLD_MAGENTA: '\x1b[1m\x1b[38;5;201m',
  
  // Underlined variants
  UNDERLINE_RED: '\x1b[4m\x1b[38;5;196m',
  UNDERLINE_GREEN: '\x1b[4m\x1b[38;5;46m',
  UNDERLINE_BLUE: '\x1b[4m\x1b[38;5;21m',
  UNDERLINE_YELLOW: '\x1b[4m\x1b[38;5;226m',
  
  // Special combinations for service logging
  SERVICE_START: '\x1b[1m\x1b[38;5;46m', // Bold green
  SERVICE_STOP: '\x1b[1m\x1b[38;5;196m', // Bold red
  SERVICE_INFO: '\x1b[1m\x1b[38;5;51m', // Bold cyan
  SERVICE_WARNING: '\x1b[1m\x1b[38;5;208m', // Bold orange
  SERVICE_ERROR: '\x1b[1m\x1b[38;5;196m\x1b[48;5;231m', // Bold red on white
  
  // Neon variants for attention-grabbing messages
  NEON_BLUE: '\x1b[1m\x1b[38;5;21m\x1b[48;5;159m', // Bold blue on light blue
  NEON_GREEN: '\x1b[1m\x1b[38;5;46m\x1b[48;5;22m', // Bold green on dark green
  NEON_PINK: '\x1b[1m\x1b[38;5;213m\x1b[48;5;129m', // Bold pink on purple
  
  // Additional creative combinations
  MATRIX: '\x1b[1m\x1b[38;5;46m\x1b[48;5;16m', // Bold green on black (Matrix style)
  SUNSET: '\x1b[38;5;208m\x1b[48;5;129m', // Orange on purple (sunset colors)
  OCEAN: '\x1b[38;5;51m\x1b[48;5;21m', // Cyan on blue (ocean theme)
  FOREST: '\x1b[38;5;46m\x1b[48;5;22m', // Green on dark green (forest theme)
  FIRE: '\x1b[1m\x1b[38;5;196m\x1b[48;5;208m', // Bold red on orange (fire theme)
  ICE: '\x1b[38;5;231m\x1b[48;5;153m', // White on light cyan (ice theme)
  DESERT: '\x1b[38;5;130m\x1b[48;5;228m', // Brown on light yellow (desert theme)
  GALAXY: '\x1b[1m\x1b[38;5;129m\x1b[48;5;16m', // Bold purple on black (galaxy theme)
  RAINBOW_RED: '\x1b[38;5;196m\x1b[48;5;16m\x1b[1m', // First color in rainbow sequence
  RAINBOW_ORANGE: '\x1b[38;5;208m\x1b[48;5;16m\x1b[1m', // Second color in rainbow sequence
  RAINBOW_YELLOW: '\x1b[38;5;226m\x1b[48;5;16m\x1b[1m', // Third color in rainbow sequence
  RAINBOW_GREEN: '\x1b[38;5;46m\x1b[48;5;16m\x1b[1m', // Fourth color in rainbow sequence
  RAINBOW_BLUE: '\x1b[38;5;21m\x1b[48;5;16m\x1b[1m', // Fifth color in rainbow sequence
  RAINBOW_PURPLE: '\x1b[38;5;129m\x1b[48;5;16m\x1b[1m', // Sixth color in rainbow sequence
  
  // Blinking attention-getters
  CRITICAL: '\x1b[5m\x1b[1m\x1b[38;5;231m\x1b[48;5;196m', // Blinking bold white on red
  CELEBRATION: '\x1b[5m\x1b[1m\x1b[38;5;226m\x1b[48;5;21m', // Blinking bold yellow on blue
  
  // Standardized log levels (for consistent logging)
  LOG_TRACE: '\x1b[38;5;240m', // Gray for trace logs
  LOG_DEBUG: '\x1b[38;5;51m', // Cyan for debug logs
  LOG_INFO: '\x1b[38;5;46m', // Green for info logs
  LOG_WARN: '\x1b[38;5;226m', // Yellow for warning logs
  LOG_ERROR: '\x1b[38;5;196m', // Red for error logs
  LOG_FATAL: '\x1b[1m\x1b[38;5;231m\x1b[48;5;196m', // Bold white on red for fatal logs
  
  // Service lifecycle standardized colors
  SERVICE_INITIALIZING: '\x1b[1m\x1b[38;5;226m', // Bold yellow for initializing
  SERVICE_INITIALIZED: '\x1b[1m\x1b[38;5;46m', // Bold green for initialized
  SERVICE_RUNNING: '\x1b[38;5;46m', // Green for running
  SERVICE_STOPPING: '\x1b[38;5;226m', // Yellow for stopping
  SERVICE_STOPPED: '\x1b[38;5;196m', // Red for stopped
  SERVICE_FAILED: '\x1b[1m\x1b[38;5;196m', // Bold red for failed
  
  // Database operation colors
  DB_QUERY: '\x1b[38;5;51m', // Cyan for queries
  DB_INSERT: '\x1b[38;5;46m', // Green for inserts
  DB_UPDATE: '\x1b[38;5;226m', // Yellow for updates
  DB_DELETE: '\x1b[38;5;196m', // Red for deletes
  DB_ERROR: '\x1b[1m\x1b[38;5;196m', // Bold red for errors
  
  // API endpoint colors
  API_GET: '\x1b[38;5;46m', // Green for GET requests
  API_POST: '\x1b[38;5;226m', // Yellow for POST requests
  API_PUT: '\x1b[38;5;208m', // Orange for PUT requests
  API_DELETE: '\x1b[38;5;196m', // Red for DELETE requests
  API_ERROR: '\x1b[1m\x1b[38;5;196m', // Bold red for API errors
  
  // Performance monitoring
  PERF_EXCELLENT: '\x1b[38;5;46m', // Green for excellent performance
  PERF_GOOD: '\x1b[38;5;226m', // Yellow for good performance
  PERF_POOR: '\x1b[38;5;208m', // Orange for poor performance
  PERF_CRITICAL: '\x1b[38;5;196m', // Red for critical performance
};

// Standardized logging color scheme
export const logColors = {
  trace: fancyColors.LOG_TRACE,
  debug: fancyColors.LOG_DEBUG,
  info: fancyColors.LOG_INFO,
  warn: fancyColors.LOG_WARN,
  error: fancyColors.LOG_ERROR,
  fatal: fancyColors.LOG_FATAL,
};

// Standardized service lifecycle color scheme
export const serviceColors = {
  initializing: fancyColors.SERVICE_INITIALIZING,
  initialized: fancyColors.SERVICE_INITIALIZED,
  running: fancyColors.SERVICE_RUNNING,
  stopping: fancyColors.SERVICE_STOPPING,
  stopped: fancyColors.SERVICE_STOPPED,
  failed: fancyColors.SERVICE_FAILED,
};

// Standardized database operation color scheme
export const dbColors = {
  query: fancyColors.DB_QUERY,
  insert: fancyColors.DB_INSERT,
  update: fancyColors.DB_UPDATE,
  delete: fancyColors.DB_DELETE,
  error: fancyColors.DB_ERROR,
};

// Standardized API endpoint color scheme
export const apiColors = {
  get: fancyColors.API_GET,
  post: fancyColors.API_POST,
  put: fancyColors.API_PUT,
  delete: fancyColors.API_DELETE,
  error: fancyColors.API_ERROR,
};

// Standardized performance monitoring color scheme
export const perfColors = {
  excellent: fancyColors.PERF_EXCELLENT,
  good: fancyColors.PERF_GOOD,
  poor: fancyColors.PERF_POOR,
  critical: fancyColors.PERF_CRITICAL,
};