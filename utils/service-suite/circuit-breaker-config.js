// utils/service-suite/circuit-breaker-config.js

/* 
 * This file is responsible for configuring the circuit breaker for each service.
 * It is used to configure the circuit breaker for each service.
 */

// Circuit breaker configuration and utilities
import { SERVICE_NAMES, DEFAULT_CIRCUIT_BREAKER_CONFIG, getServiceMetadata } from './service-constants.js';

// Service-specific configurations
export const SERVICE_SPECIFIC_CONFIGS = {
    // Data Layer Services
    [SERVICE_NAMES.TOKEN_SYNC]: {
        failureThreshold: 4,
        resetTimeoutMs: 45000,
        description: getServiceMetadata(SERVICE_NAMES.TOKEN_SYNC).description,
        reason: 'Handles external API calls, needs balanced error tolerance'
    },
    [SERVICE_NAMES.MARKET_DATA]: {
        failureThreshold: 5,          // Increased from 3 to be more tolerant
        resetTimeoutMs: 60000,        // Increased from 30000 to give more recovery time
        minHealthyPeriodMs: 120000,   // Increased from 60000 to ensure stability
        description: getServiceMetadata(SERVICE_NAMES.MARKET_DATA).description,
        reason: 'Critical for real-time trading operations, balanced with stability'
    },
    [SERVICE_NAMES.TOKEN_WHITELIST]: {
        failureThreshold: 5,
        resetTimeoutMs: 60000,
        description: getServiceMetadata(SERVICE_NAMES.TOKEN_WHITELIST).description,
        reason: 'Standard tolerance, non-critical real-time operations'
    },

    // Contest Layer Services
    [SERVICE_NAMES.CONTEST_EVALUATION]: {
        failureThreshold: 10, // More tolerant of failures
        resetTimeoutMs: 120000, // Longer recovery time
        minHealthyPeriodMs: 180000, // Longer health confirmation
        description: getServiceMetadata(SERVICE_NAMES.CONTEST_EVALUATION).description,
        reason: 'Handles critical financial operations, needs high stability'
    },
    [SERVICE_NAMES.ACHIEVEMENT]: {
        failureThreshold: 6,
        resetTimeoutMs: 70000,
        description: getServiceMetadata(SERVICE_NAMES.ACHIEVEMENT).description,
        reason: 'Non-critical service, moderate error tolerance'
    },
    [SERVICE_NAMES.REFERRAL]: {
        failureThreshold: 5,
        resetTimeoutMs: 60000,
        description: getServiceMetadata(SERVICE_NAMES.REFERRAL).description,
        reason: 'Standard configuration, balanced recovery'
    },

    // Wallet Layer Services
    [SERVICE_NAMES.CONTEST_WALLET]: {
        failureThreshold: 8,
        resetTimeoutMs: 90000,
        description: getServiceMetadata(SERVICE_NAMES.CONTEST_WALLET).description,
        reason: 'Handles financial operations, needs higher stability'
    },
    [SERVICE_NAMES.WALLET_RAKE]: {
        failureThreshold: 8,
        resetTimeoutMs: 90000,
        description: getServiceMetadata(SERVICE_NAMES.WALLET_RAKE).description,
        reason: 'Handles fund collection, needs careful error handling'
    },
    [SERVICE_NAMES.ADMIN_WALLET]: {
        failureThreshold: 7,
        resetTimeoutMs: 80000,
        description: getServiceMetadata(SERVICE_NAMES.ADMIN_WALLET).description,
        reason: 'Critical admin operations, needs high reliability'
    },

    // Infrastructure Layer Services
    [SERVICE_NAMES.FAUCET]: {
        failureThreshold: 6,
        resetTimeoutMs: 75000,
        description: getServiceMetadata(SERVICE_NAMES.FAUCET).description,
        reason: 'Test environment service, moderate tolerance'
    },
    [SERVICE_NAMES.WALLET_GENERATOR]: {
        failureThreshold: 5,
        resetTimeoutMs: 60000,
        description: getServiceMetadata(SERVICE_NAMES.WALLET_GENERATOR).description,
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