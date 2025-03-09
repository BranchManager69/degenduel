# DegenDuel Service Standardization Guide

## Current Services Inventory

### Infrastructure Layer
1. **Wallet Generator Service** (Status: ✅ Converted)
   - Purpose: Core wallet generation and management
   - Dependencies: None
   - Critical Level: High
   - Conversion Date: [Current Date]
   - Changes Made:
     * Implemented proper service configuration
     * Enhanced stats tracking
     * Added comprehensive error handling
     * Improved performance metrics
     * Added circuit breaker integration
     * Enhanced cache management
     * Added proper cleanup procedures

2. **Faucet Service** (Status: ✅ Converted)
   - Purpose: Test SOL distribution and recovery
   - Dependencies: Wallet Generator
   - Critical Level: Medium
   - Conversion Date: [Current Date]
   - Changes Made:
     * Implemented standardized service configuration
     * Added comprehensive stats tracking (operations, transactions, recovery)
     * Enhanced error handling with ServiceError
     * Added performance metrics and monitoring
     * Implemented circuit breaker integration
     * Added rate limiting with cache
     * Enhanced recovery system with automatic monitoring
     * Added proper cleanup procedures
     * Improved transaction management
     * Added event emission through ServiceManager

### Data Layer
3. **Token Sync Service** (Status: ✅ Converted)
   - Purpose: External token data synchronization
   - Dependencies: None
   - Critical Level: High
   - Conversion Date: [Current Date]
   - Changes Made:
     * Added proper initialization with state loading
     * Enhanced stats structure with detailed metrics
     * Added comprehensive performance tracking
     * Implemented proper state persistence
     * Added event emission through ServiceManager
     * Optimized circuit breaker configuration
     * Added proper cleanup procedures
     * Improved validation tracking
     * Enhanced API monitoring

4. **Market Data Service** (Status: Next for Conversion)
   - Purpose: Internal market data provider
   - Dependencies: Token Sync
   - Critical Level: Critical

5. **Token Whitelist Service** (Status: Needs Review)
   - Purpose: Token whitelist management
   - Dependencies: None
   - Critical Level: Medium

### Contest Layer
6. **Contest Evaluation Service** (Status: Needs Review)
   - Purpose: Contest lifecycle and evaluation
   - Dependencies: Market Data
   - Critical Level: Critical

7. **Achievement Service** (Status: Needs Review)
   - Purpose: User achievement tracking
   - Dependencies: Contest Evaluation
   - Critical Level: Low

8. **Referral Service** (Status: Needs Review)
   - Purpose: Referral program management
   - Dependencies: Contest Evaluation
   - Critical Level: Medium

### Wallet Layer
9. **Contest Wallet Service** (Status: Needs Review)
   - Purpose: Contest wallet management
   - Dependencies: [Vanity Wallet, Contest Evaluation]
   - Critical Level: Critical

10. **Vanity Wallet Service** (Status: Recently Converted)
    - Purpose: Vanity wallet pool management
    - Dependencies: Wallet Generator
    - Critical Level: High

11. **Wallet Rake Service** (Status: Needs Review)
    - Purpose: Post-contest fund collection
    - Dependencies: Contest Wallet
    - Critical Level: High

12. **Admin Wallet Service** (Status: Needs Review)
    - Purpose: Administrative wallet operations
    - Dependencies: Contest Wallet
    - Critical Level: Critical

## Service Pattern Requirements

### 1. Class Structure
```typescript
class ExampleService extends BaseService {
    constructor(config) {
        super(SERVICE_CONFIG.name, config);
        // Instance properties only, NO static properties
        this.serviceSpecificState = { ... };
    }

    async initialize() { ... }
    async performOperation() { ... }
    async stop() { ... }
}
```

### 2. Required Properties
- Configuration Object
- Stats Tracking
- Circuit Breaker Integration
- Instance-based State
- No Static Properties/Methods

### 3. Configuration Standard
```javascript
const SERVICE_CONFIG = {
    name: SERVICE_NAMES.SERVICE_NAME,
    description: getServiceMetadata(SERVICE_NAMES.SERVICE_NAME).description,
    checkIntervalMs: number,
    maxRetries: number,
    retryDelayMs: number,
    circuitBreaker: {
        failureThreshold: number,
        resetTimeoutMs: number,
        minHealthyPeriodMs: number
    }
};
```

### 4. Stats Structure
```javascript
{
    operations: {
        total: number,
        successful: number,
        failed: number
    },
    performance: {
        averageOperationTimeMs: number,
        lastOperationTimeMs: number
    },
    // Service-specific stats
    serviceStats: {
        // Custom metrics
    }
}
```

### 5. Required Methods
- `initialize()`: Setup and state initialization
- `performOperation()`: Main service operation
- `stop()`: Cleanup and shutdown
- Service-specific methods

### 6. Error Handling
- Use ServiceError class
- Proper error propagation
- Circuit breaker integration
- Error logging and monitoring

### 7. Integration Points
- ServiceManager registration
- Event emission
- State persistence
- Health monitoring

## Anti-Patterns to Avoid

1. **Static Properties/Methods**
   ```javascript
   // BAD
   static connection = null;
   static activeWorkers = new Map();
   
   // GOOD
   this.connection = null;
   this.activeWorkers = new Map();
   ```

2. **Direct State Mutation**
   ```javascript
   // BAD
   this.stats = { ... }; // Overwriting base stats
   
   // GOOD
   Object.assign(this.stats, { ... }); // Merging with base stats
   ```

3. **Bypassing ServiceManager**
   ```javascript
   // BAD
   directlyUpdateState();
   
   // GOOD
   await ServiceManager.updateServiceState();
   ```

4. **Inconsistent Error Handling**
   ```javascript
   // BAD
   throw new Error('Generic error');
   
   // GOOD
   throw ServiceError.operation('Specific error description');
   ```

## Conversion Checklist

For each service:

- [ ] Remove all static properties/methods
- [ ] Implement proper instance-based state
- [ ] Add comprehensive stats tracking
- [ ] Implement all required lifecycle methods
- [ ] Add proper error handling
- [ ] Add circuit breaker integration
- [ ] Add event emission
- [ ] Add state persistence
- [ ] Add health monitoring
- [ ] Add proper logging
- [ ] Add proper documentation
- [ ] Add proper tests

## Service Status Tracking

### Infrastructure Layer
- [x] Wallet Generator Service
- [x] Faucet Service

### Data Layer
- [x] Token Sync Service
- [ ] Market Data Service
- [ ] Token Whitelist Service

### Contest Layer
- [ ] Contest Evaluation Service
- [ ] Achievement Service
- [ ] Referral Service

### Wallet Layer
- [ ] Contest Wallet Service
- [x] Vanity Wallet Service
- [ ] Wallet Rake Service
- [ ] Admin Wallet Service

## Implementation Plan

1. **Phase 1: Infrastructure Layer** ✅
   - ✅ Convert Wallet Generator Service
   - ✅ Convert Faucet Service
   - ✅ Test infrastructure layer integration

2. **Phase 2: Data Layer** 🔄
   - ✅ Convert Token Sync Service
   - Convert Market Data Service (In Progress)
   - Convert Token Whitelist Service
   - Test data flow and synchronization

3. **Phase 3: Contest Layer**
   - Review/Convert Contest Services
   - Test contest lifecycle

4. **Phase 4: Wallet Layer**
   - Review/Convert remaining Wallet Services
   - Test wallet operations

5. **Phase 5: Integration Testing**
   - Full system testing
   - Performance testing
   - Error handling verification

## Success Criteria

1. All services follow instance-based pattern
2. No static properties/methods remain
3. All services properly integrate with ServiceManager
4. All services implement proper error handling
5. All services have comprehensive monitoring
6. All services have proper documentation
7. All services pass integration tests
8. System performs within expected parameters
9. Circuit breaker functions correctly
10. Error handling works as expected

## Monitoring and Maintenance

After conversion:
1. Monitor service performance
2. Track error rates
3. Verify circuit breaker operation
4. Check resource utilization
5. Validate state persistence
6. Review log patterns
7. Assess system stability 