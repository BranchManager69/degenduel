# SolanaEngine Migration Targets

The following files currently import or use `solanaService` and should be evaluated for migration to the new `SolanaEngine`:

## Key Services to Migrate

1. **Contest Wallet Service**
   - File: `/home/websites/degenduel/services/contestWalletService.js`
   - Priority: High
   - Notes: Manages contest wallet balances and transactions

2. **User Balance Tracking Service**
   - File: `/home/websites/degenduel/services/userBalanceTrackingService.js`
   - Priority: High
   - Notes: Tracks user wallet balances

3. **Admin Wallet Service**
   - File: `/home/websites/degenduel/services/adminWalletService.js`
   - Priority: Medium
   - Notes: Handles administrative wallet operations

## WebSockets to Update

1. **Wallet WebSocket (v69)** ✅ (ARCHIVED)
   - File: `/home/websites/degenduel/archive/websocket/v69/wallet-ws.js`
   - Priority: High
   - Notes: Provides real-time wallet data to clients
   - Status: Migrated to use SolanaEngine and then archived on April 1, 2025

2. **Legacy Wallet WebSocket** ✅ (ARCHIVED)
   - File: `/home/websites/degenduel/archive/websocket/wallet-ws.js`
   - Priority: Low (legacy)
   - Notes: Older version of wallet WebSocket
   - Status: Archived on April 1, 2025

## Integration Points

1. **Solana Service Manager**
   - File: `/home/websites/degenduel/utils/solana-suite/solana-service-manager.js`
   - Priority: Critical
   - Notes: Central manager for Solana-related services

2. **Web3 Transaction Handler**
   - File: `/home/websites/degenduel/utils/solana-suite/web3-v2/solana-transaction-fixed.js`
   - Priority: Medium
   - Notes: Handles transaction creation and submission

## Migration Approach

For each of these files, follow this process:

1. **Analysis**:
   - Identify all calls to solanaService methods
   - Map each method to the equivalent in SolanaEngine
   - Note any functionality gaps

2. **Implementation**:
   - Create adapter functions if needed
   - Update imports to use SolanaEngine
   - Update method calls to use SolanaEngine equivalents

3. **Testing**:
   - Test each updated component thoroughly
   - Watch for performance changes
   - Monitor error rates

4. **Documentation**:
   - Update inline comments to note the migration
   - Add deprecation notices to old code paths
   - Document any API differences

## Migration Timeline

We recommend migrating in this order:

1. First Phase:
   - Solana Service Manager
   - User Balance Tracking Service

2. Second Phase:
   - Contest Wallet Service
   - Wallet WebSocket (v69)

3. Third Phase:
   - Admin Wallet Service
   - Web3 Transaction Handler

4. Final Phase:
   - Legacy components
   - Remove solanaService completely

## Important Notes

- The migration should be gradual to minimize disruption
- Each component should be tested thoroughly after migration
- Keep the old service running until all components are migrated
- Log any issues encountered during migration for future reference