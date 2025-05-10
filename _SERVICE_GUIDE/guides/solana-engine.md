# Solana Engine Service Documentation

This document contains diagrams and analysis for components within the `solana-engine` service.

---

## Component: `jupiter-client.js`

The following diagrams illustrate the structure and interactions within the `jupiter-client.js` file, which acts as a client for the Jupiter API.

### I. Overall Architecture: The `JupiterClient` Orchestrator

`JupiterClient` is the central hub for interacting with the Jupiter API.

```
JupiterClient (Singleton: jupiterClient)
 |
 +-- Owns/Manages Instances of:
 |   |
 |   +-- TokenListService (this.tokens)
 |   |     |
 |   |     L__ Extends: JupiterBase
 |   |
 |   +-- PriceService (this.prices)
 |   |     |
 |   |     L__ Extends: JupiterBase
 |   |
 |   +-- SwapService (this.swaps)
 |         |
 |         L__ Extends: JupiterBase
 |
 +-- Inherits from: BaseService
 |     |
 |     L__ Provides: Initialization, Lifecycle (start, stop), Circuit Breaker logic, Stats
 |
 +-- Configuration:
 |   L__ Uses: jupiterConfig
 |
 +-- Key Data Stores:
 |   |
 |   +-- this.tokenList (Array: raw list from API)
 |   +-- this.tokenMap (Object: mintAddress => tokenInfo, for quick lookup)
 |
 +-- Core Public Methods (Proxies to internal services or manages state):
     |
     +-- initialize()
     +-- stop()
     +-- performOperation() (heartbeat/health check)
     +-- setAutomaticPolling(enabled)
     +-- onPriceUpdate(callback)      -> delegates to PriceService
     +-- subscribeToPrices(mints)   -> delegates to PriceService
     +-- unsubscribeFromPrices(mints) -> delegates to PriceService
     +-- getPrices(mints)             -> delegates to PriceService
     +-- getPriceHistory(mint, interval) -> delegates to PriceService
     +-- getSwapQuote(params)         -> delegates to SwapService
     +-- getTokenInfo(mint)           -> uses this.tokenMap
     +-- isCircuitBreakerOpen()
```

### II. The Foundation: `JupiterBase`

This class is the common ancestor for all specialized service modules, providing fundamental API communication.

```
JupiterBase
 |
 +-- Responsibilities:
 |   |
 |   +-- Making HTTP requests to Jupiter API (makeRequest method)
 |   |   |
 |   |   L__ Handles: Method, Endpoint, Data, Params, Headers, Timeout
 |   |
 |   +-- Basic error handling for API requests
 |   +-- Storing API configuration (this.config)
 |
 +-- Key Methods:
     |
     L__ makeRequest(method, endpoint, data, params)
```

### III. Specialized Service Modules:

#### A. `TokenListService`

```
TokenListService
 |
 +-- Extends: JupiterBase
 |
 +-- Responsibilities:
 |   |
 |   +-- Fetching the complete list of tokens from Jupiter API
 |   +-- Creating a structured map (tokenMap) for efficient lookups
 |
 +-- Key Methods:
     |
     +-- fetchTokenList()
     |     L__ Uses: makeRequest() from JupiterBase
     |
     L__ createTokenMap(tokenList)
```

#### B. `PriceService`

This is the most complex module, handling price fetching, subscriptions, and robust API interaction.

```
PriceService
 |
 +-- Extends: JupiterBase
 |
 +-- Responsibilities:
 |   |
 |   +-- Fetching current prices for specified token mint addresses (getPrices)
 |   |   |
 |   |   L__ Implements: Batching, Retry logic, Rate limit handling, Concurrency control
 |   |
 |   +-- Fetching historical price data (getPriceHistory)
 |   +-- Managing price update subscriptions:
 |   |   |
 |   |   +-- Storing subscribed tokens (this.subscriptions: Map)
 |   |   +-- Storing callback functions (this.priceUpdateCallbacks: Array)
 |   |   +-- Polling mechanism (this.pollingInterval, this.pollingFrequency)
 |   |       (Note: automaticPollingEnabled controls if this runs)
 |   |
 |   +-- Preventing concurrent fetches (this.isFetchingPrices, this.lastFetchTime)
 |
 +-- Key Methods:
 |   |
 |   +-- startPolling()
 |   +-- stopPolling()
 |   +-- notifyPriceUpdateCallbacks(priceData)
 |   +-- onPriceUpdate(callback)
 |   +-- subscribeToPrices(mintAddresses)
 |   +-- unsubscribeFromPrices(mintAddresses)
 |   +-- getPrices(mintAddresses)
 |   |     L__ Uses: makeRequest() from JupiterBase, complex batching/retry logic
 |   |
 |   L__ getPriceHistory(mintAddress, interval)
 |         L__ Uses: makeRequest() from JupiterBase
 |
 +-- Internal State for Polling/Fetching:
     |
     +-- this.pollingInterval
     +-- this.automaticPollingEnabled
     +-- this.subscriptions (Map: mintAddress -> true)
     +-- this.priceUpdateCallbacks (Array of functions)
     +-- this.isFetchingPrices (boolean lock)
     +-- this.lastFetchTime (timestamp)
     +-- this.minimumFetchGap
     +-- Static: uriTooLongErrors, currentOptimalBatchSize (for adaptive batching)
```

#### C. `SwapService`

```
SwapService
 |
 +-- Extends: JupiterBase
 |
 +-- Responsibilities:
 |   |
 |   L__ Fetching swap quotes from Jupiter API
 |
 +-- Key Methods:
     |
     L__ getSwapQuote(params)
           L__ Uses: makeRequest() from JupiterBase
```

### IV. Example Workflow: Getting Prices for a Set of Tokens

1.  **Caller (e.g., another part of `solana-engine`):** Calls `jupiterClient.getPrices(['mint1', 'mint2', ...])`.
2.  **`JupiterClient.getPrices()`:**
    *   Checks circuit breaker.
    *   Manages `this.prices.isFetchingPrices` lock.
    *   Delegates to `this.prices.getPrices([...])`.
    *   Handles stats and errors.
3.  **`PriceService.getPrices()`:**
    *   Implements batching (`effectiveBatchSize`, `MAX_CONCURRENT_REQUESTS`).
    *   Uses `throttleBatches` for processing:
        *   Retry loop (`MAX_RETRIES`) for each batch.
        *   Calls `this.makeRequest(...)`.
            *   **`JupiterBase.makeRequest()`:** Executes HTTP request via Axios.
        *   Handles API errors (429, 5xx) with exponential backoff.
    *   Returns combined price data.
```

### Component: `services/solana-engine/dexscreener-client.js`

### Component: `services/solana-engine/helius-client.js`

**Purpose:** This module serves as a comprehensive client for interacting with the Helius API. It provides access to Helius's RPC methods, WebSocket subscriptions for real-time data (including token transfers), the Digital Asset Standard (DAS) API, and webhook management.

**Key Interactions & Structure:**

```
HeliusClient (Singleton)
 |
 +-- Config: heliusConfig (API key, RPC URL, WebSocket URL, specific Helius API endpoints)
 |
 +-- Dependencies:
 |   |   
 |   +-- axios (for HTTP RPC calls and RESTful webhook management)
 |   +-- ws (for WebSocket connections)
 |   L__ logApi, color utilities, redisManager (imported but unused in current logic)
 |
 +-- Internal Structure:
 |   |
 |   +-- HeliusBase (Base class for common Helius RPC logic):
 |   |   L__ fetchFromHeliusRPC(method, params): Core method for making JSON-RPC calls via HTTP POST.
 |   |
 |   +-- HeliusWebSocketManager (Manages WebSocket connection & messages):
 |   |   L__ initialize(): Connects to Helius WebSocket, handles reconnections.
 |   |   L__ handleWebSocketMessage(message): Routes responses to pending requests or notifications.
 |   |   L__ handleTokenTransferNotification(message): Parses logs for SPL token transfers, emits events.
 |   |   L__ sendWebSocketRequest(method, params, timeout): Sends JSON-RPC requests over WebSocket.
 |   |
 |   +-- TokenService (Handles token-related RPC calls):
 |   |   L__ getTokensMetadata(mintAddresses): Fetches metadata using `getAssetBatch` or `getAsset` RPC.
 |   |   L__ mapAssetToTokenMetadata(assetData): Transforms Helius asset data to local format.
 |   |   L__ getTokenAccounts(params), getAssetsByOwner(params), getAssetsByGroup(params).
 |   |
 |   +-- DasService (Handles Digital Asset Standard API calls):
 |   |   L__ searchAssets(params), getAsset(assetId).
 |   |
 |   +-- WebhookService (Manages Helius webhooks via REST API calls):
 |   |   L__ createWebhook(config), getWebhooks(), deleteWebhook(webhookId).
 |
 +-- Public API Methods (exposed by HeliusClient instance, delegating to internal services/managers):
     L__ getTokensMetadata(), searchAssets(), createWebhook(), getWebhooks(), deleteWebhook(), getConnectionStats(), subscribeToTokenTransfers(), unsubscribeFromTokenTransfers(), onTokenTransfer(), getMonitoredTokens().
```

**Migration Notes for `services/solana-engine/helius-client.js`:**
*   **No Direct Solana Client Library Dependencies:** This client interacts with Helius APIs via HTTP (`axios`) and WebSockets (`ws`). It does **not** use `@solana/web3.js` or any other Solana-specific JavaScript client libraries (e.g., `@solana/keys`, `@solana/addresses`) for these interactions.
*   **Agnostic to v1/v2 Migration:** As it abstracts direct Helius API calls, it is independent of the v1 to v2 migration of Solana client-side SDKs.
*   **No Changes Required:** This file does not require any changes as part of the `@solana/web3.js` v1 migration effort.
*   **Redis Cache Potential:** The import of `redisManager` and an unused `DEFAULT_TOKEN_METADATA_TTL` constant suggest that Redis caching for Helius data (like token metadata) might have been planned or could be a future enhancement if API rate limits or performance become a concern.

---

### Component: `services/solana-engine/helius-balance-tracker.js`

**Purpose:** This module uses the Helius API (via `heliusClient`) to track SOL and SPL token balances for specified wallet addresses in real-time. It primarily leverages Helius WebSockets for notifications and can also fetch initial/fallback balances via RPC calls made through `heliusClient`.

**Key Interactions & Structure:**

```
HeliusBalanceTracker (Singleton)
 |
 +-- Dependencies:
 |   |   
 |   +-- heliusClient (from './helius-client.js') - Core dependency for all Helius interactions (WebSocket & RPC).
 |   +-- serviceEvents (listens for 'wallet:balance:change').
 |   L__ logApi, color utilities.
 |   L__ (Imports TOKEN_PROGRAM_ID, PublicKey from @solana/web3.js & @solana/spl-token but seem unused directly in this file's logic, possibly for heliusClient interaction patterns or future use).
 |
 +-- Core Properties:
 |   |   
 |   +-- this.tokenSubscriptions (Map: walletAddress -> Set<tokenAddress>)
 |   +-- this.solanaSubscriptions (Set: walletAddress for SOL tracking)
 |   +-- this.tokenBalances, this.solanaBalances (In-memory caches)
 |   +-- this.walletSubscriptionIds (Map: walletAddress -> Helius WebSocket subscriptionId)
 |   L__ this.tokenBalanceHandlers, this.solanaBalanceHandlers (Callback handlers)
 |
 +-- Core Methods:
 |   |
 |   +-- initialize(): Initializes `heliusClient` and sets up event handlers.
 |   |
 |   +-- subscribeTokenBalance(walletAddress, tokenAddress, handler):
 |   |   L__ Manages internal subscription state.
 |   |   L__ Calls `this.subscribeToWalletChanges(walletAddress)`.
 |   |   L__ Fetches initial balance via `this.fetchTokenBalance()`.
 |   |
 |   +-- subscribeSolanaBalance(walletAddress, handler): Similar for SOL.
 |   |
 |   +-- subscribeToWalletChanges(walletAddress):
 |   |   L__ Uses `heliusClient.websocket.sendWebSocketRequest('accountSubscribe', ...)` to subscribe via Helius.
 |   |
 |   +-- fetchTokenBalance(walletAddress, tokenAddress):
 |   |   L__ Calls `heliusClient.tokens.getTokenAccounts({ owner: walletAddress })`.
 |   |
 |   +-- fetchSolanaBalance(walletAddress):
 |   |   L__ Calls `heliusClient.tokens.fetchFromHeliusRPC('getBalance', [walletAddress])`.
 |   |
 |   +-- handleTokenTransfer(transferInfo): Callback for `heliusClient`'s token transfer notifications. Updates relevant balances.
 |   +-- handleWalletBalanceEvent(eventData): Handles external balance change events.
 |   L__ Unsubscribe methods, notification helpers, cache getters, refresh methods.
```

**Migration Notes for `services/solana-engine/helius-balance-tracker.js`:**
*   **No Direct v1 Dependencies Found:** This file does not appear to directly instantiate or use objects from `@solana/web3.js` v1 (like `new PublicKey()`, `new Transaction()`) in its own logic. The imported `PublicKey` and `TOKEN_PROGRAM_ID` from v1 libraries seem to be unused within this specific file's direct operations.
*   **Relies on `heliusClient`:** Its Web3 v1/v2 status is entirely dependent on `heliusClient.js`. Since `heliusClient.js` was found to be agnostic to Solana client SDK versions (as it uses `axios` for HTTP and `ws` for WebSockets to talk to the Helius API), this `helius-balance-tracker.js` should also be free of direct v1 migration concerns, assuming it passes data (like string addresses) to `heliusClient` in a compatible way.
*   **No Changes Required (for Web3 Migration):** Assuming `heliusClient` correctly abstracts Helius API calls without internal v1 SDK usage for those calls, this file likely requires no changes for the `@solana/web3.js` v1 migration.

---

### Component: `services/solana-engine/helius-pool-tracker.js`

**Purpose:** This service leverages Helius WebSockets (via `heliusClient`) to monitor liquidity pool accounts in real-time. It aims to detect pool activity (swaps, liquidity changes) and calculate token prices directly from on-chain pool data, providing an alternative or supplement to API-based price sources like Jupiter or DexScreener.

**Key Interactions & Structure:**

```
HeliusPoolTracker (Singleton)
 |
 +-- Dependencies:
 |   |   
 |   +-- heliusClient (from './helius-client.js') - Core dependency for Helius WebSocket subscriptions and RPC calls (e.g., to get initial pool account info).
 |   +-- prisma (DB: token_pools for initial pool discovery, pool_price_changes for logging significant changes).
 |   +-- serviceEvents (listens for 'pool:update', emits 'token:price_update').
 |   L__ logApi, color utilities.
 |
 +-- Core Properties:
 |   |   
 |   +-- this.poolSubscriptions (Map: poolAddress -> Set<tokenAddress> - tracks which tokens are monitored for a given pool).
 |   +-- this.poolData (Map: cache for fetched raw pool account data).
 |   +-- this.poolSubscriptionIds (Map: poolAddress -> Helius WebSocket subscriptionId).
 |   +-- this.eventHandlers (Map: eventType -> Map<tokenAddress, Set<handler>> - for swap, liquidity events etc.).
 |   +-- this.poolStates (Map: poolAddress -> {tokenAddress, price, liquidity, confidence} - calculated state).
 |   +-- this.tokenToPools (Map: tokenAddress -> Set<poolAddress> - mapping tokens to their known pools).
 |   L__ this.tokenPrices (Map: tokenAddress -> {price, liquidity, confidence, poolAddress} - best price found for a token).
 |
 +-- Core Methods:
 |   |
 |   +-- initialize(): Initializes `heliusClient`, sets up event handlers.
 |   |
 |   +-- subscribeToPoolEvents(poolAddress, tokenAddress, eventType, handler):
 |   |   L__ Manages subscriptions for specific events on a pool for a token.
 |   |   L__ Calls `this.subscribeToPoolAccount()`.
 |   |   L__ Fetches initial pool data via `this.fetchPoolData()`.
 |   |
 |   +-- subscribeToPoolAccount(poolAddress):
 |   |   L__ Uses `heliusClient.websocket.sendWebSocketRequest('accountSubscribe', ...)`.
 |   |
 |   +-- fetchPoolData(poolAddress):
 |   |   L__ Gets pool metadata from Prisma (`token_pools` table).
 |   |   L__ Fetches live account data via `heliusClient.tokens.fetchFromHeliusRPC('getAccountInfo', ...)`.
 |   |   L__ Calls `this.parsePoolData()`.
 |   |
 |   +-- parsePoolData(accountInfo, poolRecord) & DEX-specific parsers (e.g., `parseRaydiumPoolData`):
 |   |   L__ **CRITICAL: Currently contains placeholder/simplified logic. Needs full implementation for each supported DEX to extract reserves and other relevant data from on-chain account structures.**
 |   |
 |   +-- calculateTokenPrice(poolData):
 |   |   L__ **CRITICAL: Currently contains placeholder/simplified logic. Depends on correct data from `parsePoolData`. Needs DEX-specific price calculation formulas.**
 |   |
 |   +-- updatePoolState(poolAddress, tokenAddress, poolData):
 |   |   L__ Recalculates price, updates `this.poolStates` and `this.tokenPrices`.
 |   |   L__ If significant price change, logs to DB (`pool_price_changes`) and emits events.
 |   |
 |   +-- monitorTokenPrice(tokenAddress, priceHandler):
 |   |   L__ Primary public method. Finds pools for the token (from Prisma, potentially augmented by `pool-data-manager` via `helius-integration.js` monkey-patch).
 |   |   L__ Subscribes to 'pool_update' events on these pools.
 |   |
 |   +-- handleTokenTransfer(transferInfo), handlePoolEvent(eventData): Event handlers that trigger pool data refresh and state updates.
 |
 +-- Integration with `pool-data-manager` (via `helius-integration.js` monkey-patching):
     L__ Methods like `addPoolsToCache`, `setPools`, `fetchPoolsWithManager` are added externally.
     L__ `monitorTokenPrice` is overridden to use `poolDataManager` to find/refresh pool lists.
```

**Migration Notes for `services/solana-engine/helius-pool-tracker.js`:**
*   **No Direct Solana Client Library Dependencies:** This module, like `heliusClient` and `heliusBalanceTracker`, does not directly import or use `@solana/web3.js` v1 objects in its own logic for Helius API interactions. It relies on `heliusClient`.
*   **Agnostic to Web3 SDK Migration:** It is therefore unaffected by the v1 to v2 migration of the Solana client SDKs, assuming `heliusClient` remains SDK-agnostic.
*   **Major Functional Gaps (Not SDK Related):** The primary challenge with this module is **not** Web3 SDK migration, but the **incomplete implementation of its core purpose**: parsing on-chain pool account data for different DEXs and accurately calculating token prices from that data. The `parsePoolData` (and its DEX-specific sub-functions) and `calculateTokenPrice` methods are currently placeholders.
*   **No Changes Required (for Web3 SDK Migration):** This file itself does not require changes due to `@solana/web3.js` v1 deprecation. The work needed is feature completion for DEX data parsing.

---

### Component: `services/solana-engine/index.js`

**Purpose:** This file serves as the main entry point for the `solana-engine` service. It imports and re-exports all the major components and clients that constitute the engine, including `heliusClient`, `jupiterClient`, the main `solanaEngine` service instance, `heliusBalanceTracker`, and `heliusPoolTracker`.

**Key Interactions & Structure:**

```
solana-engine/index.js
 |
 +-- Imports:
 |   L__ heliusClient from './helius-client.js'
 |   L__ jupiterClient, getJupiterClient from './jupiter-client.js'
 |   L__ solanaEngine from './solana-engine.js'
 |   L__ heliusBalanceTracker from './helius-balance-tracker.js'
 |   L__ heliusPoolTracker from './helius-pool-tracker.js'
 |
 L__ Exports all imported components (named exports) and `solanaEngine` as default.
```

**Migration Notes for `services/solana-engine/index.js`:**
*   **No Direct Solana Client Library Dependencies:** This is purely an aggregator and exporter module.
*   **Unaffected by Web3 Migration:** Requires no changes for the v1 to v2 migration. Its v1/v2 status is implicitly determined by the modules it exports.

--- 