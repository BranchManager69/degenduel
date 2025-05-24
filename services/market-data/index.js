// services/market-data/index.js

/**
 * Market Data Service Module
 * 
 * Provides centralized access to the Market Data Service functionality.
 * This exports the main service instance along with utility components.
 * 
 * @module market-data
 */

// Import the main service instance
import marketDataService from './marketDataService.js';

// Import utility components for internal use
import marketDataRankTracker from './marketDataRankTracker.js';
import marketDataBatchProcessor from './marketDataBatchProcessor.js';
import marketDataAnalytics from './marketDataAnalytics.js';
import marketDataEnricher from './marketDataEnricher.js';
import marketDataRepository from './marketDataRepository.js';

// Export the main service instance as default (this is what service-initializer expects)
export default marketDataService;

// Also export utility components as named exports for internal use
export {
    marketDataService,
    marketDataRankTracker,
    marketDataBatchProcessor,
    marketDataAnalytics,
    marketDataEnricher,
    marketDataRepository
};

