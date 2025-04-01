// services/new-market-data/index.js

/**
 * SolanaEngine Service
 * 
 * This service provides a comprehensive integration with Solana premium APIs:
 * - Helius for blockchain data, token metadata, and wallet interactions
 * - Jupiter for market data, prices, and trading operations
 * 
 * It replaces the legacy tokenSyncService and marketDataService
 * with a more powerful, centralized engine for all Solana operations.
 */

import { heliusClient } from './helius-client.js';
import { jupiterClient } from './jupiter-client.js';
import { solanaEngine } from './solana-engine.js';

export {
  heliusClient,
  jupiterClient,
  solanaEngine
};

export default solanaEngine;