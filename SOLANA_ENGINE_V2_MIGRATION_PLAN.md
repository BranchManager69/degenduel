# SolanaEngine v2 Migration Plan

This document outlines the step-by-step plan for migrating the SolanaEngine service from Solana Web3.js v1.x to v2.x. This represents **Phase 2** of our overall Solana migration strategy.

## Current Architecture Analysis

The SolanaEngine service has the following core components:

1. **ConnectionManager**: Manages RPC connections to Solana nodes
   - Creates and maintains `Connection` objects from Web3.js v1.x
   - Provides methods to execute RPC calls and transactions

2. **Core SolanaEngine Service**: Built on BaseService
   - Provides high-level methods for blockchain operations
   - Delegates RPC operations to ConnectionManager
   - Integrates with Jupiter, Helius, and DexScreener

3. **Client Services**:
   - Jupiter Client: Price data and swap operations
   - Helius Client: Token metadata and blockchain data
   - DexScreener Client: Token pools and market data
   - Helius Pool Tracker: Real-time pool monitoring
   - Helius Balance Tracker: Real-time balance tracking

4. **Key Methods**:
   - `executeConnectionMethod`: Executes methods on Solana connection
   - `sendTransaction`: Sends transactions with retry logic
   - `confirmTransaction`: Confirms transaction success
   - Various token data and price fetching methods

## Web3.js v2 Key Differences

Web3.js v2 introduces fundamental changes to how we interact with Solana:

1. **No Connection Class**: Replaced with functional RPC interfaces
2. **Functional Programming Model**: Operations built through function composition
3. **Modular Package Structure**: Split into focused packages
4. **Transaction Construction**: Different API for building and signing transactions
5. **Different Address Format**: Simplified address handling with uniform type

## Migration Strategy

We'll implement a **complete rewrite** of the SolanaEngine service, creating a new SolanaEngineV2 that runs in parallel with the original during the transition period.

### Step 1: New Package Structure

Create a new directory structure for SolanaEngineV2:

```
services/
  solana-engine-v2/
    index.js                 # Main entry point and exports
    solana-engine-v2.js      # Core service implementation
    rpc-manager.js           # New replacement for connection-manager.js
    clients/                 # Client wrappers
      jupiter-client-v2.js
      helius-client-v2.js
      dexscreener-client-v2.js
    utils/                   # Utility functions
      transaction-utils.js
      address-utils.js
      compatibility.js       # Backward compatibility utilities
```

### Step 2: Install Required Dependencies

```bash
npm install @solana/rpc @solana/rpc-core @solana/addresses @solana/keys @solana/transactions \
  @solana/transaction-messages @solana/rpc-subscriptions @solana/compat
```

### Step 3: Create RPC Manager

Replace the ConnectionManager with a new RPC Manager using Web3.js v2:

```javascript
// services/solana-engine-v2/rpc-manager.js

import { createSolanaRpc } from '@solana/rpc';
import { createSolanaRpcSubscriptions } from '@solana/rpc-subscriptions';
import { logApi } from '../../utils/logger-suite/logger.js';
import { config } from '../../config/config.js';

class RpcManager {
  constructor() {
    // Singleton instance
    if (RpcManager.instance) {
      return RpcManager.instance;
    }
    RpcManager.instance = this;
    
    this.rpc = null;
    this.rpcSubscriptions = null;
    this.endpoint = null;
    this.initialized = false;
    this.healthyEndpoints = 0;
    this.totalEndpoints = 0;
  }
  
  async initialize() {
    try {
      logApi.info('Initializing RpcManager');
      
      // Get RPC endpoint from config
      const rpcEndpoint = config.rpc_urls.mainnet_http || config.rpc_urls.primary;
      const wsEndpoint = config.rpc_urls.mainnet_ws || config.rpc_urls.ws;
      
      if (!rpcEndpoint) {
        logApi.error('No valid RPC endpoint found in config');
        return false;
      }
      
      // Create RPC instance with default options
      this.rpc = createSolanaRpc({
        url: rpcEndpoint,
        commitment: 'confirmed',
        timeout: 60000, // 60 seconds
      });
      
      // Create RPC Subscriptions instance if WS endpoint is available
      if (wsEndpoint) {
        this.rpcSubscriptions = createSolanaRpcSubscriptions({ url: wsEndpoint });
      }
      
      // Test the connection with a simple RPC call
      const slot = await this.rpc.getSlot();
      
      this.endpoint = rpcEndpoint;
      this.initialized = true;
      this.healthyEndpoints = 1;
      this.totalEndpoints = 1;
      
      logApi.info(`RPC connection established successfully (slot: ${slot})`);
      return true;
    } catch (error) {
      logApi.error(`Failed to initialize RpcManager: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Get the Solana RPC client
   */
  getRpc() {
    if (!this.initialized || !this.rpc) {
      throw new Error('RpcManager not initialized');
    }
    
    return this.rpc;
  }
  
  /**
   * Get the Solana RPC Subscriptions client
   */
  getRpcSubscriptions() {
    if (!this.initialized || !this.rpcSubscriptions) {
      throw new Error('RPC Subscriptions not initialized');
    }
    
    return this.rpcSubscriptions;
  }
  
  /**
   * Execute an RPC method
   */
  async executeMethod(methodName, args = []) {
    if (!this.initialized || !this.rpc) {
      await this.initialize();
      if (!this.initialized) {
        throw new Error('Failed to initialize RpcManager');
      }
    }
    
    try {
      // Check if the method exists on the RPC object
      if (typeof this.rpc[methodName] !== 'function') {
        throw new Error(`Method ${methodName} not found on RPC client`);
      }
      
      // Call the method with the provided arguments
      return await this.rpc[methodName](...args);
    } catch (error) {
      logApi.error(`Failed to execute RPC method ${methodName}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Get connection status
   */
  getStatus() {
    if (!this.initialized) {
      return {
        status: 'not_initialized',
        message: 'RpcManager not initialized'
      };
    }
    
    return {
      status: 'connected',
      endpoint: this.endpoint,
      healthyEndpoints: this.healthyEndpoints,
      totalEndpoints: this.totalEndpoints
    };
  }
}

const rpcManager = new RpcManager();
export default rpcManager;
```

### Step 4: Create Address and Transaction Utilities

```javascript
// services/solana-engine-v2/utils/address-utils.js

import { PublicKey } from '@solana/web3.js';
import { createAddress, getAddressFromString } from '@solana/addresses';
import { createKeypairFromBytes } from '@solana/keys';

/**
 * Convert a string or PublicKey to a v2 Address
 */
export function toAddress(addressOrPublicKey) {
  if (typeof addressOrPublicKey === 'string') {
    return getAddressFromString(addressOrPublicKey);
  } else if (addressOrPublicKey instanceof PublicKey) {
    return getAddressFromString(addressOrPublicKey.toString());
  }
  
  // Already an Address
  return addressOrPublicKey;
}

/**
 * Create a keypair from private key bytes
 */
export function createKeypairFromPrivateKey(privateKeyBytes) {
  return createKeypairFromBytes(privateKeyBytes);
}

// Additional address utilities as needed
```

```javascript
// services/solana-engine-v2/utils/transaction-utils.js

import { getBase64EncodedWireTransaction, getSignatureFromTransaction } from '@solana/transactions';
import { appendTransactionMessageInstruction, setTransactionMessageLifetimeUsingBlockhash } from '@solana/transaction-messages';
import { transferSol } from '@solana/rpc-api';
import { logApi } from '../../../utils/logger-suite/logger.js';

/**
 * Sign and send a transaction with retry logic
 */
export async function sendTransactionWithRetry(rpc, transaction, signers, options = {}) {
  const {
    maxRetries = 3,
    commitment = 'confirmed',
    skipPreflight = false,
    preflightCommitment = commitment
  } = options;
  
  let signature = null;
  let retryCount = 0;
  
  while (retryCount <= maxRetries) {
    try {
      // Get latest blockhash
      const { value: { blockhash, lastValidBlockHeight } } = await rpc.getLatestBlockhash();
      
      // Set the blockhash
      transaction = setTransactionMessageLifetimeUsingBlockhash(
        transaction,
        { blockhash, lastValidBlockHeight }
      );
      
      // Sign and send the transaction
      signature = await rpc.sendTransaction(transaction, {
        skipPreflight,
        preflightCommitment,
        commitment
      });
      
      // Log success
      logApi.info(`Transaction sent: ${signature}`);
      return signature;
      
    } catch (error) {
      // Handle blockheight exceeded error
      if (error.message.includes('block height exceeded') && retryCount < maxRetries) {
        retryCount++;
        logApi.warn(`Block height exceeded, retrying (${retryCount}/${maxRetries})...`);
        continue;
      }
      
      // Otherwise, throw the error
      throw error;
    }
  }
}

/**
 * Confirm a transaction with timeout
 */
export async function confirmTransaction(rpc, signature, blockhash, lastValidBlockHeight, options = {}) {
  const { timeout = 60000, commitment = 'confirmed' } = options;
  
  try {
    const confirmationStrategy = {
      blockhash,
      lastValidBlockHeight,
      signature
    };
    
    // Wait for confirmation with timeout
    const confirmation = await Promise.race([
      rpc.confirmTransaction(confirmationStrategy, commitment),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Transaction confirmation timeout')), timeout)
      )
    ]);
    
    if (confirmation?.value?.err) {
      throw new Error(`Transaction failed: ${confirmation.value.err}`);
    }
    
    return 'confirmed';
  } catch (error) {
    logApi.error(`Transaction confirmation failed: ${error.message}`);
    throw error;
  }
}
```

### Step 5: Create Core SolanaEngineV2 Service

```javascript
// services/solana-engine-v2/solana-engine-v2.js

import { BaseService } from '../../utils/service-suite/base-service.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import { serviceColors, fancyColors } from '../../utils/colors.js';
import { SERVICE_NAMES } from '../../utils/service-suite/service-constants.js';
import { PrismaClient } from '@prisma/client';
import redisManager from '../../utils/redis-suite/redis-manager.js';

// Import RPC Manager
import rpcManager from './rpc-manager.js';

// Import utilities
import { toAddress } from './utils/address-utils.js';
import { sendTransactionWithRetry, confirmTransaction } from './utils/transaction-utils.js';

// Import clients (will implement later)
// import jupiterClientV2 from './clients/jupiter-client-v2.js';
// import heliusClientV2 from './clients/helius-client-v2.js';
// import dexscreenerClientV2 from './clients/dexscreener-client-v2.js';

// Config
import config from '../../config/config.js';

// SolanaEngineV2 Service
class SolanaEngineV2Service extends BaseService {
  constructor() {
    // Create proper config object for BaseService
    super({
      name: SERVICE_NAMES.SOLANA_ENGINE_V2,
      layer: 'INFRASTRUCTURE', 
      criticalLevel: 'high'
    });
    
    // Initialize state
    this.subscribedTokens = new Set();
    this.wsServer = null;
    this.transactionStats = {
      sent: 0,
      confirmed: 0,
      failed: 0
    };
    
    // Track initialization status
    this._initialized = false;
    this._lastHealthLog = 0;
  }
  
  /**
   * Initialize the SolanaEngineV2 Service
   */
  async initialize() {
    try {
      logApi.info(`Initializing SolanaEngineV2 Service`);
      
      // Initialize RPC Manager
      const rpcManagerInitialized = await rpcManager.initialize();
      if (!rpcManagerInitialized) {
        logApi.warn(`RPC Manager initialization failed`);
        return false;
      }
      
      // Initialize client services here
      // ... (initialize Jupiter, Helius, DexScreener clients)
      
      // Get reference to the WebSocket server
      this.wsServer = config.websocket.unifiedWebSocket;
      
      // Mark as initialized using BaseService
      const result = await super.initialize();
      this._initialized = result === true;
      
      logApi.info(`SolanaEngineV2 Service initialized successfully`);
      return result;
    } catch (error) {
      logApi.error(`Failed to initialize SolanaEngineV2 Service: ${error.message}`);
      this._initialized = false;
      return false;
    }
  }
  
  /**
   * Check if the service is initialized
   */
  isInitialized() {
    return this._initialized === true;
  }
  
  // Property getters/setters for backward compatibility
  get isInitialized() {
    return this._initialized === true;
  }
  
  set isInitialized(value) {
    this._initialized = value === true;
  }
  
  /**
   * Get the RPC status
   */
  getConnectionStatus() {
    return rpcManager.getStatus();
  }
  
  /**
   * Get the RPC client
   */
  getRpc() {
    return rpcManager.getRpc();
  }
  
  /**
   * Get the RPC Subscriptions client
   */
  getRpcSubscriptions() {
    if (!rpcManager.getRpcSubscriptions) {
      throw new Error('RPC Subscriptions not available');
    }
    return rpcManager.getRpcSubscriptions();
  }
  
  /**
   * Execute a method on the RPC client
   * This provides backward compatibility with the v1 executeConnectionMethod
   */
  async executeConnectionMethod(methodName, ...args) {
    try {
      return await rpcManager.executeMethod(methodName, args);
    } catch (error) {
      logApi.error(`Failed to execute method ${methodName}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Send a transaction to the Solana network
   */
  async sendTransaction(transaction, signers = [], options = {}) {
    try {
      const rpc = this.getRpc();
      const signature = await sendTransactionWithRetry(rpc, transaction, signers, options);
      
      // Update transaction stats
      this.transactionStats.sent++;
      
      // If requested, confirm the transaction
      if (options.confirmTransaction) {
        await this.confirmTransaction(signature);
        this.transactionStats.confirmed++;
      }
      
      return signature;
    } catch (error) {
      this.transactionStats.failed++;
      logApi.error(`Transaction send failed: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Confirm a transaction
   */
  async confirmTransaction(signature, options = {}) {
    try {
      const rpc = this.getRpc();
      const { blockhash, lastValidBlockHeight } = options;
      
      // If blockhash and lastValidBlockHeight not provided, get the latest
      let confirmationInfo = { blockhash, lastValidBlockHeight };
      if (!blockhash || !lastValidBlockHeight) {
        const { value } = await rpc.getLatestBlockhash();
        confirmationInfo = value;
      }
      
      // Confirm the transaction
      const status = await confirmTransaction(
        rpc,
        signature,
        confirmationInfo.blockhash,
        confirmationInfo.lastValidBlockHeight,
        options
      );
      
      return status;
    } catch (error) {
      logApi.error(`Transaction confirmation failed: ${error.message}`);
      throw error;
    }
  }
  
  // ... Additional methods for token data, prices, etc.
}

const solanaEngineV2 = new SolanaEngineV2Service();
export default solanaEngineV2;
```

### Step 6: Create Client Service Implementations

#### Jupiter Client V2

```javascript
// services/solana-engine-v2/clients/jupiter-client-v2.js

// Implement Jupiter integration with Web3.js v2
// This would be very similar to the original Jupiter client,
// but with updated transaction handling
```

#### Helius Client V2

```javascript
// services/solana-engine-v2/clients/helius-client-v2.js

// Implement Helius integration with Web3.js v2
```

#### DexScreener Client V2

```javascript
// services/solana-engine-v2/clients/dexscreener-client-v2.js

// Implement DexScreener integration with Web3.js v2
```

### Step 7: Create Index for Easy Imports

```javascript
// services/solana-engine-v2/index.js

import solanaEngineV2 from './solana-engine-v2.js';
import jupiterClientV2 from './clients/jupiter-client-v2.js';
import heliusClientV2 from './clients/helius-client-v2.js';
import dexscreenerClientV2 from './clients/dexscreener-client-v2.js';

export {
  solanaEngineV2,
  jupiterClientV2,
  heliusClientV2,
  dexscreenerClientV2
};

export default solanaEngineV2;
```

### Step 8: Create Compatibility Utilities for Service Migration

```javascript
// services/solana-engine-v2/utils/compatibility.js

import { Connection } from '@solana/web3.js';
import solanaEngineV2 from '../solana-engine-v2.js';

/**
 * Create a v1-compatible Connection object that delegates to SolanaEngineV2
 * This allows v1 code to use v2 under the hood
 */
export function createCompatConnection() {
  // Create a mock Connection object
  const compatConnection = {};
  
  // Add methods that proxy to SolanaEngineV2
  const proxyMethods = [
    'getBalance', 'getAccountInfo', 'getTransaction',
    'getSignatureStatus', 'getRecentBlockhash', 'getLatestBlockhash',
    'getSlot', 'getTokenAccountBalance', 'getTokenAccountsByOwner',
    'sendTransaction', 'confirmTransaction'
  ];
  
  for (const method of proxyMethods) {
    compatConnection[method] = async (...args) => {
      return solanaEngineV2.executeConnectionMethod(method, ...args);
    };
  }
  
  return compatConnection;
}

/**
 * Create a v1-compatible SolanaEngine that delegates to SolanaEngineV2
 * This allows existing services to use the new implementation
 */
export function createCompatSolanaEngine() {
  const compatEngine = {
    // Core Connection methods
    executeConnectionMethod: async (method, ...args) => {
      return solanaEngineV2.executeConnectionMethod(method, ...args);
    },
    
    sendTransaction: async (transaction, signers, options) => {
      return solanaEngineV2.sendTransaction(transaction, signers, options);
    },
    
    confirmTransaction: async (signature, options) => {
      return solanaEngineV2.confirmTransaction(signature, options);
    },
    
    getConnection: () => {
      return createCompatConnection();
    },
    
    getConnectionStatus: () => {
      return solanaEngineV2.getConnectionStatus();
    },
    
    isInitialized: () => {
      return solanaEngineV2.isInitialized();
    },
    
    // Add all other methods that services might use
    getTokenData: async (mintAddresses, options) => {
      return solanaEngineV2.getTokenData(mintAddresses, options);
    },
    
    getTokenPrice: async (mintAddress, options) => {
      return solanaEngineV2.getTokenPrice(mintAddress, options);
    }
  };
  
  // Also expose as a property for services that check .isInitialized
  Object.defineProperty(compatEngine, 'isInitialized', {
    get: () => solanaEngineV2.isInitialized(),
    set: (value) => { solanaEngineV2.isInitialized = value; }
  });
  
  return compatEngine;
}
```

## Implementation Plan

### Phase 1: Development (2 weeks)

1. **Week 1**:
   - Set up new package structure
   - Implement RPC Manager
   - Implement address and transaction utilities
   - Implement basic SolanaEngineV2 service structure

2. **Week 2**:
   - Implement client services (Jupiter, Helius, DexScreener)
   - Implement compatibility utilities
   - Add token data and price functionality

### Phase 2: Testing (1 week)

1. Create comprehensive test suite
   - Unit tests for RPC Manager
   - Unit tests for transaction utilities
   - Integration tests with Solana devnet

2. Conduct performance testing
   - Compare old vs. new implementation
   - Measure latency and throughput
   - Test retry and error handling logic

### Phase 3: Deployment and Migration (2 weeks)

1. **Week 1**:
   - Deploy SolanaEngineV2 alongside original SolanaEngine
   - Start with non-critical services migration
   - Monitor performance and reliability

2. **Week 2**:
   - Migrate remaining services
   - Monitor production usage
   - Gather feedback and make improvements

## Key Considerations

### Backward Compatibility

While SolanaEngineV2 uses Web3.js v2 internally, it must provide a compatible interface for existing services. The compatibility utilities will allow for a smooth transition.

### Performance Impact

Web3.js v2 should provide better performance, especially in terms of bundle size and runtime efficiency. We should measure and document these improvements.

### Error Handling

The new implementation should maintain or improve upon the robust error handling of the original, particularly for transaction retries and circuit breaker patterns.

### Testing Strategy

Comprehensive testing is crucial for this migration. We should:
- Test with both devnet and mainnet
- Test with high transaction volumes
- Test failure scenarios and recovery
- Compare performance metrics between v1 and v2

### Risk Mitigation

Running both implementations in parallel allows for immediate rollback if issues arise. We should implement detailed monitoring and alerting during the transition.

## Conclusion

Migrating to Web3.js v2 is a significant architectural change that requires careful planning and implementation. By using a phased approach with parallel implementations, we can minimize risk while capturing the benefits of the new architecture.

The resulting SolanaEngineV2 will provide a more robust, performant, and maintainable foundation for DegenDuel's Solana integration.