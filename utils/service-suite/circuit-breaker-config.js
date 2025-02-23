// Circuit breaker configuration and utilities

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

// Service-specific configurations
export const SERVICE_SPECIFIC_CONFIGS = {
    // Data Layer Services
    [SERVICE_NAMES.TOKEN_SYNC]: {
        failureThreshold: 4,
        resetTimeoutMs: 45000,
        description: 'Token sync service with moderate recovery speed',
        reason: 'Handles external API calls, needs balanced error tolerance'
    },
    [SERVICE_NAMES.MARKET_DATA]: {
        failureThreshold: 3, // More sensitive to failures
        resetTimeoutMs: 30000, // Faster recovery for market data
        minHealthyPeriodMs: 60000, // Shorter health confirmation period
        description: 'Real-time market data service requires faster recovery',
        reason: 'Critical for real-time trading operations'
    },
    [SERVICE_NAMES.TOKEN_WHITELIST]: {
        failureThreshold: 5,
        resetTimeoutMs: 60000,
        description: 'Token whitelist management service',
        reason: 'Standard tolerance, non-critical real-time operations'
    },

    // Contest Layer Services
    [SERVICE_NAMES.CONTEST_EVALUATION]: {
        failureThreshold: 10, // More tolerant of failures
        resetTimeoutMs: 120000, // Longer recovery time
        minHealthyPeriodMs: 180000, // Longer health confirmation
        description: 'Contest evaluation requires careful recovery',
        reason: 'Handles critical financial operations, needs high stability'
    },
    [SERVICE_NAMES.ACHIEVEMENT]: {
        failureThreshold: 6,
        resetTimeoutMs: 70000,
        description: 'Achievement tracking service',
        reason: 'Non-critical service, moderate error tolerance'
    },
    [SERVICE_NAMES.REFERRAL]: {
        failureThreshold: 5,
        resetTimeoutMs: 60000,
        description: 'Referral program management',
        reason: 'Standard configuration, balanced recovery'
    },

    // Wallet Layer Services
    [SERVICE_NAMES.CONTEST_WALLET]: {
        failureThreshold: 8,
        resetTimeoutMs: 90000,
        description: 'Contest wallet management service',
        reason: 'Handles financial operations, needs higher stability'
    },
    [SERVICE_NAMES.VANITY_WALLET]: {
        failureThreshold: 4,
        resetTimeoutMs: 45000,
        description: 'Vanity wallet pool management',
        reason: 'Quick recovery needed for wallet availability'
    },
    [SERVICE_NAMES.WALLET_RAKE]: {
        failureThreshold: 8,
        resetTimeoutMs: 90000,
        description: 'Wallet rake service with balanced recovery',
        reason: 'Handles fund collection, needs careful error handling'
    },
    [SERVICE_NAMES.ADMIN_WALLET]: {
        failureThreshold: 7,
        resetTimeoutMs: 80000,
        description: 'Administrative wallet operations',
        reason: 'Critical admin operations, needs high reliability'
    },

    // Infrastructure Layer Services
    [SERVICE_NAMES.FAUCET]: {
        failureThreshold: 6,
        resetTimeoutMs: 75000,
        description: 'Faucet service with standard recovery',
        reason: 'Test environment service, moderate tolerance'
    },
    [SERVICE_NAMES.WALLET_GENERATOR]: {
        failureThreshold: 5,
        resetTimeoutMs: 60000,
        description: 'Wallet generation service',
        reason: 'Core infrastructure, standard configuration'
    }
};

export function getCircuitBreakerConfig(serviceName) {
    const baseConfig = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG };
    const serviceConfig = SERVICE_SPECIFIC_CONFIGS[serviceName] || {};
    
    return {
        ...baseConfig,
        ...serviceConfig,
        // Always preserve these as they're critical
        enabled: true,
        monitoringWindowMs: baseConfig.monitoringWindowMs,
        healthCheckIntervalMs: baseConfig.healthCheckIntervalMs
    };
}

export function isHealthy(stats) {
    if (!stats?.circuitBreaker) return true;
    
    const {
        isOpen,
        failures,
        lastFailure,
        lastSuccess,
        recoveryAttempts
    } = stats.circuitBreaker;

    // Circuit is open
    if (isOpen) return false;

    // Too many failures
    if (failures >= DEFAULT_CIRCUIT_BREAKER_CONFIG.failureThreshold) return false;
    
    // In recovery period
    if (lastFailure) {
        const timeSinceFailure = Date.now() - new Date(lastFailure).getTime();
        if (timeSinceFailure < DEFAULT_CIRCUIT_BREAKER_CONFIG.resetTimeoutMs) {
            return false;
        }
    }

    // Check if we've had recent success
    if (lastSuccess) {
        const timeSinceSuccess = Date.now() - new Date(lastSuccess).getTime();
        return timeSinceSuccess < DEFAULT_CIRCUIT_BREAKER_CONFIG.monitoringWindowMs;
    }

    return true;
}

export function shouldReset(stats, config = DEFAULT_CIRCUIT_BREAKER_CONFIG) {
    if (!stats?.circuitBreaker?.isOpen) return false;
    if (!stats.circuitBreaker.lastFailure) return true;

    const timeSinceFailure = Date.now() - new Date(stats.circuitBreaker.lastFailure).getTime();
    
    // Basic timeout check
    if (timeSinceFailure < config.resetTimeoutMs) return false;
    
    // Check recovery attempts
    if (stats.circuitBreaker.recoveryAttempts >= config.maxRecoveryAttempts) {
        // Implement exponential backoff
        const backoffTime = config.resetTimeoutMs * Math.pow(
            config.backoffMultiplier, 
            stats.circuitBreaker.recoveryAttempts - config.maxRecoveryAttempts
        );
        return timeSinceFailure >= backoffTime;
    }

    return true;
}

export function calculateBackoffDelay(recoveryAttempts, config = DEFAULT_CIRCUIT_BREAKER_CONFIG) {
    return Math.min(
        config.resetTimeoutMs * Math.pow(config.backoffMultiplier, recoveryAttempts),
        config.monitoringWindowMs
    );
}

export function getCircuitBreakerStatus(stats) {
    if (!stats?.circuitBreaker) {
        return {
            status: 'unknown',
            details: 'No circuit breaker stats available'
        };
    }

    const {
        isOpen,
        failures,
        lastFailure,
        lastSuccess,
        recoveryAttempts
    } = stats.circuitBreaker;

    if (isOpen) {
        return {
            status: 'open',
            details: `Circuit open after ${failures} failures. Recovery attempts: ${recoveryAttempts}`,
            lastFailure,
            recoveryAttempts
        };
    }

    if (failures > 0) {
        return {
            status: 'degraded',
            details: `Service experiencing issues: ${failures} recent failures`,
            failures,
            lastFailure
        };
    }

    return {
        status: 'closed',
        details: 'Circuit breaker healthy',
        lastSuccess
    };
} 