// utils/service-suite/service-constants.js

/**
 * Service name constants and configurations
 * This file serves as the single source of truth for service names
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
    // TOKEN_SYNC has been permanently removed
    // TOKEN_WHITELIST is deprecated - using token.is_active flag instead
    MARKET_DATA: 'market_data_service',
    TOKEN_WHITELIST: 'token_whitelist_service', // Kept for backwards compatibility
    TOKEN_REFRESH_SCHEDULER: 'token_refresh_scheduler_service', // Advanced token refresh scheduler
    TOKEN_DEX_DATA: 'token_dex_data_service', // DEX pool data service

    // Contest Layer Services
    CONTEST_EVALUATION: 'contest_evaluation_service',
    CONTEST_SCHEDULER: 'contest_scheduler_service', // New Contest Scheduler service
    ACHIEVEMENT: 'achievement_service',
    REFERRAL: 'referral_service',
    LEVELING: 'leveling_service',

    // Wallet Layer Services
    CONTEST_WALLET: 'contest_wallet_service',
    WALLET_RAKE: 'wallet_rake_service',
    ADMIN_WALLET: 'admin_wallet_service',
    USER_BALANCE_TRACKING: 'user_balance_tracking_service',
    VANITY_WALLET: 'vanity_wallet_service', // New Vanity Wallet service
    //// WALLET_SERVICE: 'wallet_service',
    //// WALLET_GENERATOR: 'wallet_generator_service',

    // Infrastructure Layer Services
    LIQUIDITY: 'liquidity_service',
    WALLET_GENERATOR: 'wallet_generator_service',
    SOLANA: 'solana_service', // New Solana service
    SOLANA_ENGINE: 'solana_engine_service', // Solana Engine service
    SYSTEM_SETTINGS: 'system_settings_service', // New System Settings service
    AI_SERVICE: 'ai_service', // AI Analysis and Processing Service
    
    // Notification Services
    DISCORD_NOTIFICATION: 'discord_notification_service', // Discord integration service
    NOTIFICATION: 'notification_service', // General notification service
};

export const SERVICE_LAYERS = {
    DATA: 'data_layer',
    CONTEST: 'contest_layer',
    WALLET: 'wallet_layer',
    INFRASTRUCTURE: 'infrastructure_layer',
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
    [SERVICE_NAMES.TOKEN_WHITELIST]: {
        layer: SERVICE_LAYERS.DATA,
        description: 'Token whitelist management [DEPRECATED - using token.is_active flag instead]',
        updateFrequency: '1h',
        criticalLevel: 'low',
        dependencies: []
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
        dependencies: [SERVICE_NAMES.WALLET_GENERATOR]
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

    // Wallet Layer Services
    [SERVICE_NAMES.CONTEST_WALLET]: {
        layer: SERVICE_LAYERS.WALLET,
        description: 'Contest wallet management',
        updateFrequency: 'on demand',
        criticalLevel: 'critical',
        dependencies: [] // Removing hard dependency on CONTEST_EVALUATION
    },
    [SERVICE_NAMES.WALLET_RAKE]: {
        layer: SERVICE_LAYERS.WALLET,
        description: 'Post-contest fund collection',
        updateFrequency: '10m',
        criticalLevel: 'high',
        dependencies: [SERVICE_NAMES.CONTEST_WALLET]
    },
    [SERVICE_NAMES.ADMIN_WALLET]: {
        layer: SERVICE_LAYERS.WALLET,
        description: 'Administrative wallet operations',
        updateFrequency: 'on demand',
        criticalLevel: 'critical',
        dependencies: [SERVICE_NAMES.CONTEST_WALLET]
    },
    [SERVICE_NAMES.USER_BALANCE_TRACKING]: {
        layer: SERVICE_LAYERS.WALLET,
        description: 'Track user Solana wallet balances',
        updateFrequency: '1m',
        criticalLevel: 'low',
        dependencies: []
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
        dependencies: [SERVICE_NAMES.WALLET_GENERATOR]
    },
    [SERVICE_NAMES.WALLET_GENERATOR]: {
        layer: SERVICE_LAYERS.INFRASTRUCTURE,
        description: 'Wallet generation and encryption',
        updateFrequency: '5m',
        criticalLevel: 'high',
        dependencies: []
    },
    
    // New Solana service metadata
    [SERVICE_NAMES.SOLANA]: {
        layer: SERVICE_LAYERS.INFRASTRUCTURE,
        description: 'Solana blockchain connectivity service',
        updateFrequency: '30s',
        criticalLevel: 'critical',
        dependencies: []
    },
    
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

    // New System Settings service metadata
    [SERVICE_NAMES.SYSTEM_SETTINGS]: {
        layer: SERVICE_LAYERS.INFRASTRUCTURE,
        description: 'System settings management',
    },

    // Notification services metadata
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

};


/* Helper functions */

// Get service metadata
/**
 * Get the metadata for a given service name
 * 
 * @param {string} serviceName - The name of the service to get metadata for
 * @returns {Object} The metadata for the service
 */
export function getServiceMetadata(serviceName) {
    return SERVICE_METADATA[serviceName];
}

// Get service layer
/**
 * Get the layer for a given service name
 * 
 * @param {string} serviceName - The name of the service to get the layer for
 * @returns {string} The layer for the service
 */ 
export function getServiceLayer(serviceName) {
    return SERVICE_METADATA[serviceName]?.layer;
}

// Get services in a layer
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

// Validate service name
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

    function hasCycle(service) {
        visited.add(service);
        recursionStack.add(service);

        const dependencies = getServiceDependencies(service);
        for (const dep of dependencies) {
            if (!visited.has(dep)) {
                if (hasCycle(dep)) return true;
            } else if (recursionStack.has(dep)) {
                return true;
            }
        }

        recursionStack.delete(service);
        return false;
    }

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