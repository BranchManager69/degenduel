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
- **SolanaEngine Integration**: Uses SolanaEngine for enhanced reliability with multi-endpoint support

## Technical Implementation

### Service Structure

```
/services/contest-wallet/
  ├── contestWalletService.js  # Main service implementation
  ├── index.js                 # Service exports
  └── README.md                # Documentation (this file)
```

### Dependencies

- **Solana Web3.js**: For Solana blockchain interactions
- **SolanaEngine**: For enhanced Solana connectivity with multi-endpoint support
- **Prisma**: For database operations
- **AdminLogger**: For administrative action tracking

> **Note**: The Contest Wallet Service has been migrated from SolanaServiceManager to use SolanaEngine directly. This provides enhanced reliability with multi-endpoint support, automatic failover, and explicit endpoint selection for critical transactions.

## Key Methods

### Creating Contest Wallets

```javascript
async createContestWallet(contestId, adminContext = null)
```

Creates a new Solana wallet for a contest, with options for vanity address generation.

### Monitoring Wallet Balances

```javascript
async updateAllWalletBalances()
```

Scans all contest wallets to get their current SOL balance, updating the database with the results.

### Reclaiming Unused Funds

```javascript
async reclaimUnusedFunds(options = {})
```

Reclaims funds from contest wallets based on contest status and balance thresholds. Each reclaim cycle is uniquely identified with a cycle ID based on the timestamp.

## SolanaEngine Integration

The service now uses SolanaEngine directly for all Solana blockchain interactions, providing:

1. **Enhanced Reliability**: Automatic failover between multiple RPC endpoints
2. **Improved Performance**: Adaptive endpoint selection based on operation type
3. **Better Rate Limit Handling**: Distributed load across multiple endpoints
4. **Transaction Optimizations**: Low-latency endpoint selection for critical transfers

Key implementation details:

```javascript
// Balance checking
const lamports = await solanaEngine.executeConnectionMethod('getBalance', publicKey);

// Batch operations
const balances = await solanaEngine.executeConnectionMethod('getMultipleAccountsInfo', publicKeys);

// Fund transfer
const transaction = new Transaction().add(
    SystemProgram.transfer({
        fromPubkey: fromKeypair.publicKey,
        toPubkey: new PublicKey(destinationAddress),
        lamports: Math.round(amount * LAMPORTS_PER_SOL)
    })
);

const signature = await solanaEngine.sendTransaction(
    transaction, 
    [fromKeypair], 
    {
        commitment: 'confirmed',
        skipPreflight: false,
        // Use a preferred endpoint for critical operations if available
        endpointId: this.config.wallet?.preferredEndpoints?.transfers
    }
);
```

## Error Handling and Retry Logic

The service implements comprehensive error handling:

- **RPC Errors**: Adaptive backoff for rate limiting errors
- **Transaction Failures**: Detailed logging and reporting of failed transactions
- **Database Errors**: Circuit breaker pattern to prevent cascading failures
- **Endpoint Failures**: Automatic failover to healthy endpoints

## Related Documentation

For more detailed information, see:
- [Contest Wallet Service Documentation](../_docs/contest_wallet_service/README.md)
- [SolanaEngine Documentation](../_docs/solana_engine_service/README.md)