# Balance Tracking Service Optimization Plan

## Current Implementation (V1)

The current `userBalanceTrackingService` implementation:
- Tracks each user wallet individually
- Uses adaptive scheduling based on user count
- Stores historical balance data
- Already has good rate limiting and error handling

## Optimization Plan (V2)

### Batch Processing with Solana's `getMultipleAccounts`

Solana's RPC API supports fetching data for multiple accounts in a single request using `getMultipleAccounts`. This would dramatically reduce our RPC call volume.

```javascript
// Instead of multiple individual calls:
const balance1 = await connection.getBalance(publicKey1);
const balance2 = await connection.getBalance(publicKey2);
// etc...

// Use a single batch call:
const publicKeys = [publicKey1, publicKey2, ...];
const accounts = await connection.getMultipleAccounts(publicKeys);
```

### Implementation Strategy

1. **Group Users in Fixed-Size Batches**:
   - Group user wallets in batches of 100 addresses
   - Process each batch with a single RPC call
   - Still use adaptive scheduling to determine batch frequency

2. **Smart Batching by Activity Level**:
   - Segment users by activity level (high, medium, low)
   - Check high-activity users more frequently
   - Place inactive users in less frequent batches

3. **Lamport-based Account Info**:
   - Use `getMultipleAccounts` to get account info objects
   - Extract lamport balance from `AccountInfo.lamports`
   - Process balance updates in parallel

### Code Structure Changes

```javascript
// In userBalanceTrackingService.js:

async batchFetchBalances(walletAddresses) {
  try {
    const connection = SolanaServiceManager.getConnection();
    const publicKeys = walletAddresses.map(addr => new PublicKey(addr));
    
    // Fetch multiple accounts in one call
    const accountInfos = await connection.getMultipleAccounts(publicKeys);
    
    // Process results
    const results = accountInfos.map((accountInfo, index) => {
      if (!accountInfo) return { wallet: walletAddresses[index], error: 'Account not found' };
      
      return {
        wallet: walletAddresses[index],
        balance: accountInfo.lamports,
        exists: true
      };
    });
    
    return results;
  } catch (error) {
    this.trackingStats.solana.errors++;
    throw new ServiceError('batch_balance_check_failed', error.message);
  }
}

// Update executeScheduledChecks to use batching
async executeScheduledChecks() {
  // Group wallets into batches of 100 (Solana's recommended batch size)
  const batchSize = 100;
  const walletBatches = [];
  
  // Create batches from scheduled wallets
  for (const [walletAddress, schedule] of this.userSchedule.entries()) {
    if (schedule.nextCheck <= Date.now() && !this.activeChecks.has(walletAddress)) {
      let currentBatch = walletBatches[walletBatches.length - 1];
      
      if (!currentBatch || currentBatch.length >= batchSize) {
        currentBatch = [];
        walletBatches.push(currentBatch);
      }
      
      currentBatch.push(walletAddress);
      this.activeChecks.add(walletAddress);
    }
  }
  
  // Process batches
  const results = [];
  for (const batch of walletBatches) {
    try {
      const batchResults = await this.batchFetchBalances(batch);
      results.push(...batchResults);
      
      // Update database in a transaction
      await prisma.$transaction(
        batchResults.map(result => {
          if (result.error) return null;
          
          return prisma.wallet_balance_history.create({
            data: {
              wallet_address: result.wallet,
              balance_lamports: result.balance,
              timestamp: new Date()
            }
          });
        }).filter(Boolean)
      );
      
      // Update user records
      await prisma.$transaction(
        batchResults.map(result => {
          if (result.error) return null;
          
          return prisma.users.update({
            where: { wallet_address: result.wallet },
            data: {
              last_balance_check: new Date(),
              last_known_balance: result.balance
            }
          });
        }).filter(Boolean)
      );
      
    } catch (error) {
      logApi.error('Batch balance check failed:', error);
      // Mark all wallets in batch for retry
      for (const wallet of batch) {
        this.activeChecks.delete(wallet);
        const schedule = this.userSchedule.get(wallet);
        if (schedule) {
          schedule.failedAttempts++;
          schedule.nextCheck = Date.now() + Math.min(
            30000 * Math.pow(2, schedule.failedAttempts - 1),
            this.config.rateLimit.maxCheckIntervalMs
          );
          this.userSchedule.set(wallet, schedule);
        }
      }
    }
  }
  
  // Process results...
}
```

## Benefits of Batch Processing

1. **Reduced RPC Calls**: For 1000 users:
   - V1: 1000 separate calls (1 per user)
   - V2: 10 batch calls (100 users per batch)
   - **99% reduction in RPC calls**

2. **Improved Rate Limit Efficiency**:
   - Much more headroom under RPC rate limits
   - Can check balances more frequently
   - Better handles user growth

3. **Lower Latency**:
   - Fewer network round-trips
   - Parallel database updates

4. **Cost Savings**:
   - RPC providers like QuickNode charge by request volume
   - Significant cost reduction at scale

## Implementation Timeline

1. **Phase 1**: Add batch processing to the existing service
2. **Phase 2**: Implement activity-based user segmentation
3. **Phase 3**: Add performance analytics for comparison with V1

## Metrics to Track

- RPC calls per hour
- Average check time per user
- Database write efficiency
- Error rates compared to individual checks

This optimization will allow us to scale to hundreds of thousands of users while minimizing Solana RPC costs.