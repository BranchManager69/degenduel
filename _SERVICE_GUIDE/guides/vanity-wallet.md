# Vanity Wallet Service Documentation

This document contains diagrams and analysis for components within the `vanity-wallet` service, particularly focusing on key generation and storage mechanisms in the context of the Web3 v1 to v2 migration.

---

## Overview of Key Files

*   `vanity-wallet-service.js`: The main service class that orchestrates the generation and maintenance of a pool of vanity wallets.
*   `vanity-api-client.js`: Likely handles communication with the generation logic and database persistence.
*   `generators/index.js` (and specific generators like `local-generator.js`): Contains the actual vanity address generation logic.
*   `routes/admin/vanity-wallets.js`: Exposes admin API endpoints for managing vanity wallets.

---

### Component: `services/vanity-wallet/vanity-wallet-service.js`

**Purpose:** This service runs as a background process to ensure a sufficient pool of pre-generated vanity Solana addresses (e.g., starting with "DUEL" or "DEGEN") is available. It manages job requests for generation and monitors the pool status.

**Key Interactions & Structure:**

```
VanityWalletService (extends BaseService)
 |
 +-- Configuration: Patterns (e.g., DUEL, DEGEN), Target Counts, Timeouts, Intervals.
 |
 +-- Dependencies:
 |   |   
 |   +-- prisma (for DB access: vanity_wallet_pool, vanity_wallet_jobs)
 |   +-- VanityApiClient (delegates actual generation request submission)
 |   +-- VanityWalletGeneratorManager (likely holds/manages the generation engine)
 |   +-- child_process (exec - used for `ps` and `kill` commands)
 |   +-- config (application configuration)
 |
 +-- Core Responsibilities & Methods:
 |   |
 |   +-- Initialization (initialize):
 |   |   L__ Loads config, sets up service parameters.
 |   |
 |   +-- Orchestration (onPerformOperation -> checkAndGenerateAddresses):
 |   |   L__ Periodically checks DB for available vs. target vanity addresses.
 |   |   L__ If more are needed, calls `this.generateVanityAddress()`.
 |   |
 |   +-- Generation Request (`generateVanityAddress(pattern, options)`):
 |   |   L__ **Does NOT generate keys directly.**
 |   |   L__ Calls `VanityApiClient.createVanityAddressRequest(...)` to queue a generation job.
 |   |   L__ Relies on `VanityApiClient` and the underlying generator (likely `VanityWalletGeneratorManager`) for actual keypair generation, encryption, and storage.
 |   |
 |   +-- Process Management:
 |   |   L__ `cleanupOrphanedProcesses()`: Uses `exec` to find and kill `solana-keygen` processes.
 |   |   L__ `resetStuckJobs()`: Also uses `exec` to find PIDs of `solana-keygen` for stuck jobs and kill them.
 |   |
 |   +-- Status & Monitoring (`logJobStatus`, `getStatus`):
 |       L__ Queries Prisma DB for job statuses, counts, processing times.
 |
 +-- Key Generation Paradigm Indication:
     L__ The presence of `cleanupOrphanedProcesses` and `resetStuckJobs` that specifically `grep` for and `kill` `solana-keygen` processes strongly suggests that the actual vanity address generation (finding a keypair where the public key matches a pattern) is performed by an external `solana-keygen` CLI tool. This tool is known to produce exportable raw private key seeds.
```

**Migration Notes for `services/vanity-wallet/vanity-wallet-service.js`:**
*   **No Direct Key Generation:** This service file does not appear to contain any JavaScript-based key generation code (neither v1 `@solana/web3.js` `Keypair` nor v2 `@solana/keys` `generateKeyPair`).
*   **Relies on External Generation (Likely `solana-keygen`):** The process cleanup logic points to the use of the `solana-keygen` CLI tool for the computationally intensive task of finding vanity addresses. This is aligned with our finding that `solana-keygen` is the reliable way to get exportable 32-byte private key seeds.
*   **Focus on Upstream/Downstream:**
    *   The v1/v2 migration concern for this service would be less about its own code and more about how the `VanityApiClient` and `VanityWalletGeneratorManager` handle the output from `solana-keygen`.
    *   Specifically, how is the generated private key (seed) captured, encrypted (using `process.env.WALLET_ENCRYPTION_KEY`), and stored by these delegated components?
    *   If any part of *that* pipeline uses v1 `@solana/web3.js` (e.g., to re-construct a `Keypair` object from the seed merely to get a `PublicKey` object before storing), those would be points of migration.
*   **Database Storage:** The service stores `wallet_address` and `private_key` (presumably encrypted) in the `vanity_wallet_pool`. The format and handling of this stored private key data by other services or for actual use would be relevant. If it's stored as an encrypted raw seed, it can be loaded and used with v2 libraries (`createKeyPairSignerFromBytes`).

---

### Component: `services/vanity-wallet/vanity-api-client.js`

**Purpose:** This module acts as a client or facade for the vanity wallet generation system. It queues generation requests, processes results from the generator, handles encryption/decryption of private keys, and interacts with the database (via Prisma) to manage the state of vanity wallet jobs and the pool of generated wallets.

**Key Interactions & Structure:**

```
VanityApiClient (Static Class)
 |
 +-- Dependencies:
 |   |   
 |   +-- prisma (for DB access: vanity_wallet_pool)
 |   +-- VanityWalletGeneratorManager (to submit generation jobs)
 |   +-- crypto (Node.js module for AES-256-GCM encryption/decryption)
 |   +-- config (application configuration)
 |   +-- process.env.WALLET_ENCRYPTION_KEY
 |
 +-- Core Static Methods:
 |   |
 |   +-- createVanityAddressRequest(options):
 |   |   L__ Creates a 'pending' job record in DB.
 |   |   L__ Updates status to 'processing'.
 |   |   L__ Calls `generatorManager.addJob(jobConfig, onCompleteCallback, onProgressCallback)`.
 |   |       L__ `onCompleteCallback` is `VanityApiClient.processLocalResult()`.
 |   |
 |   +-- processLocalResult(requestId, generatorResult):
 |   |   L__ Called by `generatorManager` when a job finishes.
 |   |   L__ If successful (generatorResult contains `address` and `keypair_bytes`):
 |   |       L__ Converts `keypair_bytes` (expected to be raw byte array from solana-keygen) to JSON string.
 |   |       L__ Encrypts this JSON string using `encryptPrivateKey()`.
 |   |       L__ Updates DB record with `wallet_address`, encrypted `private_key`, status 'completed'.
 |   |   L__ If failed/cancelled, updates DB status.
 |   |
 |   +-- encryptPrivateKey(privateKeyJsonString):
 |   |   L__ Uses AES-256-GCM to encrypt the JSON string representation of the keypair bytes.
 |   |   L__ Stores as "iv:authTag:encryptedData".
 |   |
 |   +-- decryptPrivateKey(encryptedString):
 |   |   L__ Decrypts the above format back to the private key JSON string.
 |   |   L__ Handles unencrypted legacy keys.
 |   |
 |   +-- getAvailableVanityWallet(pattern): Retrieves an available, unused wallet, decrypts its private key.
 |   +-- assignVanityWalletToContest(walletId, contestId): Marks a wallet as used.
 |   +-- getVanityWallets(options): Lists wallets with filtering/pagination.
 |   +-- getGeneratorStatus(): Proxies to `generatorManager.getStatus()`.
 |   +-- cancelVanityAddressRequest(requestId): Cancels a job in DB and tells `generatorManager`.
 |   +-- checkHealth(): Checks generator health (currently simple for local).
```

**Migration Notes for `services/vanity-wallet/vanity-api-client.js`:**
*   **No Direct Solana Key Object Usage:** This client does not directly instantiate or use `@solana/web3.js Keypair` objects or v2 `CryptoKey` / `KeyPairSigner` objects. It treats the `keypair_bytes` received from the generator as opaque data that gets stringified, encrypted, stored, decrypted, and then parsed back into a byte array (presumably by the consumer of `getAvailableVanityWallet`).
*   **Agnostic to v1/v2 Key Objects (Mostly):** Because it handles the key material as a raw byte array (via `keypair_bytes` from the generator, then stringified & encrypted), it is largely insulated from v1 vs. v2 JS library changes *for key representation*.
*   **Dependency on Generator Output:** The crucial point is the format of `keypair_bytes` provided by the `VanityWalletGeneratorManager` (and its underlying generator, e.g., `local-generator.js`). As long as this is the standard 64-byte array (e.g., `[10, 20, ...]`) that `solana-keygen` outputs, this client will function correctly.
*   **Encryption Key Management:** Uses `process.env.WALLET_ENCRYPTION_KEY` for AES encryption. The security of this key is paramount.
*   **Path to v2 Usage:** When a decrypted `privateKeyJson` (which is `JSON.stringify(keypair_bytes)`) is retrieved, the consumer would do `JSON.parse(decryptedPrivateKeyJson)` to get the byte array, and then this byte array can be directly used with v2's `createKeyPairSignerFromBytes()` to get a functional v2 signer.
*   **No Changes Likely Needed:** This file itself likely requires no direct changes for the v1 to v2 migration, assuming its contract with `VanityWalletGeneratorManager` (regarding `keypair_bytes` format) is maintained.

---

### Component: `services/vanity-wallet/generators/index.js` (VanityWalletGeneratorManager)

**Purpose:** This module acts as a singleton manager for the vanity wallet generation process. It provides a centralized point for submitting generation jobs and receiving their results, abstracting the actual generator implementation (which is currently `LocalVanityGenerator`).

**Key Interactions & Structure:**

```
VanityWalletGeneratorManager (Singleton)
 |
 +-- Dependencies:
 |   |   
 |   L__ LocalVanityGenerator (from './local-generator.js') - Instantiates and uses this directly.
 |
 +-- Core Methods:
 |   |
 |   +-- constructor(options):
 |   |   L__ Creates an instance of `LocalVanityGenerator`.
 |   |   L__ Initializes `this.jobCallbacks` (Map to store callbacks from client).
 |   |
 |   +-- addJob(jobConfig, onCompleteExt, onProgressExt):
 |   |   L__ Stores external `onCompleteExt` and `onProgressExt` callbacks in `this.jobCallbacks` (keyed by `jobConfig.id`).
 |   |   L__ Creates an internal `job` object for `LocalVanityGenerator`.
 |   |   L__ This internal `job` object's `onComplete` points to `this.handleJobComplete`.
 |   |   L__ This internal `job` object's `onProgress` points to `this.handleJobProgress` (if `onProgressExt` provided).
 |   |   L__ Calls `this.localGenerator.addJob(internalJob)`.
 |   |
 |   +-- handleJobComplete(jobId, result):
 |   |   L__ Retrieves original external callback from `this.jobCallbacks` using `jobId`.
 |   |   L__ Invokes the original external `onComplete` callback with `result`.
 |   |   L__ Cleans up `this.jobCallbacks` for the completed `jobId`.
 |   |
 |   +-- handleJobProgress(jobId, progress):
 |   |   L__ Similar to `handleJobComplete`, but for progress updates.
 |   |
 |   +-- cancelJob(jobId): Delegates to `this.localGenerator.cancelJob(jobId)`.
 |   +-- getStatus(): Delegates to `this.localGenerator.getStatus()`.
 |
 +-- Singleton Access:
     L__ static getInstance(options): Returns the singleton instance.
```

**Migration Notes for `generators/index.js` (VanityWalletGeneratorManager):**
*   **Abstraction Layer:** This manager is an abstraction layer. It does not contain any direct Solana-specific (v1 or v2) code or key generation logic itself.
*   **Agnostic to v1/v2:** It is entirely insulated from Solana library versions. Its responsibility is job and callback management.
*   **No Changes Needed:** This file requires no changes for the v1 to v2 migration. The migration impact will be within the actual generator it uses (i.e., `LocalVanityGenerator`).

---

### Component: `services/vanity-wallet/generators/local-generator.js` (LocalVanityGenerator)

**Purpose:** This is the core worker module responsible for generating Solana vanity addresses. It achieves this by spawning and managing external `solana-keygen grind` command-line processes.

**Key Interactions & Structure:**

```
LocalVanityGenerator
 |
 +-- Dependencies:
 |   |   
 |   +-- child_process (spawn, exec - for running `solana-keygen` and process management)
 |   +-- os, path, fs (for system info, file paths, file system operations)
 |   +-- prisma (to update job status in `vanity_wallet_pool`)
 |   +-- @solana/web3.js (Specifically: `Keypair` - DIRECT V1 USAGE for `Keypair.fromSecretKey()`)
 |
 +-- Configuration:
 |   |   
 |   +-- SOLANA_KEYGEN_PATH (path to solana-keygen executable)
 |   +-- DEFAULT_WORKERS, DEFAULT_CPU_LIMIT
 |   +-- Output directories for keypair files (OUTPUT_DIR_KEYPAIRS, etc.)
 |
 +-- Core Methods & Logic:
 |   |
 |   +-- constructor(options):
 |   |   L__ Initializes worker/CPU limits, job queue, active jobs map.
 |   |   L__ Ensures output directories exist, cleans up orphaned processes.
 |   |
 |   +-- addJob(job): Adds a job (pattern, callbacks, etc.) to `this.jobQueue`, triggers `processNextJob`.
 |   |
 |   +-- processNextJob():
 |   |   L__ Manages concurrency (max `this.numWorkers` active jobs).
 |   |   L__ Dequeues a job, updates its status to 'processing' in DB.
 |   |   L__ Calls `startSolanaKeygenProcess()`.
 |   |
 |   +-- startSolanaKeygenProcess(job, cmdOptions, startTime, tempOutputFile):
 |   |   L__ Uses `child_process.spawn(SOLANA_KEYGEN_PATH, cmdOptions)` to run `solana-keygen grind ...`.
 |   |       L__ Options include `--starts-with PATTERN:1` or `--ends-with PATTERN:1`, `--ignore-case`, `--num-threads`.
 |   |       L__ `solana-keygen` writes the found keypair to a JSON file (e.g., in `/tmp`).
 |   |   L__ Monitors `stdout` for progress (attempt count) and the "Wrote keypair to <filepath>.json" message.
 |   |   L__ On `process.on('close')`:
 |   |       L__ Parses the output file path from `solana-keygen` stdout.
 |   |       L__ Reads the JSON keypair file (which contains a 64-byte array).
 |   |       L__ **Uses v1 `Keypair.fromSecretKey(Uint8Array.from(keypairArray))` solely to get `wallet.publicKey.toString()`**.
 |   |       L__ Saves a plaintext version of the keypair array (for debugging/backup perhaps).
 |   |       L__ Updates `vanity_wallet_pool` DB record with status 'completed', public key, attempt count, duration, and the **stringified raw keypair array** as `private_key`.
 |   |       L__ Calls `job.onComplete` with status and result (including `address` and `keypair_bytes` which is the raw 64-byte array).
 |   |
 |   +-- cleanupOrphanedProcesses(): Uses `exec` to find and kill stray `solana-keygen` and `cpulimit` processes.
 |   +-- getKeypairFilePath(jobId, pattern): Determines structured path for saving found keypair JSONs.
 |   +-- cancelJob(jobId): Cancels queued or active jobs (kills spawned process if active).
 |   +-- getStatus(): Reports queued and active job details.
```

**Migration Notes for `generators/local-generator.js`:**
*   **External Generation is Key:** This generator correctly uses the external `solana-keygen grind` tool. This is excellent because `solana-keygen` handles the CPU-intensive search and outputs the full keypair data (including the 32-byte private seed) in a standard JSON file format (an array of 64 numbers).
*   **Primary v1 Dependency:** The only direct use of `@solana/web3.js` is `Keypair.fromSecretKey(secretKeyArray)` which is used *after* the keypair is already generated by `solana-keygen`, solely to derive the public key string.
*   **Easy v2 Fix for Public Key Derivation:**
    *   The `keypair` variable (read from the JSON file, e.g., `[byte0, byte1, ..., byte63]`) already contains the raw public key.
    *   The raw 32-byte public key is `keypair.slice(32, 64)`.
    *   This can be converted to a `Uint8Array`: `const rawPublicKeyBytes = Uint8Array.from(keypair.slice(32, 64));`
    *   Then the public key string (address) can be obtained using v2: `const address = await getAddressFromPublicKey(rawPublicKeyBytes);` (from `@solana/addresses`).
    *   This eliminates the need for the v1 `Keypair.fromSecretKey()` call entirely.
*   **Output `keypair_bytes` is Good:** The data passed back to `VanityApiClient` via `job.onComplete` as `result.keypair_bytes` is the raw 64-byte array. This is ideal, as `VanityApiClient` can then pass this (after decryption and JSON parsing) to v2's `createKeyPairSignerFromBytes()` if a v2 signer object is needed by a consumer.
*   **No Change to Generation Logic:** The core `solana-keygen grind` mechanism does not need to change.

---

### Component: `routes/admin/vanity-wallets.js`

**Purpose:** This Express.js router defines admin API endpoints for managing the vanity wallet system. It allows admins to list wallets, request new vanity address generations, view specific wallet details (with private keys redacted), cancel generation jobs, and view generator status.

**Key Interactions & Structure:**

```
Express Router (vanity-wallets.js)
 |
 +-- Dependencies:
 |   |   
 |   +-- express (for routing)
 |   +-- VanityApiClient (primary interface to the vanity wallet service logic)
 |   +-- prisma (used directly by helper functions for detailed dashboard stats)
 |   +-- AdminLogger, auth middleware
 |   +-- @solana/web3.js (Contains an UNUSED import: `Keypair`)
 |
 +-- Endpoints:
 |   |
 |   +-- GET /api/admin/vanity-wallets: Lists wallets (delegates to `VanityApiClient.getVanityWallets`).
 |   |
 |   +-- POST /api/admin/vanity-wallets: Creates a new generation request (delegates to `VanityApiClient.createVanityAddressRequest`).
 |   |
 |   +-- GET /api/admin/vanity-wallets/:id: Gets a specific wallet (from `prisma`), redacts private key before responding.
 |   |
 |   +-- POST /api/admin/vanity-wallets/:id/cancel: Cancels a job (delegates to `VanityApiClient.cancelVanityAddressRequest`).
 |   |
 |   +-- POST /api/admin/vanity-wallets/batch: Creates batch generation requests (delegates to `VanityApiClient.createVanityAddressRequest` in a loop).
 |   |
 |   +-- GET /api/admin/vanity-wallets/status/generator: Gets generator status (delegates to `VanityApiClient.getGeneratorStatus`) and enriches with stats from helper functions using `prisma`.
 |
 +-- Helper Functions (e.g., `getRecentlyCompletedJobs`, `getCompletionStats`):
     L__ Query `prisma` directly for detailed statistics for dashboard/status views. Do not handle keypair objects.
```

**Migration Notes for `routes/admin/vanity-wallets.js`:**
*   **Unused v1 Import:** The line `import { Keypair } from '@solana/web3.js';` exists but `Keypair` is **not used anywhere** in the file. This import should be removed.
*   **No Direct Key Handling:** This router does not directly instantiate or use Solana keypair objects (v1 or v2) in a way that involves their cryptographic properties. When fetching a specific wallet, it explicitly redacts the `private_key` field.
*   **Well-Insulated:** Its operations involving vanity wallet generation or retrieval are performed through `VanityApiClient`, which, as analyzed, handles the (encrypted) raw key data rather than v1/v2 key objects directly.
*   **Actionable Change:** Remove the unused v1 `Keypair` import.

--- 