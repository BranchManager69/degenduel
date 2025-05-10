// services/solana-engine/index.js

/**
 * SolanaEngine Service
 * 
 * This service provides a comprehensive integration with Solana premium APIs:
 * - Helius for blockchain data, token metadata, and wallet interactions
 * - Jupiter for market data, prices, and trading operations
 * - Helius balance tracker for real-time wallet balance tracking
 * - Helius pool tracker for real-time liquidity pool monitoring
 * 
 * It replaces the legacy tokenSyncService and marketDataService
 * with a more powerful, centralized engine for all Solana operations.
 */

import { heliusClient } from './helius-client.js';
import { jupiterClient, getJupiterClient } from './jupiter-client.js';
import { solanaEngine } from './solana-engine.js';
import { heliusBalanceTracker } from './helius-balance-tracker.js';
import { heliusPoolTracker } from './helius-pool-tracker.js';

export {
  heliusClient,
  jupiterClient,
  getJupiterClient, // only one with a getter? why?
  solanaEngine,
  heliusBalanceTracker,
  heliusPoolTracker
};

export default solanaEngine;