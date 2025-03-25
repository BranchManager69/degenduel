// config/config.js

/**
 * 2025-03-25: Good!
 */

import dotenv from 'dotenv';
dotenv.config();

// Helpful DegenDuel API endpoints
const LOBBY_API = process.env.LOBBY_API; // future
const REFLECTIONS_API = process.env.REFLECTIONS_API; // future
const DD_SERV_API = process.env.DD_SERV_API; // deprecating
const DATA_API = process.env.DATA_API; // deprecating
const GAME_API = process.env.GAME_API; // deprecating
// Fallback API in case data service is unavailable
const LOCAL_FALLBACK_API = null; // (DISABLED to avoid circular dependency issue during startup)
////const LOCAL_PORT = process.env.PORT || process.env.API_PORT || 3004;

// Solana RPCs
// -- Default RPC URL:
const RPC_URL = process.env.SOLANA_RPC_URL;
// -- All Helius URLs:
const RPC_URL_MAINNET_HTTP = process.env.SOLANA_RPC_URL;
const RPC_URL_MAINNET_WSS = process.env.SOLANA_WSS_URL || '';
const RPC_URL_DEVNET_HTTP = process.env.SOLANA_DEVNET_RPC_URL;
const RPC_URL_DEVNET_WSS = process.env.SOLANA_DEVNET_WSS_URL || '';

// Throw error if no RPC URL is configured
if (!RPC_URL) {
  throw new Error('RPC_URL_MAINNET_HTTP must be set (use of public Solana RPC endpoints has been intentionally disabled)');
}

// Master config object
const config = {
  // RPC URLs:
  rpc_urls: {
    primary: RPC_URL,
    mainnet_http: RPC_URL_MAINNET_HTTP,
    mainnet_wss: RPC_URL_MAINNET_WSS,
    devnet_http: RPC_URL_DEVNET_HTTP,
    devnet_wss: RPC_URL_DEVNET_WSS,
  },
  // Some master wallet stuff:
  master_wallet: {
    address: process.env.DD_MASTER_WALLET,
    min_contest_wallet_balance: 0.01 // SOL
  },
  // Internal transaction types:
  transaction_types: {
    PRIZE_PAYOUT: 'PRIZE_PAYOUT',
    CONTEST_WALLET_RAKE: 'CONTEST_WALLET_RAKE',
    CONTEST_ENTRY: 'CONTEST_ENTRY',
    TOKEN_PURCHASE: 'TOKEN_PURCHASE',
    TOKEN_SALE: 'TOKEN_SALE',
    WITHDRAWAL: 'WITHDRAWAL',
    DEPOSIT: 'DEPOSIT'
  },
  // Internal transaction statuses:
  transaction_statuses: {
    PENDING: 'pending',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled'
  },
  // DegenDuel server port:
  port: process.env.PORT || process.env.API_PORT || 3004,
  // JWT secret:
  jwt: {
    secret: process.env.JWT_SECRET
  },
  // DD API URLs:
  api_urls: {
    dd_serv: DD_SERV_API,
    data: DATA_API,
    game: GAME_API,
    lobby: LOBBY_API,
    reflections: REFLECTIONS_API,
    fallback: LOCAL_FALLBACK_API,
  },
  // Debug modes:
  debug_mode: process.env.DD_API_DEBUG_MODE || 'false',
  debug_modes: {
    auth: process.env.DD_API_DEBUG_MODE || 'false',
    api: process.env.DD_API_DEBUG_MODE || 'false',
    middleware: process.env.DD_API_DEBUG_MODE || 'false',
  },
  // Logging settings:
  logging: {
    verbose: process.env.VERBOSE_LOGGING === 'true' || false,
    request_logging: process.env.REQUEST_LOGGING === 'true' || true,
  },
  // Logtail config:
  logtail: {
    token: process.env.LOGTAIL_TOKEN,
    endpoint: process.env.LOGTAIL_ENDPOINT,
    source: process.env.LOGTAIL_SOURCE,
    log_dir: process.env.LOG_DIR,
    silent_mode: process.env.SILENT_MODE === 'true' || false,
    console_log_level: process.env.CONSOLE_LOG_LEVEL || 'info',
    file_log_level: process.env.FILE_LOG_LEVEL || 'info',
  },
  // DegenDuel treasury wallet:
  degenduel_treasury_wallet: process.env.TREASURY_WALLET_ADDRESS,
  // Token submission cost:
  token_submission_cost: process.env.TOKEN_SUBMISSION_COST,
  // Token submission discount percentage per level:
  token_submission_discount_percentage_per_level: process.env.TOKEN_SUBMISSION_DISCOUNT_PERCENTAGE_PER_LEVEL,
  
  // Helper function to get environment:
  getEnvironment: (origin) => {
    // First check if we're explicitly in development mode based on NODE_ENV
    if (process.env.NODE_ENV === 'development') {
      return 'development';
    }
    // Otherwise check origin, but still respect NODE_ENV if it exists
    if (!origin) {
      return process.env.NODE_ENV || 'production'; // Default to production if NODE_ENV not set
    }
    return origin.includes('localhost') || origin.includes('127.0.0.1') ? 'development' : 'production';
  },

  // Device authentication settings:
  device_auth_enabled: 
    process.env.DEVICE_AUTH_ENABLED === 'true' || false,
  device_auth: {
    max_devices_per_user: parseInt(process.env.MAX_DEVICES_PER_USER || '10'),
    auto_authorize_first_device: process.env.AUTO_AUTHORIZE_FIRST_DEVICE === 'true' || true
  },
};

// Validate Solana config
export const validateSolanaConfig = () => {
    const required = {
        WALLET_ENCRYPTION_KEY: process.env.WALLET_ENCRYPTION_KEY,
        SOLANA_MAINNET_HTTP: process.env.SOLANA_MAINNET_HTTP,
        SOLANA_MAINNET_WSS: process.env.SOLANA_MAINNET_WSS,
    };

    // Check for missing required config:
    const missing = Object.entries(required)
        .filter(([key, value]) => !value)
        .map(([key]) => key);

    // Throw error if missing required config:
    if (missing.length > 0) {
        throw new Error(`Missing required Solana configuration: ${missing.join(', ')}`);
    }

    // Validate WALLET_ENCRYPTION_KEY format
    if (!/^[a-f0-9]{64}$/i.test(process.env.WALLET_ENCRYPTION_KEY)) {
        throw new Error('WALLET_ENCRYPTION_KEY must be a 64-character hex string');
    }
};

// Export config
export { config };
export default config;