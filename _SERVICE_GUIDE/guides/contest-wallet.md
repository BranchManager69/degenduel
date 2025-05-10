# Contest Wallet Service Documentation

This document contains diagrams and analysis for components within the `contest-wallet` service, focusing on its Web3 interactions and migration status.

---

## Overview

*(Analysis to be added as files are reviewed)*

---

### Component: `services/contest-wallet/contestWalletService.js`

**Purpose:** This service is central to managing wallets used for contests. It handles creation (both random and vanity), encryption/decryption of private keys, balance updates, and reclaiming funds from completed contests to a treasury wallet. It also includes WebSocket-based balance monitoring.

**Key Interactions & Structure:**

```
ContestWalletService (extends BaseService)
 |
 +-- Dependencies:
 |   |   
 |   +-- @solana/web3.js (v1): Keypair, PublicKey, LAMPORTS_PER_SOL, SystemProgram, Transaction (HEAVILY USED)
 |   +-- prisma (DB: contest_wallets, contests, vanity_wallet_pool)
 |   +-- solanaEngine (for some RPC calls like getBalance, sendTransaction)
 |   +-- TreasuryCertifier (for fund certification)
 |   +-- VanityApiClient (to fetch available vanity wallets)
 |   +-- Node.js crypto (AES-256-GCM for private key encryption)
 |   +-- ws (WebSocket client for balance monitoring)
 |   +-- bs58
 |
 +-- Core Responsibilities & Methods:
 |   |
 |   +-- Wallet Creation (`createContestWallet`):
 |   |   L__ Tries `VanityApiClient.getUnassociatedVanityWallet()` first.
 |   |   L__ If vanity available: Uses its key material (raw 64-byte array, stringified & encrypted for DB).
 |   |   L__ If no vanity: Falls back to `Keypair.generate()` (v1) for random wallet.
 |   |       L__ Stores `Buffer.from(keypair.secretKey).toString('base64')` (encrypted) for random wallets.
 |   |
 |   +-- Encryption/Decryption (`encryptPrivateKey`, `decryptPrivateKey`):
 |   |   L__ Handles stringified key data (base64 of v1 64-byte secretKey or JSON string of 64-byte array).
 |   |
 |   +-- Balance Updates (`updateWalletBalance`):
 |   |   L__ Uses `new PublicKey(addressString)` (v1).
 |   |   L__ Calls `solanaEngine.executeConnectionMethod('getBalance', v1PublicKey)`.
 |   |
 |   +-- Fund Reclaiming (`reclaimUnusedFunds` -> `performBlockchainTransfer` -> `executeTransfer`):
 |   |   L__ **Heavy v1 usage:** Reconstructs v1 `Keypair` using `Keypair.fromSecretKey()` after decrypting stored private key.
 |   |   L__ Builds v1 `Transaction` with `SystemProgram.transfer()`.
 |   |   L__ Signs with v1 `Keypair`.
 |   |   L__ Sends via `solanaEngine.sendTransaction()` (which might internally handle v1 Tx object).
 |   |
 |   +-- WebSocket Monitoring (`initializeWebSocketMonitoring`, `handleAccountUpdate`):
 |   |   L__ Monitors wallet addresses for balance changes, updates Prisma.
 |   |   L__ Largely independent of v1/v2 client libraries for its core WebSocket logic.
 |   |
 |   +-- Treasury Certification (`initTreasuryCertifier`):
 |       L__ Initializes `TreasuryCertifier`, passing `solanaEngine` and `decryptPrivateKey`.
 |
 +-- Key Data Handling:
     L__ For random wallets: Encrypts and stores base64 of the 64-byte `keypair.secretKey` (from v1 `Keypair.generate()`).
     L__ For vanity wallets: Encrypts and stores the JSON string of the 64-byte array (from `solana-keygen`).
```

**Migration Notes for `services/contest-wallet/contestWalletService.js`:**
*   **Significant v1 Footprint:** This service has extensive and core dependencies on `@solana/web3.js` v1, particularly for:
    *   Random keypair generation (`Keypair.generate()`).
    *   Representing public keys (`new PublicKey()`).
    *   Reconstructing keypairs for signing (`Keypair.fromSecretKey()`).
    *   Building, signing, and potentially sending transactions (`Transaction`, `SystemProgram.transfer`).
*   **Key Generation (Random Fallback):**
    *   The `Keypair.generate()` needs to be replaced. The v2 equivalent is `await generateKeyPair()` from `@solana/keys`, which returns `{ secretKey: Uint8Array(32), publicKey: Uint8Array(32) }`.
    *   To maintain compatibility with how vanity keys are stored (as a 64-byte array stringified), the new random keys should also be stored this way: create a 64-byte array `[...secretKey, ...publicKey]`, then `JSON.stringify()` it, then encrypt.
*   **Private Key Handling for Signing:**
    *   The `decryptPrivateKey` method returns a string. This string (after parsing if JSON, or base64 decoding) gives the 64-byte array.
    *   Instead of `Keypair.fromSecretKey(Buffer.from(decryptedKey, 'base64'))` or `Keypair.fromSecretKey(Uint8Array.from(JSON.parse(decryptedKey)))`,
    *   Use the first 32 bytes of this 64-byte array (the seed) with a v2 signer creation function like `createKeyPairSignerFromBytes(seedBytes)` from `@solana/kit`.
*   **Transaction Rebuilding (Major Task):**
    *   All logic creating `new Transaction()`, `SystemProgram.transfer()`, and signing with v1 `Keypair` objects must be refactored to the v2 transaction lifecycle:
        1.  Create instructions in v2 format.
        2.  Build a transaction message (`createTransactionMessage` from `@solana/transaction-messages`).
        3.  Set fee payer, blockhash/lifetime.
        4.  Compile the message (`compileTransaction` from `@solana/transactions`).
        5.  Sign with v2 signers (`signTransaction` from `@solana/transactions`).
        6.  Send via `solanaEngine` (if it accepts v2 signed transactions) or directly using a v2 RPC client.
    *   The `solana-compat.js` utility from the `admin-wallet` service could serve as a model or be generalized.
*   **`PublicKey` Objects:** Replace `new PublicKey(addressString)` with `address(addressString)` from `@solana/addresses` where a v2 `Address` is needed, or pass string addresses directly to functions that accept them (like potentially `solanaEngine` methods or new v2 RPC calls).
*   **`solanaEngine` Dependency:** The extent to which `solanaEngine` handles v1 vs. v2 objects for `getBalance` and `sendTransaction` needs to be clear. If `solanaEngine` is not fully v2-aware, direct v2 RPC calls might be needed for some operations.
*   **`TreasuryCertifier`:** This module is also initialized with v1-style `decryptPrivateKey` and `solanaEngine`. It will also need to be audited and updated.

**Overall:** This service requires substantial refactoring for v2 migration, primarily centered around keypair handling for signing and the entire transaction building/signing pipeline.

---

### Component: `services/contest-wallet/treasury-certifier.js`

**Purpose:** This module validates the integrity of treasury and wallet fund transfer operations, often as a startup routine. It generates or loads test keypairs, performs a series of SOL transfers between them (potentially requiring manual funding if balances are insufficient), and can scan for/recover funds from previously used certification wallets. It relies heavily on `@solana/web3.js` v1 for its operations.

**Key Interactions & Structure:**

```
TreasuryCertifier
 |
 +-- Dependencies:
 |   |   
 |   +-- @solana/web3.js (v1): Keypair, PublicKey, LAMPORTS_PER_SOL, SystemProgram, Transaction (EXTENSIVE USAGE)
 |   +-- solanaEngine (Injected: for RPC calls like getBalance, getTransaction, sendRawTransaction, getLatestBlockhash, confirmTransaction via `executeConnectionMethod`)
 |   +-- prisma (Injected: but limited direct use in core certification logic shown)
 |   +-- decryptPrivateKey (Injected: from ContestWalletService - though not directly used in `fundWallet` which uses Keypairs from file/generation)
 |   L__ fs, path, crypto, readline, qrcode/qrcode-terminal, bs58, logging utils, config.
 |
 +-- Core Properties:
 |   |   
 |   +-- this.certificationConfig (Parameters for test transactions)
 |   +-- this.certKeypairsDir (Directory for storing/loading keypair JSON files)
 |   L__ this.persistentPool, this.persistentTestWallets (Holds v1 Keypair objects for reusable tests).
 |
 +-- Core Methods & v1 Usage Points:
 |   |
 |   +-- Keypair Management (File I/O & Generation):
 |   |   L__ `initPersistentCertificationPool()`: Uses `Keypair.generate()` (v1) to create new keypairs if corresponding JSON files are not found. Saves new keypairs as JSON (64-byte `secretKey` array).
 |   |   L__ Loads existing keypairs from JSON files using `Keypair.fromSecretKey(Uint8Array.from(json_array))` (v1).
 |   |   L__ `runCertification()` (traditional flow): Also uses `Keypair.generate()` (v1) for temporary wallets and saves them.
 |   |   L__ `scanForStrandedFunds()`: Reads JSON keypair files and reconstructs v1 `Keypair` objects.
 |   |
 |   +-- Transaction Logic (`fundWallet(sourceKeypair_v1, destinationPublicKey_v1_or_string, amountSOL)`) - Central v1 hub:
 |   |   L__ Accepts a v1 `Keypair` as `sourceKeypair`.
 |   |   L__ Converts `destinationPublicKey` string to `new PublicKey(destinationString)` (v1) if needed.
 |   |   L__ Builds `new Transaction().add(SystemProgram.transfer({ fromPubkey: v1, toPubkey: v1, lamports }))` (v1).
 |   |   L__ Fetches blockhash via `solanaEngine.executeConnectionMethod('getLatestBlockhash')`.
 |   |   L__ Signs with `transaction.sign(sourceKeypair_v1)` (v1).
 |   |   L__ Sends via `solanaEngine.executeConnectionMethod('sendRawTransaction', transaction.serialize())`.
 |   |   L__ Confirms via `solanaEngine.executeConnectionMethod('confirmTransaction', signature)`.
 |   |
 |   +-- RPC Calls (via `solanaEngine.executeConnectionMethod("v1MethodName", ...)` which now maps to v2 calls in `connection-manager`):
 |   |   L__ `getBalance(v1PublicKey)`
 |   |   L__ `getLatestBlockhash()`
 |   |   L__ `getSignaturesForAddress(v1PublicKey, ...)`
 |   |   L__ `getTransaction(signature)`
 |   |
 |   +-- Manual Funding Interaction (`waitForFunds`):
 |       L__ Generates QR codes for funding addresses. Uses `new PublicKey()` for display/validation before RPC calls.
 |
 +-- Key Storage Format:
     L__ Saves/loads keypairs as JSON files containing a 64-element array representing the v1 `secretKey` (32-byte seed + 32-byte public key).
```

**Migration Notes for `services/contest-wallet/treasury-certifier.js`:**
*   **Pervasive v1 SDK Usage:** This module is deeply integrated with `@solana/web3.js` v1 for nearly all its Solana-related tasks, including keypair generation, loading keypairs from files, creating `PublicKey` objects, and the entire transaction lifecycle.
*   **Keypair Management Overhaul:**
    *   **Generation:** All `Keypair.generate()` calls must be replaced with `await generateKeyPair()` from `@solana/keys`. The resulting `{ secretKey: Uint8Array(32), publicKey: Uint8Array(32) }` should be combined into a 64-byte `Uint8Array` (`new Uint8Array([...secretKey, ...publicKey])`) before being stringified (`Array.from()`) and saved to JSON to maintain the existing file storage format.
    *   **Loading/Reconstruction:** When reading a 64-byte array from a JSON file, instead of `Keypair.fromSecretKey(Uint8Array.from(json_array))`, extract the first 32 bytes (the seed: `json_array.slice(0, 32)`), convert to `Uint8Array`, and use a v2 function like `createKeyPairSignerFromBytes(seedBytes)` from `@solana/kit` to obtain a v2-compatible signer object. This v2 signer will then be used for any signing operations.
*   **Transaction Logic (`fundWallet`):** This method requires a complete rewrite to use the v2 transaction model. It should:
    1.  Accept a v2 `Signer` object for the source.
    2.  Accept the destination as a v2 `Address` string.
    3.  Construct v2 instructions for the transfer.
    4.  Call the refactored `solanaEngine.sendTransaction(v2Instructions, feePayerAddress_v2, [v2Signer], options)`.
*   **`PublicKey` to `Address` String:** All instances of `new PublicKey(addressString)` must be removed. Use string addresses directly with v2-compatible functions or convert to v2 `Address` objects via `address(addressString)` from `@solana/addresses` where explicitly needed by a v2 library.
*   **Calls to `solanaEngine`:** Review all calls to `solanaEngine.executeConnectionMethod()`. While `connection-manager` now translates these to v2 RPC calls, ensure that the arguments passed (especially addresses) are in the format expected by `connectionManager.executeSolanaRpcMethod` (likely strings for public keys).
*   **File Format is Good:** The existing JSON file format for keypairs (64-byte array) is compatible with v2 loading methods (by extracting the seed), so the file structure itself doesn't need to change.

**Overall:** This module needs extensive refactoring to replace all v1 SDK usage with v2 equivalents, particularly in key management and transaction processing. The `fundWallet` method is the most critical part to update.

--- 