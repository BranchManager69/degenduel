# Token History Functions Documentation

This document provides analysis for `services/token-history-functions.js`, a module containing utility functions for recording historical token metrics.

---

## Overview

This module is designed to be imported by other services (e.g., a market data service or token enrichment service) to handle the batch recording of historical data points for tokens, such as their price, volume, liquidity, market capitalization, and rank over time. It uses Prisma for database interactions.

---

### Component: `services/token-history-functions.js`

**Purpose:** Provides a suite of utility functions for batch-inserting various token-related historical metrics (price, volume, liquidity, market cap, rank) into the Prisma database. These functions are likely called by services that collect or calculate this data.

**Key Interactions & Structure:**

```
Token History Functions Module
 |
 +-- Dependencies:
 |   |   
 |   L__ @prisma/client (Note: Instantiates a new client `marketDb` locally, should ideally use a shared Prisma instance)
 |   L__ logApi, fancyColors (for logging)
 |
 +-- Exported Functions:
 |   |
 |   +-- recordVolumeHistoryBatch(records):
 |   |   L__ Takes array of volume records, maps to `token_volume_history` schema.
 |   |   L__ Uses `marketDb.token_volume_history.createMany()`.
 |   |
 |   +-- recordLiquidityHistoryBatch(records): Similar for `token_liquidity_history`.
 |   |
 |   +-- recordMarketCapHistoryBatch(records): Similar for `token_market_cap_history`.
 |   |
 |   +-- recordRankHistoryBatch(records): Similar for `token_rank_history`.
 |   |
 |   +-- createSnapshotId(): Generates a timestamp-based snapshot ID string.
 |   |
 |   +-- recordComprehensiveTokenHistory(tokens, source):
 |       L__ Takes an array of rich token data objects.
 |       L__ Prepares records for price, volume (multi-timeframe), liquidity (multi-timeframe), market cap (multi-timeframe), and rank (multi-timeframe).
 |       L__ Calls respective batch recording functions (or `marketDb.token_price_history.createMany()` directly) in parallel.
```

**Migration Notes for `services/token-history-functions.js`:**
*   **No Direct Solana Client Library Dependencies:** This module's responsibilities are data mapping and database insertion via Prisma. It does not directly interact with `@solana/web3.js` or any v2 Solana SDKs.
*   **Unaffected by Web3 Migration:** Its functionality is independent of the v1 to v2 migration of Solana SDKs.
*   **No Changes Required (for Web3 Migration):** This file itself does not require changes related to the `@solana/web3.js` v1 migration.
*   **Prisma Client:** The local instantiation `const marketDb = new PrismaClient(...)` should be changed to use a shared Prisma client instance from the application's configuration for better connection pooling and consistency.

--- 