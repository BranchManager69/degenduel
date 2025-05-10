// services/solana-engine/connection-manager.js

/**
 * Connection Manager for Solana RPC endpoints
 * 
 * Manages a v2 RPC client for Solana interactions.
 */

import { createSolanaRpc } from '@solana/kit';
import { SolanaRpcMethods } from '@solana/rpc-methods'; // This import might also come from @solana/kit or be unneeded if rpc client is not explicitly typed
import { logApi } from '../../utils/logger-suite/logger.js';
import { config } from '../../config/config.js';
import { PublicKeyV1 } from '@solana/web3.js';

// Default commitment level
const DEFAULT_COMMITMENT = 'confirmed';

/**
 * Connection Manager for Solana RPC access using v2 RPC client.
 */
class ConnectionManager {
  constructor() {
    // Singleton instance
    if (ConnectionManager.instance) {
      return ConnectionManager.instance;
    }
    ConnectionManager.instance = this;
    
    this.rpc = null; // Will hold the v2 RPC client
    this.endpoint = null;
    this.initialized = false;
  }

  /**
   * Initialize the connection manager
   * @returns {Promise<boolean>} - Initialization success
   */
  async initialize() {
    if (this.initialized) {
      logApi.info('ConnectionManager already initialized with v2 RPC client.');
      return true;
    }
    try {
      logApi.info('Initializing ConnectionManager with v2 RPC client');
      
      // Get RPC endpoint from config
      const rpcEndpoint = config.rpc_urls.mainnet_http || config.rpc_urls.primary;
      
      if (!rpcEndpoint) {
        logApi.error('No valid RPC endpoint found in config for ConnectionManager');
        this.initialized = false;
        return false;
      }
      
      // Create v2 RPC client
      this.rpc = createSolanaRpc({ url: rpcEndpoint });
      
      // Test the connection with a simple RPC call (v2 style)
      await this.rpc.getSlot().send();
      
      this.endpoint = rpcEndpoint;
      this.initialized = true;
      
      logApi.info(`v2 RPC client initialized successfully for endpoint: ${this.endpoint}`);
      return true;
    } catch (error) {
      logApi.error(`Failed to initialize ConnectionManager with v2 RPC client: ${error.message}`, { error });
      this.initialized = false;
      this.rpc = null; // Ensure rpc is null if initialization fails
      return false;
    }
  }

  /**
   * Get the Solana v2 RPC client
   * @returns {SolanaRpcMethods} - Solana v2 RPC client object (or the client instance)
   */
  getRpcClient() {
    if (!this.initialized || !this.rpc) {
      // Attempt to initialize if not already
      logApi.warn('ConnectionManager getRpcClient called before initialization or after a failed init. Attempting to initialize...');
      // This path should ideally not be hit frequently if initialize is called at service startup.
      // Consider if an immediate throw is better if !this.initialized.
      // For now, let's stick to throwing if not initialized properly.
      throw new Error('ConnectionManager not initialized or initialization failed. Call initialize() first.');
    }
    return this.rpc;
  }

  /**
   * Get connection status
   * @returns {Object} - Status information
   */
  getStatus() {
    if (!this.initialized) {
      return {
        status: 'not_initialized',
        message: 'ConnectionManager not initialized'
      };
    }
    if (!this.rpc) {
        return {
            status: 'error',
            message: 'RPC client not available despite manager being initialized'
        };
    }
    // For v2, a simple check might involve trying a quick, harmless call or relying on initialization success.
    // Here, we assume if initialized and rpc object exists, it's 'connected' for status purposes.
    return {
      status: 'connected',
      endpoint: this.endpoint // Keep track of the endpoint used
    };
  }

  /**
   * Execute a raw RPC call function with the v2 client.
   * The provided rpcCall function should be designed to work with a v2 RPC client.
   * @param {Function} rpcCall - Function that takes a v2 RPC client and returns a promise
   * @returns {Promise<any>} - Result of the RPC call
   */
  async executeRpcV2(rpcCall) {
    if (!this.initialized || !this.rpc) {
      const initializedSuccess = await this.initialize();
      if (!initializedSuccess || !this.rpc) {
        throw new Error('Failed to initialize ConnectionManager for executeRpcV2');
      }
    }
    
    try {
      return await rpcCall(this.rpc);
    } catch (err) {
      logApi.error(`v2 RPC call error: ${err.message}`, { error: err });
      throw err;
    }
  }

  /**
   * Execute a specific, mapped Solana RPC method using the v2 client.
   * This replaces the old generic executeMethod for v1 Connection.
   * @param {string} methodName - Name of the standard Solana RPC method (mapped to v2 calls)
   * @param {Array} args - Arguments for the method
   * @returns {Promise<any>} - Result of the method call
   */
  async executeSolanaRpcMethod(methodName, args = []) {
    const rpc = this.getRpcClient(); // Ensures client is initialized or throws
    const commitment = args.find(arg => typeof arg === 'object' && arg?.commitment)?.commitment || DEFAULT_COMMITMENT;
    const rpcConfig = { commitment };

    // Note: PublicKeys from v1 must be passed as base58 strings to v2 Address type automatically
    // or converted explicitly using `address(publicKeyString)` from '@solana/addresses'.
    // For simplicity, we'll assume addresses in `args` are strings where needed.

    logApi.debug(`Executing v2 RPC method: ${methodName} with args:`, args);

    try {
      switch (methodName) {
        case 'getSlot':
          return await rpc.getSlot(rpcConfig).send();
        case 'getLatestBlockhash':
          // Args[0] could be a config object in v1, in v2 it's a direct config
          return await rpc.getLatestBlockhash(args[0] || rpcConfig).send();
        case 'getBalance':
          if (!args[0]) throw new Error('getBalance requires a public key string argument.');
          // Assumes args[0] is a publicKey string. @solana/rpc should handle string to Address.
          return await rpc.getBalance(args[0], rpcConfig).send();
        case 'getAccountInfo':
          if (!args[0]) throw new Error('getAccountInfo requires a public key string or PublicKey argument.');
          const accountAddressString = typeof args[0] === 'string' ? args[0] : args[0].toBase58();
          const accountInfoConfig = {
            commitment: (args[1] && typeof args[1] === 'object' && args[1].commitment) || 
                        (typeof args[1] === 'string' ? args[1] : commitment),
            encoding: (args[1] && typeof args[1] === 'object' && args[1].encoding) || 'base64' 
          };
          const v2AccountInfoResult = await rpc.getAccountInfo(accountAddressString, accountInfoConfig).send();
          if (v2AccountInfoResult.value) {
            if (v2AccountInfoResult.value.data && typeof v2AccountInfoResult.value.data[0] === 'string' && accountInfoConfig.encoding === 'base64') {
              v2AccountInfoResult.value.data = Buffer.from(v2AccountInfoResult.value.data[0], 'base64');
            }
            // Convert owner to PublicKeyV1 for compatibility
            if (v2AccountInfoResult.value.owner && typeof v2AccountInfoResult.value.owner === 'string') {
                v2AccountInfoResult.value.owner = new PublicKeyV1(v2AccountInfoResult.value.owner);
            }
          }
          return v2AccountInfoResult.value;

        case 'getParsedAccountInfo':
          if (!args[0]) throw new Error('getParsedAccountInfo requires a public key string or PublicKey argument.');
          const parsedAccountAddressString = typeof args[0] === 'string' ? args[0] : args[0].toBase58();
          const parsedAccountInfoConfig = {
            commitment: (args[1] && typeof args[1] === 'object' && args[1].commitment) || 
                        (typeof args[1] === 'string' ? args[1] : commitment),
            encoding: 'jsonParsed' // Always request jsonParsed for this method
          };
          const v2ParsedResult = await rpc.getAccountInfo(parsedAccountAddressString, parsedAccountInfoConfig).send();
          // The v2 rpc.getAccountInfo with encoding: 'jsonParsed' directly puts the parsed structure (or base64 data if not parsable) into `value.data`.
          // If `value.data` is an array of strings (e.g. ["base64_string", "base64"]), it means it wasn't parsed by Helius, 
          // so we should return it as a Buffer like v1 would if it couldn't parse.
          if (v2ParsedResult.value) {
            if (v2ParsedResult.value.data && Array.isArray(v2ParsedResult.value.data) && typeof v2ParsedResult.value.data[0] === 'string') {
              if (v2ParsedResult.value.data.length > 1 && typeof v2ParsedResult.value.data[1] === 'string' && 
                 (v2ParsedResult.value.data[1] === 'base64' || v2ParsedResult.value.data[1] === 'base58' || v2ParsedResult.value.data[1] === 'base64+zstd')) {
                v2ParsedResult.value.data = Buffer.from(v2ParsedResult.value.data[0], v2ParsedResult.value.data[1] === 'base58' ? 'base58' : 'base64'); 
              }
            }
            // Convert owner to PublicKeyV1 for compatibility
            if (v2ParsedResult.value.owner && typeof v2ParsedResult.value.owner === 'string') {
                v2ParsedResult.value.owner = new PublicKeyV1(v2ParsedResult.value.owner);
            }
          }
          // If v2ParsedResult.value.data is already an object (parsed), it's good.
          // The structure { program, parsed, space } is what v1 getParsedAccountInfo also aimed for in AccountInfo.data.
          return v2ParsedResult.value; // Return AccountInfo object or null

        case 'getMinimumBalanceForRentExemption':
          if (args[0] === undefined || typeof args[0] !== 'number') throw new Error('getMinimumBalanceForRentExemption requires a dataLength (number) argument.');
          const dataLength = args[0];
          const rentExemptionConfig = { 
            commitment: (args[1] && typeof args[1] === 'string' ? args[1] : commitment)
          };
          const resultBigInt = await rpc.getMinimumBalanceForRentExemption(dataLength, rentExemptionConfig).send();
          return Number(resultBigInt); // Convert bigint to number for v1 compatibility

        case 'requestAirdrop':
          if (!args[0]) throw new Error('requestAirdrop requires a publicKey (string or PublicKey) argument.');
          if (args[1] === undefined || typeof args[1] !== 'number') throw new Error('requestAirdrop requires lamports (number) as the second argument.');
          
          const airdropAddressString = typeof args[0] === 'string' ? args[0] : args[0].toBase58();
          const lamportsToAirdrop = BigInt(args[1]);
          const airdropCommitment = (args[2] && typeof args[2] === 'string') ? args[2] : commitment; // v1 might pass commitment as 3rd arg
          
          const airdropConfig = { commitment: airdropCommitment };

          // The v2 requestAirdrop method is available directly on the rpc client.
          const signature = await rpc.requestAirdrop(airdropAddressString, lamportsToAirdrop, airdropConfig).send();
          return signature;

        case 'getEpochInfo':
          // v1 commitment was args[0], v2 takes it in config.
          const epochInfoCommitment = (args[0] && typeof args[0] === 'string') ? args[0] : commitment;
          const epochInfoConfig = { commitment: epochInfoCommitment };
          // The v2 getEpochInfo method is available directly on the rpc client.
          // The return structure is compatible with v1 EpochInfo (fields are numbers/bigints).
          const epochInfo = await rpc.getEpochInfo(epochInfoConfig).send();
          return epochInfo; // Directly return the v2 EpochInformation object

        case 'getProgramAccounts':
          if (!args[0]) throw new Error('getProgramAccounts requires a programId (string or PublicKey) argument.');
          const programIdString = typeof args[0] === 'string' ? args[0] : args[0].toBase58();
          
          let v2Filters = [];
          let v2Encoding = 'base64'; // Default to base64 like v1 to get Buffer data
          const v1ConfigOrCommitment = args[1];

          if (v1ConfigOrCommitment) {
            if (typeof v1ConfigOrCommitment === 'string') { // v1: (programId, commitment)
              // Commitment is handled by the main rpcConfig at the start of the function or can be overridden in v2Config
              // No specific filter or encoding change here based on just commitment string.
            } else if (typeof v1ConfigOrCommitment === 'object') { // v1: (programId, config)
              if (v1ConfigOrCommitment.encoding) {
                v2Encoding = v1ConfigOrCommitment.encoding; // e.g., 'jsonParsed', 'base64', 'base64+zstd'
              }
              if (v1ConfigOrCommitment.filters && Array.isArray(v1ConfigOrCommitment.filters)) {
                v2Filters = v1ConfigOrCommitment.filters.map(v1Filter => {
                  if (v1Filter.dataSize !== undefined) {
                    return { dataSize: BigInt(v1Filter.dataSize) };
                  }
                  if (v1Filter.memcmp) {
                    return {
                      memcmp: {
                        offset: BigInt(v1Filter.memcmp.offset),
                        bytes: v1Filter.memcmp.bytes, // This is base58 in v1
                        encoding: 'base58' // Specify encoding for v2 memcmp
                      }
                    };
                  }
                  return v1Filter; // Should not happen if filters are valid v1
                });
              }
            }
          }

          const finalV2Config = {
            commitment: (v1ConfigOrCommitment && v1ConfigOrCommitment.commitment) || commitment,
            encoding: v2Encoding,
            filters: v2Filters.length > 0 ? v2Filters : undefined,
            dataSlice: (v1ConfigOrCommitment && v1ConfigOrCommitment.dataSlice) || undefined,
            minContextSlot: (v1ConfigOrCommitment && v1ConfigOrCommitment.minContextSlot) || undefined,
            withContext: false // To match v1 return type more closely (array of accounts directly)
          };

          const v2ResultArray = await rpc.getProgramAccounts(programIdString, finalV2Config).send();
          
          // Map results to closely match v1: pubkey as PublicKey, account.data as Buffer if base64
          return v2ResultArray.map(item => {
            let accountData = item.account.data;
            if (v2Encoding === 'base64' && Array.isArray(accountData) && typeof accountData[0] === 'string') {
              accountData = Buffer.from(accountData[0], 'base64');
            }
            return {
              pubkey: new PublicKeyV1(item.pubkey), // Convert string pubkey back to v1 PublicKey
              account: {
                ...item.account,
                data: accountData,
                owner: new PublicKeyV1(item.account.owner) // Convert owner string to v1 PublicKey
              }
            };
          });

        case 'sendRawTransaction': // Maps to v2 sendTransaction
          if (!args[0]) throw new Error('sendRawTransaction requires serialized transaction argument.');
          // Args[0] is serialized tx, args[1] might be options like {skipPreflight, preflightCommitment}
          const sendOptions = args[1] || {};
          return await rpc.sendTransaction(args[0], { 
              encoding: 'base64', // common for serialized tx
              skipPreflight: sendOptions.skipPreflight,
              preflightCommitment: sendOptions.preflightCommitment || commitment,
              maxRetries: sendOptions.maxRetries
            }).send();
        case 'confirmTransaction': // Significantly different in v2; this is a simplified single status check
          if (!args[0]) throw new Error('confirmTransaction requires a signature string argument.');
          // This is NOT a full confirmation loop. It's a one-time status check.
          // True confirmation requires polling getSignatureStatuses.
          logApi.warn('confirmTransaction called on v2 ConnectionManager is a simplified status check, not full polling confirmation.');
          return await rpc.getSignatureStatuses([args[0]], {searchTransactionHistory: true}).send();
        case 'getTransaction':
          if (!args[0]) throw new Error('getTransaction requires a signature string argument.');
          // Args[1] could be config object with commitment or encoding
          const txConfig = args[1] || { commitment, encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 };
          return await rpc.getTransaction(args[0], txConfig).send();
        case 'getSignaturesForAddress':
          if (!args[0]) throw new Error('getSignaturesForAddress requires a public key string argument.');
          // Args[1] could be options like {limit, before, until}
          // Args[2] could be commitment string
          const sigsForAddrConfig = args[1] || {};
          if (args[2] && typeof args[2] === 'string') sigsForAddrConfig.commitment = args[2]; 
          else if (args[2] && typeof args[2] === 'object') Object.assign(sigsForAddrConfig, args[2]);
          else if (!sigsForAddrConfig.commitment) sigsForAddrConfig.commitment = commitment;

          return await rpc.getSignaturesForAddress(args[0], sigsForAddrConfig).send();
        case 'getFeeForMessage':
          if (!args[0]) throw new Error('getFeeForMessage requires a message argument.');
          const messageInput = args[0];
          const feeCommitment = (args[1] && typeof args[1] === 'string') ? args[1] : commitment;
          
          // Check if messageInput is likely a v2 TransactionMessage or compiled MessageV0
          // (duck typing: v2 messages have a `version` property and an `instructions` array)
          // A compiled MessageV0 (from compileTransaction(message).message) would also work here.
          if (typeof messageInput === 'object' && messageInput !== null && 
              (messageInput.version !== undefined && Array.isArray(messageInput.instructions)) || // Uncompiled v2 TransactionMessage
              (messageInput.header && messageInput.staticAccountKeys) ) {
            logApi.debug('getFeeForMessage: Received v2-like message object.');
            return await rpc.getFeeForMessage(messageInput, { commitment: feeCommitment }).send();
          } else if (messageInput.constructor && messageInput.constructor.name === 'Message') { // Heuristic for v1 Message
            logApi.warn('getFeeForMessage: Received a v1 Message object. This path is deprecated and may be removed.');
            // This assumes the v1 Message object is somehow directly passable or that the rpc client has some compat.
            // This path is risky. Ideally, callers should send v2 messages.
            // For true v1 Message object, one would need to serialize it and provide the wire format if the RPC method demands.
            // However, Helius RPC might be more flexible. For now, trying to pass it as is.
            return await rpc.getFeeForMessage(messageInput, { commitment: feeCommitment }).send(); 
          } else if (Buffer.isBuffer(messageInput) || messageInput instanceof Uint8Array) {
            // If it's raw bytes (e.g., from v1 message.serialize()), v2 getFeeForMessage expects a Message instance.
            // This path would require deserializing into a v2 message or using a different RPC method if available for raw bytes.
            logApi.error('getFeeForMessage: Received raw bytes. v2 getFeeForMessage expects a Message object. This is not supported directly.');
            throw new Error('getFeeForMessage with raw bytes not directly supported; pass a v2 TransactionMessage or MessageV0 object.');
          } else {
            logApi.error('getFeeForMessage: Unrecognized message format.', { messageInput });
            throw new Error('getFeeForMessage received an unrecognized message format.');
          }
        // Add other common methods here as needed
        default:
          logApi.error(`Unsupported v2 RPC method in ConnectionManager: ${methodName}`);
          throw new Error(`Unsupported v2 RPC method: ${methodName}`);
      }
    } catch (error) {
      logApi.error(`Error executing v2 RPC method ${methodName}: ${error.message}`, { error, args });
      throw error;
    }
  }

  /**
   * Legacy executeMethod, will be deprecated/removed.
   * Kept for now to highlight what needs to be refactored in consumers.
   * @deprecated Use executeSolanaRpcMethod with specific v2 mappings or direct rpc client usage.
   */
  async executeMethod(methodName, args = []) {
    logApi.warn(`DEPRECATED: executeMethod('${methodName}') called. This uses v1 Connection logic and will be removed. Update consumer to use v2 RPC calls.`);
    // This will now fail if this.rpc is a v2 client and the method doesn't exist or args are wrong.
    // This is intentionally left to break to identify all call sites that need updating.
    const rpc = this.getRpcClient();
    if (typeof rpc[methodName] === 'function') {
        // This is a risky fallback, assumes method signature compatibility
        logApi.warn(`Attempting to call method '${methodName}' directly on v2 RPC client. May not work as expected.`);
        return rpc[methodName](...args).send(); // Assuming it's a sendable request
    }
    throw new Error(`Method '${methodName}' is not available on the v2 RPC client or not mapped in executeSolanaRpcMethod.`);
  }
}

// Create and export a singleton instance
const connectionManager = new ConnectionManager();
export default connectionManager;