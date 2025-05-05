# Contest Wallet Service Migration Plan

This document outlines the step-by-step process for migrating the Contest Wallet Service from Solana Web3.js v1.x to v2.x. This represents an essential part of the overall Solana ecosystem migration.

## Current Architecture Analysis

The Contest Wallet Service has the following core components:

1. **Main Service Implementation**: `contestWalletService.js`
   - Manages wallet creation, balance tracking, and fund transfers
   - Uses WebSocket for real-time balance monitoring
   - Handles contest lifecycle management

2. **Treasury Certifier**: `treasury-certifier.js`
   - Validates and certifies contest treasury wallets
   - Recovers stranded funds when needed

3. **Integration Points**:
   - Relies heavily on SolanaEngine for blockchain operations
   - Uses WebSocket server for real-time monitoring
   - Interacts with VanityApiClient for vanity wallet operations

## Current Solana Usage Analysis

The Contest Wallet Service interacts with Solana in the following ways:

1. **Balance Checking**:
   ```javascript
   const publicKey = new PublicKey(wallet.wallet_address);
   const lamports = await solanaEngine.executeConnectionMethod('getBalance', publicKey);
   const solBalance = lamports / LAMPORTS_PER_SOL;
   ```

2. **Batch Balance Checking**:
   ```javascript
   const publicKeys = walletAddresses.map(address => new PublicKey(address));
   const balances = await solanaEngine.executeConnectionMethod('getMultipleAccountsInfo', publicKeys);
   ```

3. **Transaction Creation and Sending**:
   ```javascript
   // Create transaction
   const transaction = new Transaction().add(
     SystemProgram.transfer({
       fromPubkey: fromKeypair.publicKey,
       toPubkey: toPublicKey,
       lamports: Math.round(amount * LAMPORTS_PER_SOL)
     })
   );
   
   // Get blockhash
   const { blockhash } = await solanaEngine.executeConnectionMethod('getLatestBlockhash');
   transaction.recentBlockhash = blockhash;
   
   // Send transaction
   const signature = await solanaEngine.sendTransaction(
     transaction, 
     [fromKeypair], 
     {
       commitment: 'confirmed',
       skipPreflight: false
     }
   );
   ```

4. **Keypair Management**:
   ```javascript
   const privateKeyBytes = bs58.decode(privateKey);
   const fromKeypair = Keypair.fromSecretKey(privateKeyBytes);
   ```

## Web3.js v2.x Differences Impact

The migration to Web3.js v2.x affects the Contest Wallet Service in these key areas:

1. **Address Handling**: PublicKey objects are replaced with Address objects
2. **Transaction Construction**: Different APIs for building and sending transactions
3. **RPC Method Access**: Functional approach vs. object-oriented methods
4. **Keypair Handling**: Different API for creating and managing keypairs

## Migration Strategy

We'll implement a **compatibility-layer approach** for the Contest Wallet Service, similar to the approach used for the Admin Wallet Service but with adaptations specific to contest wallets.

### Step 1: Create Utilities Directory

First, let's create a utilities directory for compatibility helpers:

```
services/
  contest-wallet/
    utils/
      address-utils.js      # Address conversion utilities
      transaction-utils.js  # Transaction helpers
      compatibility.js      # General compatibility functions
```

### Step 2: Implement Address Utilities

```javascript
// services/contest-wallet/utils/address-utils.js

import { PublicKey } from '@solana/web3.js';
import { createAddress, getAddressFromPublicKey } from '@solana/addresses';

/**
 * Convert a string or PublicKey to a v2 Address
 */
export function toAddress(addressOrPublicKey) {
  if (typeof addressOrPublicKey === 'string') {
    return createAddress(addressOrPublicKey);
  } else if (addressOrPublicKey instanceof PublicKey) {
    return getAddressFromPublicKey(addressOrPublicKey);
  }
  
  // Already an Address
  return addressOrPublicKey;
}

/**
 * Convert an array of strings or PublicKeys to v2 Addresses
 */
export function toAddresses(addressesOrPublicKeys) {
  return addressesOrPublicKeys.map(item => toAddress(item));
}

/**
 * Create a keypair from private key bytes
 */
export function createKeypairFromPrivateKey(privateKeyBytes) {
  // Import will be done dynamically to avoid bundling both versions
  return import('@solana/keys').then(({ createKeypairFromBytes }) => {
    return createKeypairFromBytes(privateKeyBytes);
  }).catch(() => {
    // Fall back to v1 method if import fails
    const { Keypair } = require('@solana/web3.js');
    return Keypair.fromSecretKey(privateKeyBytes);
  });
}
```

### Step 3: Implement Transaction Utilities

```javascript
// services/contest-wallet/utils/transaction-utils.js

import { SystemProgram, Transaction, VersionedTransaction } from '@solana/web3.js';
import { createTransaction, createTransactionMessage } from '@solana/transactions';
import { transferSol } from '@solana/rpc-api';
import { appendTransactionMessageInstruction, setTransactionMessageLifetimeUsingBlockhash } from '@solana/transaction-messages';
import { toAddress } from './address-utils.js';

/**
 * Create a transfer transaction compatible with both v1 and v2
 */
export function createTransferTransaction(fromPublicKey, toAddress, lamports) {
  // For v1 usage
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: fromPublicKey,
      toPubkey: toPublicKey,
      lamports
    })
  );
  
  return transaction;
}

/**
 * Create a v2 transfer transaction message
 */
export function createTransferTransactionMessage(fromAddressOrPublicKey, toAddressOrPublicKey, lamports, recentBlockhash, lastValidBlockHeight) {
  // Convert addresses if needed
  const fromAddress = toAddress(fromAddressOrPublicKey);
  const toAddress = toAddress(toAddressOrPublicKey);
  
  // Create a new message with system transfer instruction
  let message = createTransactionMessage();
  
  // Add transfer instruction
  message = appendTransactionMessageInstruction(
    message,
    transferSol({ from: fromAddress, to: toAddress, lamports })
  );
  
  // Set blockhash info
  if (recentBlockhash && lastValidBlockHeight) {
    message = setTransactionMessageLifetimeUsingBlockhash(
      message,
      { 
        blockhash: recentBlockhash, 
        lastValidBlockHeight 
      }
    );
  }
  
  return message;
}
```

### Step 4: Update contestWalletService.js (Key Parts Only)

Let's modify the key parts of the service to use our compatibility utilities:

```javascript
// services/contest-wallet/contestWalletService.js

// Add new imports at the top
import { toAddress, toAddresses, createKeypairFromPrivateKey } from './utils/address-utils.js';
import { createTransferTransaction, createTransferTransactionMessage } from './utils/transaction-utils.js';

// ...existing imports...

// Update the balance checking method
async getWalletBalance(walletAddress) {
  try {
    const addressObj = toAddress(walletAddress);
    const lamports = await solanaEngine.executeConnectionMethod('getBalance', addressObj);
    return lamports / LAMPORTS_PER_SOL;
  } catch (error) {
    logApi.error(`${formatLog.tag()} ${formatLog.error(`Failed to get wallet balance: ${error.message}`)}`);
    throw error;
  }
}

// Update batch balance checking
async getMultipleWalletBalances(walletAddresses) {
  try {
    const addressObjs = toAddresses(walletAddresses);
    const balances = await solanaEngine.executeConnectionMethod('getMultipleAccountsInfo', addressObjs);
    // Process balances...
  } catch (error) {
    // Error handling...
  }
}

// Update transaction sending
async transferSOL(fromWalletPrivateKey, toAddress, amount) {
  try {
    // Convert addresses
    const toAddressObj = toAddress(toAddress);
    
    // Create keypair
    const privateKeyBytes = bs58.decode(fromWalletPrivateKey);
    const fromKeypair = await createKeypairFromPrivateKey(privateKeyBytes);
    
    // Create transaction (v1 style for backward compatibility)
    const transaction = createTransferTransaction(
      fromKeypair.publicKey,
      toAddressObj,
      Math.round(amount * LAMPORTS_PER_SOL)
    );
    
    // Get latest blockhash
    const { blockhash } = await solanaEngine.executeConnectionMethod('getLatestBlockhash');
    transaction.recentBlockhash = blockhash;
    
    // Send transaction
    const signature = await solanaEngine.sendTransaction(
      transaction,
      [fromKeypair],
      {
        commitment: 'confirmed',
        skipPreflight: false
      }
    );
    
    return signature;
  } catch (error) {
    // Error handling...
  }
}
```

### Step 5: Update treasury-certifier.js

The Treasury Certifier will need similar updates focused on address handling and transaction creation.

## Implementation Plan

### Phase 1: Compatibility Layer (1 week)

1. **Day 1-2**: Set up the utilities directory and implement address utilities
   - Create address-utils.js
   - Create transaction-utils.js
   - Create compatibility.js

2. **Day 3-5**: Update contestWalletService.js
   - Modify balance checking methods
   - Update transaction construction and sending
   - Update keypair handling

3. **Day 6-7**: Update treasury-certifier.js
   - Similar updates for Solana interactions
   - Test integration with updated contestWalletService

### Phase 2: Testing and Integration (1 week)

1. **Day 1-3**: Create comprehensive tests
   - Balance checking functionality
   - Transaction sending
   - Error handling and retry logic

2. **Day 4-5**: Integration testing
   - Verify WebSocket monitoring still works
   - Test with real contest simulations

3. **Day 6-7**: Performance testing
   - Compare execution time before and after migration
   - Verify handling of high transaction volumes

### Phase 3: SolanaEngineV2 Integration (After SolanaEngine migration)

Once SolanaEngineV2 is available:

1. Update imports to use SolanaEngineV2
2. Remove v1-specific compatibility code
3. Fully embrace the functional programming model

## Considerations for Contest Wallet Service

### Balance Monitoring

The Contest Wallet Service relies heavily on real-time balance monitoring. The migration should:
- Maintain WebSocket integration for balance updates
- Ensure the performance of batch balance checks is preserved or improved
- Verify the accuracy of balance information during contests

### Treasury Recovery

The Treasury Certifier functionality is critical for security. The migration must:
- Maintain the ability to recover funds from stranded wallets
- Ensure transfer operations work reliably
- Preserve treasury certification capabilities

### Wallet Creation

The service creates and manages contest wallets. The migration should:
- Maintain compatibility with VanityApiClient
- Ensure keypair generation and storage remain secure
- Preserve the ability to create deterministic wallets

## Testing Strategy

1. **Unit Tests**:
   - Test address conversion utilities
   - Test transaction creation utilities
   - Test each wallet operation individually

2. **Integration Tests**:
   - Test the full wallet lifecycle (creation, funding, monitoring, withdrawal)
   - Test interaction with WebSocket subsystem
   - Test interaction with VanityApiClient

3. **Performance Tests**:
   - Measure balance checking performance
   - Measure transaction throughput
   - Ensure WebSocket monitoring remains efficient

## Conclusion

The Contest Wallet Service migration will follow a compatibility-layer approach, similar to the Admin Wallet Service but tailored to the specific needs of contest wallet management. By implementing address and transaction utilities, we can update the service to work with Web3.js v2.x while maintaining backward compatibility through the transition period.

When SolanaEngineV2 is fully implemented, we can complete the migration by adopting the functional programming model more thoroughly. This phased approach minimizes risk while allowing the service to benefit from the performance improvements in Web3.js v2.x.