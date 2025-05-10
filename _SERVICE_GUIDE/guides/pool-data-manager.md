# Pool Data Manager Service Documentation

This document contains diagrams and analysis for components within the `pool-data-manager` service, focusing on its data collection, management, and integration with other services like Helius pool tracking. We'll also examine any Web3 interactions relevant to the migration.

---

## Overview

The `pool-data-manager` service appears to provide a reactive, on-demand system for fetching and managing liquidity pool data for Solana tokens. It seems to use DexScreener as a primary data source and integrates with the `helius-pool-tracker`.

Key components include:
*   `pool-data-manager.js` (The core data management logic)
*   `helius-integration.js` (Extends/integrates with `helius-pool-tracker`)
*   `index.js` (Service entry point)

*(Further analysis to be added as files are reviewed)*

---

### Component: `services/pool-data-manager/pool-data-manager.js` (PoolDataManager)

**Purpose:** This class is a reactive, on-demand manager for fetching, caching (in DB), and providing liquidity pool data for Solana tokens. It uses `dexscreenerClient` (from `solana-engine`) as its source for pool information and synchronizes this data with the Prisma database.

**Key Interactions & Structure:**

```
PoolDataManager (Singleton)
 |
 +-- Dependencies:
 |   |   
 |   +-- @prisma/client (Note: Instantiates a new client locally, should use shared Prisma instance)
 |   +-- dexscreenerClient (from `../solana-engine/dexscreener-client.js` - for DexScreener API calls)
 |   +-- serviceEvents (for emitting `pool:data_updated` event)
 |   L__ logApi, color utilities
 |
 +-- Core Properties:
 |   |   
 |   +-- this.inProgressTokens (Set: tracks tokens currently being fetched to prevent duplicates)
 |   +-- this.poolFetchQueue (Array: queue for tokens needing pool data)
 |   +-- this.minLiquidityUsd, this.maxPoolsPerToken (configuration for filtering pools)
 |   L__ this.stats (for monitoring fetch operations)
 |
 +-- Core Methods:
 |   |
 |   +-- initializeDexScreener(): Ensures the shared `dexscreenerClient` is initialized.
 |   |
 |   +-- getPoolsForToken(tokenAddress, options):
 |   |   L__ Main public method. Checks DB first.
 |   |   L__ If data missing or `forceRefresh`, calls `fetchAndStorePoolsForToken` or queues it.
 |   |   L__ Supports `waitForFetch` option for synchronous or background fetching.
 |   |
 |   +-- queuePoolFetch(tokenAddress): Adds a token to `poolFetchQueue` for background processing.
 |   |
 |   +-- fetchAndStorePoolsForToken(tokenAddress):
 |   |   L__ Marks token as in-progress.
 |   |   L__ Calls `dexscreenerClient.getTokenPools('solana', tokenAddress)`.
 |   |   L__ Handles DexScreener rate limits (429 errors) with a retry/DB check.
 |   |   L__ Filters/sorts/limits fetched pools.
 |   |   L__ Calls `storePoolsInDatabase()`.
 |   |   L__ Emits `pool:data_updated` event.
 |   |
 |   +-- storePoolsInDatabase(tokenAddress, poolsFromDexScreener):
 |   |   L__ Uses Prisma transaction (`prisma.$transaction`).
 |   |   L__ Compares fetched pools with existing DB entries for the token; adds new ones, deletes outdated ones from `token_pools`.
 |   |   L__ Creates/updates the token record in the `tokens` table with metadata and refresh timestamps.
 |   |
 |   +-- processQueue(): Processes the `poolFetchQueue`, ensuring one fetch per token at a time.
 |
 +-- Incorrect Prisma Usage:
     L__ Instantiates `new PrismaClient()` locally instead of using a shared instance from `config/prisma.js`.
```

**Migration Notes for `services/pool-data-manager/pool-data-manager.js`:**
*   **No Direct Solana Client Library Dependencies:** This manager uses `dexscreenerClient` for external data and Prisma for local storage. It does not directly interact with `@solana/web3.js` or v2 Solana client libraries.
*   **Agnostic to Web3 Migration:** The functionality of this module is independent of the v1 to v2 migration of Solana client SDKs. Its primary external dependency for Solana-related data is `dexscreenerClient`, which itself is agnostic.
*   **No Changes Required (for Web3 Migration):** This file does not require changes related to the `@solana/web3.js` v1 migration.
*   **Prisma Client:** The local instantiation of `PrismaClient` should be changed to use the shared Prisma client (typically exported from a central config file like `../../config/prisma.js`) for consistency and efficient connection management.

---

### Component: `services/pool-data-manager/helius-integration.js`

**Purpose:** This module extends the `heliusPoolTracker` (imported from `../solana-engine/helius-pool-tracker.js`) by adding methods that allow it to be populated with pool data fetched via the `PoolDataManager`. It essentially makes `heliusPoolTracker` aware of `PoolDataManager` as a source for pool information.

**Key Interactions & Structure:**

```
helius-integration.js (Modifies heliusPoolTracker instance)
 |
 +-- Imports:
 |   |   
 |   +-- heliusPoolTracker (from '../solana-engine/helius-pool-tracker.js') - The object being extended.
 |   +-- poolDataManager (from './pool-data-manager.js') - Used as a data source.
 |   L__ logApi, color utilities
 |
 +-- Functionality (Methods added/overridden on `heliusPoolTracker` instance):
 |   |
 |   +-- addPoolsToCache(tokenAddress, pools):
 |   |   L__ Adds provided `pools` to `heliusPoolTracker`'s internal `this.tokenToPools` map and updates stats.
 |   |
 |   +-- setPools(tokenAddress, pools):
 |   |   L__ Clears existing pools for `tokenAddress` in `heliusPoolTracker` and then calls `addPoolsToCache`.
 |   |
 |   +-- fetchPoolsWithManager(tokenAddress, options):
 |   |   L__ Calls `poolDataManager.getPoolsForToken(tokenAddress, options)`.
 |   |   L__ If pools are found, calls `this.setPools(tokenAddress, pools)` (on `heliusPoolTracker` instance) to update its cache.
 |   |
 |   +-- Overridden monitorTokenPrice(tokenAddress, priceHandler):
 |       L__ Stores original `heliusPoolTracker.monitorTokenPrice`.
 |       L__ New implementation first tries `this.getPoolsForToken(tokenAddress)` (original `heliusPoolTracker` method).
 |       L__ If no pools, calls `poolDataManager.getPoolsForToken(tokenAddress, { forceRefresh: true, waitForFetch: true })`.
 |       L__ If pools found via manager, calls `this.setPools(tokenAddress, pools)` (on `heliusPoolTracker` instance).
 |       L__ Finally, calls the original `monitorTokenPrice` method.
```

**Migration Notes for `services/pool-data-manager/helius-integration.js`:**
*   **No Direct Solana Client Library Dependencies:** This integration script itself does not directly import or use `@solana/web3.js` or any v2 Solana client SDKs.
*   **Indirect Migration Impact:** Its v1/v2 compatibility is determined by the modules it integrates: `heliusPoolTracker` and `poolDataManager`.
    *   `poolDataManager` (as analyzed) is largely agnostic to v1/v2 SDK versions.
    *   The critical dependency is `heliusPoolTracker`. If `heliusPoolTracker` undergoes changes due to the v1-to-v2 migration (e.g., how it expects pool data, how its internal state is managed, or the arguments to its methods like `getPoolsForToken` or the original `monitorTokenPrice`), this integration script might need adjustments to match the new interface or behavior of `heliusPoolTracker`.
*   **Focus on Interface Contract:** The primary concern is maintaining the functional contract between this module and the `heliusPoolTracker` it extends. If `heliusPoolTracker` changes significantly, this monkey-patching module will need to be updated.
*   **No Changes Required (Directly for Web3 Migration):** No code within this specific file needs to be changed due to `@solana/web3.js` v1 deprecation, unless the methods of `heliusPoolTracker` that it calls or overrides change their signatures or expected data types as part of their own v2 migration.

---

### Component: `services/pool-data-manager/index.js`

**Purpose:** This file serves as the main entry point for the `pool-data-manager` service. It imports and re-exports the singleton instance of the `PoolDataManager` class from `pool-data-manager.js`.

**Key Interactions & Structure:**

```
pool-data-manager/index.js
 |
 L__ Imports `poolDataManager` from './pool-data-manager.js'
 L__ Exports `poolDataManager` as default.
```

**Migration Notes for `services/pool-data-manager/index.js`:**
*   **No Direct Solana Client Library Dependencies:** This is purely an export module.
*   **Unaffected by Web3 Migration:** Requires no changes for the v1 to v2 migration.

--- 