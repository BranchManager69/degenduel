# Token Monitor Service Documentation

This document provides analysis for `services/tokenMonitorService.js`, focusing on its Web3 interactions, how it monitors token transactions, and its migration status.

---

## Overview

The `tokenMonitorService` is responsible for actively monitoring specific Solana tokens for buy/sell transactions. It uses `heliusClient` for real-time transaction data (via WebSockets) and `jupiterClient` for token price information to assess transaction values. It then emits internal service events for detected purchases or sales that meet configured criteria.

---

### Component: `services/tokenMonitorService.js`

**Purpose:** To monitor blockchain activity for a list of specified tokens, identify buy/sell transactions exceeding a minimum value, and emit events for these transactions.

**Key Interactions & Structure:**

```
TokenMonitorService (extends BaseService)
 |
 +-- Dependencies:
 |   |   
 |   +-- prisma (Shared client: for loading/saving `monitored_tokens` configuration).
 |   +-- heliusClient (from `solana-engine`): Used for `onTokenTransfer` and `subscribeToTokenTransfers` (WebSocket-based).
 |   +-- jupiterClient (from `solana-engine`): Used for `getTokenInfo`, `subscribeToPrices`, `onPriceUpdate`, `getPrices`.
 |   +-- solanaEngine (from `solana-engine`): Dynamically imported, mainly to ensure it's initialized.
 |   +-- serviceEvents (Emits `TOKEN_PURCHASE`, `TOKEN_SALE`, `TOKEN_PRICE_UPDATE`).
 |   L__ logApi, fancyColors, config.
 |   L__ (UNUSED: ServiceError).
 |
 +-- Core Properties:
 |   |   
 |   +-- this.monitoredTokens (Map: tokenAddress -> {monitoring_options, metadata}).
 |   +-- this.priceCache (Map: tokenAddress -> {price_usd, last_updated, etc.}).
 |   L__ this.tokenTransferHandlerRegistered (Boolean flag).
 |
 +-- Core Methods:
 |   |
 |   +-- initialize(): Loads monitored tokens from DB, initializes `heliusClient` & `jupiterClient` (if not already by `solanaEngine`), sets up Jupiter price update listener.
 |   |
 |   +-- loadMonitoredTokens(): Fetches token monitoring configs from `monitored_tokens` Prisma table. Includes one-time table creation if not exists.
 |   |
 |   +-- addTokenToMonitor(tokenAddress, options):
 |   |   L__ Adds/updates a token in `this.monitoredTokens`.
 |   |   L__ Fetches initial metadata via `jupiterClient.getTokenInfo()` if needed.
 |   |   L__ Subscribes to price updates via `jupiterClient.subscribeToPrices()`.
 |   |   L__ Calls `this.setupTokenMonitoring()`.
 |   |   L__ Saves config to DB.
 |   |
 |   +-- setupTokenMonitoring(tokenAddress):
 |   |   L__ Registers `this.handleTokenTransfer` with `heliusClient.onTokenTransfer`.
 |   |   L__ Calls `heliusClient.subscribeToTokenTransfers(tokenAddress)`.
 |   |
 |   +-- handleTokenTransfer(transferInfoFromHeliusClient):
 |   |   L__ If token and transaction type (buy/sell) are monitored:
 |   |       L__ Gets current price from `this.priceCache`.
 |   |       L__ Calculates USD value of the transfer.
 |   |       L__ If value >= `min_transaction_value`, emits `TOKEN_PURCHASE` or `TOKEN_SALE` via `serviceEvents`.
 |   |
 |   +-- handlePriceUpdate(priceDataFromJupiterClient):
 |   |   L__ Updates `this.priceCache`.
 |   |   L__ If significant change, logs and emits `TOKEN_PRICE_UPDATE`.
 |   |
 |   +-- performOperation() (Periodic task):
 |       L__ Calls `this.refreshPriceData()` (which uses `jupiterClient.getPrices()`).
```

**Migration Notes for `services/tokenMonitorService.js`:**
*   **No Direct Solana Client Library Dependencies:** This service abstracts its Solana interactions through `heliusClient` and `jupiterClient` (both from `solana-engine`). It does not directly use `@solana/web3.js` objects like `Connection`, `Keypair`, or `Transaction` for its primary monitoring and data fetching logic.
*   **Dependent on Engine Clients:** Its v1/v2 compatibility hinges on `heliusClient` and `jupiterClient`. Since these clients were found to be SDK-agnostic (using `axios`, `ws` for direct API calls), `TokenMonitorService` is also well-insulated from direct v1 SDK migration issues.
*   **No Changes Required (for Web3 Migration):** This file itself does not require changes related to the `@solana/web3.js` v1 migration, assuming the underlying engine clients function as expected.
*   **Prisma Client Usage:** Correctly uses the shared `prisma` client instance.
*   **Actionable Items (Non-Migration):** Review and remove unused imports like `ServiceError` and potentially `solanaEngine` if its dynamic import is only for ensuring `heliusClient` and `jupiterClient` (which are part of `solanaEngine` exports) are ready.

--- 