// utils/service-suite/service-constants.js

/**
 * Service Constants
 * @description Centralized constants for service names, layers, metadata, and configurations.
 * 
 * NOTE: 
 * This is ideally used by all services.
 * However, due to technical debt, some services do not follow this standard.
 * 
 * NOTE:
 * If you begin to migrate a service to a true DegenDuel BaseService,
 * then you'd better DO IT RIGHT -- or DON'T FUCKING DO IT AT ALL!!!!!!!!!!!
 * [BECAUSE THE MESS I AM NOW SOLVING WILL NEVER BE ALLOWED TO HAPPEN AGAIN!!!!!!!!!]
 * 
 * @author BranchManager69
 * @version 1.9.1
 * @created 2025-04-10
 * @updated 2025-05-24
 */

// Default circuit breaker configuration
export const DEFAULT_CIRCUIT_BREAKER_CONFIG = {
    enabled: true, // Enabled by default
    failureThreshold: 5, // 5 failures
    resetTimeoutMs: 60 * 1000, // 1 minute
    minHealthyPeriodMs: 2 * 60 * 1000, // 2 minutes
    monitoringWindowMs: 5 * 60 * 1000, // 5 minutes
    healthCheckIntervalMs: 30 * 1000, // 30 seconds
    maxRecoveryAttempts: 3, // 3 attempts
    backoffMultiplier: 2 // 2x backoff for each attempt
};

export const SERVICE_NAMES = {
    // Data Layer Services
    // TOKEN_SYNC has been permanently removed - not needed
    // TOKEN_WHITELIST is deprecated - using token.is_active flag from db instead
    MARKET_DATA: 'market_data_service', // Market Data service
    TOKEN_REFRESH_SCHEDULER: 'token_refresh_scheduler', // Token Refresh Scheduler service
    TOKEN_DEX_DATA: 'token_dex_data_service', // DexScreener token data service
    TOKEN_DETECTION: 'token_detection_service', // New token detection service
    TOKEN_ENRICHMENT: 'token_enrichment_service', // New token enrichment service
    TOKEN_ACTIVATION: 'token_activation_service', // Token Activation service
    JUPITER_CLIENT: 'jupiter_client', // Jupiter API client (???)

    // Contest Layer Services
    CONTEST_EVALUATION: 'contest_evaluation_service', // Contest Evaluation service
    CONTEST_SCHEDULER: 'ContestSchedulerService', // Contest Scheduler service
    PORTFOLIO_SNAPSHOT: 'portfolio_snapshot_service', // Portfolio Snapshot service
    ACHIEVEMENT: 'achievement_service', // Achievement service
    REFERRAL: 'referral_service', // Referral service
    LEVELING: 'leveling_service', // Leveling service

    // Wallet Layer Services
    CONTEST_WALLET: 'contest_wallet_service', // Contest Wallet service
    //WALLET_RAKE: 'wallet_rake_service', // deprecated - not needed
    ADMIN_WALLET: 'admin_wallet_service', // Admin Wallet service
    USER_BALANCE_TRACKING: 'user_balance_tracking_service', // User Balance Tracking service
    VANITY_WALLET: 'vanity_wallet_service', // Vanity Wallet service
    //// WALLET_SERVICE: 'wallet_service', // deprecated - wtf even is a "wallet service" lmao?
    //// WALLET_GENERATOR: 'wallet_generator_service', // deprecated - replaced by other services

    // Infrastructure Layer Services
    LIQUIDITY: 'liquidity_service',
    // WALLET_GENERATOR: 'wallet_generator_service', // REMOVED - was over-engineered and barely used
    //SOLANA: 'solana_service', // New Solana service
    SOLANA_ENGINE: 'solana_engine_service', // Solana Engine service
    SYSTEM_SETTINGS: 'system_settings_service', // New System Settings service
    AI_SERVICE: 'ai_service', // AI Analysis and Processing Service
    DIALECT: 'dialect_service', // Dialect integration service (Blinks)

    // Notification Services
    NOTIFICATION: 'notification_service', // General notification service
    DISCORD_NOTIFICATION: 'discord_notification_service', // Discord integration service
    DISCORD_INTERACTIVE: 'discord_interactive_service', // Discord interactive service
    LAUNCH_EVENT: 'LaunchEventService', // Added new service name
};

export const SERVICE_LAYERS = {
    DATA: 'data_layer',
    CONTEST: 'contest_layer',
    WALLET: 'wallet_layer',
    INFRASTRUCTURE: 'infrastructure_layer',
};

export const SERVICE_VERBOSITY = {
    SILENT: 'silent',
    LOW: 'low',
    NORMAL: 'normal',
    HIGH: 'high',
    DEBUG: 'debug'
};

export const SERVICE_CRITICALITY = {
    CRITICAL: 'critical',
    HIGH: 'high',
    MEDIUM: 'medium',
    LOW: 'low',
    DEBUG: 'debug'
};

export const SERVICE_METADATA = {
    // Data Layer Services
    
    // TOKEN_SYNC has been permanently removed
    
    [SERVICE_NAMES.MARKET_DATA]: {
        layer: SERVICE_LAYERS.DATA,
        description: 'Market price data aggregation',
        updateFrequency: '1m',
        criticalLevel: 'critical',
        dependencies: [SERVICE_NAMES.SOLANA_ENGINE]
    },
    [SERVICE_NAMES.TOKEN_REFRESH_SCHEDULER]: {
        layer: SERVICE_LAYERS.DATA,
        description: 'Advanced token refresh scheduling system',
        updateFrequency: '5s',
        criticalLevel: 'high',
        dependencies: [SERVICE_NAMES.MARKET_DATA, SERVICE_NAMES.SOLANA_ENGINE]
    },
    [SERVICE_NAMES.TOKEN_DEX_DATA]: {
        layer: SERVICE_LAYERS.DATA,
        description: 'Token DEX pool data management',
        updateFrequency: '15m',
        criticalLevel: 'medium',
        dependencies: [SERVICE_NAMES.SOLANA_ENGINE]
    },
    [SERVICE_NAMES.TOKEN_DETECTION]: {
        layer: SERVICE_LAYERS.DATA,
        description: 'Efficient detection of new tokens',
        updateFrequency: '30s',
        criticalLevel: 'medium',
        dependencies: [SERVICE_NAMES.SOLANA_ENGINE]
    },
    [SERVICE_NAMES.TOKEN_ENRICHMENT]: {
        layer: SERVICE_LAYERS.DATA,
        description: 'Token metadata and price enrichment',
        updateFrequency: '1m',
        criticalLevel: 'medium',
        dependencies: [SERVICE_NAMES.TOKEN_DETECTION, SERVICE_NAMES.SOLANA_ENGINE]
    },
    [SERVICE_NAMES.JUPITER_CLIENT]: {
        layer: SERVICE_LAYERS.DATA,
        description: 'Jupiter API client & Token Address Sync', // Updated description
        updateFrequency: 'dynamic', // Syncs daily, prices on demand
        criticalLevel: SERVICE_CRITICALITY.MEDIUM,
        dependencies: [] // More self-contained now
    },
    [SERVICE_NAMES.TOKEN_WHITELIST]: {
        layer: SERVICE_LAYERS.DATA,
        description: 'Token whitelist management [DEPRECATED - using token.is_active flag instead]',
        updateFrequency: '1h',
        criticalLevel: 'low',
        dependencies: []
    },
    [SERVICE_NAMES.TOKEN_ACTIVATION]: { // <-- ADDED METADATA FOR NEW SERVICE
        layer: SERVICE_LAYERS.DATA,
        description: 'Manages the active status of tokens based on dynamic criteria.',
        updateFrequency: '15m', // Default, configurable by its internal interval
        criticalLevel: SERVICE_CRITICALITY.MEDIUM,
        dependencies: [SERVICE_NAMES.JUPITER_CLIENT] // Needs Jupiter for metrics
    },

    // Contest Layer Services
    [SERVICE_NAMES.CONTEST_EVALUATION]: {
        layer: SERVICE_LAYERS.CONTEST,
        description: 'Contest evaluation and scoring',
        updateFrequency: '1m',
        criticalLevel: 'critical',
        dependencies: [SERVICE_NAMES.MARKET_DATA]
    },
    [SERVICE_NAMES.CONTEST_SCHEDULER]: {
        layer: SERVICE_LAYERS.CONTEST,
        description: 'Automatic contest creation and scheduling',
        updateFrequency: '1h',
        criticalLevel: 'medium',
        dependencies: [] // REMOVED dependency on WALLET_GENERATOR since that service was deleted
    },
    [SERVICE_NAMES.ACHIEVEMENT]: {
        layer: SERVICE_LAYERS.CONTEST,
        description: 'User achievement tracking',
        updateFrequency: '5m',
        criticalLevel: 'low',
        dependencies: [SERVICE_NAMES.CONTEST_EVALUATION]
    },
    [SERVICE_NAMES.REFERRAL]: {
        layer: SERVICE_LAYERS.CONTEST,
        description: 'Referral program management',
        updateFrequency: '10m',
        criticalLevel: 'medium',
        dependencies: [SERVICE_NAMES.CONTEST_EVALUATION]
    },
    [SERVICE_NAMES.LEVELING]: {
        layer: SERVICE_LAYERS.CONTEST,
        description: 'User XP and level progression management',
        updateFrequency: '5m',
        criticalLevel: 'medium',
        dependencies: [SERVICE_NAMES.ACHIEVEMENT]
    },
    [SERVICE_NAMES.PORTFOLIO_SNAPSHOT]: {
        layer: SERVICE_LAYERS.CONTEST, // Runs alongside other contest logic
        description: 'Periodically snapshots participant portfolio values for historical charting.',
        updateFrequency: '15s', // Configurable via constructor
        criticalLevel: 'medium', // Important for charts, but API still works without it
        dependencies: [
            SERVICE_NAMES.MARKET_DATA, // Needs current prices
            SERVICE_NAMES.CONTEST_EVALUATION // Implicitly needs active contest info
        ]
    },

    // Wallet Layer Services
    [SERVICE_NAMES.CONTEST_WALLET]: {
        layer: SERVICE_LAYERS.WALLET,
        description: 'Contest wallet management',
        updateFrequency: 'on demand',
        criticalLevel: 'critical',
        dependencies: [] // Removing hard dependency on CONTEST_EVALUATION
    },
    /* REMOVED: WALLET_RAKE service was deleted
    [SERVICE_NAMES.WALLET_RAKE]: {
        layer: SERVICE_LAYERS.WALLET,
        description: 'Post-contest fund collection',
        updateFrequency: '10m',
        criticalLevel: 'high',
        dependencies: [SERVICE_NAMES.CONTEST_WALLET]
    },
    */
    [SERVICE_NAMES.ADMIN_WALLET]: {
        layer: SERVICE_LAYERS.WALLET,
        description: 'Administrative wallet operations',
        updateFrequency: 'on demand',
        criticalLevel: 'critical',
        dependencies: [SERVICE_NAMES.CONTEST_WALLET]
    },
    [SERVICE_NAMES.USER_BALANCE_TRACKING]: {
        layer: SERVICE_LAYERS.WALLET,
        description: 'Track user Solana wallet balances (polling or WebSocket)',
        updateFrequency: 'varies',
        criticalLevel: 'low',
        dependencies: [SERVICE_NAMES.SOLANA_ENGINE]
    },
    [SERVICE_NAMES.VANITY_WALLET]: {
        layer: SERVICE_LAYERS.WALLET,
        description: 'Vanity wallet generation and management',
        updateFrequency: '5m',
        criticalLevel: 'low',
        dependencies: []
    },

    // Infrastructure Layer Services
    [SERVICE_NAMES.LIQUIDITY]: {
        layer: SERVICE_LAYERS.INFRASTRUCTURE,
        description: 'Test user SOL distribution and recovery',
        updateFrequency: '1h',
        criticalLevel: 'medium',
        dependencies: [] // REMOVED dependency on WALLET_GENERATOR since that service was deleted
    },
    /* REMOVED: WALLET_GENERATOR service was deleted
    [SERVICE_NAMES.WALLET_GENERATOR]: {
        layer: SERVICE_LAYERS.INFRASTRUCTURE,
        description: 'Wallet generation and encryption',
        updateFrequency: '5m',
        criticalLevel: 'high',
        dependencies: []
    },
    */
    
    /* REMOVED: SOLANA service was deleted and replaced with SolanaEngine
    [SERVICE_NAMES.SOLANA]: {
        layer: SERVICE_LAYERS.INFRASTRUCTURE,
        description: 'Solana blockchain connectivity service',
        updateFrequency: '30s',
        criticalLevel: 'critical',
        dependencies: []
    },
    */

    // Solana Engine service metadata
    [SERVICE_NAMES.SOLANA_ENGINE]: {
        layer: SERVICE_LAYERS.INFRASTRUCTURE,
        description: 'Advanced Solana blockchain integration service',
        updateFrequency: '30s',
        criticalLevel: 'critical',
        dependencies: []
    },

    // AI Service metadata
    [SERVICE_NAMES.AI_SERVICE]: {
        layer: SERVICE_LAYERS.INFRASTRUCTURE,
        description: 'AI Analysis and Processing Service',
        updateFrequency: '10m',
        criticalLevel: 'medium',
        dependencies: []
    },

    // New System Settings service metadata (what???)
    [SERVICE_NAMES.SYSTEM_SETTINGS]: {
        layer: SERVICE_LAYERS.INFRASTRUCTURE,
        description: 'System settings management',
        updateFrequency: '1m',
        criticalLevel: 'medium',
        dependencies: []
    },

    // Notification services metadata (what??? This is NOT Discord Notification Service but rather *another* notification service? Hmm...)
    [SERVICE_NAMES.NOTIFICATION]: {
        layer: SERVICE_LAYERS.INFRASTRUCTURE,
        description: 'User notification service',
        updateFrequency: '1m',
        criticalLevel: 'medium',
        dependencies: []
    },
    
    // Discord notification service metadata
    [SERVICE_NAMES.DISCORD_NOTIFICATION]: {
        layer: SERVICE_LAYERS.INFRASTRUCTURE,
        description: 'Discord webhook integration service',
        updateFrequency: 'event-based',
        criticalLevel: 'low',
        dependencies: []
    },

    // Discord interactive service metadata
    [SERVICE_NAMES.DISCORD_INTERACTIVE]: {
        layer: SERVICE_LAYERS.INFRASTRUCTURE,
        description: 'Interactive Discord bot integration',
        updateFrequency: 'event-based',
        criticalLevel: 'low',
        dependencies: []
    },

    // Dialect service metadata
    [SERVICE_NAMES.DIALECT]: {
        layer: SERVICE_LAYERS.INFRASTRUCTURE,
        description: 'Integration for Blinks (Solana Actions)',
        updateFrequency: 'on demand',
        criticalLevel: 'medium',
        dependencies: [SERVICE_NAMES.SOLANA_ENGINE]
    },

    // Launch Event service metadata
    [SERVICE_NAMES.LAUNCH_EVENT]: { // Added metadata for LaunchEventService
        layer: SERVICE_LAYERS.INFRASTRUCTURE, // Placing in Infrastructure layer
        description: 'Monitors countdown and triggers launch events via WebSocket.',
        updateFrequency: '10s', // Based on default checkIntervalMs
        criticalLevel: 'high', // Important for the launch event
        dependencies: [] // No hard dependencies defined yet
    }

    // (likely missing a handful of services)  
    //
    // Any new services should be added here
    //
};


/* Helper functions */

// Get a service's metadata
/**
 * Get the metadata for a given service name
 * 
 * @param {string} serviceName - The name of the service to get metadata for
 * @returns {Object} The metadata for the service
 */
export function getServiceMetadata(serviceName) {
    return SERVICE_METADATA[serviceName];
}

// Get a service layer
/**
 * Get the layer for a given service name
 * 
 * @param {string} serviceName - The name of the service to get the layer for
 * @returns {string} The layer for the service
 */ 
export function getServiceLayer(serviceName) {
    return SERVICE_METADATA[serviceName]?.layer;
}

// Get the services of a layer
/**
 * Get all services in a given layer
 * 
 * @param {string} layer - The layer to get services for
 * @returns {Array} The services in the layer
 */
export function getServicesInLayer(layer) {
    return Object.entries(SERVICE_METADATA)
        .filter(([_, metadata]) => metadata.layer === layer)
        .map(([serviceName]) => serviceName);
}

// Validate a service name
/**
 * Validate if a given service name exists in the SERVICE_NAMES object
 * 
 * @param {string} serviceName - The name of the service to validate
 * @returns {boolean} True if the service name exists, false otherwise
 */
export function validateServiceName(serviceName) {
    if (serviceName === undefined || serviceName === null) return false;
    return Object.values(SERVICE_NAMES).includes(serviceName);
}

// Get service dependencies
/**
 * Get the dependencies for a given service name
 * 
 * @param {string} serviceName - The name of the service to get dependencies for
 * @returns {Array} The dependencies for the service
 */
export function getServiceDependencies(serviceName) {
    return SERVICE_METADATA[serviceName]?.dependencies || [];
}

// Get service critical level
/**
 * Get the critical level for a given service name
 * 
 * @param {string} serviceName - The name of the service to get the critical level for
 * @returns {string} The critical level for the service
 */
export function getServiceCriticalLevel(serviceName) {
    return SERVICE_METADATA[serviceName]?.criticalLevel || 'medium';
}

// Validate dependency chain
/**
 * Validate if the dependency chain for a given service name is valid
 * 
 * @param {string} serviceName - The name of the service to validate the dependency chain for
 * @returns {boolean} True if the dependency chain is valid, false otherwise
 */
export function validateDependencyChain(serviceName) {
    const visited = new Set();
    const recursionStack = new Set();

    // Helper function to check for recursive cycles
    function hasCycle(service) {
        visited.add(service);
        recursionStack.add(service);

        // Get the dependencies of the service
        const dependencies = getServiceDependencies(service);
        for (const dep of dependencies) {
            if (!visited.has(dep)) {
                // If the dependency hasn't been visited, check for cycles
                if (hasCycle(dep)) return true;
            } else if (recursionStack.has(dep)) {
                // If the dependency is already in the recursion stack, we have a cycle
                return true;
            }
        }

        // Remove the service from the recursion stack
        recursionStack.delete(service);
        return false;
    }

    // Check for cycles
    return !hasCycle(serviceName);
}

// Export the constants
export default {
    SERVICE_NAMES,
    SERVICE_LAYERS,
    SERVICE_METADATA,
    getServiceMetadata,
    getServiceLayer,
    getServicesInLayer,
    validateServiceName,
    getServiceDependencies,
    getServiceCriticalLevel,
    validateDependencyChain
}; 