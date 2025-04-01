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

export { adminWalletService };
export default adminWalletService;