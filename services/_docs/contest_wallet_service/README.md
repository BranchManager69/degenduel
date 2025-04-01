# Contest Wallet Service

The Contest Wallet Service is responsible for managing Solana wallets used for contests within the DegenDuel platform. It handles wallet creation, funding, balance monitoring, and reclaiming unused funds.

## Overview

Each contest in DegenDuel requires a dedicated Solana wallet to manage funds for token purchases and payouts. The Contest Wallet Service automates the lifecycle of these wallets, from creation through to reclaiming unused funds when contests end.

## Key Features

- **Wallet Creation**: Generates new Solana wallets for contests, with optional vanity address support
- **Wallet Funding**: Facilitates the transfer of SOL to contest wallets for operations
- **Balance Monitoring**: Tracks balances of all contest wallets in real-time
- **Fund Reclamation**: Automatically reclaims unused funds from completed contests
- **Batch Processing**: Processes wallets in batches to avoid rate limiting
- **Adaptive Throttling**: Implements exponential backoff for RPC call failures
- **Cycle Management**: Orchestrates reclaim operations with unique cycle IDs

## Technical Implementation

### Service Structure

```
/services/contest-wallet/
  ├── contestWalletService.js      # Main service implementation
  └── index.js                     # Service exports
```

### Dependencies

- **Solana Web3.js**: For Solana blockchain interactions
- **SolanaEngine**: For enhanced Solana connectivity with multi-endpoint support
- **Prisma**: For database operations
- **AdminLogger**: For administrative action tracking

> **Migration Note**: The Contest Wallet Service was previously using SolanaServiceManager, but has been migrated to use SolanaEngine directly. This provides enhanced reliability with multi-endpoint support, automatic failover, and explicit endpoint selection for critical transactions.

## Migration to SolanaEngine

### Current Status
The Contest Wallet Service is a prime candidate for SolanaEngine migration due to its critical transaction operations.

### Migration Benefits
- **Enhanced Reliability**: Multiple RPC endpoints with health monitoring and failover
- **Improved Performance**: Adaptive endpoint selection based on operation type
- **Better Rate Limit Handling**: Distributed load across multiple endpoints
- **Transaction Optimizations**: Low-latency endpoint selection for critical transfers
- **Explicit Control**: Option to specify which endpoint to use for specific operations

### Implementation Plan
1. **Update Dependencies**
   ```javascript
   // BEFORE
   import SolanaServiceManager from '../utils/solana-suite/solana-service-manager.js';
   
   // AFTER
   import { solanaEngine } from '../services/solana-engine/index.js';
   ```

2. **Update Initialization**
   ```javascript
   // Add SolanaEngine availability check
   if (!solanaEngine.isInitialized()) {
     // Wait for SolanaEngine to initialize
     // Add retry logic with reasonable timeout
   }
   
   // Get connection status for logging
   const connectionStatus = solanaEngine.getConnectionStatus();
   logApi.info(`Using SolanaEngine with ${connectionStatus.healthyEndpoints}/${connectionStatus.totalEndpoints} healthy endpoints`);
   ```

3. **Update Transaction Methods**
   ```javascript
   // BEFORE - Using SolanaServiceManager
   const connection = SolanaServiceManager.getConnection();
   const balance = await connection.getBalance(publicKey);
   const signature = await connection.sendTransaction(transaction);
   
   // AFTER - Using SolanaEngine
   // For balance checking
   const balance = await solanaEngine.executeConnectionMethod('getBalance', publicKey);
   
   // For fund reclamation transactions (use low-latency endpoint)
   const signature = await solanaEngine.sendTransaction(transaction, signers, {
     // Use endpoint-specific options
     preferLowLatency: true,
     skipConfirmation: false
   });
   ```

## Fund Reclamation vs. Cycle Management

The Contest Wallet Service handles two related but distinct aspects of fund management:

### Fund Reclamation
The **technical process** of recovering SOL from contest wallets:
- Creating Solana transactions to transfer funds
- Verifying wallet balances
- Applying minimum threshold rules
- Handling transaction creation, signing, and confirmation
- Managing blockchain interactions

### Cycle Management 
The **organizational framework** that controls reclamation operations:
- Assigning unique cycle IDs (e.g., `RC-3XF5GT`)
- Scheduling when reclamation happens
- Ensuring cycles don't overlap
- Logging start/end of each cycle
- Tracking cycle progress
- Handling errors during cycles
- Providing administrative visibility

## Key Methods

### Creating Contest Wallets

```javascript
async createContestWallet(contestId, options = {})
```

Creates a new Solana wallet for a contest, with options for vanity address generation.

### Monitoring Wallet Balances

```javascript
async checkWalletBalances(options = {})
```

Scans all contest wallets to get their current SOL balance, updating the database with the results.

### Reclaiming Unused Funds

```javascript
async reclaimUnusedFunds(options = {})
```

Reclaims funds from contest wallets based on contest status and balance thresholds. Each reclaim cycle is uniquely identified with a cycle ID based on the timestamp.

## Reclaim Cycle Process

The fund reclamation process follows these steps:

1. **Cycle Start**: Each reclaim cycle begins with a unique cycle ID (e.g., `RC-3XF5GT`)
2. **Wallet Identification**: System identifies wallets eligible for reclaiming based on:
   - Contest status (completed, cancelled)
   - Minimum balance threshold (configurable)
   - Minimum transfer amount (configurable)
3. **Batch Processing**: Processes wallets in small batches with adaptive delays between batches to prevent RPC rate limiting
4. **Transaction Execution**: For each eligible wallet:
   - Confirms wallet has sufficient balance
   - Creates and signs a transfer transaction to the treasury wallet
   - Records transaction details including signature
5. **Cycle Completion**: Records statistics about the operation including:
   - Total wallets processed
   - Number of successful transfers
   - Total SOL reclaimed
   - Duration of the cycle

## SolanaEngine Integration Specifics

### Endpoint Selection Strategy

Different operations benefit from different endpoint selection strategies:

- **Balance Checking**: Use standard round-robin or adaptive strategy
  ```javascript
  // Let SolanaEngine handle rotation automatically
  const balance = await solanaEngine.executeConnectionMethod('getBalance', publicKey);
  ```

- **Critical Transactions**: Use explicit endpoint selection
  ```javascript
  // For high-value transactions, use a specific endpoint
  const signature = await solanaEngine.sendTransaction(transaction, signers, {
    endpointId: 'endpoint-2',  // Use specific endpoint known to be reliable
    fallbackToRotation: true   // Fall back if that endpoint is unhealthy
  });
  ```

- **Low-Latency Operations**: Use performance-optimized endpoint
  ```javascript
  // For time-sensitive operations
  const blockHeight = await solanaEngine.executeRpcRequest(
    (conn) => conn.getBlockHeight(),
    'getBlockHeight',
    { preferLowLatency: true }
  );
  ```

### Error Handling and Retry Logic

SolanaEngine provides enhanced error handling:

- Automatic endpoint rotation on rate limits
- Health-aware endpoint selection
- Adaptive backoff strategies
- Detailed error information including endpoint context

```javascript
try {
  const result = await solanaEngine.executeConnectionMethod('getBalance', publicKey);
  // Success handling
} catch (error) {
  // Enhanced error details
  logApi.error(`Balance check failed: ${error.message}`, {
    endpoint: error.endpoint,
    endpointHealth: error.endpointHealth,
    isRateLimit: error.isRateLimit
  });
  
  // Take appropriate action based on error type
  if (error.isRateLimit) {
    // Handle rate limit specifically
  }
}
```

## Configuration

The service uses the following configuration options:

```javascript
// Example configuration
const contestWalletConfig = {
  reclaim: {
    // Contest statuses eligible for fund reclamation
    contestStatuses: ['COMPLETED', 'CANCELLED'],
    // Minimum wallet balance to consider for reclaiming (in SOL)
    minimumBalanceToReclaim: 0.001,
    // Minimum amount to transfer (accounts for transaction fees)
    minimumAmountToTransfer: 0.0005
  },
  // Treasury wallet to reclaim funds to
  treasuryWallet: 'TREASURY_WALLET_ADDRESS',
  // RPC timeouts and batch sizes
  solana_timeouts: {
    rpc_wallet_batch_size: 20
  },
  // SolanaEngine specific settings
  solanaEngine: {
    // Preferred endpoint for reclaim transactions
    preferredEndpoint: 'endpoint-2',
    // Fallback to rotation if preferred endpoint is unhealthy
    fallbackToRotation: true
  }
};
```

## Administrative Logging

All significant operations are logged to both the application logs and the administrative logs database:

- **Wallet Creation**: Logs creation of new contest wallets
- **Reclaim Cycle Start**: Logs the beginning of a reclaim cycle with ID and parameters
- **Individual Reclaims**: Logs each successful fund transfer with contest ID and amount
- **Reclaim Cycle Completion**: Logs cycle summary including total amounts and success rates
- **Endpoint Selection**: Logs which endpoint was used for critical transactions

## Error Handling

The service implements comprehensive error handling:

- **RPC Errors**: Adaptive backoff for rate limiting errors
- **Transaction Failures**: Detailed logging and reporting of failed transactions
- **Database Errors**: Circuit breaker pattern to prevent cascading failures
- **Endpoint Failures**: Automatic failover to healthy endpoints

## Circuit Breaker Protection

The service inherits from BaseService and includes circuit breaker protection:

- Monitors error rates during operations
- Automatically disables service if error threshold is exceeded
- Reports service health metrics for monitoring

## Integration Points

- **Contest Scheduler Service**: Coordinates wallet creation for scheduled contests
- **Admin Contest Controller**: Interface for administrative wallet operations
- **SolanaEngine**: Provides enhanced Solana connection management

## Related Services

- [Contest Evaluation Service](../contest_evaluation_service/)
- [Contest Scheduler Service](../contest_scheduler_service/)
- [Admin Wallet Service](../admin_wallet_service/)
- [User Balance Tracking Service](../user_balance_tracking_service/)
- [SolanaEngine Service](../solana_engine_service/)