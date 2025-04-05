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

// Connection endpoints
export const RPC_ENDPOINTS = {
  DEFAULT: process.env.DEFAULT_RPC_URL || "https://api.mainnet-beta.solana.com",
  HELIUS: process.env.HELIUS_RPC_URL || "https://mainnet.helius-rpc.com/?api-key=8fd1a2cd-76e7-4462-b38b-1026960edd40",
  JITO: process.env.JITO_RPC_URL || "https://jito-mainnet-rpc-url" 
};

// Default options
export const DEFAULT_OPTIONS = {
  priorityFee: 1000000, // 0.001 SOL in lamports
  maxRetries: 3,
  confirmationTarget: "processed",
  useJito: false,
  simulate: true
};
