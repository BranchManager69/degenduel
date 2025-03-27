# Solana RPC Rate Limiting Guide

This document provides information about the centralized Solana RPC rate limiting system in the DegenDuel application.

## Overview

DegenDuel interacts with the Solana blockchain via RPC calls to endpoints like Helius. These endpoints have rate limits, and when exceeded, they return 429 errors. Previously, different services in our application were making independent RPC calls without coordination, which led to ineffective rate limiting and "Hit #1" errors appearing repeatedly at the same timestamp.

To address this issue, we've implemented a centralized request queue in the SolanaService with global rate limiting. This ensures that all services use a shared queue and rate limit counter, providing more efficient use of RPC resources and more effective backoff during rate limiting.

## Architecture

The rate limiting system consists of the following components:

1. **SolanaService** - The central service that manages the Solana connection and request queue
2. **SolanaServiceManager** - An adapter that provides backward compatibility for existing code
3. **ConnectionProxy** - A proxy wrapper that intercepts Connection method calls and routes them through the central queue

## Usage Guidelines

### For New Services

When implementing a new service that needs to interact with Solana, always use the `SolanaService` directly:

```javascript
import solanaService from '../services/solanaService.js';

class MyNewService {
    async someMethod() {
        // Execute RPC methods through the central queue
        const balance = await solanaService.executeConnectionMethod('getBalance', publicKey);
        
        // Instead of creating your own Connection object:
        // const connection = new Connection(...);
        // const balance = await connection.getBalance(publicKey);
    }
}
```

### For Existing Services

Existing services should be updated to use the centralized system:

1. **Remove direct Connection creation**:
   ```javascript
   // Remove this:
   this.connection = new Connection(config.rpc_urls.primary, "confirmed");
   ```

2. **Use SolanaServiceManager instead**:
   ```javascript
   import SolanaServiceManager from '../utils/solana-suite/solana-service-manager.js';
   
   // Get the connection via SolanaServiceManager
   this.connection = SolanaServiceManager.getConnection();
   ```

3. **For custom RPC calls** that don't have direct Connection methods:
   ```javascript
   // Use the executeRpcRequest method
   const result = await SolanaServiceManager.executeRpcRequest(
     () => customRpcFunction(),
     'customRpcMethodName'
   );
   ```

## Configuration

The rate limiting system is configured in `services/solanaService.js`:

```javascript
const SOLANA_SERVICE_CONFIG = {
    // ... other config options ...
    rpcLimiter: {
        maxConcurrentRequests: 5,         // Max parallel requests
        minBackoffMs: 1000,               // Min backoff on rate limit (1 second)
        maxBackoffMs: 15000,              // Max backoff on rate limit (15 seconds)
        baseDelayMs: 250,                 // Base delay for exponential backoff
        minOperationSpacingMs: 100,       // Min gap between operations
    }
};
```

## Monitoring

The Solana RPC rate limiting system includes comprehensive monitoring:

1. **Logging**: Rate limit hits are logged with details:
   ```
   [solana-rpc] RATE LIMIT getBalance Hit #3 Retry in 2350ms (via SolanaService)
   ```

2. **Service Status**: You can view rate limiting metrics in the service status:
   ```javascript
   const status = solanaService.getServiceStatus();
   console.log(status.rpcStats);
   ```

3. **Admin Dashboard**: The admin dashboard includes Solana RPC metrics in the Services section

## Common Issues and Solutions

### Still Seeing "Hit #1" Errors

If you're still seeing "Hit #1" errors, there might be some services bypassing the central system:

1. Look for direct `new Connection()` calls in the codebase
2. Ensure all services are using `SolanaServiceManager.getConnection()`
3. Check for custom RPC clients that might not be using the central system

### Rate Limiting Too Aggressive

If the rate limiting seems too aggressive:

1. Increase `maxConcurrentRequests` in `SOLANA_SERVICE_CONFIG.rpcLimiter`
2. Decrease `minOperationSpacingMs` to allow faster operation processing
3. Adjust backoff parameters based on your RPC provider's limits

### Service Dependent on Solana Not Starting

If a service that depends on Solana is not starting:

1. Ensure SolanaService is initialized before dependent services
2. Check if the service correctly lists SOLANA in its dependencies
3. Use `await SolanaServiceManager.initialize()` in your service's initialization code

## Best Practices

1. **Always use the central system**: Never create your own Connection objects
2. **Batch related operations**: When possible, batch related operations to reduce the number of RPC calls
3. **Use proper error handling**: Always handle potential RPC errors gracefully
4. **Monitor rate limit hits**: Set up alerts for excessive rate limit hits
5. **Consider caching**: Cache frequently accessed data to reduce RPC calls

## Migration Checklist

- [ ] Remove direct `new Connection()` instances
- [ ] Import `SolanaServiceManager`
- [ ] Use `SolanaServiceManager.getConnection()` to get a connection
- [ ] Update custom RPC calls to use `executeRpcRequest` or `executeConnectionMethod`
- [ ] Test your service with the new rate limiting system
- [ ] Monitor rate limit metrics after deployment