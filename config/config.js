// config/config.js

/**
 * 
 * Some good, some bad
 * 
 */

import dotenv from 'dotenv';
dotenv.config();

// Helpful DegenDuel API endpoints:
const DD_SERV_API = 'https://degenduel.me/api/dd-serv/tokens'; // deprecated
const DATA_API = 'https://data.degenduel.me/api'; // deprecated
const GAME_API = 'https://game.degenduel.me'; // deprecated
const LOBBY_API = 'https://lobby.degenduel.me'; // future
const REFLECTIONS_API = 'https://reflections.degenduel.me'; // future
// Fallback API for when data service is unavailable
const LOCAL_PORT = process.env.PORT || process.env.API_PORT || 3004;
const LOCAL_FALLBACK_API = null; // Disabling local fallback during startup to avoid circular dependency

// Helpful Solana RPC URLs:
const RPC_URL_MAINNET_HTTP = process.env.QUICKNODE_MAINNET_HTTP;
const RPC_URL_MAINNET_WSS = process.env.QUICKNODE_MAINNET_WSS || '';
const RPC_URL_DEVNET_HTTP = process.env.QUICKNODE_DEVNET_HTTP;
const RPC_URL_DEVNET_WSS = process.env.QUICKNODE_DEVNET_WSS || '';
const RPC_URL = RPC_URL_MAINNET_HTTP;

// Force an error if RPC URL is not configured
if (!RPC_URL) {
  throw new Error('QUICKNODE_MAINNET_HTTP environment variable must be set - cannot default to public Solana RPC endpoint');
}

const config = {
  rpc_urls: {
    primary: RPC_URL,
    mainnet_http: RPC_URL_MAINNET_HTTP,
    mainnet_wss: RPC_URL_MAINNET_WSS,
    devnet_http: RPC_URL_DEVNET_HTTP,
    devnet_wss: RPC_URL_DEVNET_WSS,
  },
  master_wallet: {
    address: process.env.DD_MASTER_WALLET,
    min_contest_wallet_balance: 0.01 // SOL
  },
  transaction_types: {
    PRIZE_PAYOUT: 'PRIZE_PAYOUT',
    CONTEST_WALLET_RAKE: 'CONTEST_WALLET_RAKE',
    CONTEST_ENTRY: 'CONTEST_ENTRY',
    TOKEN_PURCHASE: 'TOKEN_PURCHASE',
    TOKEN_SALE: 'TOKEN_SALE',
    WITHDRAWAL: 'WITHDRAWAL',
    DEPOSIT: 'DEPOSIT'
  },
  transaction_statuses: {
    PENDING: 'pending',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled'
  },
  port: process.env.PORT || process.env.API_PORT || 3004,
  jwt: {
    secret: process.env.JWT_SECRET
  },
  api_urls: {
    dd_serv: DD_SERV_API,
    data: DATA_API,
    game: GAME_API,
    lobby: LOBBY_API,
    reflections: REFLECTIONS_API,
    fallback: LOCAL_FALLBACK_API,
  },
  debug_mode: process.env.DD_API_DEBUG_MODE || 'false',
  debug_modes: {
    auth: process.env.DD_API_DEBUG_MODE || 'false',
    api: process.env.DD_API_DEBUG_MODE || 'false',
    middleware: process.env.DD_API_DEBUG_MODE || 'false',
  },
  logging: {
    verbose: process.env.VERBOSE_LOGGING === 'true' || false,
    request_logging: process.env.REQUEST_LOGGING === 'true' || true,
  },
  degenduel_treasury_wallet: process.env.TREASURY_WALLET_ADDRESS,
  token_submission_cost: process.env.TOKEN_SUBMISSION_COST,
  token_submission_discount_percentage_per_level: process.env.TOKEN_SUBMISSION_DISCOUNT_PERCENTAGE_PER_LEVEL,
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
  // Device authentication settings
  device_auth_enabled: process.env.DEVICE_AUTH_ENABLED === 'true' || false,
  device_auth: {
    max_devices_per_user: parseInt(process.env.MAX_DEVICES_PER_USER || '10'),
    auto_authorize_first_device: process.env.AUTO_AUTHORIZE_FIRST_DEVICE === 'true' || true
  },
};

export const validateSolanaConfig = () => {
    const required = {
        WALLET_ENCRYPTION_KEY: process.env.WALLET_ENCRYPTION_KEY,
        QUICKNODE_MAINNET_HTTP: process.env.QUICKNODE_MAINNET_HTTP,
        QUICKNODE_MAINNET_WSS: process.env.QUICKNODE_MAINNET_WSS,
    };

    const missing = Object.entries(required)
        .filter(([key, value]) => !value)
        .map(([key]) => key);

    if (missing.length > 0) {
        throw new Error(`Missing required Solana configuration: ${missing.join(', ')}`);
    }

    // Validate WALLET_ENCRYPTION_KEY format
    if (!/^[a-f0-9]{64}$/i.test(process.env.WALLET_ENCRYPTION_KEY)) {
        throw new Error('WALLET_ENCRYPTION_KEY must be a 64-character hex string');
    }
};

export { config };
export default config;