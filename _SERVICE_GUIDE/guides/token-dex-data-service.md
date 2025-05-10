# Token DEX Data Service Documentation

This document contains diagrams and analysis for components within the `token-dex-data-service`, focusing on its data fetching, storage, and any Web3 interactions relevant to the migration.

---

## Overview

The `token-dex-data-service` is likely responsible for managing and updating detailed information about tokens related to their presence and performance on decentralized exchanges (DEXs), primarily using DexScreener as a data source.

*(Further analysis to be added as files are reviewed)*

---

### Component: `services/token-dex-data-service.js` (TokenDEXDataService)

**Purpose:** This service is dedicated to fetching, processing, and storing detailed data about token liquidity pools and market metrics from decentralized exchanges (DEXs), primarily using DexScreener as its data source (via `dexscreenerClient`). It integrates with a token refresh system to keep this data updated.

**Key Interactions & Structure:**

```
TokenDEXDataService (extends BaseService)
 |
 +-- Dependencies:
 |   |   
 |   +-- @prisma/client (Note: Instantiates a new client locally, should use shared Prisma instance)
 |   +-- dexscreenerClient (from `solana-engine` - for DexScreener API calls)
 |   +-- serviceEvents (Listens for `token.refresh`, `token.batch.refresh`)
 |   +-- config (application configuration)
 |   L__ logApi, color utilities
 |   L__ (UNUSED: ServiceError, serviceManager, getServiceMetadata, solanaEngine from solana-engine/index.js)
 |
 +-- Configuration (this.config):
 |   L__ maxTokensPerBatch, refreshIntervalMs, priorityThreshold, maxPoolsPerToken, minLiquidityUsd.
 |
 +-- Core Methods:
 |   |
 |   +-- initialize(): Ensures `dexscreenerClient` is ready, subscribes to refresh events, schedules periodic refresh.
 |   |
 |   +-- Event Handlers (`handleTokenRefreshEvent`, `handleBatchRefreshEvent`):
 |   |   L__ Trigger `refreshPoolsForToken` or `refreshPoolsForMultipleTokens` for high-priority tokens/batches.
 |   |
 |   +-- refreshTokenPools() (Main periodic refresh loop):
 |   |   L__ Fetches active tokens from Prisma due for DEX data refresh (based on `last_refresh_attempt`, `priority_score`).
 |   |   L__ Processes them in batches via `refreshPoolsForMultipleTokens`.
 |   |
 |   +-- refreshPoolsForMultipleTokens(tokenAddresses):
 |   |   L__ Attempts batch fetch via `dexscreenerClient.getMultipleTokenPools()`.
 |   |   L__ If batch fails, falls back to individual `refreshPoolsForToken` calls.
 |   |   L__ Uses `processPoolData()` to handle results.
 |   |
 |   +-- refreshPoolsForToken(tokenAddress) / processPoolData(tokenAddress, poolsData):
 |   |   L__ (refreshPoolsForToken calls `dexscreenerClient.getTokenPools()` if data not pre-fetched).
 |   |   L__ Filters raw pool data (Solana chain, min liquidity, max pools).
 |   |   L__ Uses Prisma transaction to:
 |   |       L__ Update `token_pools` table (add new, delete old).
 |   |       L__ Update `tokens` table with metadata derived from the best pool (name, symbol, image, socials, market metrics like price, volume, liquidity from DexScreener).
 |   |       L__ Upsert/Create `token_prices` record.
 |   |       L__ Create `token_price_history`, `token_market_cap_history`, `token_volume_history`, `token_liquidity_history` records.
 |   |       L__ Update/Create `token_websites` and `token_socials`.
 |
 +-- Incorrect Prisma Usage:
     L__ Instantiates `new PrismaClient()` locally instead of using a shared instance from `config/prisma.js`.
```

**Migration Notes for `services/token-dex-data-service.js`:**
*   **No Direct Solana Client Library Dependencies:** This service uses `dexscreenerClient` for its external data fetching and Prisma for database operations. It does not directly import or use `@solana/web3.js` or any v2 Solana client libraries.
*   **Agnostic to Web3 Migration:** The functionality of this module is independent of the v1 to v2 migration of Solana client SDKs, as its interactions are abstracted through `dexscreenerClient` (which is SDK-agnostic).
*   **No Changes Required (for Web3 Migration):** This file does not require changes related to the `@solana/web3.js` v1 migration.
*   **Actionable Items (Non-Migration):**
    *   Change `const prisma = new PrismaClient();` to use the shared Prisma instance.
    *   Remove unused imports (`ServiceError`, `serviceManager`, `getServiceMetadata`, `solanaEngine`).

--- 