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
  GOLD: '\x1b[38;5;220m',         // Added gold color for system services
  BOLD_PURPLE: '\x1b[1m\x1b[38;5;129m', // Added bold purple
  LIGHT_PURPLE: '\x1b[38;5;141m', // Added light purple 
  BOLD_CYAN: '\x1b[1m\x1b[38;5;51m', // Added bold cyan
  BG_PURPLE: '\x1b[48;5;129m', // Added purple background
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
  DARK_MAGENTA: '\x1b[38;5;90m', // Changed to match BG_DARK_MAGENTA
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
  BG_DARK_MAGENTA: '\x1b[48;5;90m', // Added dark magenta background
  BG_ORANGE: '\x1b[48;5;208m',
  BG_PURPLE: '\x1b[48;5;129m',
  BG_GOLD: '\x1b[48;5;220m',     // Added gold background
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

  // Debug vivid highlight and formatted lines
  BG_DEBUG: '\x1b[48;5;236m\x1b[38;5;252m',                                  // general debug      -  N/A              -  Light gray text on dark gray background
  BG_DEBUG_MARKET_DATABASE: '\x1b[1m\x1b[38;5;231m\x1b[48;5;201m\x1b[4m\x1b[3m',    // marketDataService  -  MARKET DATABASE  -  Bold white text on magenta background with underline and italic
  BG_DEBUG_GAME_DATABASE: '\x1b[1m\x1b[38;5;16m\x1b[48;5;118m\x1b[3m\x1b[4m',       // tokenSyncService   -  GAME DATABASE    -  Bold black text on bright green background with underline and italic

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
  
  // New exotic colors (from demo)
  INDIGO: '\x1b[38;5;93m',       // Indigo (93) - deep purple-blue
  BOLD_INDIGO: '\x1b[1m\x1b[38;5;93m', // Bold Indigo
  BG_INDIGO: '\x1b[48;5;93m',    // Indigo background
  
  LIME: '\x1b[38;5;112m',        // Lime (112) - vibrant green
  BOLD_LIME: '\x1b[1m\x1b[38;5;112m', // Bold Lime
  BG_LIME: '\x1b[48;5;112m',     // Lime background
  
  SALMON: '\x1b[38;5;209m',      // Salmon (209) - pinkish-orange
  BOLD_SALMON: '\x1b[1m\x1b[38;5;209m', // Bold Salmon
  BG_SALMON: '\x1b[48;5;209m',   // Salmon background
  
  TEAL: '\x1b[38;5;43m',         // Teal (43) - blue-green
  BOLD_TEAL: '\x1b[1m\x1b[38;5;43m', // Bold Teal
  BG_TEAL: '\x1b[48;5;43m',      // Teal background
  
  SEA_GREEN: '\x1b[38;5;29m',    // Sea Green (29) - darker green
  BOLD_SEA_GREEN: '\x1b[1m\x1b[38;5;29m', // Bold Sea Green
  BG_SEA_GREEN: '\x1b[48;5;29m', // Sea Green background
  
  LAVENDER: '\x1b[38;5;141m',    // Lavender (141) - light purple
  BOLD_LAVENDER: '\x1b[1m\x1b[38;5;141m', // Bold Lavender
  BG_LAVENDER: '\x1b[48;5;141m', // Lavender background
  
  TURQUOISE: '\x1b[38;5;80m',    // Turquoise (80) - blue-green
  BOLD_TURQUOISE: '\x1b[1m\x1b[38;5;80m', // Bold Turquoise
  BG_TURQUOISE: '\x1b[48;5;80m', // Turquoise background
};

// Standardized logging color scheme - Updated with new exotic colors
export const logColors = {
  trace: fancyColors.INDIGO,           // Changed to Indigo (was GRAY)
  debug: fancyColors.TEAL,             // Changed to Teal (was CYAN)
  info: fancyColors.LIME,              // Changed to Lime (was GREEN)
  warn: fancyColors.SALMON,            // Changed to Salmon (was YELLOW)
  error: fancyColors.RED,              // Kept as RED for consistency
  fatal: fancyColors.LOG_FATAL,        // Kept as is for consistency
};

// Standardized service lifecycle color scheme
export const serviceColors = {
  initializing: fancyColors.BOLD_INDIGO,   // Changed to Bold Indigo
  initialized: fancyColors.BOLD_LIME,      // Changed to Bold Lime
  running: fancyColors.LIME,               // Changed to Lime
  stopping: fancyColors.SALMON,            // Changed to Salmon
  stopped: fancyColors.RED,                // Kept as RED for consistency
  failed: fancyColors.SERVICE_FAILED,      // Kept as is for consistency
};

// Service-specific colors using our exotic new colors
export const serviceSpecificColors = {
  // Current service colors
  tokenSync: {
    tag: '\x1b[1m\x1b[38;5;201m',                   // Magenta (201)
    header: '\x1b[1m\x1b[38;5;201m\x1b[48;5;236m',  // Magenta on dark gray
    info: '\x1b[38;5;201m',                         // Regular magenta
    success: '\x1b[38;5;46m',                       // Standard green
    warning: '\x1b[38;5;214m',                      // Standard orange
    error: '\x1b[38;5;196m',                        // Standard red
  },
  tokenDEXData: {
    tag: '\x1b[1m\x1b[38;5;147m',                   // Light Purple (147)
    header: '\x1b[1m\x1b[38;5;147m\x1b[48;5;236m',  // Light Purple on dark gray
    info: '\x1b[38;5;147m',                         // Regular light purple
    success: '\x1b[38;5;46m',                       // Standard green
    warning: '\x1b[38;5;214m',                      // Standard orange
    error: '\x1b[38;5;196m',                        // Standard red
    highlight: '\x1b[1m\x1b[38;5;147m',             // Bold light purple for highlights
    token: '\x1b[38;5;51m',                         // Cyan for token identifiers
    count: '\x1b[38;5;46m',                         // Green for counts
  },
  contestWallet: {
    tag: '\x1b[1m\x1b[38;5;51m',                    // Cyan (51)
    header: '\x1b[1m\x1b[38;5;51m\x1b[48;5;236m',   // Cyan on dark gray
    info: '\x1b[38;5;51m',                          // Regular cyan
    success: '\x1b[38;5;46m',                       // Standard green
    warning: '\x1b[38;5;214m',                      // Standard orange
    error: '\x1b[38;5;196m',                        // Standard red
    highlight: '\x1b[1m\x1b[38;5;51m',              // Bold cyan for highlights
    batch: '\x1b[1m\x1b[38;5;51m\x1b[48;5;239m',    // Bold cyan on medium gray for batch operations
    transfer: '\x1b[1m\x1b[38;5;51m\x1b[48;5;17m',  // Bold cyan on navy for transfer operations
  },
  heliusClient: {
    tag: '\x1b[1m\x1b[38;5;127m',                   // Purple (127)
    header: '\x1b[1m\x1b[38;5;127m\x1b[48;5;236m',  // Purple on dark gray
    info: '\x1b[38;5;127m',                         // Regular purple
    success: '\x1b[38;5;46m',                       // Standard green
    warning: '\x1b[38;5;214m',                      // Standard orange
    error: '\x1b[38;5;196m',                        // Standard red
  },
  jupiterClient: {
    tag: '\x1b[1m\x1b[38;5;208m',                   // Orange (208)
    header: '\x1b[1m\x1b[38;5;208m\x1b[48;5;236m',  // Orange on dark gray
    info: '\x1b[38;5;208m',                         // Regular orange
    success: '\x1b[38;5;46m',                       // Standard green
    warning: '\x1b[38;5;214m',                      // Standard orange
    error: '\x1b[38;5;196m',                        // Standard red
    highlight: '\x1b[1m\x1b[38;5;208m',             // Bold orange for highlights
    token: '\x1b[38;5;51m',                         // Cyan for token identifiers
    price: '\x1b[38;5;226m',                        // Yellow for prices
    count: '\x1b[38;5;46m',                         // Green for counts
  },
  dexscreenerClient: {
    tag: '\x1b[1m\x1b[38;5;141m',                   // Lavender (141)
    header: '\x1b[1m\x1b[38;5;141m\x1b[48;5;236m',  // Lavender on dark gray
    info: '\x1b[38;5;141m',                         // Regular lavender
    success: '\x1b[38;5;46m',                       // Standard green
    warning: '\x1b[38;5;214m',                      // Standard orange
    error: '\x1b[38;5;196m',                        // Standard red
    highlight: '\x1b[1m\x1b[38;5;141m',             // Bold lavender for highlights
    token: '\x1b[38;5;51m',                         // Cyan for token identifiers
    count: '\x1b[38;5;46m',                         // Green for counts
  },
  solanaEngine: {
    tag: '\x1b[1m\x1b[38;5;75m',                    // Blue (75)
    header: '\x1b[1m\x1b[38;5;75m\x1b[48;5;236m',   // Blue on dark gray
    info: '\x1b[38;5;75m',                          // Regular blue
    success: '\x1b[38;5;46m',                       // Standard green
    warning: '\x1b[38;5;214m',                      // Standard orange
    error: '\x1b[38;5;196m',                        // Standard red
    highlight: '\x1b[1m\x1b[38;5;75m',              // Bold blue for highlights
    token: '\x1b[1m\x1b[38;5;75m',                  // Bold blue for token
    count: '\x1b[1m\x1b[38;5;75m',                  // Bold blue for count
  },
  
  // New service colors using our exotic theme additions
  ddcomment: {
    tag: '\x1b[1m\x1b[38;5;93m',                    // Bold Indigo (93)
    header: '\x1b[1m\x1b[38;5;93m\x1b[48;5;236m',   // Bold Indigo on dark gray
    info: '\x1b[38;5;93m',                          // Regular Indigo
    success: '\x1b[38;5;46m',                       // Standard green
    warning: '\x1b[38;5;214m',                      // Standard orange
    error: '\x1b[38;5;196m',                        // Standard red
  },
  aiService: {
    tag: '\x1b[1m\x1b[38;5;112m',                   // Bold Lime (112)
    header: '\x1b[1m\x1b[38;5;112m\x1b[48;5;236m',  // Bold Lime on dark gray
    info: '\x1b[38;5;112m',                         // Regular Lime
    success: '\x1b[38;5;46m',                       // Standard green
    warning: '\x1b[38;5;214m',                      // Standard orange
    error: '\x1b[38;5;196m',                        // Standard red
  },
  adminTools: {
    tag: '\x1b[1m\x1b[38;5;209m',                   // Bold Salmon (209)
    header: '\x1b[1m\x1b[38;5;209m\x1b[48;5;236m',  // Bold Salmon on dark gray
    info: '\x1b[38;5;209m',                         // Regular Salmon
    success: '\x1b[38;5;46m',                       // Standard green
    warning: '\x1b[38;5;214m',                      // Standard orange
    error: '\x1b[38;5;196m',                        // Standard red
  },
  marketAnalytics: {
    tag: '\x1b[1m\x1b[38;5;43m',                    // Bold Teal (43)
    header: '\x1b[1m\x1b[38;5;43m\x1b[48;5;236m',   // Bold Teal on dark gray
    info: '\x1b[38;5;43m',                          // Regular Teal
    success: '\x1b[38;5;46m',                       // Standard green
    warning: '\x1b[38;5;214m',                      // Standard orange
    error: '\x1b[38;5;196m',                        // Standard red
  },
  balanceTracking: {
    tag: '\x1b[1m\x1b[38;5;29m',                    // Bold Sea Green (29)
    header: '\x1b[1m\x1b[38;5;29m\x1b[48;5;236m',   // Bold Sea Green on dark gray
    info: '\x1b[38;5;29m',                          // Regular Sea Green
    success: '\x1b[38;5;46m',                       // Standard green
    warning: '\x1b[38;5;214m',                      // Standard orange
    error: '\x1b[38;5;196m',                        // Standard red
  }
};

// Standardized database operation color scheme
export const dbColors = {
  query: fancyColors.TEAL,               // Changed to Teal
  insert: fancyColors.LIME,              // Changed to Lime
  update: fancyColors.SALMON,            // Changed to Salmon
  delete: fancyColors.RED,               // Kept as RED for consistency
  error: fancyColors.DB_ERROR,           // Kept as is for consistency
};

// Standardized API endpoint color scheme
export const apiColors = {
  get: fancyColors.TEAL,                 // Changed to Teal
  post: fancyColors.LIME,                // Changed to Lime
  put: fancyColors.SALMON,               // Changed to Salmon
  delete: fancyColors.RED,               // Kept as RED for consistency
  error: fancyColors.API_ERROR,          // Kept as is for consistency
};

// Standardized performance monitoring color scheme
export const perfColors = {
  excellent: fancyColors.LIME,           // Changed to Lime
  good: fancyColors.TEAL,                // Changed to Teal
  poor: fancyColors.SALMON,              // Changed to Salmon
  critical: fancyColors.RED,             // Kept as RED for consistency
};

// WebSocket color scheme - updated with exotic colors
export const wsColors = {
  // Base websocket tag color (replace magenta)
  tag: '\x1b[1m\x1b[38;5;93m',                      // Bold Indigo
  
  // Variations for different websocket operations
  connect: '\x1b[1m\x1b[38;5;93m\x1b[48;5;236m',    // Bold Indigo on dark gray
  auth: '\x1b[1m\x1b[38;5;112m\x1b[48;5;236m',      // Bold Lime on dark gray
  subscribe: '\x1b[38;5;43m',                       // Teal
  message: '\x1b[38;5;141m',                        // Lavender
  disconnect: '\x1b[38;5;209m',                     // Salmon
  error: '\x1b[1m\x1b[38;5;196m\x1b[48;5;236m',     // Bold red on dark gray (kept as is)
  
  // Box drawing theme colors
  boxFg: '\x1b[38;5;93m',                           // Indigo text
  boxBg: '\x1b[48;5;236m',                          // Dark gray background
  highlightFg: '\x1b[1m\x1b[38;5;16m',              // Bold black text
  highlightBg: '\x1b[48;5;93m',                     // Indigo background
  
  // Connection box specific colors
  connectBoxBg: '\x1b[48;5;236m',                   // Dark gray background for connection box
  connectBoxFg: '\x1b[38;5;93m',                    // Indigo text for connection box
  
  // Disconnection box specific colors
  disconnectBoxBg: '\x1b[48;5;236m',                // Dark gray background for disconnection box
  disconnectBoxFg: '\x1b[38;5;209m',                // Salmon text for disconnection box
  
  // Special combinations
  notification: '\x1b[1m\x1b[38;5;93m\x1b[48;5;209m', // Bold Indigo on Salmon
  success: '\x1b[1m\x1b[38;5;16m\x1b[48;5;112m',      // Bold black on Lime
  warning: '\x1b[1m\x1b[38;5;16m\x1b[48;5;209m',      // Bold black on Salmon
};