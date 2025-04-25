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

// Service-specific colors organized by color families
export const serviceSpecificColors = {
  // =============================================================
  // 1. BLUE FAMILY - Solana API Services
  // =============================================================
  
  // Parent Service - Navy Background
  solanaEngine: {
    tag: '\x1b[1m\x1b[38;5;17m',                    // Navy/Dark Blue (17)
    header: '\x1b[1m\x1b[38;5;255m\x1b[48;5;17m',   // White on Navy background
    info: '\x1b[38;5;17m',                          // Navy
    success: '\x1b[38;5;17m',                       // Navy
    warning: '\x1b[38;5;214m',                      // Standard orange
    error: '\x1b[38;5;196m',                        // Standard red
    highlight: '\x1b[1m\x1b[38;5;17m',              // Bold Navy
    token: '\x1b[1m\x1b[38;5;17m',                  // Bold Navy
    count: '\x1b[1m\x1b[38;5;17m',                  // Bold Navy
  },
  
  // Child Services - Blue variants
  heliusClient: {
    tag: '\x1b[1m\x1b[38;5;75m',                    // Blue (75)
    header: '\x1b[1m\x1b[38;5;75m\x1b[48;5;236m',   // Blue on dark gray
    info: '\x1b[38;5;75m',                          // Regular blue
    highlight: '\x1b[1m\x1b[38;5;75m',              // Bold blue for highlights
    token: '\x1b[38;5;51m',                         // Cyan for token identifiers
    count: '\x1b[1m\x1b[38;5;75m',                  // Blue for counts
    success: '\x1b[38;5;75m',                       // Blue instead of green
    warning: '\x1b[38;5;214m',                      // Standard orange
    error: '\x1b[38;5;196m',                        // Standard red
  },
  
  jupiterClient: {
    tag: '\x1b[1m\x1b[38;5;51m',                    // Cyan (51)
    header: '\x1b[1m\x1b[38;5;51m\x1b[48;5;236m',   // Cyan on dark gray
    info: '\x1b[38;5;51m',                          // Regular cyan
    success: '\x1b[38;5;51m',                       // Cyan instead of green
    warning: '\x1b[38;5;214m',                      // Standard orange
    error: '\x1b[38;5;196m',                        // Standard red
    highlight: '\x1b[1m\x1b[38;5;51m',              // Bold cyan for highlights
    token: '\x1b[38;5;51m',                         // Cyan for token identifiers
    price: '\x1b[38;5;226m',                        // Yellow for prices
    count: '\x1b[38;5;51m',                         // Cyan for counts
  },
  
  dexscreenerClient: {
    tag: '\x1b[1m\x1b[38;5;39m',                    // Sky Blue (39)
    header: '\x1b[1m\x1b[38;5;39m\x1b[48;5;236m',   // Sky Blue on dark gray
    info: '\x1b[38;5;39m',                          // Regular Sky Blue
    success: '\x1b[38;5;39m',                       // Sky Blue instead of green
    warning: '\x1b[38;5;214m',                      // Standard orange
    error: '\x1b[38;5;196m',                        // Standard red
    highlight: '\x1b[1m\x1b[38;5;39m',              // Bold Sky Blue for highlights
    token: '\x1b[38;5;51m',                         // Cyan for token identifiers
    count: '\x1b[38;5;39m',                         // Sky Blue for counts
  },
  
  // =============================================================
  // 2. GOLD/BRONZE FAMILY - Data Processing Services
  // =============================================================
  
  // Parent Service - Gold with background
  marketDataService: {
    tag: '\x1b[1m\x1b[38;5;220m',                   // Gold (220)
    header: '\x1b[1m\x1b[38;5;232m\x1b[48;5;220m',  // Black on Gold background
    info: '\x1b[38;5;220m',                         // Regular Gold
    success: '\x1b[38;5;220m',                      // Gold instead of green
    warning: '\x1b[38;5;214m',                      // Standard orange
    error: '\x1b[38;5;196m',                        // Standard red
    highlight: '\x1b[1m\x1b[38;5;220m',             // Bold Gold
    broadcast: '\x1b[1m\x1b[38;5;232m\x1b[48;5;183m', // Black on Mauve for broadcasts
    token: '\x1b[38;5;220m',                        // Gold for tokens
    count: '\x1b[38;5;220m',                        // Gold for counts
  },
  
  // Child Services - Gold/Bronze variants
  tokenSync: {
    tag: '\x1b[1m\x1b[38;5;214m',                   // Amber (214)
    header: '\x1b[1m\x1b[38;5;214m\x1b[48;5;236m',  // Amber on dark gray
    info: '\x1b[38;5;214m',                         // Regular amber
    success: '\x1b[38;5;214m',                      // Amber instead of green
    warning: '\x1b[38;5;214m',                      // Standard orange
    error: '\x1b[38;5;196m',                        // Standard red
    highlight: '\x1b[1m\x1b[38;5;214m',             // Bold amber
  },
  
  tokenDEXData: {
    tag: '\x1b[1m\x1b[38;5;130m',                   // Copper/Bronze (130)
    header: '\x1b[1m\x1b[38;5;130m\x1b[48;5;236m',  // Copper on dark gray
    info: '\x1b[38;5;130m',                         // Regular copper
    success: '\x1b[38;5;130m',                      // Copper instead of green
    warning: '\x1b[38;5;214m',                      // Standard orange
    error: '\x1b[38;5;196m',                        // Standard red
    highlight: '\x1b[1m\x1b[38;5;130m',             // Bold copper for highlights
    token: '\x1b[38;5;220m',                        // Gold for token identifiers
    count: '\x1b[38;5;130m',                        // Copper for counts
  },
  
  // =============================================================
  // 3. FOREST/OLIVE FAMILY - Wallet Services
  // =============================================================
  
  // Parent Service - Forest Green with background
  contestWallet: {
    tag: '\x1b[1m\x1b[38;5;29m',                    // Forest Green (29)
    header: '\x1b[1m\x1b[38;5;255m\x1b[48;5;29m',   // White on Forest Green background
    info: '\x1b[38;5;29m',                          // Regular Forest Green
    success: '\x1b[38;5;29m',                       // Forest Green instead of bright green
    warning: '\x1b[38;5;214m',                      // Standard orange
    error: '\x1b[38;5;196m',                        // Standard red
    highlight: '\x1b[1m\x1b[38;5;29m',              // Bold Forest Green
    batch: '\x1b[1m\x1b[38;5;255m\x1b[48;5;29m',    // White on Forest Green for batch operations
    transfer: '\x1b[1m\x1b[38;5;255m\x1b[48;5;29m', // White on Forest Green for transfers
  },
  
  // Child Service - Olive Green
  vanityWallet: {
    tag: '\x1b[1m\x1b[38;5;64m',                    // Olive Green (64)
    header: '\x1b[1m\x1b[38;5;64m\x1b[48;5;236m',   // Olive Green on dark gray
    info: '\x1b[38;5;64m',                          // Regular Olive Green
    success: '\x1b[38;5;64m',                       // Olive Green instead of bright green
    warning: '\x1b[38;5;214m',                      // Standard orange
    error: '\x1b[38;5;196m',                        // Standard red
    highlight: '\x1b[1m\x1b[38;5;64m',              // Bold Olive Green
  },
  
  // =============================================================
  // 4. YELLOW/ORANGE FAMILY - Analytics & Tracking
  // =============================================================
  
  // Balance Tracking - Dark Yellow with subtle background
  balanceTracking: {
    tag: '\x1b[1m\x1b[38;5;178m',                   // Dark Yellow (178)
    header: '\x1b[1m\x1b[38;5;232m\x1b[48;5;178m',  // Black on Dark Yellow background
    info: '\x1b[38;5;178m',                         // Regular Dark Yellow
    success: '\x1b[38;5;178m',                      // Dark Yellow instead of green
    warning: '\x1b[38;5;214m',                      // Standard orange
    error: '\x1b[38;5;196m',                        // Standard red
    highlight: '\x1b[1m\x1b[38;5;178m',             // Bold Dark Yellow
  },
  
  // Market Analytics - Orange
  marketAnalytics: {
    tag: '\x1b[1m\x1b[38;5;208m',                   // Orange (208)
    header: '\x1b[1m\x1b[38;5;208m\x1b[48;5;236m',  // Orange on dark gray
    info: '\x1b[38;5;208m',                         // Regular Orange
    success: '\x1b[38;5;208m',                      // Orange instead of green
    warning: '\x1b[38;5;214m',                      // Standard orange
    error: '\x1b[38;5;196m',                        // Standard red
    highlight: '\x1b[1m\x1b[38;5;208m',             // Bold Orange
  },
  
  // =============================================================
  // 5. RUST/PLUM FAMILY - Admin & Infrastructure
  // =============================================================
  
  // Parent Service - Vibrant turquoise with background (Special color for AI Service)
  aiService: {
    tag: '\x1b[1m\x1b[38;5;43m',                    // Turquoise (43)
    header: '\x1b[1m\x1b[38;5;232m\x1b[48;5;43m',   // Black on Turquoise background
    info: '\x1b[38;5;43m',                          // Regular Turquoise
    success: '\x1b[38;5;43m',                       // Turquoise instead of green
    warning: '\x1b[38;5;214m',                      // Standard orange
    error: '\x1b[38;5;196m',                        // Standard red
    highlight: '\x1b[1m\x1b[38;5;43m',              // Bold Turquoise
    ai: '\x1b[1m\x1b[38;5;232m\x1b[48;5;43m',       // Black on Turquoise for AI-specific messages
  },
  
  // Child Services - Plum and Slate variants
  adminTools: {
    tag: '\x1b[1m\x1b[38;5;96m',                    // Plum (96)
    header: '\x1b[1m\x1b[38;5;96m\x1b[48;5;236m',   // Plum on dark gray
    info: '\x1b[38;5;96m',                          // Regular Plum
    success: '\x1b[38;5;96m',                       // Plum instead of green
    warning: '\x1b[38;5;214m',                      // Standard orange
    error: '\x1b[38;5;196m',                        // Standard red
    highlight: '\x1b[1m\x1b[38;5;96m',              // Bold Plum
  },
  
  discord: {
    tag: '\x1b[1m\x1b[38;5;102m',                   // Slate Gray (102)
    header: '\x1b[1m\x1b[38;5;102m\x1b[48;5;236m',  // Slate Gray on dark gray
    info: '\x1b[38;5;102m',                         // Regular Slate Gray
    success: '\x1b[38;5;102m',                      // Slate Gray instead of green
    warning: '\x1b[38;5;214m',                      // Standard orange
    error: '\x1b[38;5;196m',                        // Standard red
    highlight: '\x1b[1m\x1b[38;5;102m',             // Bold Slate Gray
  },
  
  // Legacy service - keeping for backward compatibility
  ddcomment: {
    tag: '\x1b[1m\x1b[38;5;102m',                   // Slate Gray (102) - matching discord
    header: '\x1b[1m\x1b[38;5;102m\x1b[48;5;236m',  // Slate Gray on dark gray
    info: '\x1b[38;5;102m',                         // Regular Slate Gray
    success: '\x1b[38;5;102m',                      // Slate Gray instead of green
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