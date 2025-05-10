# Web3 v1 to v2 Migration - Summary Report

Date: $(date +%Y-%m-%d)

## 1. Overall Migration Status

Based on the analysis of multiple services and their components, the migration from `@solana/web3.js` v1 to the new v2 JavaScript SDKs is a significant undertaking with varying levels of impact across the codebase.

*   **Services Primarily Agnostic / Easy Migration:** A substantial portion of the services, particularly those dealing with data collection from external non-Solana APIs (e.g., `token-enrichment` collectors, `dexscreenerClient`) or higher-level orchestration, are already agnostic to the Solana client SDK version or require minimal changes. The `vanity-wallet` service is a good example where the core generation relies on the external `solana-keygen` tool, and JS-side v1 usage was minor and has been addressed.
*   **Services with Significant v1 Dependencies:** Core services responsible for direct Solana blockchain interaction, such as `solana-engine` (specifically `connection-manager.js` and `solana-engine.js`) and `contest-wallet` (both `contestWalletService.js` and `treasury-certifier.js`), have deep integrations with v1 of `@solana/web3.js`. These require major refactoring.
*   **Services with Moderate/Minor v1 Dependencies:** Some services like `admin-wallet` and `userBalanceTrackingService` have specific modules or instances of v1 usage (e.g., `Keypair` creation/reconstruction, `PublicKey` instantiation) that are more localized but still need attention.

Refer to the [Web3 Migration Status Overview Checklist](./web3_migration_checklist.md) for a detailed per-service status.

## 2. Key Areas Requiring Refactoring

The most common and critical areas for migration are:

*   **RPC Connection Management:**
    *   The v1 `Connection` object (from `@solana/web3.js`) is used in `solana-engine/connection-manager.js` and subsequently by `solana-engine.js` and other services that rely on `solanaEngine` for RPC calls.
    *   **Action:** This needs to be replaced with a v2 RPC client (e.g., from `@solana/rpc-transport` or `@solana/rpc`). The `ConnectionManager` should be refactored to provide this v2 client, and all consumers updated.

*   **Transaction Building, Signing, and Sending:**
    *   Multiple services (`solana-engine.js`, `contestWalletService.js`, `treasury-certifier.js`) build, sign, and send transactions using v1 `Transaction`, `SystemProgram.transfer`, `Keypair` signing, and `sendAndConfirmTransaction` or `connection.sendTransaction`.
    *   **Action:** This is a major refactoring task. The entire lifecycle must be updated to the v2 model:
        1.  Use v2 instruction formats.
        2.  Build transaction messages with `@solana/transaction-messages` (`createTransactionMessage`, `setTransactionMessageFeePayer`, `setTransactionMessageLifetimeUsingBlockhash`, `appendTransactionMessageInstruction`).
        3.  Compile messages with `@solana/transactions` (`compileTransaction`).
        4.  Sign with v2 signers (e.g., `KeyPairSigner` derived from raw seeds, or `CryptoKey` objects) using `signTransaction` from `@solana/transactions`.
        5.  Send via a v2 RPC client's `sendTransaction` method.
    *   The `admin-wallet/utils/solana-compat.js` file provides some examples of using `@solana/compat` and building v2 transactions, which can serve as a reference.

*   **Keypair Generation and Handling:**
    *   `Keypair.generate()` (v1) is used for creating new wallets (e.g., in `contestWalletService.js`, `treasury-certifier.js`).
    *   `Keypair.fromSecretKey()` (v1) is used to reconstruct keypairs from raw byte arrays (e.g., in `admin-wallet/modules/wallet-crypto.js`, `treasury-certifier.js`, and was in `vanity-wallet/generators/local-generator.js` before being fixed).
    *   **Action (Generation):** Replace `Keypair.generate()` with `await generateKeyPair()` from `@solana/keys`. This returns `{ secretKey: Uint8Array(32), publicKey: Uint8Array(32) }`. If the 64-byte array format (seed + pubkey) is needed for storage (as used by `solana-keygen`), these two should be concatenated.
    *   **Action (Loading/Reconstruction):** When loading a 64-byte array (e.g., from a file or decrypted storage), extract the first 32 bytes (the seed) and use a v2 function like `createKeyPairSignerFromBytes(seedBytes)` (from `@solana/kit`) or similar functionality in `@solana/keys` to get a v2-compatible signer object.

*   **PublicKey Objects:**
    *   `new PublicKey(addressString)` (v1) is used in various places (`contestWalletService.js`, `userBalanceTrackingService.js`, etc.).
    *   **Action:** Replace with `address(addressString)` from `@solana/addresses` where a v2 `Address` object is needed, or pass string addresses directly to v2 functions that accept them.

## 3. Key Generation for File Storage (e.g., `solana-keygen new --outfile`)

*   **Challenge:** We confirmed that generating a new keypair *and* exporting its 32-byte private seed directly from v2 JavaScript libraries (`@solana/keys`, `@solana/kit`) in a standard Node.js environment is problematic. Node.js's Web Crypto API restricts the `'raw'` export of Ed25519 private keys, even if generated as `extractable: true`.
*   **Recommended Solution:** For creating keypair files in the traditional `solana-keygen` JSON format (64-byte array), the most reliable method remains using the external Rust-based `solana-keygen new --outfile mykey.json` CLI tool.
*   **Loading these files in v2:** Node.js applications can then load the byte array from these JSON files and use v2 functions like `createKeyPairSignerFromBytes(seedBytes)` to obtain a functional v2 signer.
*   **In-Application Generation:** For keys generated and used purely within the application runtime (without needing to save the seed to a file), the v2 libraries like `@solana/keys` `generateKeyPair()` work perfectly fine for creating `CryptoKey` objects suitable for v2 signing operations.

## 4. General Observations & Recommendations

*   **Abstraction Layers:** Services that interact with external APIs (Jupiter, Helius, DexScreener) via dedicated client modules (`jupiterClient`, `heliusClient`, `dexscreenerClient`, `dexScreenerCollector`) are well-insulated from the Solana SDK migration, as these clients handle direct API communication using HTTP/WebSocket and do not rely on `@solana/web3.js`.
*   **Prisma Client Instantiation:** Several modules (`solana-engine.js`, `token-refresh-scheduler.js`, `token-dex-data-service.js`, `token-history-functions.js`) instantiate their own `PrismaClient`. This should be standardized to use a single, shared Prisma client instance (e.g., from `config/prisma.js`) for better connection pooling and consistency.
*   **Unused Imports:** Several files contain unused imports, including v1 `@solana/web3.js` imports in some cases. These should be cleaned up.
*   **Phased Approach:** Given the varying levels of v1 dependency, a phased migration approach is advisable. Start with foundational components like `connection-manager.js`, then move to services with heavy transaction logic.

## 5. Next Steps (High-Level Suggestions)

1.  **Prioritize `solana-engine`:** Focus on migrating `connection-manager.js` to a v2 RPC client model, then refactor `solana-engine.js` (especially its transaction methods) to use this v2 client and v2 transaction objects.
2.  **Address `contest-wallet`:** This service requires significant refactoring of its key handling and transaction logic.
3.  **Update `admin-wallet`:** Complete the migration of its modules, particularly `wallet-crypto.js` and ensure `solana-compat.js` uses pure v2 mechanisms where possible.
4.  **Review and update services with minor v1 usage** (e.g., `userBalanceTrackingService.js`).
5.  **Standardize Prisma client usage** across all services.
6.  **Perform thorough testing** after each major refactoring.

This report summarizes the current understanding of the Web3 migration landscape within the analyzed services. Further detailed analysis of remaining unmapped services will provide a more complete picture. 