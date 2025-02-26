# Solana Service

## Overview

The Solana Service is a critical infrastructure component that provides blockchain connectivity for the DegenDuel platform. It manages the connection to Solana RPC nodes, handles reconnection logic, and provides connection instances to other services.

This service is designed as a foundational component that adheres to the standard service architecture.

## Architecture

The Solana Service follows the BaseService pattern with these key components:

1. **Connection Management**: Maintains connection to Solana blockchain
2. **Health Monitoring**: Regularly checks connection status
3. **Automatic Reconnection**: Handles network interruptions
4. **Circuit Breaker Integration**: Protects system during prolonged outages

## Usage

### Getting the Solana Connection

```javascript
import solanaService from '../services/solanaService.js';

// Get the Solana connection
const connection = solanaService.getConnection();

// Use the connection
const balance = await connection.getBalance(publicKey);
```

### Service Dependencies

The following services depend on the Solana Service:

- Contest Wallet Service
- Wallet Rake Service
- Admin Wallet Service
- User Balance Tracking Service

## Compatibility Layer

For backward compatibility, we maintain a `SolanaServiceManager` adapter that forwards calls to the new service implementation. This allows existing code to keep working while new code can use the standardized interface.

```javascript
// Legacy usage (still supported)
import SolanaServiceManager from '../utils/solana-suite/solana-service-manager.js';
const connection = SolanaServiceManager.getConnection();

// Preferred new usage
import solanaService from '../services/solanaService.js';
const connection = solanaService.getConnection();
```

## Configuration

The Solana Service uses the following configuration:

```javascript
const SOLANA_SERVICE_CONFIG = {
    name: 'solana_service',
    description: 'Solana blockchain connectivity service',
    layer: 'infrastructure_layer',
    criticalLevel: 'critical',
    checkIntervalMs: 30000, // 30 seconds
    circuitBreaker: {
        failureThreshold: 3,
        resetTimeoutMs: 60000,
        minHealthyPeriodMs: 120000
    }
};
```

## Error Handling

The service implements specific error types:

- `solana_init_failed`: Failure during initialization
- `solana_connection_error`: Error during connection health check
- `solana_not_initialized`: Attempted to use connection before initialization
- `solana_reconnect_failed`: Failed to reconnect after connection loss

## Monitoring

The service provides health metrics:

```javascript
// Get detailed status
const status = solanaService.getServiceStatus();

// Example status response
{
    status: 'healthy',
    isRunning: true,
    connectionActive: true,
    metrics: {
        operations: {
            total: 583,
            successful: 581,
            failed: 2
        },
        performance: {
            averageOperationTimeMs: 246,
            lastOperationTimeMs: 124
        },
        circuitBreaker: {
            isOpen: false,
            failures: 0,
            lastFailure: null
        },
        serviceStartTime: '2025-02-25T14:32:15Z'
    }
}
```

## Implementation Notes

1. The service initializes a single Solana Connection instance shared by all components
2. Configuration values are driven by service metadata from the constants file
3. The `performOperation` method runs a health check by calling getVersion()
4. The service leverages circuit breaker protection from BaseService
5. Connection errors trigger automatic reconnection attempts

## Migration Path

When updating existing code to use the new service:

1. Replace imports:
   ```javascript
   // Before
   import SolanaServiceManager from '../utils/solana-suite/solana-service-manager.js';
   
   // After
   import solanaService from '../services/solanaService.js';
   ```

2. Replace method calls:
   ```javascript
   // Before
   const connection = SolanaServiceManager.getConnection();
   
   // After
   const connection = solanaService.getConnection();
   ```

## Future Improvements

- RPC endpoint rotation for failover
- Connection performance metrics
- Request rate limiting
- Cluster endpoint configuration (mainnet-beta, devnet, etc.)
- Transaction submission optimization