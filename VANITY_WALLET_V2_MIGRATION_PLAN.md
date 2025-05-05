# Vanity Wallet Service Migration Plan

This document outlines the migration strategy for updating the Vanity Wallet Service to work with Solana Web3.js v2.x. The service is responsible for generating vanity Solana wallet addresses with specific patterns like "DUEL" and "DEGEN".

## Current Architecture Analysis

The Vanity Wallet Service consists of the following components:

1. **Main Service Implementation**: `vanity-wallet-service.js`
   - Manages the generation of vanity addresses
   - Maintains a pool of available addresses for contests
   - Schedules and monitors generation jobs

2. **Generator Components**:
   - `generators/local-generator.js`: Uses solana-keygen for efficient address generation
   - `generators/index.js`: Manages generator instances and job processing

3. **API Client**: `vanity-api-client.js`
   - Provides a client interface for generating vanity addresses
   - Handles job creation, monitoring, and results

4. **Core Dependencies**:
   - **Solana Web3.js**: Used for Keypair handling and wallet address generation
   - **Solana Keygen CLI**: External tool called via child_process for efficient generation
   - **Prisma**: Database operations for storing and retrieving wallet information

## Solana Web3.js Usage Analysis

The Vanity Wallet Service has minimal but critical Solana Web3.js usage:

1. **Keypair Handling**: Primary usage in local-generator.js
   ```javascript
   import { Keypair } from '@solana/web3.js';
   
   // Creating a keypair from a secret key
   const secretKey = Uint8Array.from(keypair);
   const wallet = Keypair.fromSecretKey(secretKey);
   const publicKey = wallet.publicKey.toString();
   ```

2. **No Transaction Creation**: The service doesn't create or send transactions
3. **No RPC Calls**: No direct Solana RPC calls are made
4. **Limited PublicKey Usage**: Only used for getting the string representation

## Migration Strategy

Given the limited scope of Web3.js usage, a targeted approach focusing on Keypair handling is appropriate.

### Step 1: Create Compatibility Utilities

Create a compatibility layer for Keypair handling:

```javascript
// services/vanity-wallet/utils/keypair-utils.js

import { Keypair as KeypairV1 } from '@solana/web3.js';
import { createKeypairFromBytes } from '@solana/keys';

/**
 * Create a keypair from a secret key, compatible with both v1 and v2
 * @param {Uint8Array} secretKey - The secret key as a Uint8Array
 * @returns {Object} - A compatible keypair object
 */
export function createKeypairFromSecretKey(secretKey) {
  try {
    // Try v2 approach first
    const keypair = createKeypairFromBytes(secretKey);
    return {
      ...keypair,
      // Ensure publicKey has a toString method for compatibility
      publicKey: {
        ...keypair.publicKey,
        toString: () => keypair.publicKey.toString()
      }
    };
  } catch (error) {
    // Fall back to v1 if needed
    return KeypairV1.fromSecretKey(secretKey);
  }
}

/**
 * Verify if a string is a valid Solana address
 * @param {string} address - The address to verify
 * @returns {boolean} - Whether the address is valid
 */
export function isValidSolanaAddress(address) {
  try {
    // Try to use v2 validation if available
    return import('@solana/addresses').then(({ validateAddress }) => {
      return validateAddress(address);
    }).catch(() => {
      // Fall back to v1 validation
      try {
        new KeypairV1.PublicKey(address);
        return true;
      } catch {
        return false;
      }
    });
  } catch {
    // If all else fails, do a simple regex check
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  }
}
```

### Step 2: Update LocalVanityGenerator

Modify `local-generator.js` to use the compatibility utilities:

```javascript
// services/vanity-wallet/generators/local-generator.js

// Replace the direct Web3.js import
// import { Keypair } from '@solana/web3.js';
import { createKeypairFromSecretKey, isValidSolanaAddress } from '../utils/keypair-utils.js';

// Update the keypair creation code
const secretKey = Uint8Array.from(keypair);
const wallet = createKeypairFromSecretKey(secretKey);
const publicKey = wallet.publicKey.toString();
```

### Step 3: Update Test Files

Update test files to use the compatibility utilities:

```javascript
// services/vanity-wallet/tests/test-vanity-generator.js (and other test files)

// Replace Web3.js imports with compatibility imports
// import { Keypair } from '@solana/web3.js';
import { createKeypairFromSecretKey, isValidSolanaAddress } from '../utils/keypair-utils.js';
```

## Implementation Plan

Since the Vanity Wallet Service has very limited Web3.js usage focused almost entirely on Keypair handling, the migration is straightforward.

### Phase 1: Compatibility Layer (1 day)

1. Create the `utils` directory and implement keypair utilities
2. Add comprehensive error handling for version compatibility
3. Ensure the utilities work with both v1.x and v2.x approaches

### Phase 2: Code Updates (1 day)

1. Update `local-generator.js` to use the compatibility utilities
2. Ensure the service can still properly generate and validate addresses
3. Test the basic functionality of creating and verifying keypairs

### Phase 3: Testing (1 day)

1. Update and run existing test cases with the new utilities
2. Verify end-to-end functionality of address generation
3. Test database storage and retrieval with the updated code

## Testing Strategy

The testing should focus on:

1. **Keypair Generation**: Ensure vanity addresses are correctly generated
   - Test with various patterns (DUEL, DEGEN, etc.)
   - Verify the public keys match the expected patterns
   - Ensure the private keys can be reconstructed correctly

2. **Efficiency**: Confirm the migration doesn't impact performance
   - Benchmark the generation speed before and after migration
   - Test CPU usage patterns remain consistent

3. **Integration**: Test the service's integration with other components
   - Verify contest wallet service can use the generated addresses
   - Ensure the admin dashboard can manage vanity wallets correctly

## Special Considerations

### External Tool Dependency

The service relies heavily on the external `solana-keygen` CLI tool. This dependency should remain unchanged during the migration since:

1. It's more efficient than pure JavaScript implementations
2. It's external to the Web3.js library being migrated
3. It generates standard keypair files that can be processed with either version

### Address Format Consistency

Ensure that the string representation of addresses remains consistent between Web3.js versions:

```javascript
// Verify the toString method produces identical results in both versions
const publicKeyV1 = keypairV1.publicKey.toString();
const publicKeyV2 = keypairV2.publicKey.toString();
assert.strictEqual(publicKeyV1, publicKeyV2);
```

## Migration Risks and Mitigations

1. **Risk**: Changes to keypair format between versions
   **Mitigation**: Use compatibility utilities that ensure consistent representation

2. **Risk**: Performance impact on address generation
   **Mitigation**: Benchmark and optimize if necessary, with fallback to v1 methods

3. **Risk**: Output format changes affecting stored addresses
   **Mitigation**: Ensure addresses are stored as strings, which should remain consistent

## Conclusion

The Vanity Wallet Service migration is relatively straightforward due to its limited use of Solana Web3.js functionality. By creating a focused compatibility layer for keypair handling, the service can be migrated with minimal risk and disruption.

The migration should have no impact on existing vanity addresses or the service's ability to generate new ones. The compatibility approach allows for graceful degradation if any issues arise, ensuring the service remains operational throughout the transition to Web3.js v2.x.