// services/admin-wallet/index.js

/**
 * Admin Wallet Service Entry Point
 * 
 * @description Exports the main Admin Wallet Service singleton and its constituent modules.
 *              The service has been migrated to support Solana Web3.js v2.x through a
 *              compatibility layer that maintains backward compatibility.
 * 
 * @migration Phase 1: Implementation of compatibility layer (solana-compat.js)
 *           - All modules now use the compatibility layer for Web3.js operations
 *           - Original API signatures remain unchanged for backward compatibility
 *           - Future Phase 2 will involve direct usage of native v2 APIs
 *
 * @see ./utils/solana-compat.js - Compatibility utilities bridging v1.x and v2.x APIs
 * 
 * @module admin-wallet
 * @author BranchManager69
 * @version 1.5.0 // Reflects Phase 1 migration with compatibility layer
 * @created 2023-05-01
 * @updated 2023-12-12
 */

import adminWalletService from './admin-wallet-service.js';
import walletCrypto from './modules/wallet-crypto.js';
import walletTransactions from './modules/wallet-transactions.js';
import batchOperations from './modules/batch-operations.js';
import walletBalance from './modules/wallet-balance.js';

// Export the main service singleton as default
export default adminWalletService;

// Export individual modules (now using v2 compatibility layer)
export {
  adminWalletService, // The main service instance
  walletCrypto,       // Encryption/decryption and keypair functions
  walletTransactions, // Single SOL/token transfer logic
  batchOperations,    // Mass transfer orchestration
  walletBalance       // Balance fetching and checking logic
};