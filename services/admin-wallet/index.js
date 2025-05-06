// services/admin-wallet/index.js

/**
 * Admin Wallet Service Entry Point
 * 
 * @description Exports the main Admin Wallet Service singleton and its constituent modules.
 *              The service and modules have been updated to use the Solana Web3.js v2
 *              compatibility layer.
 * 
 * @module admin-wallet
 * @author BranchManager69
 * @version 2.0.0 // Reflects migration update
 * @created 2025-05-05 // Assuming creation date for this structure update
 * @updated 2025-05-05
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