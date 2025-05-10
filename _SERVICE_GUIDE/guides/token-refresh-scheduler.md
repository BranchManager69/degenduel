# Token Refresh Scheduler Service Documentation

This document contains diagrams and analysis for components within the `token-refresh-scheduler` service, focusing on its scheduling logic, optimization techniques, and any Web3 interactions relevant to the migration.

---

## Overview

The `token-refresh-scheduler` service is likely responsible for periodically refreshing token data (e.g., prices, metadata) by calling other services or external APIs. It appears to use several helper modules for optimizing its scheduling and batching operations.

Key components include:
*   `batch-optimizer.js`
*   `metrics-collector.js`
*   `priority-queue.js`
*   `rank-analyzer.js`
*   (The main service file, presumably `token-refresh-scheduler.js`, is yet to be reviewed)

*(Further analysis to be added as files are reviewed)*

---

### Component: `services/token-refresh-scheduler/batch-optimizer.js` (BatchOptimizer)

**Purpose:** This class is responsible for optimizing the way tokens are grouped into batches for refresh operations. The goal is to improve throughput and efficiency when calling external APIs by intelligently scheduling and sizing these batches.

**Key Interactions & Structure:**

```
BatchOptimizer
 |
 +-- Configuration (this.config, passed in constructor):
 |   L__ e.g., maxTokensPerBatch, batchDelayMs
 |
 +-- Core Methods:
 |   |
 |   +-- createBatches(tokens, options):
 |   |   L__ Sorts input `tokens` by `priority` (desc) then `nextRefreshTime` (asc).
 |   |   L__ Slices sorted tokens into batches based on `maxTokensPerBatch`.
 |   |   L__ (Future consideration: Graph coloring algorithm for advanced batching based on token relations).
 |   |
 |   +-- analyzeBatchResult(batch, success, metrics):
 |   |   L__ Placeholder for future logic to adapt strategy based on historical performance.
 |   |   L__ Currently returns default/configured values.
 |   |
 |   +-- getOptimalBatchSize(tokens):
 |       L__ Determines an optimal batch size.
 |       L__ Starts with `this.config.maxTokensPerBatch`.
 |       L__ Reduces size if many high-priority tokens are present.
 |       L__ (Future consideration: System load based on a `metricsCollector`).
```

**Migration Notes for `services/token-refresh-scheduler/batch-optimizer.js`:**
*   **No Direct Solana Client Library Dependencies:** This module contains business logic for batching and does not directly interact with `@solana/web3.js` or any v2 Solana SDKs.
*   **Unaffected by Web3 Migration:** Its functionality is internal to the scheduling process and is not impacted by the v1 to v2 migration of Solana SDKs.
*   **No Changes Required:** This file requires no changes for the Web3 migration.

---

### Component: `services/token-refresh-scheduler/metrics-collector.js` (MetricsCollector)

**Purpose:** This class is responsible for collecting, storing, and analyzing various metrics related to the execution of token refresh batches. This data can be used for monitoring the health and performance of the refresh scheduler and potentially for input into optimization algorithms (like those in `BatchOptimizer`).

**Key Interactions & Structure:**

```
MetricsCollector
 |
 +-- Configuration (this.config, passed in constructor):
 |   L__ e.g., metricsWindowMs, maxHistoryWindows
 |
 +-- Core Properties (State):
 |   |
 |   +-- this.currentWindow (Object: tracks stats for the current time window - attempts, completions, failures, durations, errors, API calls for batches & tokens).
 |   +-- this.history (Object: stores completed windows and overall totals).
 |   L__ this.performance (Object: stores calculated metrics like avg/min/max/P95 batch duration, success rate).
 |
 +-- Core Methods:
 |   |
 |   +-- reset(): Initializes/clears all metrics.
 |   |
 |   +-- recordBatchCompletion(tokenCount, durationMs):
 |   |   L__ Increments success counters for current window and history.
 |   |   L__ Adds duration to `batchDurations`.
 |   |   L__ Calls `updatePerformanceMetrics()` and `checkWindowRollover()`.
 |   |
 |   +-- recordBatchFailure(tokenCount, durationMs, errorMessage):
 |   |   L__ Increments failure counters and stores error.
 |   |   L__ Calls `updatePerformanceMetrics()` and `checkWindowRollover()`.
 |   |
 |   +-- updatePerformanceMetrics(): Recalculates avg, min, max, P95 batch durations and success rates.
 |   |
 |   +-- checkWindowRollover(): If current window duration exceeds `metricsWindowMs`, archives current window to history and starts a new one.
 |   |
 |   +-- getMetrics(): Returns a structured object with current, historical, and performance metrics.
```

**Migration Notes for `services/token-refresh-scheduler/metrics-collector.js`:**
*   **No Direct Solana Client Library Dependencies:** This module handles internal metrics and does not directly interact with `@solana/web3.js` or any v2 Solana SDKs.
*   **Unaffected by Web3 Migration:** Its functionality is internal to the scheduler and is not impacted by the v1 to v2 migration of Solana SDKs.
*   **No Changes Required:** This file requires no changes for the Web3 migration.

---

### Component: `services/token-refresh-scheduler/priority-queue.js` (PriorityQueue)

**Purpose:** This class implements a sophisticated priority queue data structure, specifically designed to manage and prioritize tokens for refresh operations. It uses a min-heap internally and allows for efficient addition, removal, and retrieval of the highest-priority items based on a custom comparison logic.

**Key Interactions & Structure:**

```
PriorityQueue
 |
 +-- Configuration (this.config, passed in constructor - currently unused by queue logic itself).
 |
 +-- Core Properties (State):
 |   |   
 |   +-- this.items (Array: Stores the heap elements, representing tokens to be refreshed).
 |   L__ this.tokenMap (Map: `tokenId -> index_in_items_array` for O(1) average time lookups/updates).
 |
 +-- Core Methods:
 |   |
 |   +-- enqueue(item): Adds a new token item or updates an existing one in the queue.
 |   |   L__ An `item` object is expected to have `id`, `priority` (score), and `nextRefreshTime`.
 |   |   L__ Uses `tokenMap` to check for existing items.
 |   |   L__ Calls `siftUp` (for new items) or `siftDown`/`siftUp` (for updates) to maintain heap property.
 |   |
 |   +-- dequeue(): Removes and returns the highest priority item (root of the heap).
 |   |   L__ Restores heap property using `siftDown`.
 |   |   L__ Updates `tokenMap`.
 |   |
 |   +-- getDueItems(currentTime, maxItems):
 |   |   L__ Creates a temporary copy of the heap.
 |   |   L__ Iteratively extracts the highest priority item from the copy, checks if its `nextRefreshTime <= currentTime`.
 |   |   L__ Returns an array of due items (up to `maxItems`).
 |   |
 |   +-- peek(): Returns the highest priority item without removal.
 |   |
 |   +-- isEmpty(), size(): Standard queue utility methods.
 |   |
 |   +-- siftUp(index), siftDown(index): Standard heap maintenance algorithms.
 |   |
 |   +-- compareItems(a, b): Custom comparison logic for prioritization:
 |       1.  Due status (due items first: `a.nextRefreshTime <= now`).
 |       2.  `nextRefreshTime` (earlier time first).
 |       3.  `priority` score (higher score first - note: `b.priority - a.priority` for min-heap).
 |       4.  `id` (for stable sort as a tie-breaker).
```

**Migration Notes for `services/token-refresh-scheduler/priority-queue.js`:**
*   **No Direct Solana Client Library Dependencies:** This module is a pure data structure implementation using standard JavaScript. It does not directly interact with `@solana/web3.js` or any v2 Solana SDKs.
*   **Unaffected by Web3 Migration:** Its functionality is internal to the scheduling logic and is not impacted by the v1 to v2 migration of Solana SDKs.
*   **No Changes Required:** This file requires no changes for the Web3 migration.

---

### Component: `services/token-refresh-scheduler/rank-analyzer.js` (TokenRankAnalyzer)

**Purpose:** This class analyzes a collection of token data (presumably from the database) to understand their distribution by rank, refresh intervals, and other characteristics. The output of this analysis is used to generate recommendations for optimizing token refresh schedules.

**Key Interactions & Structure:**

```
TokenRankAnalyzer
 |
 +-- Configuration (this.config, passed in constructor):
 |   L__ e.g., maxTokensPerBatch
 |
 +-- Core Methods:
 |   |
 |   +-- analyzeTokenDistribution(tokens):
 |   |   L__ Expects an array of `token` objects (likely Prisma results with relations like `contest_portfolios`, `token_prices`, `rank_history`).
 |   |   L__ Categorizes tokens into tiers (tier1-tier5, other) based on `token.rank_history[0].rank`.
 |   |   L__ Calculates stats per tier (count, min/max/avg `refresh_interval_seconds`).
 |   |   L__ Calculates overall stats (total tokens, active in contests, with price/rank data, etc.).
 |   |   L__ Produces a `refreshDistribution` based on `refresh_interval_seconds` buckets.
 |   |
 |   +-- getRefreshRecommendations(tokens):
 |       L__ Calls `analyzeTokenDistribution()`.
 |       L__ Estimates `apiCallsPerMinute` based on the distribution and configured `maxTokensPerBatch`.
 |       L__ Returns an object with API call estimates and recommended/adjusted refresh intervals per tier.
```

**Migration Notes for `services/token-refresh-scheduler/rank-analyzer.js`:**
*   **No Direct Solana Client Library Dependencies:** This module performs data analysis on token objects that are assumed to be already populated. It does not directly interact with `@solana/web3.js` or any v2 Solana SDKs.
*   **Unaffected by Web3 Migration:** Its functionality is internal to the scheduling logic and is not impacted by the v1 to v2 migration of Solana SDKs, as long as the input `token` objects it receives are consistently structured.
*   **No Changes Required:** This file requires no changes for the Web3 migration.

---

### Component: `services/token-refresh-scheduler.js` (TokenRefreshScheduler Service)

**Purpose:** This is the main service class that orchestrates the intelligent refreshing of token price data. It uses a priority queue, batch optimization, metrics collection, and rank analysis to efficiently manage API calls to `jupiterClient` and update token prices in the database.

**Key Interactions & Structure:**

```
TokenRefreshScheduler (extends BaseService)
 |
 +-- Dependencies:
 |   |   
 |   +-- @prisma/client (Note: Instantiates a new client locally, should use shared Prisma instance)
 |   +-- jupiterClient (from `solana-engine` - used for `getPrices()`)
 |   +-- heliusClient (from `solana-engine` - imported but UNUSED)
 |   +-- PriorityQueue (local module)
 |   +-- TokenRankAnalyzer (local module)
 |   +-- BatchOptimizer (local module)
 |   +-- MetricsCollector (local module)
 |   L__ logApi, color utilities, service-suite components, config
 |
 +-- Configuration (this.config, loaded from DB/env):
 |   L__ maxTokensPerBatch, minIntervalSeconds, batchDelayMs, apiRateLimit, PRIORITY_TIERS, etc.
 |
 +-- Core Properties (State):
 |   |   
 |   +-- this.priorityQueue (Instance of PriorityQueue for managing token refresh order)
 |   +-- this.rankAnalyzer, this.batchOptimizer, this.metricsCollector (Instances of helper modules)
 |   +-- this.isRunning, this.schedulerInterval, this.metricsInterval (Service lifecycle)
 |   +-- Rate limiting state (apiCallsInCurrentWindow, rateLimitAdjustmentFactor)
 |   L__ this.activeTokens, this.failedTokens, this.prioritizationCache (Tracking token states)
 |
 +-- Core Methods:
 |   |
 |   +-- initialize(): Loads config, initializes helper components, loads active tokens into priority queue.
 |   |
 |   +-- loadActiveTokens(): Fetches tokens from Prisma, calculates initial priority using `calculateTokenPriority`, enqueues them.
 |   |
 |   +-- calculateTokenPriority(token): Determines score and refresh interval based on rank, contest usage, volume, and `PRIORITY_TIERS` config.
 |   |
 |   +-- runSchedulerCycle(): Main loop - gets due tokens, creates batches, processes batches via `processBatch`.
 |   |   L__ Implements rate limiting and adaptive delays.
 |   |
 |   +-- processBatch(batch, ...):
 |   |   L__ Calls `jupiterClient.getPrices(tokenAddressesInBatch)`.
 |   |   L__ Calls `updateTokenPrices()` with the results.
 |   |   L__ Records metrics.
 |   |
 |   +-- updateTokenPrices(batch, priceDataFromJupiter):
 |   |   L__ Updates `tokens` and `token_prices` tables in Prisma.
 |   |   L__ Creates `token_price_history` records.
 |   |   L__ Re-enqueues tokens into `priorityQueue` with potentially adjusted priority/next refresh time.
 |
 +-- Incorrect Prisma Usage:
     L__ Instantiates `new PrismaClient()` locally instead of using a shared instance from `config/prisma.js`.
```

**Migration Notes for `services/token-refresh-scheduler.js`:**
*   **No Direct Solana Client Library Dependencies:** The service's core logic for scheduling, prioritization, batching, and metrics is independent of `@solana/web3.js` or v2 Solana SDKs.
*   **Primary External Data Source (`jupiterClient`):** Its only direct interaction for fetching Solana-related data (token prices) is via `jupiterClient.getPrices()`. As `jupiterClient` (from `solana-engine`) is largely SDK-agnostic for its data fetching operations, this scheduler service is well-insulated.
*   **Unaffected by Web3 Migration:** This file requires no direct changes for the `@solana/web3.js` v1 migration, assuming `jupiterClient` continues to function as expected.
*   **Actionable Items (Non-Migration):**
    *   Change `const prisma = new PrismaClient();` to use the shared Prisma instance (e.g., `import prisma from '../config/prisma.js';`).
    *   Remove the unused import of `heliusClient`.

--- 