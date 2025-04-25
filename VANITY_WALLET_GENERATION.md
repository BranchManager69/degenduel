# Vanity Wallet Generation System

## Overview

The DegenDuel Vanity Wallet Generation System automatically creates and maintains a pool of Solana wallet addresses with custom prefixes like "DUEL" and "DEGEN". These vanity addresses enhance branding and provide a consistent user experience for contest wallets and platform operations.

## System Architecture

```
+---------------------------------------------+
|   Vanity Wallet Generation Process Flow     |
+---------------------------------------------+

+------------------------+      Triggers      +------------------------+
| vanity-wallet-service  |<----------------->| BaseService Interval   |
|                        |   Every N minutes  |   (config setting)     |
+------------------------+                    +------------------------+
          |
          | Calls checkAndGenerateAddresses()
          | if pool is below target count
          v
+------------------------+      Creates      +------------------------+
| generateVanityAddress()|----------------->| Database Record in     |
|                        |                  | vanity_wallet_pool     |
+------------------------+                  +------------------------+
          |
          | Calls
          v
+------------------------+      Submits Job  +------------------------+
| VanityApiClient        |----------------->| VanityWalletGenerator  |
| createVanityAddress    |                  | Manager (singleton)    |
+------------------------+                  +------------------------+
          ^                                           |
          |                                           | Forwards to
          |                                           v
          |                                +------------------------+
          |                                | LocalVanityGenerator   |
          |                                | addJob()               |
          |                                +------------------------+
          |                                           |
          |                                           | Calls
          |                                           v
          |                                +------------------------+
          |                                | startSolanaKeygen()    |
          |                                | - Core generation      |
          |                                +------------------------+
          |                                           |
          |                                           | Spawns process
          |                                           v
          |                                +------------------------+
          |                                | solana-keygen grind    |
          |                                | (Native CLI tool)      |
          |                                +------------------------+
          |                                           |
          |                                           | When complete
          |                                           v
          |    Result callback             +------------------------+
          +------------------------------- | Read keypair file      |
               processLocalResult()        | Extract public key     |
                                           +------------------------+
                                                      |
                                                      | Updates
                                                      v
                                           +------------------------+
                                           | Database Record        |
                                           | (with encrypted keys)  |
                                           +------------------------+
```

## Key Components

### 1. Vanity Wallet Service
[File: `/services/vanity-wallet/vanity-wallet-service.js`](/services/vanity-wallet/vanity-wallet-service.js)

This service manages the entire vanity wallet generation process:
- Uses BaseService framework for scheduling periodic checks
- Monitors the pool of available vanity addresses
- Triggers new address generation when pool falls below target thresholds
- Provides status reporting and job management

### 2. Vanity API Client
[File: `/services/vanity-wallet/vanity-api-client.js`](/services/vanity-wallet/vanity-api-client.js)

The API client handles:
- Creating database records for vanity address requests
- Submitting generation jobs to the generator manager
- Processing completed jobs and storing encrypted results
- Encrypting private keys before database storage

### 3. Generator Manager
[File: `/services/vanity-wallet/generators/index.js`](/services/vanity-wallet/generators/index.js)

A singleton class that:
- Manages the vanity wallet generation process
- Provides a unified interface for job submission
- Routes jobs to the LocalVanityGenerator
- Handles callbacks for job completion and progress updates

### 4. Local Generator
[File: `/services/vanity-wallet/generators/local-generator.js`](/services/vanity-wallet/generators/local-generator.js)

The core implementation that:
- Uses the `solana-keygen grind` CLI tool via child processes
- Manages system resource usage with CPU limiting
- Processes command outputs and extracts keypair information
- Implements a job queue to prevent system overload

## Configuration

The vanity wallet system is configured in the main application config:
[File: `/config/config.js`](/config/config.js)

Key configuration settings:
```javascript
vanityWallet: {
  // Number of worker threads to use (default: CPU cores - 1)
  numWorkers: parseInt(process.env.VANITY_WALLET_NUM_WORKERS || (os.cpus().length - 1)),
  // Number of addresses to check per batch
  batchSize: parseInt(process.env.VANITY_WALLET_BATCH_SIZE || 10000),
  // Maximum attempts before giving up
  maxAttempts: parseInt(process.env.VANITY_WALLET_MAX_ATTEMPTS || 50000000),
  // Target counts for automatic generation
  targetCounts: {
    DUEL: parseInt(process.env.VANITY_WALLET_TARGET_DUEL || 5),
    DEGEN: parseInt(process.env.VANITY_WALLET_TARGET_DEGEN || 3)
  },
  // Check interval in minutes
  checkIntervalMinutes: parseInt(process.env.VANITY_WALLET_CHECK_INTERVAL || 1),
  // Maximum concurrent generation jobs
  maxConcurrentJobs: parseInt(process.env.VANITY_WALLET_MAX_CONCURRENT_JOBS || 1),
}
```

## Security

- Private keys are encrypted before storage using `WALLET_ENCRYPTION_KEY`
- The database only stores encrypted versions of private keys
- Access to vanity wallets is controlled through the admin dashboard

## Performance Considerations

- Generation is CPU-intensive; uses `cpulimit` to prevent server overload
- Worker count and CPU limits are configurable
- Job queue prevents too many concurrent generation processes
- Automatic cleanup of orphaned processes

## Admin Dashboard Integration

The Vanity Wallet section in the Admin Dashboard provides:
- Monitoring of available vanity addresses
- Current generation job status
- Manual generation request capability
- Assignment of vanity addresses to contests

For more information on using the Admin Dashboard to manage vanity wallets, see the [Admin Wallet Service Documentation](/services/_docs/admin_wallet_service/README.md).