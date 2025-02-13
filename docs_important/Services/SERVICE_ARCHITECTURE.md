# DegenDuel Service Architecture

## Overview

DegenDuel's backend is built on a robust service-oriented architecture that ensures reliability, maintainability, and scalability. Each service operates independently while maintaining consistent behavior patterns and error handling.

## Core Services

1. **Token Sync Service**
   - Manages token price and metadata synchronization
   - Handles market data integration
   - Circuit breaker protection for API failures

2. **Contest Evaluation Service**
   - Manages contest lifecycle
   - Handles prize distribution
   - Ensures fair play and accurate results

3. **Contest Wallet Service**
   - Manages contest-specific wallets
   - Handles secure key management
   - Integrates with blockchain operations

4. **Admin Wallet Service**
   - Manages administrative wallet operations
   - Handles secure fund transfers
   - Maintains transaction records

5. **Vanity Wallet Service**
   - Manages pool of vanity wallets
   - Handles wallet generation and assignment
   - Maintains wallet availability

6. **Wallet Rake Service**
   - Collects platform fees and leftover funds
   - Periodic wallet balance checks (10-minute intervals)
   - Safety mechanisms for minimum balances
   - Detailed operation tracking and statistics
   - Admin-triggered manual rake operations
   - Circuit breaker protection
   - Comprehensive transaction logging

7. **Referral Service**
   - Manages referral tracking
   - Handles reward distribution
   - Maintains referral relationships

## Service Deep Dive: Wallet Rake Service

### Configuration
```javascript
const WALLET_RAKE_CONFIG = {
    name: 'wallet_rake_service',
    checkIntervalMs: 10 * 60 * 1000,  // 10-minute intervals
    maxRetries: 3,
    retryDelayMs: 5 * 60 * 1000,      // 5-minute retry delay
    circuitBreaker: {
        failureThreshold: 5,
        resetTimeoutMs: 60000,         // 1-minute timeout
        minHealthyPeriodMs: 120000     // 2-minute health period
    },
    wallet: {
        min_balance_sol: 0.01,         // Minimum SOL to maintain
        min_rake_amount: 0.001         // Minimum amount to rake
    }
}
```

### Key Features

1. **Safety Mechanisms**
   - Pre-transfer balance verification
   - Minimum balance protection
   - Configurable retry logic
   - Transaction validation
   - Automatic rollback on failures

2. **Statistics Tracking**
```javascript
{
    operations: {
        total: 0,
        successful: 0,
        failed: 0
    },
    amounts: {
        total_raked: 0,
        by_contest: {}
    },
    wallets: {
        processed: 0,
        skipped: 0,
        failed: 0,
        last_processed: {}
    },
    performance: {
        average_rake_time_ms: 0,
        last_rake_time_ms: 0
    }
}
```

3. **Admin Operations**
   - Manual wallet rake capability
   - Service status monitoring
   - Start/Stop/Restart controls
   - Detailed operation logging

4. **Transaction Management**
   - Secure key decryption
   - Balance verification
   - Transaction creation and signing
   - Confirmation handling
   - Detailed transaction logging

### Integration Points

1. **Admin Interface**
   ```javascript
   // Manual rake operation
   POST /api/admin/rake-wallet/:walletAddress
   
   // Service control
   POST /api/admin/rake-service/:action
   
   // Service status
   GET /api/admin/rake-service/status
   ```

2. **Admin Logging**
   ```javascript
   await AdminLogger.logAction(
       adminAddress,
       'WALLET_RAKE',
       {
           contest_id: wallet.contest_id,
           amount: rakeAmount,
           signature: result.signature
       },
       context
   );
   ```

## Architecture Components

### 1. Base Service (`utils/service-suite/base-service.js`)
```javascript
class BaseService {
    constructor(name, config)
    async initialize()
    async start()
    async stop()
    async checkEnabled()
    async performOperation()
    // ... other core methods
}
```

Key features:
- Standardized lifecycle management
- Built-in state tracking
- Automatic error handling
- Performance monitoring
- Circuit breaker pattern

### 2. Service Registry (`utils/service-suite/service-registry.js`)
```javascript
class ServiceRegistry {
    register(service, dependencies)
    async initializeAll()
    async startAll()
    async stopAll()
    async getHealthStatus()
}
```

Key features:
- Centralized service management
- Dependency resolution
- Coordinated startup/shutdown
- Health monitoring

### 3. Service Error Handling (`utils/service-suite/service-error.js`)
```javascript
class ServiceError extends Error {
    static initialization(message, details)
    static operation(message, details)
    static validation(message, details)
    // ... other error types
}
```

Key features:
- Standardized error types
- Detailed error tracking
- Consistent error formatting
- Enhanced debugging support

## Admin Logging System

The admin logging system provides consistent tracking of administrative actions across all services:

```javascript
class AdminLogger {
    static async logAction(adminAddress, action, details, context)
    
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

Features:
- Standardized action types
- Detailed context tracking
- IP and user agent logging
- Non-blocking operation
- Consistent formatting

## Circuit Breaker Pattern

The circuit breaker pattern protects services from cascading failures:

1. **Closed State (Normal Operation)**
   - Service operates normally
   - Failures are counted
   - Success resets failure count

2. **Open State (Protection Mode)**
   - Service operations are blocked
   - Automatic timeout-based recovery
   - Gradual recovery with backoff

3. **Half-Open State (Recovery)**
   - Limited operations allowed
   - Success restores normal operation
   - Failure returns to open state

## Configuration

Each service accepts standardized configuration:

```javascript
const SERVICE_CONFIG = {
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

## Service State Management

Services maintain comprehensive state information:

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
        lastError: null,
        lastErrorTime: null,
        consecutiveFailures: 0
    }
}
```

## Best Practices

1. **Service Implementation**
   - Extend BaseService
   - Implement performOperation()
   - Use appropriate error types
   - Maintain clean state

2. **Error Handling**
   - Use ServiceError types
   - Include relevant details
   - Log appropriately
   - Handle cleanup

3. **Configuration**
   - Use reasonable defaults
   - Override when needed
   - Document changes
   - Consider environment

4. **Monitoring**
   - Track performance metrics
   - Monitor health status
   - Set up alerts
   - Review logs regularly

## Example Implementation

```javascript
import { BaseService } from '../utils/service-suite/base-service.js';
import { ServiceError } from '../utils/service-suite/service-error.js';

class ExampleService extends BaseService {
    constructor() {
        super('example_service', {
            checkIntervalMs: 10000,
            // ... custom config
        });
    }

    async performOperation() {
        try {
            // Service-specific logic
        } catch (error) {
            throw ServiceError.operation(
                'Failed to perform operation',
                { originalError: error }
            );
        }
    }
}
```

## Service Dependencies

Services can depend on each other:

```javascript
serviceRegistry.register(tokenSyncService, []);
serviceRegistry.register(contestService, ['token_sync_service']);
serviceRegistry.register(walletService, ['contest_service']);
```

The registry ensures proper initialization order.

## Monitoring and Maintenance

1. **Health Checks**
   - Regular status updates
   - Performance metrics
   - Resource utilization
   - Error rates

2. **Maintenance**
   - Graceful shutdown
   - State persistence
   - Clean recovery
   - Version management

3. **Debugging**
   - Detailed error logs
   - State snapshots
   - Performance traces
   - Audit trails

## Service Modernization Status

Current status of service modernization:

✅ **Completed**
- Token Sync Service (Modern architecture + Admin logging)
- Contest Evaluation Service (Modern architecture + Admin logging)
- Wallet Rake Service (Modern architecture + Admin logging)
- Admin Wallet Service (Modern architecture + Admin logging)
- Referral Service (Modern architecture + Admin logging)
- Contest Wallet Service (Modern architecture + Admin logging)

🔄 **In Progress**
- Vanity Wallet Service (Needs modern architecture update)

⏳ **Pending**
- DD-Serv Service (Future modernization planned)

## Recent Improvements

### Contest Wallet Service Modernization
- Extended BaseService for standardized service management
- Added circuit breaker protection for wallet operations
- Implemented comprehensive stats tracking
- Added admin logging for wallet operations
- Added periodic health checks for wallet monitoring
- Improved error handling with ServiceError
- Added proper dependency management with Vanity Wallet Service

### Referral Service Modernization
- Implemented modern service architecture
- Added circuit breaker protection
- Enhanced caching mechanisms
- Added comprehensive analytics
- Implemented period management
- Added milestone and ranking systems
- Integrated admin logging

### Service Dependencies
The following dependencies have been established:
```javascript
tokenSyncService: []
contestEvaluationService: ['token_sync_service']
walletRakeService: ['contest_evaluation_service']
referralService: ['token_sync_service']
contestWalletService: ['vanity_wallet_service']
```

## Next Steps

1. **Vanity Wallet Service Modernization**
   - Convert to modern architecture
   - Add circuit breaker protection
   - Implement admin logging
   - Add comprehensive stats tracking
   - Integrate with service management system

2. **DD-Serv Service Future Planning**
   - Assess modernization requirements
   - Plan dependency structure
   - Design monitoring and health checks

## Future Enhancements

1. **Service Discovery**
   - Dynamic registration
   - Load balancing
   - Health-based routing

2. **Enhanced Monitoring**
   - Metrics aggregation
   - Performance analysis
   - Trend detection

3. **Advanced Recovery**
   - State reconciliation
   - Automatic failover
   - Data consistency checks 