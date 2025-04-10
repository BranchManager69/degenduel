// services/admin-wallet/index.js

/**
 * Admin Wallet Service
 * 
 * This service manages administrative wallets for platform operations.
 * It handles secure wallet management, SOL/token transfers, and batch operations.
 * 
 * This implementation uses SolanaEngine directly for improved RPC performance
 * with multi-endpoint support and automatic failover.
 */

import adminWalletService from './admin-wallet-service.js';
import walletCrypto from './modules/wallet-crypto.js';
import walletTransactions from './modules/wallet-transactions.js';
import batchOperations from './modules/batch-operations.js';
import walletBalance from './modules/wallet-balance.js';

// Export the main service as default
export default adminWalletService;

// Export individual modules for direct use when needed
export {
  adminWalletService,
  walletCrypto,
  walletTransactions,
  batchOperations,
  walletBalance
};