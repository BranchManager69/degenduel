# Token Refresh Scheduler Technical Details

This document provides in-depth technical details about the Advanced Token Refresh Scheduler implementation.

## Component Architecture

### TokenRefreshScheduler (Main Service)

The core scheduler service that orchestrates the token refresh process.

**Key Responsibilities:**
- Maintains the overall refresh state and scheduling
- Manages the priority queue and refresh cycle
- Handles API calls and rate limiting
- Processes token batches and updates the database
- Implements circuit breaking and error handling

**Important Methods:**
- `initialize()`: Set up the scheduler and load configuration
- `loadActiveTokens()`: Fetch tokens from database and populate the queue
- `calculateTokenPriority()`: Determine token importance for scheduling
- `start()`, `stop()`: Control the scheduler
- `runSchedulerCycle()`: Execute a scheduling iteration
- `processBatch()`: Process a batch of tokens
- `updateTokenPrices()`: Update token prices in the database

### PriorityQueue

A specialized data structure for efficient token scheduling.

**Key Features:**
- O(log n) operations for queue management
- Priority and time-based scheduling
- Efficient retrieval of due tokens
- Token lookup by ID for fast updates

**Important Methods:**
- `enqueue(item)`: Add or update a token in the queue
- `dequeue()`: Remove highest priority token
- `getDueItems(currentTime, maxItems)`: Get tokens due for refresh
- `compareItems(a, b)`: Priority comparison function

### TokenRankAnalyzer

Analyzes token importance and provides scheduling insights.

**Key Features:**
- Token distribution analysis by tier
- Refresh recommendations based on token characteristics
- API usage projections

**Important Methods:**
- `analyzeTokenDistribution(tokens)`: Generate statistics about token distribution
- `getRefreshRecommendations(tokens)`: Provide optimal settings recommendations

### BatchOptimizer

Optimizes the composition of token batches for API calls.

**Key Features:**
- Batch creation based on token priority
- Optimization for API throughput
- Avoidance of related tokens in same batch (future feature)

**Important Methods:**
- `createBatches(tokens, options)`: Create optimized batches
- `getOptimalBatchSize(tokens)`: Determine ideal batch size

### MetricsCollector

Collects and analyzes performance metrics.

**Key Features:**
- Real-time and historical metrics tracking
- Performance statistics calculation
- Success/failure rate monitoring

**Important Methods:**
- `recordBatchCompletion(tokenCount, durationMs)`: Record successful batch
- `recordBatchFailure(tokenCount, durationMs, errorMessage)`: Record failed batch
- `getMetrics()`: Get current metrics

### TokenRefreshIntegration

Integration layer that connects the scheduler to other services.

**Key Features:**
- Clean API for external interaction
- Event handling for system integration
- Admin API support

**Important Methods:**
- `initializeTokenRefresh()`: Set up the refresh system
- `refreshToken(tokenAddress)`: Manually refresh a token
- `updateTokenRefreshSettings(tokenId, settings)`: Update token settings
- `getSchedulerMetrics()`: Get current scheduler metrics
- `getRefreshRecommendations()`: Get refresh recommendations

## Token Prioritization Logic

Tokens are prioritized based on multiple factors:

1. **Base Tier from Rank:**
   - Tier 1 (Critical): Ranks 1-50
   - Tier 2 (High): Ranks 51-200
   - Tier 3 (Medium): Ranks 201-500
   - Tier 4 (Low): Ranks 501-1000
   - Tier 5 (Minimal): Ranks 1001-3000
   - Tier 6 (Inactive): Ranks 3001+

2. **Priority Score Adjustments:**
   - Contest usage: +300 points (ensures at least HIGH tier)
   - High volume (>$1M): +200 points
   - Medium volume ($100K-$1M): +100 points
   - Low volume ($10K-$100K): +50 points

3. **Volatility Adjustment:**
   - Price changed in last hour: 2.0x factor
   - Price changed in last 3 hours: 1.5x factor
   - Price changed in last 6 hours: 1.2x factor
   - No price change in 24+ hours: 0.9x factor
   - No price change in 48+ hours: 0.8x factor

## Refresh Interval Calculation

Token refresh intervals are calculated dynamically:

1. Get base interval from token's tier
2. Apply volatility adjustment factor
3. Enforce minimum interval (15 seconds)
4. Apply rate limit adjustments if necessary

Formula: `adjustedInterval = max(minInterval, baseInterval / (volatilityFactor * tierFactor))`

## Rate Limiting Strategy

The scheduler implements sophisticated rate limiting:

1. Sliding window tracking of API calls
2. Adaptive adjustment based on success rates
3. Exponential backoff during API errors (2s, 4s, 8s, up to 30s)
4. Circuit breaking during persistent failures
5. Lock mechanism to prevent concurrent API calls
6. Minimum 3-second delay between batches

## Batch Processing Pipeline

1. Get due tokens from priority queue
2. Optimize tokens into batches
3. For each batch:
   - Call Jupiter API for prices
   - Process and compare price data
   - Update database with new prices
   - Update price history if changed
   - Requeue tokens with updated priorities

## Error Handling

The scheduler implements robust error handling:

1. **API Call Failures:**
   - Track failed tokens
   - Implement exponential backoff
   - Max 5-minute backoff after repeated failures

2. **Database Errors:**
   - Transaction-based updates
   - Retry logic for transient errors

3. **Rate Limit Errors:**
   - Automatic rate adjustment
   - Batch size reduction

## Database Interactions

The scheduler interacts with these database tables:

1. `tokens`: Main token information and refresh settings
2. `token_prices`: Current token prices
3. `token_price_history`: Historical price data
4. `token_rank_history`: Historical rank data

## Performance Considerations

- **Memory Usage**: The scheduler uses efficient data structures to minimize memory usage
- **CPU Usage**: Batch processing is optimized to reduce CPU overhead
- **Database Load**: Updates are batched to minimize database operations
- **API Efficiency**: Tokens are batched to maximize API throughput

## Scaling

The scheduler is designed to handle millions of tokens with efficient prioritization. Some scaling considerations:

1. **Horizontal Scaling**: Can be distributed across multiple instances with token partitioning
2. **Queue Optimization**: The priority queue uses O(log n) operations for efficient scheduling
3. **Adaptive Behavior**: Automatically adjusts to system load and API constraints

## Coordination with Jupiter Client

The scheduler is designed to work with the Jupiter Client by:

1. **Using Jupiter's API methods**: All API calls are made through the Jupiter Client
2. **Lock mechanism**: Both systems respect a shared lock to prevent concurrent API calls
3. **Disabling automatic polling**: Jupiter Client's automatic polling is disabled by default
4. **Rate limit coordination**: Both systems respect the same rate limit settings

## Integration Hooks

The scheduler provides several integration points:

1. **Events**: Emits events for service status, batch completion, etc.
2. **API**: REST API for monitoring and control
3. **Metrics**: Real-time performance metrics
4. **WebSocket**: Status updates via the system settings websocket