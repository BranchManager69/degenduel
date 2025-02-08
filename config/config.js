// config/config.js

import dotenv from 'dotenv';
dotenv.config();

// helpful DegenDuel API endpoints:
const DD_SERV_API = 'https://degenduel.me/api/dd-serv/tokens';
const DATA_API = 'https://data.degenduel.me/api';
const GAME_API = 'https://game.degenduel.me';

// helpful Solana RPC URLs:
const RPC_URL_MAINNET_HTTP = process.env.QUICKNODE_MAINNET_HTTP || 'https://api.mainnet-beta.solana.com';
const RPC_URL_MAINNET_WSS = process.env.QUICKNODE_MAINNET_WSS || '';
const RPC_URL_DEVNET_HTTP = process.env.QUICKNODE_DEVNET_HTTP || 'https://api.devnet.solana.com';
const RPC_URL_DEVNET_WSS = process.env.QUICKNODE_DEVNET_WSS || '';
const RPC_URL = RPC_URL_MAINNET_HTTP;

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
  },
  debug_mode: process.env.DD_API_DEBUG_MODE || 'false',
  debug_modes: {
    auth: process.env.DD_API_DEBUG_MODE || 'false',
    api: process.env.DD_API_DEBUG_MODE || 'false',
    middleware: process.env.DD_API_DEBUG_MODE || 'false',
    ////token_sync: process.env.DD_API_DEBUG_MODE || 'false',
    ////market_data: process.env.DD_API_DEBUG_MODE || 'false',
    ////leaderboard: process.env.DD_API_DEBUG_MODE || 'false',
    ////admin: process.env.DD_API_DEBUG_MODE || 'false',
    /////maintenance: process.env.DD_API_DEBUG_MODE || 'false',
  },
  getEnvironment: (origin) => {
    if (!origin) return 'production'; // direct API calls default to prod
    return origin.includes('localhost') || origin.includes('127.0.0.1') ? 'development' : 'production';
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