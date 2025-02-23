# DegenDuel Base Service Architecture

## Overview

This document outlines the foundational architecture patterns and implementation standards for all DegenDuel services. It serves as the primary reference for service development, modernization, and maintenance.

## Base Service Implementation

### BaseService Class
```javascript
class BaseService {
    constructor(name, config) {
        this.name = name;
        this.config = {
            ...DEFAULT_CONFIG,
            ...config
        };
        
        this.stats = {
            operations: {
                total: 0,
                successful: 0,
                failed: 0
            },
            performance: {
                averageOperationTimeMs: 0,
                lastOperationTimeMs: 0
            },
            circuitBreaker: {
                failures: 0,
                lastFailure: null,
                lastSuccess: null,
                lastReset: null,
                isOpen: false
            }
        };
    }

    async initialize() {}
    async start() {}
    async stop() {}
    async performOperation() {}
}
```

### Standard Configuration
```javascript
const DEFAULT_CONFIG = {
    checkIntervalMs: 5000,
    maxRetries: 3,
    retryDelayMs: 5000,
    circuitBreaker: {
        failureThreshold: 5,
        resetTimeoutMs: 30000,
        minHealthyPeriodMs: 60000
    },
    backoff: {
        initialDelayMs: 1000,
        maxDelayMs: 30000,
        factor: 2
    }
}
```

## Service Registry

### Implementation
```javascript
class ServiceRegistry {
    constructor() {
        this.services = new Map();
        this.dependencies = new Map();
    }

    register(service, dependencies = []) {
        this.services.set(service.name, service);
        this.dependencies.set(service.name, dependencies);
    }

    async initializeAll() {
        const order = this.resolveDependencies();
        for (const serviceName of order) {
            await this.services.get(serviceName).initialize();
        }
    }
}
```

### Usage
```javascript
const registry = new ServiceRegistry();

registry.register(tokenSyncService, []);
registry.register(contestService, ['token_sync_service']);
registry.register(walletService, ['contest_service']);
```

## Circuit Breaker Pattern

### Implementation
```javascript
class CircuitBreaker {
    constructor(config) {
        this.config = config;
        this.failures = 0;
        this.lastFailure = null;
        this.isOpen = false;
    }

    async execute(operation) {
        if (this.isOpen) {
            if (this.shouldAttemptReset()) {
                return this.attemptOperation(operation);
            }
            throw new Error('Circuit breaker is open');
        }
        return this.attemptOperation(operation);
    }
}
```

### States
1. **Closed (Normal)**
   - Service operates normally
   - Failures are counted
   - Success resets count

2. **Open (Protected)**
   - Operations blocked
   - Timeout-based recovery
   - Automatic reset attempt

3. **Half-Open (Recovery)**
   - Limited operations
   - Success restores service
   - Failure returns to open

## Admin Logging System

### Implementation
```javascript
class AdminLogger {
    static async logAction(adminAddress, action, details, context) {
        await prisma.admin_logs.create({
            data: {
                admin_address: adminAddress,
                action: action,
                details: details,
                context: context,
                timestamp: new Date()
            }
        });
    }

    static Actions = {
        CONTEST: {
            START: 'CONTEST_START',
            END: 'CONTEST_END',
            CANCEL: 'CONTEST_CANCEL'
        },
        SERVICE: {
            START: 'SERVICE_START',
            STOP: 'SERVICE_STOP',
            CONFIGURE: 'SERVICE_CONFIGURE'
        }
    }
}
```

### Usage
```javascript
await AdminLogger.logAction(
    adminAddress,
    AdminLogger.Actions.SERVICE.START,
    {
        service_name: 'contest_evaluation',
        config: serviceConfig
    },
    context
);
```

## Service Modernization Status

### Completed ✅
- Token Sync Service
- Contest Evaluation Service
- Wallet Rake Service
- Admin Wallet Service
- Referral Service
- Contest Wallet Service

### In Progress 🔄
- Vanity Wallet Service (Needs modern architecture update)

### Pending ⏳
- DD-Serv Service (Future modernization planned)

## Implementation Standards

### 1. Error Handling
```javascript
class ServiceError extends Error {
    constructor(type, message, details = {}) {
        super(message);
        this.type = type;
        this.details = details;
        this.isServiceError = true;
    }

    static operation(message, details) {
        return new ServiceError('OPERATION', message, details);
    }

    static validation(message, details) {
        return new ServiceError('VALIDATION', message, details);
    }
}
```

### 2. State Management
```javascript
{
    operations: {
        total: 0,
        successful: 0,
        failed: 0
    },
    performance: {
        averageOperationTimeMs: 0,
        lastOperationTimeMs: 0
    },
    circuitBreaker: {
        failures: 0,
        lastFailure: null,
        lastSuccess: null,
        lastReset: null,
        isOpen: false
    },
    history: {
        lastStarted: null,
        lastStopped: null,
        lastError: null
    }
}
```

### 3. Configuration Management
```javascript
class ConfigManager {
    static validate(config, schema) {
        // Configuration validation
    }

    static merge(base, override) {
        // Deep merge with validation
    }
}
```

## Future Enhancements

### 1. Service Discovery
- Dynamic registration
- Load balancing
- Health-based routing

### 2. Enhanced Monitoring
- Metrics aggregation
- Performance analysis
- Trend detection

### 3. Advanced Recovery
- State reconciliation
- Automatic failover
- Data consistency checks

---

*Last Updated: February 2024*
*Contact: DegenDuel Platform Team* 