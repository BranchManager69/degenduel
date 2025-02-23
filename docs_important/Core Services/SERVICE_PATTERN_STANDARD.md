# DegenDuel Service Pattern Standard

## Overview

This document outlines the standard pattern that all DegenDuel services must follow. This pattern ensures consistency, reliability, and maintainability across the platform's service layer.

## Service Structure

### 1. File Organization
```javascript
// Service file header with description
/*
 * Service description and responsibility
 */

// Import groups (in order)
// 1. Service Auth
import { generateServiceAuthHeader } from '../config/service-auth.js';

// 2. Service Base Classes
import { BaseService } from '../utils/service-suite/base-service.js';
import { ServiceError } from '../utils/service-suite/service-error.js';

// 3. Core Dependencies
import { config } from '../config/config.js';
import { logApi } from '../utils/logger-suite/logger.js';
import AdminLogger from '../utils/admin-logger.js';
import prisma from '../config/prisma.js';

// 4. Service Manager
import { ServiceManager } from '../utils/service-suite/service-manager.js';
import { SERVICE_NAMES, getServiceMetadata } from '../utils/service-suite/service-constants.js';

// 5. Additional Dependencies (domain-specific)
```

### 2. Configuration Standard
```javascript
const SERVICE_CONFIG = {
    name: SERVICE_NAMES.SERVICE_NAME,
    description: getServiceMetadata(SERVICE_NAMES.SERVICE_NAME).description,
    checkIntervalMs: number,  // How often the service performs its operation
    maxRetries: number,       // Maximum retry attempts for operations
    retryDelayMs: number,     // Delay between retries
    circuitBreaker: {
        failureThreshold: number,    // Failures before circuit opens
        resetTimeoutMs: number,      // Time before reset attempt
        minHealthyPeriodMs: number   // Time required healthy before full reset
    },
    backoff: {
        initialDelayMs: number,
        maxDelayMs: number,
        factor: number
    }
};
```

### 3. Service Class Structure
```javascript
class ServiceName extends BaseService {
    constructor() {
        super(SERVICE_CONFIG.name, SERVICE_CONFIG);
        
        // Service-specific state
        this.serviceStats = {
            operations: {
                total: 0,
                successful: 0,
                failed: 0
            },
            performance: {
                average_operation_time_ms: 0,
                last_operation_time_ms: 0
            },
            // Service-specific metrics
            domain_specific: {
                // Domain-specific stats
            }
        };
    }

    // Required Methods
    async initialize()
    async performOperation()
    async stop()
}
```

## Required Method Implementations

### 1. Initialize Method
```javascript
async initialize() {
    try {
        // Call parent initialize
        await super.initialize();
        
        // Load configuration from database
        const settings = await prisma.system_settings.findUnique({
            where: { key: this.name }
        });

        if (settings?.value) {
            const dbConfig = typeof settings.value === 'string' 
                ? JSON.parse(settings.value)
                : settings.value;

            // Merge configs
            this.config = {
                ...this.config,
                ...dbConfig,
                circuitBreaker: {
                    ...this.config.circuitBreaker,
                    ...(dbConfig.circuitBreaker || {})
                }
            };
        }

        // Register with ServiceManager
        const serializableStats = JSON.parse(JSON.stringify(this.stats));
        await ServiceManager.markServiceStarted(
            this.name,
            JSON.parse(JSON.stringify(this.config)),
            serializableStats
        );

        return true;
    } catch (error) {
        await this.handleError('initialize', error);
        throw error;
    }
}
```

### 2. Perform Operation Method
```javascript
async performOperation() {
    const startTime = Date.now();
    
    try {
        // Perform service-specific operations
        const result = await this.performServiceOperation();
        
        // Update performance metrics
        this.updatePerformanceMetrics(startTime);

        // Update ServiceManager state
        await ServiceManager.updateServiceHeartbeat(
            this.name,
            this.config,
            {
                ...this.stats,
                serviceStats: this.serviceStats
            }
        );

        return result;
    } catch (error) {
        // Let base class handle circuit breaker
        throw error;
    }
}
```

### 3. Stop Method
```javascript
async stop() {
    try {
        await super.stop();
        // Perform service-specific cleanup
        await this.cleanup();
    } catch (error) {
        logApi.error(`Error stopping ${this.name}:`, error);
        throw error;
    }
}
```

## Error Handling

### 1. Service Errors
Use the `ServiceError` class for all errors:
```javascript
throw ServiceError.validation('Invalid input');
throw ServiceError.operation('Operation failed');
throw ServiceError.network('Network error');
```

### 2. Error Propagation
- Let the base class handle circuit breaker logic
- Log errors appropriately
- Include relevant context in error details

## State Management

### 1. Stats Structure
```javascript
{
    operations: {
        total: number,
        successful: number,
        failed: number
    },
    performance: {
        average_operation_time_ms: number,
        last_operation_time_ms: number
    },
    domain_specific: {
        // Service-specific metrics
    }
}
```

### 2. State Updates
- Update stats after each operation
- Ensure stats are JSON-serializable
- Keep ServiceManager in sync

## Service Registration

Services must be registered with dependencies in `ServiceManager`:
```javascript
ServiceManager.register(serviceName, dependencies);
```

## Best Practices

1. **Configuration**
   - Use constants for configuration
   - Allow runtime configuration updates
   - Validate configuration changes

2. **Performance**
   - Track operation timing
   - Use appropriate intervals
   - Implement backoff strategies

3. **Monitoring**
   - Log significant events
   - Track meaningful metrics
   - Use appropriate log levels

4. **Security**
   - Validate inputs
   - Handle sensitive data appropriately
   - Use service authentication

5. **Testing**
   - Unit test core functionality
   - Test error scenarios
   - Validate state management

## Example Implementation

See `AchievementService` for a reference implementation of this pattern.

## Migration Guide

When updating existing services:
1. Update imports to match standard order
2. Implement required methods
3. Add ServiceManager integration
4. Update error handling
5. Add proper state management
6. Update configuration format
7. Add proper logging

## Validation

Services can be validated against this standard using the service validation tool (TODO). 