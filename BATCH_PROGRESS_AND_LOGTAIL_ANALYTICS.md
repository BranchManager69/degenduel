# Batch Progress System & Logtail Analytics

This document explains how to use the batch progress system for displaying real-time progress in the terminal while collecting rich analytics data in Logtail.

## Overview

The batch progress system provides:

1. A terminal-friendly progress bar with ETA, error counts, and real-time updates
2. Structured logging for analytics and monitoring
3. Built-in error tracking and rate limit detection
4. Performance metrics for batch operations
5. Automatic alerting for error rates and performance issues

## Using Batch Progress

### Basic Usage

```javascript
import { createBatchProgress } from '../../utils/logger-suite/batch-progress.js';

// Create a progress tracker
const progress = createBatchProgress({
  name: 'Processing Transactions',
  total: transactions.length,
  service: 'TRANSACTION_SERVICE',
  operation: 'process_txs',
  category: 'blockchain'
});

// Start the operation
progress.start();

// Process items in batches
for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
  const batch = batches[batchIndex];
  const batchNum = batchIndex + 1;
  
  try {
    // Show what we're working on
    progress.update(0, [`Processing batch ${batchNum}`]);
    
    // Process the batch and track time
    const startTime = Date.now();
    const result = await processBatch(batch);
    const batchTime = Date.now() - startTime;
    
    // Mark batch complete with timing info
    progress.completeBatch(batchNum, batch.length, [], batchTime);
  } catch (error) {
    // Track errors with detailed info
    const isRateLimit = error.status === 429;
    progress.trackError(
      batchNum,
      error,
      false, // Not fatal, we'll continue with other batches
      error.status,
      isRateLimit ? 'RateLimit' : 'ProcessingError'
    );
  }
}

// Finish and get stats
const stats = progress.finish({
  message: `Processed ${transactions.length} transactions`
});

console.log(`Processed at ${stats.itemsPerSecond} items/sec with ${stats.errors} errors`);
```

### Advanced Options

The batch progress tracker supports many options:

```javascript
const progress = createBatchProgress({
  // Basic settings
  name: 'API Batch Processing',
  total: items.length,
  service: 'API_SERVICE',
  
  // Display settings
  progressChar: '█',      // Character for completed progress
  emptyChar: '░',         // Character for remaining progress
  barLength: 20,          // Length of progress bar
  displayErrors: true,    // Show errors in TTY mode
  
  // Rate settings
  throttleMs: 250,        // Min time between updates
  updateInterval: 10,     // Update every X% in non-TTY mode
  
  // Analytics settings
  operation: 'api_batch', // Operation identifier
  category: 'data_sync',  // Category for grouping
  
  // Custom metadata for every log
  metadata: {
    api_version: 'v2',
    environment: 'production',
    batch_size: 50
  }
});
```

## Logtail Integration

### Structured Data

The batch progress system emits structured logs that work perfectly with Logtail's analytics and alerting features:

1. **Batch Start**: `_source: 'batch_analytics', event_type: 'batch_start'`
2. **Batch Complete**: `_source: 'batch_analytics', event_type: 'batch_complete'`
3. **Batch Error**: `_source: 'batch_error', event_type: 'batch_error'`
4. **Final Summary**: `_source: 'batch_analytics', _batch_summary: {...}`

### Setting Up Logtail Alerts

With these structured logs, you can set up powerful alerts in Logtail:

1. In Logtail, go to **Alerts** and create a new alert
2. Create the following alerts:

#### Rate Limiting Alert

- **Query**: `_alert_group:"rate_limit" AND _source:"batch_error"`
- **Condition**: Count > 5 in the last 15 minutes
- **Priority**: Medium
- **Notification**: Email/Slack/Discord

#### High Error Rate Alert

- **Query**: `_alert_group:"high_error_rate"`
- **Condition**: Count > 0 in the last 15 minutes
- **Priority**: High
- **Notification**: Email/Slack/Discord

#### Performance Degradation Alert

- **Query**: `_alert_group:"slow_performance" AND _performance_alert.slowdown_factor:>2`
- **Condition**: Count > 0 in the last 1 hour
- **Priority**: Low
- **Notification**: Email/Slack/Discord

### Creating Dashboards

Create rich dashboards using the structured data:

1. **API Performance Dashboard**:
   - Query: `_source:"batch_analytics"`
   - Charts:
     - Average items/second by operation
     - Error rates by operation
     - Batch processing times (min/max/avg)

2. **Rate Limit Dashboard**:
   - Query: `_source:"batch_error" AND _error.rate_limit:true`
   - Charts:
     - Rate limits by operation
     - Rate limits by time of day
     - Average retry times

3. **Batch Duration Analysis**:
   - Query: `_source:"batch_analytics" AND event_type:"batch_complete"`
   - Charts:
     - Batch duration distribution
     - Slowest batches
     - Performance trends over time

## Troubleshooting

### Dealing with Rate Limits

The batch progress system automatically detects rate limits (429 errors) and extracts the Retry-After header when available. It will:

1. Log detailed information about the rate limit
2. Record rate limit patterns for analysis
3. Emit structured data with the `_alert_group: "rate_limit"` field
4. Include retry time in the logs when available

### Performance Monitoring

The system tracks detailed performance metrics:

1. Average item processing time
2. Items processed per second
3. Min/max/avg batch times
4. Deviation percentage between fastest and slowest batches

Use these metrics to identify performance bottlenecks and optimize batch processing.

## Best Practices

1. **Always track batch timing**: Pass the batch processing time to `completeBatch()` for accurate analytics
2. **Use meaningful operation names**: Make operation names descriptive and consistent for better analytics
3. **Add custom metadata**: Include relevant context like API version, environment, etc.
4. **Set appropriate error thresholds**: Adjust the error rate threshold in the `finish()` method if needed
5. **Review the analytics regularly**: Check Logtail dashboards to identify patterns and optimize performance

## Example: Jupiter API Batching

The Jupiter API client uses the batch progress system to track token price fetching:

```javascript
// Initialize progress tracker with detailed metadata
const progress = createBatchProgress({
  name: 'Jupiter Token Batches',
  total: batches.length,
  service: SERVICE_NAMES.JUPITER_CLIENT,
  operation: 'jupiter_price_batches',
  category: 'api_requests',
  metadata: {
    total_tokens: mintAddresses.length,
    effective_batch_size: effectiveBatchSize,
    max_concurrent_requests: MAX_CONCURRENT_REQUESTS,
    max_retries: MAX_RETRIES,
    endpoint: this.config.endpoints.price.getPrices,
    api_type: 'jupiter'
  }
});

// Start tracking
progress.start();

// Track batch timing
const batchStartTime = Date.now();
const response = await this.makeRequest(/* ... */);
const batchDuration = Date.now() - batchStartTime;
progress.completeBatch(batchNum, batch.length, [], batchDuration);
```

This produces rich analytics data that helps identify performance patterns, rate limit issues, and optimization opportunities.