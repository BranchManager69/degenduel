# Admin Wallet Service Documentation

This document contains diagrams and analysis for components within the `admin-wallet` service, particularly focusing on areas relevant to the Web3 v1 to v2 migration.

---

## Overview

The `admin-wallet` service is responsible for managing administrative wallets, including operations like balance checking, transaction handling, and cryptographic functions. It is currently in a partial migration state, with some components using the new Solana v2 stack while others still rely on the legacy `@solana/web3.js`.

Files identified as still using `@solana/web3.js` (v1) and requiring migration attention:
*   `admin-wallet-service.js`
*   `modules/wallet-balance.js`
*   `modules/wallet-crypto.js`
*   `modules/wallet-transactions.js`
*   `utils/solana-compat.js` (noted as mixed v1/v2)

---

### Component: `admin-wallet-service.js`

**Purpose:** The central orchestrator for administrative wallet operations. It manages wallet security, handles SOL/token transfers (single & batch), and monitors wallet balances. This service delegates specific low-level Solana interactions and cryptographic operations to its sub-modules.

**Key Interactions & Structure:**

```
AdminWalletService (extends BaseService)
 |
 +-- Configuration: ADMIN_WALLET_CONFIG, DB Settings (via Prisma)
 |
 +-- Dependencies:
 |   |   
 |   +-- solanaEngine (for blockchain interactions, crucial for v2 migration path)
 |   +-- prisma (for database access: managed_wallets, system_settings)
 |   +-- AdminLogger (for logging admin actions)
 |   +-- serviceManager (for service registration & status reporting)
 |   +-- Environment Variables (e.g., WALLET_ENCRYPTION_KEY)
 |
 +-- Core Responsibilities & Methods:
 |   |
 |   +-- Initialization (initialize):
 |   |   L__ Waits for solanaEngine, loads config, initializes stats, registers with serviceManager.
 |   |
 |   +-- Wallet Encryption/Decryption:
 |   |   |   
 |   |   +-- encryptWallet(privateKey) --> Delegates to: walletCrypto.encryptWallet()
 |   |   +-- decryptWallet(encryptedData) --> Delegates to: walletCrypto.decryptWallet()
 |   |
 |   +-- Single Transfer Operations:
 |   |   |
 |   |   +-- transferSOL(...) --> Delegates to: walletTransactions.transferSOL()
 |   |   |   L__ Manages activeTransfers map & timeouts.
 |   |   |
 |   |   +-- transferToken(...) --> Delegates to: walletTransactions.transferToken()
 |   |       L__ Manages activeTransfers map & timeouts.
 |   |
 |   +-- Batch Transfer Operations:
 |   |   |
 |   |   +-- massTransferSOL(...) --> Delegates to: batchOperations.massTransferSOL()
 |   |   +-- massTransferTokens(...) --> Delegates to: batchOperations.massTransferTokens()
 |   |
 |   +-- Balance Operations:
 |   |   |
 |   |   +-- updateWalletBalance(wallet) --> Delegates to: walletBalance.updateWalletBalance()
 |   |   +-- updateAllWalletBalances() --> Delegates to: walletBalance.updateAllWalletBalances()
 |   |   +-- checkWalletStates() --> Delegates to: walletBalance.checkWalletStates()
 |   |
 |   +-- Service Lifecycle & Operations:
 |   |   |
 |   |   +-- stop()
 |   |   +-- onPerformOperation() (calls performOperation, circuit breaker integration)
 |   |   +-- performOperation() (periodic task: updates balances, checks solanaEngine)
 |   |
 |   +-- Status Reporting:
 |       L__ getServiceStatus() (provides detailed service & wallet stats)
 |
 +-- Internal State:
 |   |
 |   +-- this.walletStats (detailed statistics object)
 |   +-- this.activeTransfers (Map: tracks ongoing single transfers)
 |   +-- this.transferTimeouts (Set: manages timeouts for single transfers)
 |
 +-- Modules Delegated To (Key for v1->v2 Migration Focus):
     |
     +-- walletCrypto (from './modules/wallet-crypto.js')
     +-- walletTransactions (from './modules/wallet-transactions.js')
     +-- batchOperations (from './modules/batch-operations.js')
     +-- walletBalance (from './modules/wallet-balance.js')
```

**Migration Notes for `admin-wallet-service.js`:**
*   This service itself appears to have removed direct `Keypair`, `PublicKey` imports from `@solana/web3.js`.
*   Its migration status heavily depends on the migration status of the modules it delegates to (`wallet-crypto`, `wallet-transactions`, `batch-operations`, `wallet-balance`) and its interaction with `solanaEngine`.
*   If these underlying modules or `solanaEngine` (where relevant to its calls) still use v1 `@solana/web3.js` objects/methods, then this service is indirectly affected and not fully v2.
*   The primary concern for this specific file would be ensuring that the data structures it passes to and receives from these modules are compatible with v2 standards if the modules are updated.

---

### Component: `modules/wallet-crypto.js`

**Purpose:** Handles encryption/decryption of wallet private keys and creation of Solana `Keypair` objects from various private key formats.

**Key Interactions & Structure:**

```
wallet-crypto.js
 |
 +-- Dependencies:
 |   |   
 |   +-- crypto (Node.js module for AES-256-GCM encryption/decryption)
 |   +-- bs58 (for Base58 decoding)
 |   +-- @solana/web3.js (Specifically: `Keypair` - DIRECT V1 USAGE)
 |   +-- ../utils/solana-compat.js (Imports `createKeypairFromPrivateKey` as `createKeypairV2Compat`)
 |   +-- ServiceError
 |
 +-- Core Functions:
 |   |
 |   +-- encryptWallet(privateKey, config, encryptionKey)
 |   |   L__ Uses crypto.createCipheriv (AES-256-GCM), returns JSON {encrypted, iv, tag}.
 |   |
 |   +-- decryptWallet(encryptedData, encryptionKey)
 |   |   L__ Uses crypto.createDecipheriv (AES-256-GCM), handles potential plaintext input.
 |   |
 |   +-- createKeypairFromPrivateKeyLegacy(decryptedPrivateKeyString)  [V1 SPECIFIC]
 |   |   L__ Attempts to decode string from hex, bs58, base64, JSON array.
 |   |   L__ Uses `Keypair.fromSecretKey()` (from @solana/web3.js v1).
 |   |   L__ Pads keys to 64 bytes if needed.
 |   |
 |   +-- createKeypairFromPrivateKeyCompat(privateKeyInput) [BRIDGE ATTEMPT]
 |       L__ If input is string: Calls `createKeypairFromPrivateKeyLegacy()` first to get bytes.
 |       L__ If input is bytes (Uint8Array/Buffer): Uses directly.
 |       L__ Calls `createKeypairV2Compat(bytes)` (from solana-compat.js).
 |
 +-- Exported API:
     L__ { encryptWallet, decryptWallet, createKeypairFromPrivateKeyCompat, createKeypairFromPrivateKeyLegacy }
```

**Migration Notes for `modules/wallet-crypto.js`:**
*   **Direct v1 Dependency:** The function `createKeypairFromPrivateKeyLegacy` directly uses `Keypair.fromSecretKey` from `@solana/web3.js` (v1). This is a primary target for migration.
*   **Bridging Function's v1 Path:** The `createKeypairFromPrivateKeyCompat` function, while aiming for v2 compatibility, currently falls back to using the `createKeypairFromPrivateKeyLegacy` (v1) function when its input is a string. This means it's not fully independent of v1 for all input types.
*   **Reliance on `solana-compat.js`:** The effectiveness of the `createKeypairFromPrivateKeyCompat` function for v2 compatibility depends heavily on the implementation of `createKeypairV2Compat` (imported from `../utils/solana-compat.js`). We'll need to analyze `solana-compat.js` to understand how it handles keypair creation from bytes.
*   **Goal for v2:**
    *   Ideally, `createKeypairFromPrivateKeyCompat` (or a new dedicated v2 function) should be able to take various private key input formats (bytes, common string encodings like bs58, hex) and produce a v2-compatible keypair representation *without* relying on any `@solana/web3.js` v1 functions.
    *   This might involve using v2 library functions for decoding bs58/hex directly and then creating the keypair from the resulting secret key bytes using only v2 stack tools (e.g., from `@solana/keys` or similar in the v2 ecosystem).
    *   The padding logic for keys of incorrect length in `createKeypairFromPrivateKeyLegacy` should be reviewed for correctness and whether it's still needed or handled differently in v2.

---

### Component: `utils/solana-compat.js`

**Purpose:** Acts as a compatibility layer to bridge Solana Web3.js v1.x and the new v2.x stack. Provides unified functions for common operations like key creation, RPC calls, and transaction sending, attempting to abstract the version differences.

**Key Interactions & Structure:**

```
utils/solana-compat.js
 |
 +-- Dependencies:
 |   |   
 |   +-- @solana/web3.js (v1): `PublicKeyV1`, `KeypairV1` (for intermediate steps & type checks)
 |   +-- @solana/addresses (v2): `address`, `getAddressFromPublicKey`
 |   +-- @solana/rpc (v2): `createSolanaRpc`
 |   +-- @solana/transaction-messages (v2): Message creation/modification functions
 |   +-- @solana/transactions (v2): `compileTransaction`, `signTransaction`
 |   +-- @solana/compat (Official v1<->v2 bridge): `fromLegacyKeypair`, `fromLegacyTransactionInstruction`
 |
 +-- Core Functions:
 |   |
 |   +-- toAddress(publicKeyOrStringV1_Or_String): Converts to v2 Address.
 |   |   L__ Uses v2 `@solana/addresses`.
 |   |
 |   +-- createKeypairFromPrivateKey(privateKeyBytes): Creates v2 `CryptoKeyPair`.
 |   |   L__ **Internally creates `KeypairV1.fromSecretKey(bytes)` (v1).**
 |   |   L__ Then uses `fromLegacyKeypair(v1Keypair)` (from `@solana/compat`) to get v2 `CryptoKeyPair`.
 |   |
 |   +-- executeRpcMethod(connection, method, ...args): Flexible RPC wrapper.
 |   |   L__ If `connection` is SolanaEngine (v1 style): Calls `connection.executeConnectionMethod()`.
 |   |   L__ Else (v2 style): Creates v2 RPC client, calls specific v2 methods (e.g., `rpc.getBalance()`).
 |   |       L__ Handles argument adaptation & uses `toAddress()`.
 |   |
 |   +-- sendTransaction(connection, transactionV1, signers_CryptoKeyPair, options): Flexible Tx sender.
 |   |   L__ If `connection` is SolanaEngine (v1 style): Calls `connection.sendTransaction()`.
 |   |       L__ Notes potential signer type mismatch (v1 Keypair vs v2 CryptoKeyPair).
 |   |   L__ Else (v2 style):
 |   |       L__ Gets blockhash (via `executeRpcMethod`).
 |   |       L__ Converts v1 instructions to v2 via `fromLegacyTransactionInstruction()`.
 |   |       L__ Builds, compiles, signs, and sends v2 transaction message using v2 libraries.
 |   |
 |   +-- getLamportsFromRpcResult(rpcResult, ...): Normalizes balance results (v1 number vs v2 object).
 |
 +-- Constants:
     L__ LAMPORTS_PER_SOL
```

**Migration Notes for `utils/solana-compat.js`:**
*   **Central to Phased Migration:** This file is a clear example of a compatibility layer, essential for a gradual migration. It uses official `@solana/compat` tools.
*   **Remaining v1 Step in Key Creation:** The `createKeypairFromPrivateKey` function, while outputting a v2 `CryptoKeyPair`, still takes an intermediate step of creating a v1 `Keypair`. For a "pure" v2 stack, this internal v1 instantiation should eventually be removed.
    *   **Update (Investigation Finding):** The `@solana/kit` library provides `createKeyPairSignerFromBytes(bytes)`. This function appears to offer a direct v2 path from raw private key bytes to a `KeyPairSigner` object, potentially eliminating the need for the intermediate v1 `Keypair` creation when the input is already in byte format. This should be further investigated for compatibility with the rest of the v2 signing process (which often expects `CryptoKey` objects).
*   **Conditional Logic for RPC/Tx:** The `executeRpcMethod` and `sendTransaction` functions contain conditional logic to route calls to either a presumed v1 path (via `solanaEngine`) or a direct v2 path. The long-term goal would be to migrate all callers to use the direct v2 path and then simplify or remove this conditional logic.
*   **Signer Compatibility:** The `sendTransaction` v1 path explicitly notes potential issues with signer types if `solanaEngine` expects v1 `Keypair`s but receives v2 `CryptoKeyPair`s. This highlights a critical area to manage during the transition.
*   **Incomplete RPC Abstraction:** `executeRpcMethod` has a `switch` for common RPC calls. Expanding full v2 RPC support might require adding more cases or a more robust dynamic dispatch, though the latter is noted as risky.
*   **Future Simplification:** As more of the system (including `solanaEngine`) moves to v2, this compatibility layer can be simplified, and eventually, parts of it might be deprecated or removed once all direct v1 dependencies are gone from the services that use it.

--- 