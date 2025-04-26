// services/market-data/index.js

/**
 * Market Data Service Module
 * 
 * Provides centralized access to the Market Data Service functionality.
 * This modernized version uses a modular architecture for better maintainability.
 * 
 * @module market-data
 */

import marketDataRankTracker from './marketDataRankTracker.js';
import marketDataBatchProcessor from './marketDataBatchProcessor.js';
import marketDataAnalytics from './marketDataAnalytics.js';
import marketDataEnricher from './marketDataEnricher.js';
import marketDataRepository from './marketDataRepository.js';

export {
    marketDataRankTracker,
    marketDataBatchProcessor,
    marketDataAnalytics,
    marketDataEnricher,
    marketDataRepository
};

// Re-export individual components for easy access
export default {
    rankTracker: marketDataRankTracker,
    batchProcessor: marketDataBatchProcessor,
    analytics: marketDataAnalytics,
    enricher: marketDataEnricher,
    repository: marketDataRepository
};