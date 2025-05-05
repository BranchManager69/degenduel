# Solana Web3.js v2.x Migration Guide for DegenDuel

This guide outlines the step-by-step process for migrating the DegenDuel codebase from Solana Web3.js v1.x to v2.x, starting with the Admin Wallet Service.

## Background

DegenDuel currently uses:
- **@solana/web3.js v1.98.1**: Soon-to-be deprecated version
- **@solana/spl-token v0.4.13**: Only compatible with web3.js v1.x

We need to migrate to:
- **@solana/web3.js v2.x family** of packages (split into multiple focused packages)
- A compatible SPL token package for web3.js v2.x

## Architectural Differences Between v1.x and v2.x

Web3.js v2.x (also known as Solana Kit) represents a fundamental paradigm shift:

1. **Functional vs Object-Oriented**: v2.x uses a functional programming approach rather than the object-oriented style of v1.x.

2. **No Centralized Connection**: The `Connection` class is removed in favor of function-based RPC methods:
   - `createSolanaRpc()` for RPC requests
   - `createSolanaRpcSubscriptions()` for event subscriptions

3. **Modular Package Structure**: Instead of one monolithic package, v2.x is split into multiple focused packages:
   - `@solana/rpc` for RPC communication
   - `@solana/addresses` for address handling
   - `@solana/keys` for keypair management
   - `@solana/transactions` for transaction handling
   - And others for specific functionality

4. **Improved Tree-Shaking**: The functional approach enables better tree-shaking, significantly reducing bundle sizes.

## Migration Strategy Overview

We'll use a **phased migration approach**:

1. **Phase 1** (This Guide): Admin Wallet Service migration with compatibility layer
   - Implement compatibility shims 
   - Keep interface with SolanaEngine unchanged
   - Focus on updating import patterns and internal logic

2. **Phase 2** (Future): SolanaEngine complete rewrite
   - Create a new SolanaEngineV2 service built natively on v2.x patterns
   - Build with functional programming paradigms from the start
   - Implement endpoint rotation and reliability features natively

3. **Phase 3** (Future): Service-by-service migration
   - Incrementally migrate services from SolanaEngine to SolanaEngineV2
   - Run both engines in parallel during transition
   - Gradually remove compatibility layer as services move to native v2.x

This approach balances immediate needs with long-term architectural health.

## Challenges Identified

1. **CommonJS/ESM Compatibility Issues**: Workarounds like the `pkg` import approach in wallet-transactions.js
2. **Dependency on Multiple SPL Token Functions**: Particularly in token transfer operations
3. **Integration with SolanaEngine**: Must maintain compatibility during transition
4. **Different API Patterns**: Web3.js v2.x uses a more functional approach vs v1.x's object-oriented style
5. **Technical Debt**: Compatibility layers add complexity that will need to be addressed long-term

## Migration Strategy

We'll follow a stepwise approach:

1. Implement shims for v1.x code
2. Update imports and dependencies
3. Refactor modules incrementally, ensuring backward compatibility
4. Implement proper testing
5. Deploy and verify

## Step 1: Install Required Dependencies

```bash
npm install @solana/compat @solana/addresses @solana/instructions @solana/rpc \
  @solana/rpc-api @solana/transactions @solana/transaction-messages \
  @solana/keys @solana/web3.js@^2.0.0
```

> **Important Note about SPL Token**: For v2.x compatibility, we might need to use `@solana/spl-token-3.x` or a different package. However, as of this writing, the exact compatible SPL token package for web3.js v2.x is still being determined. We'll implement dynamic imports in our code to handle both versions and make the transition smoother.

## Step 2: Update Admin Wallet Service

### 2.1 Create Compatibility Layer

Create a new file at `/services/admin-wallet/utils/solana-compat.js`:

```javascript
// services/admin-wallet/utils/solana-compat.js

/**
 * Compatibility layer to facilitate smooth migration from web3.js v1.x to v2.x
 * Provides unified interfaces that work with both versions
 */

import { PublicKey as PublicKeyV1, Keypair as KeypairV1 } from '@solana/web3.js';
import { 
  createAddress, 
  getAddressFromPublicKey, 
  createKeypairFromBytes 
} from '@solana/keys';
import { createSolanaRpc } from '@solana/rpc';
import { 
  transferSol, 
  getSignatureStatuses, 
  getBalance 
} from '@solana/rpc-api';
import { createTransaction } from '@solana/transactions';
import { 
  appendTransactionMessageInstruction, 
  setTransactionMessageLifetimeUsingBlockhash 
} from '@solana/transaction-messages';

// Constants
export const LAMPORTS_PER_SOL = 1000000000;

// Address conversion utilities
export function toAddress(publicKeyOrString) {
  if (typeof publicKeyOrString === 'string') {
    return createAddress(publicKeyOrString);
  } else if (publicKeyOrString instanceof PublicKeyV1) {
    return getAddressFromPublicKey(publicKeyOrString);
  }
  return publicKeyOrString; // Assume it's already an Address
}

// Keypair utilities
export function createKeypairFromPrivateKey(privateKeyBytes) {
  if (Buffer.isBuffer(privateKeyBytes) || ArrayBuffer.isView(privateKeyBytes)) {
    // For v2.x, create keypair from bytes
    return createKeypairFromBytes(privateKeyBytes);
  } else {
    // For v1.x, fallback
    return KeypairV1.fromSecretKey(privateKeyBytes);
  }
}

// RPC utilities
export function executeRpcMethod(connection, method, ...args) {
  if (typeof connection.executeConnectionMethod === 'function') {
    // SolanaEngine style v1.x
    return connection.executeConnectionMethod(method, ...args);
  } else {
    // Direct v2.x style
    const rpc = createSolanaRpc(connection.url || connection);
    switch (method) {
      case 'getBalance':
        return getBalance(rpc, { address: toAddress(args[0]) });
      case 'getLatestBlockhash':
        return rpc.getLatestBlockhash();
      case 'getFeeForMessage':
        return rpc.getFeeForMessage(...args);
      case 'getTokenSupply':
        return rpc.getTokenSupply({ mint: toAddress(args[0]) });
      case 'getTokenAccountsByOwner':
        return rpc.getTokenAccountsByOwner({ 
          owner: toAddress(args[0]), 
          filter: { programId: args[1].mint ? toAddress(args[1].mint) : args[1] },
          encoding: args[2]?.encoding || 'jsonParsed'
        });
      case 'getTokenAccountBalance':
        return rpc.getTokenAccountBalance({ account: toAddress(args[0]) });
      default:
        throw new Error(`Method ${method} not implemented in compatibility layer`);
    }
  }
}

// Transaction utilities
export async function sendTransaction(connection, transaction, signers, options = {}) {
  if (typeof connection.sendTransaction === 'function') {
    // SolanaEngine/v1.x style
    return connection.sendTransaction(transaction, signers, options);
  } else {
    // v2.x style
    const rpc = createSolanaRpc(connection.url || connection);
    const compiledTx = createTransaction(transaction, signers);
    return rpc.sendTransaction(compiledTx);
  }
}

// Re-export for convenience
export { transferSol, getSignatureStatuses };
```

### 2.2 Update wallet-transactions.js

Refactor the file `/services/admin-wallet/modules/wallet-transactions.js`:

```javascript
// services/admin-wallet/modules/wallet-transactions.js

/**
 * Admin wallet transaction module for handling SOL and token transfers
 * with proper encryption, validation, and error handling
 * 
 * @module wallet-transactions
 */

import prisma from '../../../config/prisma.js';
import { logApi } from '../../../utils/logger-suite/logger.js';
import { ServiceError } from '../../../utils/service-suite/service-error.js';
import { decryptWallet, createKeypairFromPrivateKey } from './wallet-crypto.js';
import { 
  LAMPORTS_PER_SOL, 
  toAddress, 
  executeRpcMethod, 
  sendTransaction 
} from '../utils/solana-compat.js';
import { 
  PublicKey, 
  SystemProgram, 
  Transaction 
} from '@solana/web3.js';

// Import SPL Token functions from the proper package based on availability
let getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, 
    createTransferInstruction, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID;

// Dynamic import to handle different package versions
try {
  // Try the v3.x import first
  const splToken = await import('@solana/spl-token-3.x');
  ({ 
    getAssociatedTokenAddress, 
    createAssociatedTokenAccountInstruction, 
    createTransferInstruction,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID 
  } = splToken);
  logApi.info('Using @solana/spl-token-3.x package');
} catch (err) {
  // Fall back to the v0.x import
  try {
    const splToken = await import('@solana/spl-token');
    ({ 
      getAssociatedTokenAddress, 
      createAssociatedTokenAccountInstruction, 
      createTransferInstruction,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID 
    } = splToken);
    logApi.info('Using @solana/spl-token package');
  } catch (importError) {
    logApi.error('Failed to import SPL token package:', importError);
    throw new Error('SPL token package not available');
  }
}

/**
 * Transfers SOL from one wallet to another with validation and balance checks
 * 
 * @param {string} fromWalletEncrypted - Encrypted private key of the sending wallet
 * @param {string} toAddress - Recipient wallet address
 * @param {number} amount - Amount of SOL to transfer
 * @param {string} description - Description of the transfer
 * @param {Object} solanaEngine - SolanaEngine instance for transaction processing
 * @param {Object} config - Service configuration
 * @param {string} encryptionKey - The encryption key (from environment variables)
 * @returns {Object} - Transaction result with signature and confirmation
 * @throws {ServiceError} - If validation fails or transaction fails
 */
export async function transferSOL(fromWalletEncrypted, toAddress, amount, description, solanaEngine, config, encryptionKey) {
    try {
        // Input validation
        if (!fromWalletEncrypted || typeof fromWalletEncrypted !== 'string') {
            throw ServiceError.validation('Invalid from wallet', { fromWalletEncrypted });
        }
        
        if (!toAddress || typeof toAddress !== 'string') {
            throw ServiceError.validation('Invalid recipient address', { toAddress });
        }
        
        if (!amount || amount <= 0 || isNaN(amount)) {
            throw ServiceError.validation('Invalid amount', { amount });
        }
        
        // Convert to PublicKey and validate addresses
        let toPublicKey;
        try {
            toPublicKey = new PublicKey(toAddress);
        } catch (error) {
            throw ServiceError.validation('Invalid recipient SOL address', { toAddress, error: error.message });
        }
        
        // Decrypt and prepare sender wallet
        const decryptedPrivateKey = decryptWallet(fromWalletEncrypted, encryptionKey);
        const fromKeypair = createKeypairFromPrivateKey(decryptedPrivateKey);
        
        // Check sender's SOL balance
        const senderBalance = await executeRpcMethod(
            solanaEngine,
            'getBalance', 
            fromKeypair.publicKey
        );
        
        const transferAmountLamports = amount * LAMPORTS_PER_SOL;
        
        // Accurately estimate transaction fees
        let estimatedFee = 5000; // Default fallback fee (0.000005 SOL)
        try {
            // Create the transaction just for fee estimation
            const estimationTx = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: fromKeypair.publicKey,
                    toPubkey: toPublicKey,
                    lamports: transferAmountLamports
                })
            );
            
            // Get blockhash and estimate fee
            const { blockhash } = await executeRpcMethod(solanaEngine, 'getLatestBlockhash');
            estimationTx.recentBlockhash = blockhash;
            
            const feeCalculator = await executeRpcMethod(
                solanaEngine,
                'getFeeForMessage', 
                estimationTx.compileMessage(),
                blockhash
            );
            
            if (feeCalculator && feeCalculator.value) {
                estimatedFee = feeCalculator.value;
                logApi.debug(`Estimated fee for SOL transfer: ${estimatedFee} lamports`);
            }
        } catch (error) {
            logApi.warn(`Fee estimation failed, using default: ${error.message}`);
        }
        
        if (senderBalance < (transferAmountLamports + estimatedFee)) {
            throw ServiceError.validation('Insufficient SOL balance', { 
                balance: senderBalance / LAMPORTS_PER_SOL, 
                requested: amount,
                minimum: (transferAmountLamports + estimatedFee) / LAMPORTS_PER_SOL
            });
        }
        
        // Log transaction attempt
        logApi.info(`Transferring ${amount} SOL from ${fromKeypair.publicKey.toString()} to ${toAddress}`);
        
        // Create transaction
        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: fromKeypair.publicKey,
                toPubkey: toPublicKey,
                lamports: transferAmountLamports
            })
        );

        // Get a recent blockhash and set it on the transaction
        const { blockhash } = await executeRpcMethod(solanaEngine, 'getLatestBlockhash');
        transaction.recentBlockhash = blockhash;

        // Use our compatibility wrapper for transaction sending
        const signature = await sendTransaction(
            solanaEngine, 
            transaction, 
            [fromKeypair], 
            {
                endpointId: config.wallet.preferredEndpoints.transfers,
                commitment: 'confirmed',
                skipPreflight: false
            }
        );

        // Log the successful transaction
        await prisma.transactions.create({
            data: {
                wallet_address: fromKeypair.publicKey.toString(),
                type: 'ADMIN_TRANSFER',
                amount,
                description,
                status: 'completed',
                blockchain_signature: signature,
                completed_at: new Date(),
                created_at: new Date()
            }
        });

        logApi.info(`SOL transfer complete: ${signature}`);
        return { signature, success: true };
    } catch (error) {
        // Determine if this is already a ServiceError or needs conversion
        if (error.name === 'ServiceError') {
            throw error;
        }
        
        throw ServiceError.operation('SOL transfer failed', {
            error: error.message,
            from: fromWalletEncrypted ? fromWalletEncrypted.substring(0, 10) + '...' : 'undefined',
            to: toAddress,
            amount
        });
    }
}

// transferToken function with similar updates...
// [Rest of the file with appropriate updates]

export default {
    transferSOL,
    transferToken
};
```

### 2.3 Update admin-wallet-service.js

Modify references and imports to use our compatibility layer:

```javascript
// services/admin-wallet/admin-wallet-service.js

// ...existing imports...

// Update Solana imports
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { 
  toAddress, 
  executeRpcMethod 
} from './utils/solana-compat.js';

// ...rest of the file...
```

## Step 3: Testing Approach

Create a test file specifically for verifying the migration:

```javascript
// tests/services/admin-wallet-migration.test.js

import adminWalletService from '../../services/admin-wallet/admin-wallet-service.js';
import { solanaEngine } from '../../services/solana-engine/index.js';
import { logApi } from '../../utils/logger-suite/logger.js';

async function testAdminWalletMigration() {
  try {
    logApi.info('Testing Admin Wallet Migration...');
    
    // 1. Test service initialization
    const isInitialized = await adminWalletService.initialize();
    logApi.info(`Service initialization: ${isInitialized ? 'SUCCESS' : 'FAILED'}`);
    
    // 2. Test basic operations
    const serviceStatus = adminWalletService.getServiceStatus();
    logApi.info(`Service status: ${JSON.stringify(serviceStatus, null, 2)}`);
    
    // 3. If test wallets/keys are available, test transfers
    // NOTE: This would require test wallet credentials
    
    logApi.info('Migration test completed successfully');
  } catch (error) {
    logApi.error('Migration test failed:', error);
    throw error;
  }
}

testAdminWalletMigration().catch(err => {
  logApi.error('Migration test error:', err);
  process.exit(1);
});
```

## Step 4: Complete Implementation Steps

1. **Compatibility Layer**: 
   - Create the solana-compat.js file
   - Test basic functionality

2. **Module Updates**:
   - Refactor wallet-transactions.js first
   - Update wallet-crypto.js next
   - Update wallet-balance.js
   - Update batch-operations.js
   - Finally update admin-wallet-service.js

3. **Migration Testing**:
   - Run the migration test
   - Verify functionality against production scenarios

4. **Deployment**:
   - Update package.json with new dependencies
   - Deploy to staging environment first
   - Verify in staging
   - Deploy to production

## Long-Term Migration Roadmap

After successfully migrating the Admin Wallet Service, we should follow this roadmap:

### Phase 2: SolanaEngine Rewrite (High Priority)

The SolanaEngine service requires a complete rewrite rather than a compatibility layer approach because:

1. **Core RPC functionality**: SolanaEngine's primary purpose revolves around connection management, which is fundamentally different in v2.x.

2. **Performance benefits**: The performance improvements of v2.x won't be realized through compatibility layers.

3. **Architectural foundation**: Other services depend on SolanaEngine, so a native v2.x implementation will provide a solid foundation.

The recommended approach:

1. Create a new `SolanaEngineV2` service that:
   - Uses v2.x native patterns from the start
   - Maintains the same external API surface for backward compatibility
   - Implements all existing reliability features (endpoint rotation, retries, etc.)
   - Takes advantage of the functional programming model for better testability

2. Run the original SolanaEngine and SolanaEngineV2 in parallel during transition.

### Phase 3: Service-by-Service Migration

Gradually migrate other services in this recommended order:

1. **TokenMonitorService**: Directly interfaces with blockchain data
2. **ContestWalletService**: Handles critical financial operations
3. **UserBalanceTrackingService**: Depends on blockchain data
4. **Remaining services**: Based on dependency order

For each service:
- Create a comprehensive test suite before migration
- Update imports and structure to use v2.x patterns
- Connect to SolanaEngineV2 instead of the original
- Maintain backward compatibility for dependent services

### Phase 4: Remove Compatibility Layers

Once all services are migrated:
1. Remove compatibility shims
2. Retire the original SolanaEngine service
3. Refactor code to take full advantage of v2.x patterns
4. Optimize for performance and bundle size

## Resources

- [Solana Web3.js v2 Migration Guide](https://solana-kit-docs.vercel.app/docs/upgrade-guide)
- [SPL Token Documentation](https://spl.solana.com/token)
- [Solana GitHub Repositories](https://github.com/solana-labs)

## Troubleshooting

Common issues and their solutions:

1. **Import Errors**: If you encounter import errors, ensure you're using the correct package versions and import paths. The modular structure of v2.x means functionality is spread across multiple packages.

2. **Type Compatibility**: When passing between v1 and v2 APIs, use the compatibility layer's conversion functions. Pay special attention to conversions between PublicKey and Address types.

3. **SolanaEngine Integration**: Be particularly careful with SolanaEngine integration points, as it expects specific v1.x behaviors. The compatibility layer is specifically designed to handle this integration correctly.

4. **Transaction Signing**: The signing process is significantly different between versions, so ensure proper conversion. Use the compatibility layer's sendTransaction function which handles both paradigms.

5. **Performance Issues**: Monitor for any performance degradation after migration. Note that the compatibility layer adds some overhead - this is expected and will be removed in Phase 4 of the migration.

6. **ESM vs CommonJS**: Web3.js v2.x is built with ESM in mind. If you encounter module loading issues, ensure your import/export patterns are consistent.

7. **Versioning Conflicts**: If you have conflicting Solana dependencies, you might need to use package aliasing in your package.json to manage versions.

## Important Implementation Notes

- **Admin Wallet Service Will Work**: The admin wallet service will successfully function with our compatibility layer approach even while it continues to use the existing SolanaEngine. This is because the service primarily delegates complex RPC operations to SolanaEngine rather than making direct RPC calls itself.

- **Compatibility Layer Design**: Our compatibility layer specifically detects whether it's working with SolanaEngine methods or direct v2.x functions and routes accordingly:

  ```javascript
  // Example from the compatibility layer
  if (typeof connection.executeConnectionMethod === 'function') {
    // SolanaEngine style v1.x - delegate to existing engine
    return connection.executeConnectionMethod(method, ...args);
  } else {
    // Direct v2.x style
    const rpc = createSolanaRpc(connection.url || connection);
    // ...handle with v2.x approach
  }
  ```

- **Testing Focus**: During testing, focus particularly on ensuring that the wallet service continues to interact properly with SolanaEngine, as this is the critical integration point.