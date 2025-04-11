# Advanced Token Refresh Scheduler

The Advanced Token Refresh Scheduler is a sophisticated system for efficiently managing token price updates from external APIs while respecting rate limits and optimizing for high-priority tokens.

## Overview

The scheduler intelligently manages how and when token prices are refreshed by:

1. Prioritizing tokens based on importance (rank, usage in contests, volatility)
2. Dynamically adjusting refresh intervals from 15 to 300+ seconds
3. Respecting API rate limits with adaptive throttling
4. Efficiently batching token updates for better throughput
5. Implementing circuit breaking for API failures

## Key Features

- **Priority-based Scheduling**: Tokens are refreshed based on their importance, with top tokens updated more frequently
- **Adaptive Rate Limiting**: Automatically adjusts API usage to stay within limits
- **Intelligent Batching**: Optimizes batch composition to maximize API throughput
- **Dynamic Intervals**: Refresh frequency adjusts based on token volatility and activity
- **Robust Error Handling**: Implements exponential backoff for failed requests
- **Comprehensive Metrics**: Real-time performance monitoring

## Architecture

The token refresh scheduler is composed of several specialized components:

1. **TokenRefreshScheduler** (core scheduler service)
2. **PriorityQueue** (efficient token scheduling data structure)
3. **TokenRankAnalyzer** (analyzes token importance)
4. **BatchOptimizer** (optimizes API call batches)
5. **MetricsCollector** (collects performance metrics)
6. **TokenRefreshIntegration** (connects to other services)

## Configuration

The scheduler can be enabled or disabled in the service profiles:

```javascript
// In config.js
service_profiles: {
  production: {
    // ...
    token_refresh_scheduler: true, // Enable in production
  },
  development: {
    // ...
    token_refresh_scheduler: false, // Disable in development
  }
}
```

Environment variables that can be used to configure the scheduler:

| Variable | Description | Default |
|----------|-------------|---------|
| `TOKEN_REFRESH_MAX_BATCH_SIZE` | Maximum tokens per batch | 100 |
| `TOKEN_REFRESH_MIN_INTERVAL` | Minimum refresh interval (seconds) | 15 |
| `TOKEN_REFRESH_BATCH_DELAY` | Delay between batches (ms) | 3000 |
| `TOKEN_REFRESH_API_RATE_LIMIT` | API rate limit (requests/second) | 30 |
| `TOKEN_REFRESH_METRICS_INTERVAL` | Metrics reporting interval (ms) | 60000 |
| `TOKEN_REFRESH_PRIORITIZATION` | Enable prioritization | true |
| `TOKEN_REFRESH_DYNAMIC_INTERVALS` | Enable dynamic intervals | true |
| `TOKEN_REFRESH_ADAPTIVE_RATE` | Enable adaptive rate limiting | true |

## Database Schema Changes

The token refresh scheduler relies on several fields added to the `tokens` table:

```sql
model tokens {
  // Existing fields...
  refresh_interval_seconds  Int       @default(30)
  priority_score            Int       @default(0)
  last_refresh_attempt      DateTime?
  last_refresh_success      DateTime?
  last_price_change         DateTime?
  refresh_metadata          Json?     @default("{}")
}
```

## Integration with Other Services

The scheduler integrates with:

- **Market Data Service**: For token price updates
- **Jupiter Client**: For price API calls (with automatic polling disabled by default)
- **Service Manager**: For lifecycle management
- **Circuit Breaker**: For fault tolerance

> **IMPORTANT**: As of April 2025, the Jupiter Client's automatic polling is disabled by default to avoid conflicts with this scheduler. The Token Refresh Scheduler is now the primary mechanism for token price updates.

## API Routes

See the [API Routes Documentation](./API_ROUTES.md) for details on the admin API endpoints for managing the token refresh scheduler.

## Best Practices

1. **Test performance impact**: Monitor API rate usage after enabling the scheduler
2. **Tune refresh intervals**: Adjust intervals based on token volatility and importance
3. **Monitor error rates**: Watch for API failures and adjust batch sizes as needed
4. **Use admin API**: Use the admin panel to monitor and control the scheduler