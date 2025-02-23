// Circuit breaker configuration and utilities

export const DEFAULT_CIRCUIT_BREAKER_CONFIG = {
    enabled: true,
    failureThreshold: 5,
    resetTimeoutMs: 60000, // 1 minute
    minHealthyPeriodMs: 120000, // 2 minutes
    monitoringWindowMs: 300000, // 5 minutes
    healthCheckIntervalMs: 30000, // 30 seconds
};

export const SERVICE_SPECIFIC_CONFIGS = {
    market_data_service: {
        failureThreshold: 3, // More sensitive to failures
        resetTimeoutMs: 30000, // Faster recovery for market data
    },
    contest_evaluation_service: {
        failureThreshold: 10, // More tolerant of failures
        resetTimeoutMs: 120000, // Longer recovery time
    },
    // Add other service-specific configurations as needed
};

export function getCircuitBreakerConfig(serviceName) {
    return {
        ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
        ...(SERVICE_SPECIFIC_CONFIGS[serviceName] || {})
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

    if (isOpen) return false;
    if (failures >= DEFAULT_CIRCUIT_BREAKER_CONFIG.failureThreshold) return false;
    
    // Check if we're in a recovery period
    if (lastFailure) {
        const timeSinceFailure = Date.now() - new Date(lastFailure).getTime();
        if (timeSinceFailure < DEFAULT_CIRCUIT_BREAKER_CONFIG.resetTimeoutMs) {
            return false;
        }
    }

    return true;
}

export function shouldReset(stats, config = DEFAULT_CIRCUIT_BREAKER_CONFIG) {
    if (!stats?.circuitBreaker?.isOpen) return false;
    if (!stats.circuitBreaker.lastFailure) return true;

    const timeSinceFailure = Date.now() - new Date(stats.circuitBreaker.lastFailure).getTime();
    return timeSinceFailure >= config.resetTimeoutMs;
} 