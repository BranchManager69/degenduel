# Local Vanity Wallet Generator

This document provides a comprehensive overview of the Local Vanity Wallet Generator system used in the DegenDuel platform, which replaces the previous GPU server-based implementation.

## Overview

The Vanity Wallet Generator creates Solana wallet addresses with custom patterns (like "DUEL" or "DEGEN") for branding purposes. This process is now handled locally using JavaScript and worker threads, providing a self-contained solution without external dependencies.

## Local Generation Architecture

The system implements a multi-threaded approach for vanity address generation:

1. **Pure JavaScript Implementation**:
   - Runs directly on the DegenDuel server without external services
   - Uses worker threads to parallelize the workload across CPU cores
   - Maintains compatibility with existing database schema and API endpoints

2. **Job Queue Management**:
   - Prioritizes jobs in a FIFO queue
   - Processes one job at a time to optimize CPU resources
   - Provides progress tracking and status updates

3. **Database-Driven Workflow**:
   - All vanity wallet requests stored in database
   - Results saved to database upon completion
   - Maintains existing integration with ContestWalletService

## Key Components

### 1. `VanityApiClient.js`

Located at `/services/vanity-wallet/vanity-api-client.js`, this client:

- Creates vanity address requests in the database
- Submits jobs to the local generator
- Processes results from the generator
- Finds available vanity wallets for contest assignment
- Manages wallet usage tracking

Key methods:
```javascript
// Create a request in database and start local generation
static async createVanityAddressRequest(options)

// Process a generation result
static async processLocalResult(requestId, result)

// Get available vanity wallet from database
static async getAvailableVanityWallet(pattern = null)

// Mark vanity wallet as used by a contest
static async assignVanityWalletToContest(walletId, contestId)

// Get generator status information
static async getGeneratorStatus()
```

### 2. Local Generator

Located at `/services/vanity-wallet/generators/local-generator.js`, this code:

- Implements the vanity address generation algorithm in pure JavaScript
- Uses worker threads to parallelize the workload
- Manages the job queue and processing
- Provides progress tracking and status updates

### 3. Admin Routes

Located at `/routes/admin/vanity-wallets.js` and `/routes/admin/vanity-callback.js`, these endpoints manage:

- Admin-initiated vanity wallet creation
- Job status inquiries
- Generator status information

Key endpoints:
```javascript
// For admins to request vanity wallets
POST /api/admin/vanity-wallets

// For admins to view vanity wallet details
GET /api/admin/vanity-wallets/:id

// For admins to check generator status
GET /api/admin/vanity-wallets/status/generator
```

### 4. Database Schema

The `vanity_wallet_pool` table in the database tracks:

- Wallet address and private key
- Pattern to match (e.g., "DUEL" or "DEGEN")
- Status tracking (pending, processing, completed, failed, cancelled)
- Usage information (which contest is using the wallet)
- Generation metrics (attempts, duration)

### 5. ContestWalletService Integration

The `contestWalletService.js` integrates with the vanity wallet system:

- Prioritized search for available vanity wallets
- Assignment of vanity wallets to contests
- Fallback to random wallet generation when needed

## Flow of Operations

### Requesting a Vanity Wallet

1. Admin triggers a request via admin API or scheduled task
2. `VanityApiClient.createVanityAddressRequest()` stores request in database
3. Request enters "pending" state and is immediately submitted to the local generator
4. Local generator begins processing the job using worker threads

### Local Processing

1. VanityWalletGeneratorManager maintains a job queue
2. Worker threads search for addresses matching the requested pattern
3. Results are reported back to the main thread
4. On successful generation, the result is stored in the database

### Using Generated Wallets

1. `contestWalletService.getUnassociatedVanityWallet()` searches database
2. Prioritizes "DUEL" pattern first, then "DEGEN", then any available
3. Selected wallet is assigned to a contest
4. Database updated to mark the wallet as used

## Configuration

The system is configured in `config.js` with these key settings:

```javascript
// Vanity Wallet Generator Configuration
vanityWallet: {
  // Number of worker threads to use for generation (default: CPU cores - 1)
  numWorkers: parseInt(process.env.VANITY_WALLET_NUM_WORKERS || (require('os').cpus().length - 1)), 
  // Number of addresses to check per batch
  batchSize: parseInt(process.env.VANITY_WALLET_BATCH_SIZE || 10000),
  // Maximum number of attempts before giving up
  maxAttempts: parseInt(process.env.VANITY_WALLET_MAX_ATTEMPTS || 50000000),
},
```

## Performance Considerations

1. **CPU Usage**:
   - Uses (CPU cores - 1) worker threads by default
   - Can be configured to use more or fewer threads
   - Heavy computation that may impact other services on the same machine

2. **Expected Performance**:
   - Approximately 10,000-30,000 addresses/second per CPU core
   - 4-char pattern: ~30-60 seconds on a typical server
   - 5-char pattern: ~15-30 minutes on a typical server
   - 6-char pattern: ~8-24 hours on a typical server

3. **Limitations**:
   - Much slower than GPU-based solutions
   - For patterns longer than 5 characters, consider pre-generating wallets during off-peak hours

## Benefits of Local Implementation

1. **No External Dependencies**:
   - Complete self-contained solution
   - No need to manage external GPU servers
   - No network connectivity issues

2. **Simplicity**:
   - Easier to deploy and maintain
   - No complex firewall or networking setup
   - Code runs in the same process as the main application

3. **Cost Effective**:
   - No additional cloud resources needed
   - Utilizes existing server CPU resources
   - Scales with server hardware

4. **Perfect Integration**:
   - Direct integration with existing application code
   - No serialization/deserialization overhead
   - Immediate results processing

## Differences from Previous Implementation

1. **Local Processing vs. External GPU Server**:
   - Previous: External GPU server polled for jobs
   - Now: Local worker threads process jobs immediately

2. **Performance**:
   - Previous: High-speed GPU processing (millions of addresses/second)
   - Now: Slower CPU-based processing (thousands of addresses/second)

3. **API Compatibility**:
   - All existing endpoints maintained for backward compatibility
   - No changes required in ContestWalletService integration
   - Same database schema used

## Monitoring and Management

To monitor the vanity wallet generator:

1. **Generator Status**:
   - `GET /api/admin/vanity-wallets/status/generator`
   - Shows active jobs, queue length, and processing statistics

2. **Request Management**:
   - `POST /api/admin/vanity-wallets/:id/cancel`
   - Allows cancellation of long-running generation jobs

3. **Database Reports**:
   - `GET /api/admin/vanity-wallets?status=processing`
   - View all jobs in a specific status

## Troubleshooting

Common issues and solutions:

1. **High CPU Usage**:
   - Reduce `numWorkers` configuration
   - Schedule vanity wallet generation during off-peak hours

2. **Slow Generation**:
   - For long patterns (>5 chars), use batch generation during maintenance windows
   - Consider pre-generating a pool of vanity wallets

3. **Job Stuck in Processing**:
   - Use `POST /api/admin/vanity-wallets/:id/cancel` to cancel the job
   - Check server logs for worker thread errors

4. **Error Handling**:
   - All errors are logged with detailed information
   - Workers automatically restart if they fail during processing
   - Timeouts prevent infinite loops in generation