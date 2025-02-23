/**
 * Service name constants and configurations
 * This file serves as the single source of truth for service names
 */

export const SERVICE_NAMES = {
    // Data Services
    TOKEN_SYNC: 'token_sync_service',
    MARKET_DATA: 'market_data_service',
    TOKEN_WHITELIST: 'token_whitelist_service',

    // Contest Services
    CONTEST_EVALUATION: 'contest_evaluation_service',
    ACHIEVEMENT: 'achievement_service',
    REFERRAL: 'referral_service',

    // Wallet Services
    CONTEST_WALLET: 'contest_wallet_service',
    VANITY_WALLET: 'vanity_wallet_service',
    WALLET_RAKE: 'wallet_rake_service',
    ADMIN_WALLET: 'admin_wallet_service'
};

export const SERVICE_LAYERS = {
    DATA: 'data_layer',
    CONTEST: 'contest_layer',
    WALLET: 'wallet_layer'
};

export const SERVICE_METADATA = {
    [SERVICE_NAMES.TOKEN_SYNC]: {
        layer: SERVICE_LAYERS.DATA,
        description: 'External token data synchronization',
        updateFrequency: '30s'
    },
    [SERVICE_NAMES.MARKET_DATA]: {
        layer: SERVICE_LAYERS.DATA,
        description: 'Internal market data provider',
        updateFrequency: '100ms'
    },
    [SERVICE_NAMES.TOKEN_WHITELIST]: {
        layer: SERVICE_LAYERS.DATA,
        description: 'Token whitelist management',
        updateFrequency: 'on demand'
    },
    [SERVICE_NAMES.CONTEST_EVALUATION]: {
        layer: SERVICE_LAYERS.CONTEST,
        description: 'Contest lifecycle and evaluation',
        updateFrequency: 'on demand'
    },
    [SERVICE_NAMES.ACHIEVEMENT]: {
        layer: SERVICE_LAYERS.CONTEST,
        description: 'User achievement tracking',
        updateFrequency: 'on demand'
    },
    [SERVICE_NAMES.REFERRAL]: {
        layer: SERVICE_LAYERS.CONTEST,
        description: 'Referral program management',
        updateFrequency: '5m'
    },
    [SERVICE_NAMES.CONTEST_WALLET]: {
        layer: SERVICE_LAYERS.WALLET,
        description: 'Contest wallet management',
        updateFrequency: 'on demand'
    },
    [SERVICE_NAMES.VANITY_WALLET]: {
        layer: SERVICE_LAYERS.WALLET,
        description: 'Vanity wallet pool management',
        updateFrequency: 'continuous'
    },
    [SERVICE_NAMES.WALLET_RAKE]: {
        layer: SERVICE_LAYERS.WALLET,
        description: 'Post-contest fund collection',
        updateFrequency: '10m'
    },
    [SERVICE_NAMES.ADMIN_WALLET]: {
        layer: SERVICE_LAYERS.WALLET,
        description: 'Administrative wallet operations',
        updateFrequency: 'on demand'
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

export default {
    SERVICE_NAMES,
    SERVICE_LAYERS,
    SERVICE_METADATA,
    getServiceMetadata,
    getServiceLayer,
    getServicesInLayer,
    validateServiceName
}; 