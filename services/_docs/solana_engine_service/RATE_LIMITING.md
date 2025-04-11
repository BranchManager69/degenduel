# API Rate Limiting and Token Updates

## Overview

As of April 2025, we've made significant changes to how token price updates are managed to prevent rate limit issues with the Jupiter API and introduced a new DexScreener client with its own rate limiting strategy. This document explains the current architecture and coordination between systems.

## Architecture

### Two Token Update Mechanisms

The system has two mechanisms for updating token prices:

1. **Jupiter Client Automatic Polling**:
   - Located in `services/solana-engine/jupiter-client.js`
   - Polls every 30 seconds (if enabled)
   - Updates tokens that the application has subscribed to via `subscribeToPrices()`
   - **Now disabled by default** to avoid conflicts

2. **Token Refresh Scheduler**:
   - Located in `services/token-refresh-scheduler.js`
   - More sophisticated system with priority-based scheduling
   - Handles the entire token database with smart prioritization
   - **Now the primary mechanism** for token price updates

## Rate Limiting Improvements

### Lock Mechanism

We've implemented a lock mechanism in both Jupiter and DexScreener clients to prevent concurrent API calls:

#### Jupiter Client
```javascript
this.isFetchingPrices = false; // Lock flag
this.lastFetchTime = 0;        // Timestamp tracking
this.minimumFetchGap = 15000;  // Min 15s between full batch fetches
```

#### DexScreener Client
```javascript
// Request locking to prevent concurrent calls
this.isRequestInProgress = false;
this.lastRequestTime = 0;
```

When an API call starts:
1. Check if a call is already in progress
2. If yes, either wait or skip based on context
3. If no, set the lock and proceed
4. Always release the lock when done, even on errors

### API-Specific Rate Limiting

#### Jupiter API
- Default Jupiter API rate limit: 30 requests per second
- Minimum delay between batches: 3000ms
- Exponential backoff for failures

#### DexScreener API
DexScreener has differentiated rate limits for different endpoints:

```javascript
// Standard rate limit (60 req/min)
standardEndpoints: {
  maxRequestsPerMinute: 60,
  delayBetweenRequests: 1050, // Slightly over 1 second to be safe
},

// Enhanced rate limit (300 req/min)
enhancedEndpoints: {
  maxRequestsPerMinute: 300,
  delayBetweenRequests: 210, // Slightly over 200ms to be safe
}
```

The client dynamically tracks rate limit windows for each endpoint type separately.

### Batch Processing

Improved batch processing to avoid rate limits:

1. Jupiter Client:
   - Increased delay between batches from 500ms to 3000ms
   - Reduced default API rate limit from 100/s to 30/s
   - Improved exponential backoff for failures
   - Added better batch progress tracking

2. DexScreener Client:
   - Different batch handling for standard vs enhanced endpoints
   - Sequential processing with appropriate delays
   - Detailed progress tracking for large batches
   - Built-in rate limit window tracking

### Coordination Between Systems

To avoid conflicts, the systems now coordinate:

1. Jupiter Client's automatic polling is disabled by default
2. All clients respect their own lock mechanisms
3. Token Refresh Scheduler coordinates updates from multiple sources
4. All clients implement proper exponential backoff

## Configuration

### Jupiter Client Polling Control

You can control automatic polling with:

```javascript
// Enable automatic polling (use with caution)
jupiterClient.setAutomaticPolling(true);

// Disable automatic polling (default)
jupiterClient.setAutomaticPolling(false);
```

### DexScreener Client Configuration

The DexScreener client is configured through the config file:

```javascript
// In dexscreener-config.js
export const dexscreenerConfig = {
  apiKey: DEXSCREENER_API_KEY,  // Optional API key
  rateLimit: {
    standardEndpoints: {
      maxRequestsPerMinute: 60,
      delayBetweenRequests: 1050,
    },
    enhancedEndpoints: {
      maxRequestsPerMinute: 300,
      delayBetweenRequests: 210,
    },
    batchingEnabled: true,
    batchFailureBackoffMs: 2000,
    maxBackoffMs: 60000,
    backoffFactor: 2.0,
  }
};
```

### Token Refresh Scheduler Configuration

Configured via environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `TOKEN_REFRESH_MAX_BATCH_SIZE` | Maximum tokens per batch | 100 |
| `TOKEN_REFRESH_BATCH_DELAY` | Delay between batches (ms) | 3000 |
| `TOKEN_REFRESH_API_RATE_LIMIT` | API rate limit (requests/second) | 30 |

## Troubleshooting

### Common Issues

1. **Rate limit errors (429)**:
   - Check for concurrent batch processes
   - Verify batch delay settings
   - Consider reducing API rate limit further
   - Check for endpoint type mismatches in DexScreener (standard vs enhanced)

2. **Multiple polling processes**:
   - Ensure Jupiter Client polling is disabled
   - Check for multiple service instances running

3. **Memory usage spikes**:
   - Large token batches can cause memory pressure
   - Consider reducing batch size
   
4. **Endpoint-specific rate limits**:
   - DexScreener has different limits for different endpoints
   - Verify endpoint classification (standard vs enhanced)
   - Check if batch requests are respecting the correct rate limit

### Monitoring

Monitor rate limit issues through:
1. Server logs (look for 429 errors)
2. TokenRefreshScheduler metrics
3. Admin monitoring panel
4. DexScreener API response headers for rate limit information

## API-Specific Tips

### Jupiter API
- Prefer batched requests when possible
- Consider using cache for less frequently changed data
- Keep automatic polling disabled

### DexScreener API
- Use the appropriate endpoint category (standard vs enhanced)
- For larger token batches, consider using the enhanced endpoints when possible
- Leverage the built-in Redis caching for frequently accessed data

## Future Improvements

Planned improvements:
1. Better queue prioritization based on market activity
2. Dynamic batch sizing based on API health
3. Improved circuit breaking for persistent API issues
4. Advanced data reconciliation between Jupiter and DexScreener
5. Cross-API rate limit coordination in TokenRefreshScheduler

## Contact

For issues related to token updates or rate limiting, contact the DegenDuel engineering team.