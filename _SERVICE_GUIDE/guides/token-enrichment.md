### Component: `services/token-enrichment/collectors/dexScreenerCollector.js`
// ... existing content for dexScreenerCollector.js ...

---

### Component: `services/token-enrichment/collectors/jupiterCollector.js`

**Purpose:** This module is a data collector that fetches token information (metadata like name, symbol, decimals, logo) and price data from the Jupiter API. It uses the centralized `jupiterClient` (from `solana-engine`) for all its API interactions.

**Key Interactions & Structure:**

```
JupiterCollector (Singleton)
 |
 +-- Dependencies:
 |   |   
 |   L__ jupiterClient, getJupiterClient (from '../../solana-engine/jupiter-client.js') - Core dependency for Jupiter API calls.
 |   L__ logApi, fancyColors (for logging).
 |
 +-- Core Properties:
 |   |   
 |   +-- this.jupiterClient (Instance of the client from solana-engine).
 |   +-- dataCache (In-memory Map for caching API responses for 5 minutes).
 |
 +-- Core Methods:
 |   |
 |   +-- initialize(): Ensures `this.jupiterClient` is initialized.
 |   |
 |   +-- getTokenInfo(tokenAddress):
 |   |   L__ Calls `this.jupiterClient.getTokenInfo(tokenAddress)`.
 |   |   L__ Caches and processes the result using `this.processTokenInfo()`.
 |   |
 |   +-- getTokenInfoBatch(tokenAddresses): (Note: Two conflicting implementations exist in the source file)
 |   |   L__ *Version 1:* Calls `this.jupiterClient.getPrices(chunk)` for prices and then `this.jupiterClient.getTokenInfo(address)` for each token's static data.
 |   |   L__ *Version 2:* Uses `this.jupiterClient.tokenMap` for static data and falls back to individual `getTokenInfo` if not in map. Does not explicitly fetch prices in its batch logic here.
 |   |   L__ Both versions use caching and chunking.
 |   |
 |   +-- getTokenPrice(tokenAddress):
 |   |   L__ Calls `this.jupiterClient.getTokenPrice(tokenAddress)` (likely implemented via `getPrices` in `jupiterClient`).
 |   |   L__ Caches and processes the result.
 |   |
 |   +-- checkTokenExists(tokenAddress):
 |   |   L__ Checks against `this.jupiterClient.tokenList`.
 |   |
 |   +-- processTokenInfo(tokenInfoRaw): Maps raw Jupiter token data to a local standardized format.
 |   |
 |   +-- Caching Methods (`cacheData`, `getCachedData`, `cleanCache` - `cleanCache` not auto-invoked).
```

**Migration Notes for `collectors/jupiterCollector.js`:**
*   **No Direct Solana Client Library Dependencies:** This collector interacts with Jupiter via the `jupiterClient` (from `solana-engine`). It does not directly use `@solana/web3.js` or other Solana-specific JavaScript client libraries.
*   **Dependent on `jupiterClient`:** Its v1/v2 compatibility status is tied to that of `jupiterClient`. Since `jupiterClient` itself primarily makes HTTP calls and is largely SDK-agnostic (as previously analyzed), this collector is also well-insulated from direct v1 SDK migration issues.
*   **No Changes Required (for Web3 Migration):** This file itself does not require changes related to the `@solana/web3.js` v1 migration.
*   **Code Quality Note:** The duplicate definition of `getTokenInfoBatch` should be resolved by removing or merging the redundant implementations.

--- 

### Component: `services/token-enrichment/collectors/heliusCollector.js`

**Purpose:** This module is a data collector responsible for fetching detailed token metadata and supply information directly from the Helius API. It leverages the centralized `heliusClient` (from `solana-engine`) for these interactions.

**Key Interactions & Structure:**

```
HeliusCollector (Singleton)
 |
 +-- Dependencies:
 |   |   
 |   L__ heliusClient (from '../../solana-engine/helius-client.js') - Core dependency for Helius API calls.
 |   L__ logApi, fancyColors (for logging).
 |
 +-- Core Properties:
 |   |   
 |   +-- this.heliusClient (Instance of the client from solana-engine).
 |   +-- dataCache (In-memory Map for caching API responses for 15 minutes).
 |
 +-- Core Methods:
 |   |
 |   +-- getTokenMetadata(tokenAddress):
 |   |   L__ Ensures `heliusClient` is initialized.
 |   |   L__ Calls `this.heliusClient.getTokenMetadata(tokenAddress)` (which likely uses `getTokensMetadata` in `heliusClient` that calls Helius's `getAssetBatch` or `getAsset`).
 |   |   L__ Caches and processes the result using `this.processTokenMetadata()`.
 |   |
 |   +-- getTokenMetadataBatch(tokenAddresses): (Note: Two conflicting implementations exist in the source file)
 |   |   L__ Both versions aim to fetch metadata for multiple tokens in batches, using `this.heliusClient.getTokensMetadata(batch)`.
 |   |   L__ Include caching and fallback to individual calls if batch fails.
 |   |
 |   +-- getTokenSupply(tokenAddress):
 |   |   L__ Ensures `heliusClient` is initialized.
 |   |   L__ Calls `this.heliusClient.getTokenSupply(tokenAddress)`. (Note: `heliusClient.js` provided does not have a direct `getTokenSupply`. This might call a generic RPC method via `heliusClient` or rely on a method not shown in the provided `heliusClient` snippet, or it might be intended to use something like `heliusClient.tokens.fetchFromHeliusRPC('getTokenSupply', ...)`).
 |   |   L__ Caches and processes the result.
 |   |
 |   +-- processTokenMetadata(metadataRaw): Maps raw Helius metadata to a local standardized format, including social links via `this.extractSocialsFromMetadata()`.
 |   |
 |   +-- extractSocialsFromMetadata(metadataRaw): Extracts social links from Helius metadata fields.
 |   |
 |   +-- Caching Methods (`cacheData`, `getCachedData`, `cleanCache` - `cleanCache` not auto-invoked).
```

**Migration Notes for `collectors/heliusCollector.js`:**
*   **No Direct Solana Client Library Dependencies:** This collector interacts with Helius via the `heliusClient` (from `solana-engine`). It does not directly use `@solana/web3.js` or other Solana-specific JavaScript client libraries.
*   **Dependent on `heliusClient`:** Its v1/v2 compatibility status is tied to that of `heliusClient`. Since `heliusClient` itself is agnostic to Solana client SDK versions (as it uses `axios` and `ws`), this `heliusCollector` is also well-insulated from direct v1 SDK migration issues.
*   **No Changes Required (for Web3 Migration):** This file itself does not require changes related to the `@solana/web3.js` v1 migration.
*   **Code Quality/Consistency Notes:**
    *   The duplicate definition of `getTokenMetadataBatch` should be resolved.
    *   The `getTokenSupply` method's call to `this.heliusClient.getTokenSupply()` should be verified against the actual methods exposed by the `heliusClient.js` in `solana-engine`. If `heliusClient` is intended to call a generic Helius RPC method for token supply, the call should likely be routed through its `fetchFromHeliusRPC` mechanism (e.g., `this.heliusClient.tokens.fetchFromHeliusRPC('getTokenSupply', [tokenAddress])` if Helius supports this RPC method).

--- 

### Component: `services/token-enrichment/tokenEnrichmentService.js`

**Purpose:** This is the main service responsible for orchestrating the enrichment of token data. It listens for events indicating new or to-be-updated tokens, queues them based on a priority system, and then uses various data collectors (`dexScreenerCollector`, `heliusCollector`, `jupiterCollector`) to fetch information from external APIs. Finally, it merges and stores this enriched data in the Prisma database.

**Key Interactions & Structure:**

```
TokenEnrichmentService (extends BaseService)
 |
 +-- Dependencies:
 |   |   
 |   +-- prisma (Shared client for DB operations: tokens, token_prices, token_socials, etc.)
 |   +-- serviceEvents (Listens for `token:new`, `token:enrich`, `system:maintenance`; Emits `token:enriched`)
 |   +-- Collectors:
 |   |   L__ dexScreenerCollector (from './collectors/dexScreenerCollector.js')
 |   |   L__ heliusCollector (from './collectors/heliusCollector.js')
 |   |   L__ jupiterCollector (from './collectors/jupiterCollector.js')
 |   L__ logApi, color utilities, serviceManager
 |   L__ (UNUSED: ServiceError, redisManager)
 |
 +-- Configuration (Internal `CONFIG` object):
 |   L__ BATCH_SIZE, BATCH_DELAY_MS, MAX_CONCURRENT_BATCHES, THROTTLE_MS, PRIORITY_TIERS, STRATEGIES, RETRY_INTERVALS, PRIORITY_SCORE (weights, base scores, decay factors).
 |
 +-- Core Properties:
 |   |   
 |   +-- this.db (Prisma client instance)
 |   +-- this.processingQueue (Array of token addresses to enrich, with priority info)
 |   +-- this.collectors (Map of instantiated collector modules)
 |   L__ this.stats (For monitoring enrichment process)
 |
 +-- Core Methods:
 |   |
 |   +-- initialize(): Sets up DB, registers with serviceManager, initializes collectors, starts queue processing, schedules recovery for stuck tokens.
 |   |
 |   +-- Event Handling (`registerEventListeners`, `handleNewToken`):
 |   |   L__ `token:new`: Checks if token exists; if new, creates DB record & enqueues for high-priority enrichment. If existing, may re-enqueue based on status/age.
 |   |   L__ `token:enrich`: Enqueues token for high-priority enrichment.
 |   |
 |   +-- Queue & Batch Processing (`enqueueTokenEnrichment`, `startProcessingQueue`, `processNextBatch`):
 |   |   L__ `enqueueTokenEnrichment`: Adds token to queue with calculated `priorityScore`.
 |   |   L__ `processNextBatch`: Takes a batch from sorted queue, calls collectors in parallel (`Promise.all`), then processes results individually using `processAndStoreToken`. Handles batch failures with individual fallbacks (`enrichToken`).
 |   |
 |   +-- Data Collection & Storage (`processAndStoreToken`, `enrichToken`, `collectTokenData`, `storeTokenData`, `mergeTokenData`):
 |   |   L__ `collectTokenData`: Calls individual collectors sequentially for a single token (fallback path).
 |   |   L__ `mergeTokenData`: Consolidates data from different collectors based on field priority.
 |   |   L__ `storeTokenData`: Updates/creates records in `tokens`, `token_prices`, `token_price_history`, `token_socials`, `token_websites` tables in Prisma.
 |   |
 |   +-- Priority Management (`calculatePriorityScore`, `updateTokenPriorityScores`):
 |   |   L__ Dynamically scores tokens to prioritize enrichment based on market activity, data completeness, and recency.
 |   |
 |   +-- Recovery (`reprocessStuckTokens`): Periodically re-queues tokens stuck in 'pending' state.
 |
 +-- Solana SDK v1/v2 Agnostic:
     L__ This service itself does not directly use `@solana/web3.js` or other Solana client SDKs. Its Solana-related data comes from the collectors, which are also SDK-agnostic.
```

**Migration Notes for `services/token-enrichment/tokenEnrichmentService.js`:**
*   **No Direct Solana Client Library Dependencies:** This service orchestrates data collection and storage. Its interactions with external APIs are handled by the collector modules (`dexScreenerCollector`, `heliusCollector`, `jupiterCollector`). As these collectors (and the underlying `jupiterClient` and `heliusClient` they use) have been found to be agnostic to Solana client SDK versions, this main enrichment service is also insulated.
*   **Unaffected by Web3 Migration:** This file requires no changes related to the `@solana/web3.js` v1 migration.
*   **Prisma Client Usage:** Correctly uses the shared `prisma` client instance.
*   **Unused Imports:** `ServiceError` and `redisManager` are imported but not used and can be removed if not intended for future use.

--- 

### Component: `services/token-enrichment/index.js`

**Purpose:** This file serves as the main entry point for the `token-enrichment` service. It imports and re-exports the singleton instance of the `TokenEnrichmentService` class from `tokenEnrichmentService.js`.

**Key Interactions & Structure:**

```
token-enrichment/index.js
 |
 L__ Imports `tokenEnrichmentService` from './tokenEnrichmentService.js'
 L__ Exports `tokenEnrichmentService` (default and named).
```

**Migration Notes for `services/token-enrichment/index.js`:**
*   **No Direct Solana Client Library Dependencies:** This is purely an export module.
*   **Unaffected by Web3 Migration:** Requires no changes for the v1 to v2 migration.

--- 