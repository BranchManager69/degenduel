# Admin Wallet Service Migration Plan: Solana Web3.js v1.x to v2.x

This document outlines the strategy and implementation details for migrating the Admin Wallet Service from Solana Web3.js v1.x to v2.x.

## Current Issues

1. **SPL Token Import Workaround**: The current code uses a problematic workaround for importing SPL Token functionality due to ESM/CommonJS compatibility issues:
   ```javascript
   import pkg from '@solana/spl-token';
   const { 
     getAssociatedTokenAddress, 
     createAssociatedTokenAccountInstruction, 
     createTransferInstruction,
     TOKEN_PROGRAM_ID,
     ASSOCIATED_TOKEN_PROGRAM_ID
   } = pkg;
   ```

2. **Direct Web3.js v1.x Dependencies**:
   - PublicKey objects for address handling
   - Transaction class for transaction building
   - SystemProgram methods for transfer instructions
   - LAMPORTS_PER_SOL constant references

3. **SolanaEngine Integration**:
   - Heavy dependency on SolanaEngine's executeConnectionMethod API
   - Transaction sending implementation tied to v1.x structure
   - Keypair handling using v1.x methods

## Migration Strategy

### 1. Create Compatibility Layer

Build a compatibility layer to handle the transition between v1.x and v2.x APIs:

```javascript
// utils/solana-suite/web3-v2/compatibility.js

import {
  Address,
  getBalance,
  getLatestBlockhash,
  getFeeForMessage,
  getTokenAccountsByOwner,
  getTokenAccountBalance,
  getTokenSupply
} from '@solana/web3.js';

/**
 * Compatibility layer for PublicKey
 */
export function toAddress(keyStringOrObject) {
  if (typeof keyStringOrObject === 'string') {
    return new Address(keyStringOrObject);
  } else if (keyStringOrObject?.toBase58) {
    // Handle v1 PublicKey objects
    return new Address(keyStringOrObject.toBase58());
  } else if (keyStringOrObject?.toString) {
    return new Address(keyStringOrObject.toString());
  }
  return keyStringOrObject; // Assume it's already an Address
}

/**
 * Compatibility layer for balance operations
 */
export async function getBalanceCompat(connection, address) {
  const addressObj = toAddress(address);
  return getBalance(connection, addressObj);
}

/**
 * Converts a PrivateKey to a Keypair-like object compatible with v2.x
 */
export function createKeypairCompat(privateKey) {
  // Implementation will depend on the exact format of privateKey
  // This is a placeholder - actual implementation would create a compatible keypair
  return {
    secretKey: privateKey,
    publicKey: new Address(/* derive from privateKey */),
    sign: (message) => {/* implement signing */}
  };
}

// Add more compatibility functions as needed
```

### 2. Update SPL Token Integration

Replace the problematic SPL Token import with the proper v2.x approach:

```javascript
// Import directly from the new package
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID
} from '@solana/spl-token';

// Alternatively, if ESM issues persist, create a compatibility layer
import { getAssociatedTokenAddressV2, createTokenInstructions } from '../../../utils/solana-suite/token-compatibility.js';
```

### 3. Transaction Builder Update

Replace v1.x Transaction class usage with v2.x message-based approach:

```javascript
// Current v1.x approach:
const transaction = new Transaction().add(
  SystemProgram.transfer({
    fromPubkey: fromKeypair.publicKey,
    toPubkey: toPublicKey,
    lamports: transferAmountLamports
  })
);

// New v2.x approach:
import { 
  transactionBuilder, 
  transferSol 
} from '@solana/web3.js';

const { blockhash, lastValidBlockHeight } = await getLatestBlockhash(connection);
const transferIx = transferSol({
  fromAddress: fromKeypair.publicKey,
  toAddress: toAddress,
  amount: transferAmountLamports
});

const tx = transactionBuilder()
  .addInstruction(transferIx)
  .setRecentBlockhash(blockhash)
  .setSigners([fromKeypair])
  .build();
```

### 4. SolanaEngine Integration

Work with the SolanaEngine team to ensure compatibility with v2.x:

```javascript
// Updated solanaEngine.sendTransaction call
const signature = await solanaEngine.sendTransaction(
  transactionMessage, 
  [fromKeypair], 
  {
    endpointId: config.wallet.preferredEndpoints.transfers,
    commitment: 'confirmed',
    skipPreflight: false,
    useV2: true // Flag to indicate using the v2.x transaction format
  }
);
```

## Implementation Plan

### Phase 1: Preparation

1. Create compatibility utilities:
   - Address handling (PublicKey to Address)
   - Transaction building compatibility
   - SPL Token compatibility layer

2. Update SolanaEngine to support v2.x transactions (coordinate with the SolanaEngine team)

### Phase 2: Refactor wallet-transactions.js

1. Update imports:
   ```javascript
   // Replace:
   import { PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
   import pkg from '@solana/spl-token';
   
   // With:
   import { 
     LAMPORTS_PER_SOL, 
     Address, 
     getLatestBlockhash, 
     getFeeForMessage, 
     transferSol, 
     transactionBuilder 
   } from '@solana/web3.js';
   import {
     getAssociatedTokenAddress,
     createAssociatedTokenAccountInstruction,
     createTransferCheckedInstruction,
     TOKEN_PROGRAM_ID,
     ASSOCIATED_TOKEN_PROGRAM_ID
   } from '@solana/spl-token';
   import { toAddress } from '../../../utils/solana-suite/web3-v2/compatibility.js';
   ```

2. Update transaction building code using the new pattern

3. Refactor token transfer function to use v2.x approaches

### Phase 3: Update admin-wallet-service.js

1. Update imports and Solana-specific code
2. Update integration with SolanaEngine

### Phase 4: Testing

1. Create a comprehensive test suite for admin wallet operations:
   - SOL transfers
   - Token transfers (existing accounts)
   - Token transfers (creating new accounts)
   - Error handling
   - Edge cases

2. Set up test fixtures with v1.x and v2.x for parallel testing

3. Verify results against expected outcomes

## Compatibility Considerations

1. **SolanaEngine Dependency**: The Admin Wallet Service depends on SolanaEngine, which needs to be updated to support v2.x first or simultaneously.

2. **KeyPair Handling**: v2.x has significant changes to keypair and address handling.

3. **Transaction Flow**: The transaction lifecycle is completely different in v2.x, moving from an object-oriented to a functional approach.

## Rollback Strategy

1. Maintain compatibility with v1.x during the transition
2. Use feature flags to toggle between v1.x and v2.x code paths
3. Keep a version-controlled backup of the v1.x implementation
4. Set up monitoring for transaction failures

## Timeline

1. **Phase 1 (Preparation)**: 2-3 days
2. **Phase 2 (wallet-transactions.js)**: 2-3 days
3. **Phase 3 (admin-wallet-service.js)**: 1-2 days
4. **Phase 4 (Testing)**: 3-4 days

Total estimate: 8-12 days depending on complexity and SolanaEngine coordination.