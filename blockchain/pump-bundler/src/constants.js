/**
 * Constants for Pump.fun bundler
 */

export const PUMP_FUN_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
export const PUMP_FUN_ACCOUNT = "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1";
export const GLOBAL = "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf";

// Pump.swap program
export const PUMP_SWAP_PROGRAM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";

// Transaction modes
export const TX_MODE = {
  SIMULATE: "simulate",
  EXECUTE: "execute",
  BUNDLE: "bundle"
};

// Connection endpoints - load API keys from environment
export const RPC_ENDPOINTS = {
  DEFAULT: process.env.PUMP_BUNDLER_RPC_URL || process.env.SOLANA_RPC_ENDPOINT || "https://api.mainnet-beta.solana.com",
  // Always load Helius API key from environment
  HELIUS: process.env.HELIUS_RPC_URL || process.env.SOLANA_MAINNET_HTTP || 
          (process.env.HELIUS_API_KEY ? 
           `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}` :
           "https://api.mainnet-beta.solana.com"), // Fallback to public RPC if no API key
  JITO: process.env.JITO_RPC_URL || "https://jito-mainnet-rpc-url",
  WS: process.env.PUMP_BUNDLER_WS_URL || process.env.SOLANA_MAINNET_WSS || "wss://api.mainnet-beta.solana.com",
  GRPC: process.env.PUMP_BUNDLER_GRPC_URL || "http://localhost:10000/"
};

// Default options
export const DEFAULT_OPTIONS = {
  priorityFee: 1000000, // 0.001 SOL in lamports
  maxRetries: 3,
  confirmationTarget: "processed",
  useJito: false,
  simulate: true
};
