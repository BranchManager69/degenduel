/**
 * Standard error types for DegenDuel services
 */
export const ServiceErrorTypes = {
    INITIALIZATION: 'INITIALIZATION_ERROR',
    OPERATION: 'OPERATION_ERROR',
    VALIDATION: 'VALIDATION_ERROR',
    NETWORK: 'NETWORK_ERROR',
    DATABASE: 'DATABASE_ERROR',
    BLOCKCHAIN: 'BLOCKCHAIN_ERROR',
    CONFIGURATION: 'CONFIGURATION_ERROR',
    AUTHENTICATION: 'AUTHENTICATION_ERROR',
    RATE_LIMIT: 'RATE_LIMIT_ERROR',
    CIRCUIT_BREAKER: 'CIRCUIT_BREAKER_ERROR',
    SERVICE_DISABLED: 'SERVICE_DISABLED'
};

/**
 * Standard error class for DegenDuel services
 */
export class ServiceError extends Error {
    constructor(type, message, details = {}) {
        super(message);
        this.name = 'ServiceError';
        this.type = type;
        this.details = details;
        this.timestamp = new Date();
        this.isServiceError = true;

        // Ensure we capture the stack trace
        Error.captureStackTrace(this, ServiceError);
    }

    /**
     * Create an initialization error
     */
    static initialization(message, details = {}) {
        return new ServiceError(ServiceErrorTypes.INITIALIZATION, message, details);
    }

    /**
     * Create an operation error
     */
    static operation(message, details = {}) {
        return new ServiceError(ServiceErrorTypes.OPERATION, message, details);
    }

    /**
     * Create a validation error
     */
    static validation(message, details = {}) {
        return new ServiceError(ServiceErrorTypes.VALIDATION, message, details);
    }

    /**
     * Create a network error
     */
    static network(message, details = {}) {
        return new ServiceError(ServiceErrorTypes.NETWORK, message, details);
    }

    /**
     * Create a database error
     */
    static database(message, details = {}) {
        return new ServiceError(ServiceErrorTypes.DATABASE, message, details);
    }

    /**
     * Create a blockchain error
     */
    static blockchain(message, details = {}) {
        return new ServiceError(ServiceErrorTypes.BLOCKCHAIN, message, details);
    }

    /**
     * Create a configuration error
     */
    static configuration(message, details = {}) {
        return new ServiceError(ServiceErrorTypes.CONFIGURATION, message, details);
    }

    /**
     * Create an authentication error
     */
    static authentication(message, details = {}) {
        return new ServiceError(ServiceErrorTypes.AUTHENTICATION, message, details);
    }

    /**
     * Create a rate limit error
     */
    static rateLimit(message, details = {}) {
        return new ServiceError(ServiceErrorTypes.RATE_LIMIT, message, details);
    }

    /**
     * Create a circuit breaker error
     */
    static circuitBreaker(message, details = {}) {
        return new ServiceError(ServiceErrorTypes.CIRCUIT_BREAKER, message, details);
    }

    /**
     * Create a service disabled error
     */
    static serviceDisabled(serviceName, details = {}) {
        return new ServiceError(
            ServiceErrorTypes.SERVICE_DISABLED,
            `Service ${serviceName} is disabled via dashboard`,
            details
        );
    }

    /**
     * Convert error to a loggable format
     */
    toLog() {
        return {
            name: this.name,
            type: this.type,
            message: this.message,
            details: this.details,
            timestamp: this.timestamp,
            stack: this.stack
        };
    }
} 