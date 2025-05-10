# Web3 Migration Documentation - Table of Contents

This document provides an organized overview and links to all generated analysis and guide files for the Web3 v1 to v2 migration effort.

## I. Overview & Checklists

*   [Web3 Migration Status Overview (Main Checklist)](./web3_migration_checklist.md)

## II. Service-Specific Analysis Guides

Below are links to detailed analysis for each service and its components. Files marked with direct v1 dependencies or requiring significant refactoring for v2 are noted.

### 1. Admin Wallet (`admin-wallet`)
*   **Guide:** [Admin Wallet Service Documentation](./guides/admin-wallet.md)
*   **Status:** Partial Migration
*   **Components Analyzed:**
    *   `services/admin-wallet/admin-wallet-service.js` (Orchestrator, delegates to v1-dependent modules)
    *   `services/admin-wallet/modules/wallet-crypto.js` (Direct v1 `Keypair` usage, bridging attempts)
    *   `services/admin-wallet/utils/solana-compat.js` (Mixed v1/v2, uses v1 `Keypair` internally for v2 `CryptoKeyPair` creation)
    *   *(Remaining modules: `wallet-balance.js`, `wallet-transactions.js`, `batch-operations.js` - Not yet analyzed in detail)*

### 2. Contest Wallet (`contest-wallet`)
*   **Guide:** [Contest Wallet Service Documentation](./guides/contest-wallet.md)
*   **Status:** Needs Migration (Heavy v1 Usage)
*   **Components Analyzed:**
    *   `services/contest-wallet/contestWalletService.js` (Heavy v1: `Keypair.generate`, `PublicKey`, `Transaction`, `SystemProgram`)
    *   `services/contest-wallet/treasury-certifier.js` (Heavy v1: `Keypair.generate`, `Keypair.fromSecretKey`, `PublicKey`, `Transaction`, `SystemProgram`)

### 3. Diagnostics Scripts (`diagnostics`)
*   **Guide:** [Diagnostics Scripts Documentation](./guides/diagnostics.md)
*   **Status:** OK / N-A (for Web3 Migration)
*   **Components Analyzed:**
    *   `diagnostics/dexscreener-diagnostics.js` (SDK Agnostic - Prisma DB interaction only)

### 4. Pool Data Manager (`pool-data-manager`)
*   **Guide:** [Pool Data Manager Service Documentation](./guides/pool-data-manager.md)
*   **Status:** OK / N-A (for Web3 Migration)
*   **Components Analyzed:**
    *   `services/pool-data-manager/pool-data-manager.js` (SDK Agnostic - uses `dexscreenerClient`)
    *   `services/pool-data-manager/helius-integration.js` (SDK Agnostic - monkey-patches `heliusPoolTracker`)
    *   `services/pool-data-manager/index.js` (SDK Agnostic - Exporter)

### 5. Solana Engine (`solana-engine`)
*   **Guide:** [Solana Engine Service Documentation](./guides/solana-engine.md)
*   **Status:** Needs Migration (Core components are v1)
*   **Components Analyzed:**
    *   `services/solana-engine/connection-manager.js` (**Pure v1 `Connection`** - Critical to migrate)
    *   `services/solana-engine/solana-engine.js` (**Heavy v1 `Transaction`, `sendAndConfirmTransaction`** - Critical to migrate, depends on `connection-manager`)
    *   `services/solana-engine/jupiter-client.js` (SDK Agnostic - HTTP client)
    *   `services/solana-engine/dexscreener-client.js` (SDK Agnostic - HTTP client)
    *   `services/solana-engine/helius-client.js` (SDK Agnostic - HTTP/WebSocket client)
    *   `services/solana-engine/helius-balance-tracker.js` (SDK Agnostic - uses `heliusClient`)
    *   `services/solana-engine/helius-pool-tracker.js` (SDK Agnostic - uses `heliusClient`, has functional gaps in DEX parsing)
    *   `services/solana-engine/index.js` (SDK Agnostic - Exporter)

### 6. Token DEX Data Service (`token-dex-data-service`)
*   **Guide:** [Token DEX Data Service Documentation](./guides/token-dex-data-service.md)
*   **Status:** OK / N-A (for Web3 Migration)
*   **Components Analyzed:**
    *   `services/token-dex-data-service.js` (SDK Agnostic - uses `dexscreenerClient`)

### 7. Token Enrichment Service (`token-enrichment`)
*   **Guide:** [Token Enrichment Service Documentation](./guides/token-enrichment.md)
*   **Status:** OK / N-A (for Web3 Migration)
*   **Components Analyzed:**
    *   `services/token-enrichment/tokenEnrichmentService.js` (SDK Agnostic - orchestrates collectors)
    *   `services/token-enrichment/collectors/dexScreenerCollector.js` (SDK Agnostic - HTTP client)
    *   `services/token-enrichment/collectors/jupiterCollector.js` (SDK Agnostic - uses `jupiterClient`)
    *   `services/token-enrichment/collectors/heliusCollector.js` (SDK Agnostic - uses `heliusClient`)
    *   `services/token-enrichment/index.js` (SDK Agnostic - Exporter)

### 8. Token History Functions (`token-history-functions`)
*   **Guide:** [Token History Functions Documentation](./guides/token-history-functions.md)
*   **Status:** OK / N-A (for Web3 Migration)
*   **Components Analyzed:**
    *   `services/token-history-functions.js` (SDK Agnostic - Prisma DB interaction only)

### 9. Token Monitor Service (`tokenMonitorService`)
*   **Guide:** [Token Monitor Service Documentation](./guides/tokenMonitorService.md)
*   **Status:** OK / N-A (for Web3 Migration)
*   **Components Analyzed:**
    *   `services/tokenMonitorService.js` (SDK Agnostic - uses `heliusClient`, `jupiterClient`)

### 10. Token Refresh Scheduler (`token-refresh-scheduler`)
*   **Guide:** [Token Refresh Scheduler Service Documentation](./guides/token-refresh-scheduler.md)
*   **Status:** OK / N-A (for Web3 Migration)
*   **Components Analyzed:**
    *   `services/token-refresh-scheduler/token-refresh-scheduler.js` (SDK Agnostic - uses `jupiterClient`)
    *   `services/token-refresh-scheduler/batch-optimizer.js` (SDK Agnostic - Internal logic)
    *   `services/token-refresh-scheduler/metrics-collector.js` (SDK Agnostic - Internal logic)
    *   `services/token-refresh-scheduler/priority-queue.js` (SDK Agnostic - Internal logic)
    *   `services/token-refresh-scheduler/rank-analyzer.js` (SDK Agnostic - Internal logic)

### 11. User Balance Tracking Service (`userBalanceTrackingService`)
*   **Guide:** _SERVICE_GUIDE/guides/userBalanceTrackingService.md (Note: File was deleted, content needs regeneration if desired based on previous analysis)
*   **Status:** Needs Migration (Minor v1 `PublicKey` usage)
*   **Components Analyzed:**
    *   `services/userBalanceTrackingService.js` (Uses v1 `PublicKey`, depends on `solanaEngine` and `heliusBalanceTracker`)

### 12. Vanity Wallet (`vanity-wallet`)
*   **Guide:** [Vanity Wallet Service Documentation](./guides/vanity-wallet.md)
*   **Status:** Needs Migration (Minor v1 - Patches Applied)
*   **Components Analyzed:**
    *   `services/vanity-wallet/vanity-wallet-service.js` (SDK Agnostic - orchestrator)
    *   `services/vanity-wallet/vanity-api-client.js` (SDK Agnostic - handles raw key data)
    *   `services/vanity-wallet/generators/index.js` (SDK Agnostic - manager)
    *   `services/vanity-wallet/generators/local-generator.js` (Minor v1 `Keypair.fromSecretKey` usage fixed to use v2 `getAddressFromPublicKey`)
    *   `routes/admin/vanity-wallets.js` (Unused v1 `Keypair` import removed)

---
*(This table of contents will be updated as more services are analyzed.)* 