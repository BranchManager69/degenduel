/**
 * Service name constants and configurations
 * This file serves as the single source of truth for service names
 */

// Default circuit breaker configuration
export const DEFAULT_CIRCUIT_BREAKER_CONFIG = {
    enabled: true,
    failureThreshold: 5,
    resetTimeoutMs: 60000, // 1 minute
    minHealthyPeriodMs: 120000, // 2 minutes
    monitoringWindowMs: 300000, // 5 minutes
    healthCheckIntervalMs: 30000, // 30 seconds
    maxRecoveryAttempts: 3,
    backoffMultiplier: 2
};

export const SERVICE_NAMES = {
    // Data Layer Services
    TOKEN_SYNC: 'token_sync_service',
    MARKET_DATA: 'market_data_service',
    TOKEN_WHITELIST: 'token_whitelist_service',

    // Contest Layer Services
    CONTEST_EVALUATION: 'contest_evaluation_service',
    ACHIEVEMENT: 'achievement_service',
    REFERRAL: 'referral_service',
    LEVELING: 'leveling_service',

    // Wallet Layer Services
    CONTEST_WALLET: 'contest_wallet_service',
    WALLET_RAKE: 'wallet_rake_service',
    ADMIN_WALLET: 'admin_wallet_service',

    // Infrastructure Layer Services
    LIQUIDITY: 'liquidity_service',
    WALLET_GENERATOR: 'wallet_generator_service'
};

export const SERVICE_LAYERS = {
    DATA: 'data_layer',
    CONTEST: 'contest_layer',
    WALLET: 'wallet_layer',
    INFRASTRUCTURE: 'infrastructure_layer',
    ////AUTH: 'auth_layer'
};

export const SERVICE_METADATA = {
    // Data Layer Services
    [SERVICE_NAMES.TOKEN_SYNC]: {
        layer: SERVICE_LAYERS.DATA,
        description: 'Token balance synchronization',
        updateFrequency: '5m',
        criticalLevel: 'high',
        dependencies: []
    },
    [SERVICE_NAMES.MARKET_DATA]: {
        layer: SERVICE_LAYERS.DATA,
        description: 'Market price data aggregation',
        updateFrequency: '1m',
        criticalLevel: 'critical',
        dependencies: [SERVICE_NAMES.TOKEN_SYNC]
    },
    [SERVICE_NAMES.TOKEN_WHITELIST]: {
        layer: SERVICE_LAYERS.DATA,
        description: 'Token whitelist management',
        updateFrequency: '1h',
        criticalLevel: 'medium',
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
        dependencies: [SERVICE_NAMES.CONTEST_EVALUATION]
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
    }
};

// Helper functions
export function getServiceMetadata(serviceName) {
    return SERVICE_METADATA[serviceName];
}

export function getServiceLayer(serviceName) {
    return SERVICE_METADATA[serviceName]?.layer;
}

export function getServicesInLayer(layer) {
    return Object.entries(SERVICE_METADATA)
        .filter(([_, metadata]) => metadata.layer === layer)
        .map(([serviceName]) => serviceName);
}

export function validateServiceName(serviceName) {
    return Object.values(SERVICE_NAMES).includes(serviceName);
}

export function getServiceDependencies(serviceName) {
    return SERVICE_METADATA[serviceName]?.dependencies || [];
}

export function getServiceCriticalLevel(serviceName) {
    return SERVICE_METADATA[serviceName]?.criticalLevel || 'medium';
}

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