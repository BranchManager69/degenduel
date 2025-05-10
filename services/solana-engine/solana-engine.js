// services/solana-engine/solana-engine.js

/**
 * Solana Engine Service
 * @module services/solana-engine/solana-engine
 * 
 * @description This service provides comprehensive Solana integration using Helius and Jupiter APIs.
 *              It offers token metadata, market data, and blockchain operations.
 * 
 *              It replaces solanaService, tokenSyncService, and marketDataService
 *              with a more robust implementation using premium APIs.
 * 
 * @author BranchManager69
 * @version 2.1.0
 * @created 2025-05-10
 * @updated 2025-05-10
 */

import { BaseService } from '../../utils/service-suite/base-service.js';
import { SERVICE_NAMES } from '../../utils/service-suite/service-constants.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors, serviceColors } from '../../utils/colors.js';
import { heliusClient } from './helius-client.js';
import { jupiterClient } from './jupiter-client.js';
import { dexscreenerClient } from './dexscreener-client.js';
import { heliusPoolTracker } from './helius-pool-tracker.js';
import connectionManager from './connection-manager.js';
import redisManager from '../../utils/redis-suite/redis-manager.js';
import prisma from '../../config/prisma.js';

// Config
import config from '../../config/config.js';

// Make sure to import v2 transaction and address utilities
import { getAddressEncoder, isAddress } from '@solana/addresses';
import { 
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction
} from '@solana/transaction-messages'; 
import { 
  compileTransaction,
  signTransaction
} from '@solana/transactions';

// Import Helius Kite
import { connect as connectKite } from 'solana-kite';

// Default solanaEngine colors if not found in serviceColors
const defaultSolanaEngineColors = {
  tag: '\x1b[1m\x1b[38;5;75m',                    // Blue (75)
  header: '\x1b[1m\x1b[38;5;75m\x1b[48;5;236m',   // Blue on dark gray
  info: '\x1b[38;5;75m',                          // Regular blue
  success: '\x1b[38;5;46m',                       // Standard green
  warning: '\x1b[38;5;214m',                      // Standard orange
  error: '\x1b[38;5;196m',                        // Standard red
  highlight: '\x1b[1m\x1b[38;5;75m',              // Bold blue
  token: '\x1b[1m\x1b[38;5;75m',                  // Bold blue
  count: '\x1b[1m\x1b[38;5;75m',                  // Bold blue
};

// Formatting helpers for consistent logging with fallbacks
const formatLog = {
  tag: () => `${(serviceColors.solanaEngine || defaultSolanaEngineColors).tag}[SolanaEngine]${fancyColors.RESET}`,
  header: (text) => `${(serviceColors.solanaEngine || defaultSolanaEngineColors).header} ${text} ${fancyColors.RESET}`,
  success: (text) => `${(serviceColors.solanaEngine || defaultSolanaEngineColors).success}${text}${fancyColors.RESET}`,
  warning: (text) => `${(serviceColors.solanaEngine || defaultSolanaEngineColors).warning}${text}${fancyColors.RESET}`,
  error: (text) => `${(serviceColors.solanaEngine || defaultSolanaEngineColors).error}${text}${fancyColors.RESET}`,
  info: (text) => `${(serviceColors.solanaEngine || defaultSolanaEngineColors).info}${text}${fancyColors.RESET}`,
  highlight: (text) => `${(serviceColors.solanaEngine || defaultSolanaEngineColors).highlight}${text}${fancyColors.RESET}`,
  token: (symbol) => `${(serviceColors.solanaEngine || defaultSolanaEngineColors).token}${symbol}${fancyColors.RESET}`,
  count: (num) => `${(serviceColors.solanaEngine || defaultSolanaEngineColors).count}${num}${fancyColors.RESET}`,
};

// SolanaEngine Service
/**
 * SolanaEngine Service
 * Comprehensive Solana integration using Helius and Jupiter APIs
 * Provides token metadata, market data, and blockchain operations
 * 
 * NOTE: This service operates independently and does NOT depend on solanaService.
 * It will eventually replace solanaService, tokenSyncService, and marketDataService
 * with a more robust implementation using premium APIs.
 */
class SolanaEngineService extends BaseService {
  constructor() {
    // Create proper config object for BaseService
    super({
      name: SERVICE_NAMES.SOLANA_ENGINE,
      layer: 'INFRASTRUCTURE', 
      criticalLevel: 'high'
    });
    
    // WebSocket topics for real-time data distribution
    this.wsTopics = {
      tokenData: config.websocket.topics.MARKET_DATA,
    };
    
    // Track subscribed tokens
    this.subscribedTokens = new Set();
    
    // Reference to the WebSocket server
    this.wsServer = null;
    
    // Track transaction stats
    this.transactionStats = {
      sent: 0,
      confirmed: 0,
      failed: 0
    };
    
    // Track initialization status separately from property
    this._initialized = false;

    // Track last health check time
    this._lastHealthLog = 0;

    this.kiteConnection = null; // For Helius Kite
  }

  /**
   * Initialize the SolanaEngine Service
   */
  async initialize() {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('INITIALIZING')} SolanaEngine Service`);
      
      // Store the connection manager instance
      this.connectionManager = connectionManager;
      
      // Initialize ConnectionManager first (provides RPC access to other clients)
      const connectionManagerInitialized = await this.connectionManager.initialize();
      if (!connectionManagerInitialized) {
        logApi.warn(`${formatLog.tag()} ${formatLog.warning('ConnectionManager initialization failed')}`);
      }
      
      // Initialize Helius client
      const heliusInitialized = await heliusClient.initialize();
      if (!heliusInitialized) {
        logApi.warn(`${formatLog.tag()} ${formatLog.warning('Helius client initialization failed')}`);
      }
      
      // Initialize Jupiter client - use singleton instance
      if (!jupiterClient.initialized) {
        const jupiterInitialized = await jupiterClient.initialize();
        if (!jupiterInitialized) {
          logApi.warn(`${formatLog.tag()} ${formatLog.warning('Jupiter client initialization failed')}`);
        }
      } else {
        logApi.info(`${formatLog.tag()} ${formatLog.info('Jupiter client already initialized')}`);
      }
      
      // Initialize DexScreener client
      const dexscreenerInitialized = await dexscreenerClient.initialize();
      if (!dexscreenerInitialized) {
        logApi.warn(`${formatLog.tag()} ${formatLog.warning('DexScreener client initialization failed')}`);
      }
      
      // Initialize Helius Kite connection
      try {
        const kiteRpcUrl = this.connectionManager.endpoint || config.rpc_urls.primary || config.rpc_urls.mainnet_http;
        if (kiteRpcUrl) {
          const wsUrl = config.rpc_urls.mainnet_wss || 'wss://api.mainnet-beta.solana.com';
          // Fix: Only initialize Kite with both URLs defined, use appropriate object structure
          if (wsUrl) {
            if (wsUrl === 'wss://api.mainnet-beta.solana.com') { 
              logApi.warn(`${formatLog.tag()} ${formatLog.warning('Using default Helius Kite WebSocket URL:')} ${wsUrl}`); 
            }
            // Initialize Kite connection with both URLs
            this.kiteConnection = connectKite({
              httpUrl: kiteRpcUrl,
              webSocketUrl: wsUrl,
              connectionTimeoutMs: 10000
            });
            logApi.info(`${formatLog.tag()} ${formatLog.success('Helius Kite client initialized successfully with RPC:')} ${kiteRpcUrl} and WS: ${wsUrl}`);
          } else {
            logApi.warn(`${formatLog.tag()} ${formatLog.warning('No WebSocket URL found for Helius Kite initialization. Continuing without Kite features.')}`);
          }
        } else {
          logApi.error(`${formatLog.tag()} ${formatLog.error('No RPC URL found for Helius Kite initialization.')}`);
          // this.kiteConnection will remain null
        }
      } catch (kiteError) {
        logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to initialize Helius Kite client:')} ${kiteError.message}`, { error: kiteError });
        // this.kiteConnection will remain null
      }
      
      // Set up Jupiter price update callback
      jupiterClient.onPriceUpdate((priceData) => {
        this.handlePriceUpdate(priceData);
      });
      
      // Get reference to the WebSocket server
      this.wsServer = config.websocket.unifiedWebSocket;
      
      // Mark as initialized using BaseService
      const result = await super.initialize();
      
      // Set our own tracking property
      this._initialized = result === true;
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('SolanaEngine Service initialized successfully')}`);
      return result;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to initialize SolanaEngine Service:')} ${error.message}`);
      this._initialized = false;
      return false;
    }
  }
  
  /**
   * Check if the service is initialized
   * @returns {boolean} - True if initialized, false otherwise
   */
  isInitialized() {
    // Use our separate property to avoid name collision
    return this._initialized === true;
  }
  
  /**
   * Property getter for backward compatibility
   * Some services access this as a property, others as a method
   */
  get isInitialized() {
    return this._initialized === true;
  }
  
  /**
   * Property setter for backward compatibility
   * Allows BaseService to set isInitialized
   */
  set isInitialized(value) {
    this._initialized = value === true;
  }
  
  /**
   * Get the connection status
   * @returns {Object} - Connection status information
   */
  getConnectionStatus() {
    if (!this.connectionManager) {
      return {
        status: "unavailable",
        message: "Connection manager not initialized"
      };
    }
    
    try {
      const status = this.connectionManager.getStatus();
      return status;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Error getting connection status:')} ${error.message}`);
      return {
        status: "error",
        message: error.message
      };
    }
  }
  
  // -----------------------------------------------------------------------------------
  // SOLANA CONNECTION METHODS - COMPATIBILITY WITH SOLANA SERVICE MANAGER
  // These methods provide a drop-in replacement for SolanaServiceManager
  // -----------------------------------------------------------------------------------
  
  /**
   * Get a connection from the connection manager.
   * This simplified version just returns the single connection.
   * @returns {Object} The Solana v2 RPC client
   */
  getConnection() {
    return this.connectionManager.getRpcClient();
  }
  
  /**
   * Execute a method on the Solana connection
   * @param {string} methodName - Name of the method to call
   * @param {...any} args - Arguments to pass to the method
   * @returns {Promise<any>} - Result of the method call
   */
  async executeConnectionMethod(methodName, ...args) {
    try {
      // Now calls the new method in connectionManager that maps v1 names to v2 calls
      return await this.connectionManager.executeSolanaRpcMethod(methodName, args);
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error(`Failed to execute method ${methodName}: ${error.message}`)}`);
      throw error;
    }
  }
  
  /**
   * Execute an RPC call with automatic retries
   * @param {Function} rpcCall - Function that takes a connection and returns a promise
   * @returns {Promise<any>} - Result of the RPC call
   */
  async executeRpc(rpcCall) {
    return this.connectionManager.executeRpc(rpcCall);
  }
  
  /**
   * Send a transaction to the Solana network (Fully Refactored for v2)
   * @param {Array<import('@solana/transaction-messages').SolanaInstruction>} instructions - Array of v2 SolanaInstruction objects.
   * @param {import('@solana/addresses').Address} feePayerAddress - The v2 Address string of the fee payer.
   * @param {Array<import('@solana/signers').Signer>} signers - Array of v2 Signer objects (e.g., KeyPairSigner).
   * @param {Object} options - Options for sending the transaction.
   * @param {string} [options.commitment='confirmed'] - Desired commitment level for blockhash and confirmation.
   * @param {boolean} [options.skipPreflight=false] - Whether to skip preflight checks.
   * @param {number} [options.maxRetries=0] - Max retries for sendTransaction itself (RPC level).
   * @param {number} [options.blockhashRetries=3] - Max retries for blockhash expiration (application level).
   * @param {boolean} [options.waitForConfirmation=true] - Whether to wait for confirmation.
   * @param {number} [options.confirmationTimeoutMs=60000] - Timeout for confirmation polling.
   * @param {number} [options.pollIntervalMs=2000] - Interval for polling signature status.
   * @returns {Promise<Object>} The result, including signature, blockhash info, and confirmationStatus.
   */
  async sendTransaction(instructions, feePayerAddress, signers, options = {}) {
    logApi.info(`${formatLog.tag()} ${formatLog.header('SENDING TRANSACTION (Full v2 Path)')}`);
    this.transactionStats.sent++;
    const rpc = this.connectionManager.getRpcClient();

    const blockhashRetries = options.blockhashRetries !== undefined ? options.blockhashRetries : 3;
    let attempt = 0;

    if (!instructions || instructions.length === 0) {
        throw new Error('Transaction must have at least one instruction.');
    }
    if (!feePayerAddress || !isAddress(feePayerAddress)) {
        throw new Error('Valid feePayerAddress (v2 Address string) is required.');
    }
    if (!signers || signers.length === 0) {
        throw new Error('At least one v2 Signer object (fee payer) is required.');
    }
    // Ensure feePayer is the first signer or is present in signers array for `signTransaction`
    // `signTransaction` expects signers in the order they appear in the message, or for feePayer to be explicitly handled.
    // For simplicity here, we'll assume the `signers` array is correctly ordered and includes the fee payer.

    while (attempt <= blockhashRetries) {
      try {
        // 1. Get Latest Blockhash
        const commitment = options.commitment || 'confirmed';
        const latestBlockhashResult = await rpc.getLatestBlockhash({ commitment }).send();
        const { blockhash, lastValidBlockHeight } = latestBlockhashResult.value;

        // 2. Create the v2 Transaction Message
        const message = createTransactionMessage({
          version: 0,
          payerKey: feePayerAddress,
          recentBlockhash: blockhash,
          instructions: instructions 
        });

        // 3. Sign the Transaction Message
        // `signTransaction` from `@solana/transactions` expects CryptoKeyPair-like objects or objects with a sign() method.
        // If signers are KeyPairSigner from `@solana/kit`, they have a .signTransactions method, 
        // but signTransaction from @solana/transactions expects CryptoKey[] or CryptoKeyPair[].
        // For now, assuming `signers` contains objects that `signTransaction` can use (e.g., from fromLegacyKeypair or new v2 keypairs).
        // This might need adjustment based on the actual structure of v2 Signer objects you intend to use.
        // If using KeyPairSigner from @solana/kit, a different signing approach might be needed or a helper to extract CryptoKeyPairs.
        // Let's assume for now `signers` are CryptoKeyPair[] as returned by `fromLegacyKeypair` for this step.
        const signedTx = await signTransaction(signers, message);

        // 4. Send the Transaction
        const signature = await rpc.sendTransaction(
          signedTx.serializedMessage, 
          {
            encoding: 'base64',
            skipPreflight: options.skipPreflight || false,
            preflightCommitment: commitment, // Use the same commitment for preflight
            maxRetries: options.maxRetries || 0, 
            minContextSlot: options.minContextSlot,
          }
        ).send();

        logApi.info(`${formatLog.tag()} ${formatLog.info('Transaction sent (Full v2 path)')} Signature: ${signature}`);

        // 5. Handle Confirmation
        if (options.waitForConfirmation !== false) {
            const confirmationStatus = await this.confirmTransaction(signature, blockhash, lastValidBlockHeight, options);
            return {
              signature,
              confirmationStatus,
              blockhash,
              lastValidBlockHeight
            };
        }

        return {
          signature,
          blockhash,
          lastValidBlockHeight,
          confirmationStatus: 'sent'
        };

      } catch (error) {
        logApi.warn(`${formatLog.tag()} Attempt ${attempt + 1}/${blockhashRetries + 1} failed for sendTransaction: ${error.message}`);
        if (error.message && (error.message.includes('blockhash not found') || error.message.includes('block height exceeded') || error.message.includes('Transaction too old'))) {
          if (attempt < blockhashRetries) {
            logApi.info(`${formatLog.tag()} Retrying due to blockhash issue...`);
            await new Promise(resolve => setTimeout(resolve, 1000 + (attempt * 500))); // Incremental backoff
            attempt++;
            continue; // Retry the while loop
          }
          logApi.error(`${formatLog.tag()} Max blockhash retries reached for transaction.`);
        }
        this.transactionStats.failed++;
        logApi.error(`${formatLog.tag()} ${formatLog.error('Full v2 Transaction send/sign failed permanently:')} ${error.message}`, { stack: error.stack });
        throw error; // Re-throw the last error after retries are exhausted or for non-blockhash errors
      }
    }
    // Should not be reached if blockhashRetries >= 0, as loop will either return or throw.
    // Added for safety if blockhashRetries is somehow negative.
    throw new Error('sendTransaction failed after all attempts.'); 
  }
  
  /**
   * Confirm a transaction (Refactored for v2)
   * @param {string} signature - The transaction signature
   * @param {string} blockhash - The blockhash used when sending the transaction
   * @param {number} lastValidBlockHeight - The last valid block height for the transaction
   * @param {Object} options - Options for confirming the transaction
   * @returns {Promise<string>} The confirmation status (e.g., 'processed', 'confirmed', 'finalized')
   */
  async confirmTransaction(signature, blockhash, lastValidBlockHeight, options = {}) {
    const rpc = this.connectionManager.getRpcClient();
    // Map v1 commitment to a hierarchy of v2 statuses for checking.
    // If desired is 'confirmed', 'finalized' also counts.
    // If desired is 'processed', 'confirmed' or 'finalized' also count.
    const desiredCommitment = options.commitment || 'confirmed'; 
    const pollIntervalMs = options.pollIntervalMs || 2000; 
    const confirmationTimeoutMs = options.confirmationTimeoutMs || 60000; 

    const startTime = Date.now();

    logApi.info(`${formatLog.tag()} Confirming transaction (v2 polling) ${signature.substring(0,10)}... with target commitment ${desiredCommitment}`);

    try {
      while (Date.now() - startTime < confirmationTimeoutMs) {
        const statusesResult = await rpc.getSignatureStatuses([signature], { searchTransactionHistory: true }).send();
        const statusInfo = statusesResult.value && statusesResult.value[0];

        if (statusInfo) {
          logApi.debug(`${formatLog.tag()} Sig ${signature.substring(0,10)}... Current Status: ${statusInfo.confirmationStatus}, Error: ${statusInfo.err}`);
          
          if (statusInfo.err) {
            logApi.error(`${formatLog.tag()} Transaction ${signature} confirmed with error:`, statusInfo.err);
            this.transactionStats.failed++;
            throw new Error(`Transaction failed on-chain: ${JSON.stringify(statusInfo.err)}`);
          }

          const currentStatus = statusInfo.confirmationStatus;
          let confirmed = false;
          if (currentStatus === 'finalized') {
            confirmed = true;
          } else if (currentStatus === 'confirmed' && (desiredCommitment === 'confirmed' || desiredCommitment === 'processed')) {
            confirmed = true;
          } else if (currentStatus === 'processed' && desiredCommitment === 'processed') {
            confirmed = true;
          }

          if (confirmed) {
            logApi.info(`${formatLog.tag()} Transaction ${signature} confirmed to status: ${currentStatus} (desired: ${desiredCommitment})`);
            this.transactionStats.confirmed++; 
            return currentStatus; 
          }
        }

        // Check if blockheight exceeded only if not yet confirmed to avoid race condition with very fast finalization
        const currentBlockHeight = await rpc.getBlockHeight({commitment: 'confirmed'}).send();
        if (currentBlockHeight > lastValidBlockHeight) {
          logApi.warn(`${formatLog.tag()} Transaction ${signature} expired. Current height ${currentBlockHeight} > lastValidBlockHeight ${lastValidBlockHeight}`);
          this.transactionStats.failed++;
          throw new Error('Transaction expired due to block height exceeded before reaching desired commitment');
        }

        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      }

      logApi.warn(`${formatLog.tag()} Timeout confirming transaction ${signature} to commitment ${desiredCommitment}`);
      this.transactionStats.failed++;
      throw new Error(`Timeout confirming transaction to ${desiredCommitment}`);

    } catch (error) {
      // Ensure failure is counted if error originates before this block, or is rethrown
      if (!error.message.includes('Transaction failed on-chain') && !error.message.includes('Transaction expired')) {
        this.transactionStats.failed++; 
      }
      logApi.error(`${formatLog.tag()} ${formatLog.error('Transaction confirmation process failed for signature')} ${signature}: ${error.message}`);
      throw error; 
    }
  }
  
  /**
   * Get the current SolanaEngine configuration from the database
   * @param {boolean} [includeStatus=false] - Whether to include connection status information
   * @returns {Promise<Object>} The current configuration
   */
  async getConfiguration(includeStatus = false) {
    try {
      const config = await prisma.config_solana_engine.findFirst();
      
      if (!config) {
        throw new Error('SolanaEngine configuration not found in database');
      }
      
      let result = { config };
      if (includeStatus) {
        result.status = this.connectionManager.getStatus();
      }
      
      return result;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error(`Failed to get configuration: ${error.message}`)}`);
      throw error;
    }
  }
  
  /**
   * Update the SolanaEngine configuration in the database
   * @param {Object} configUpdates - The configuration updates to apply
   * @param {string} adminAddress - The wallet address of the admin making the change
   * @returns {Promise<Object>} The updated configuration
   */
  async updateConfiguration(configUpdates, adminAddress) {
    try {
      // Get current config
      let config = await prisma.config_solana_engine.findFirst();
      
      if (!config) {
        throw new Error('SolanaEngine configuration not found in database');
      }
      
      // Update the configuration
      const updatedConfig = await prisma.config_solana_engine.update({
        where: { id: config.id },
        data: {
          ...configUpdates,
          updated_by: adminAddress,
          last_updated: new Date()
        }
      });
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Configuration updated by')} ${adminAddress}`);
      
      // A restart will be required to apply the new configuration
      logApi.warn(`${formatLog.tag()} ${formatLog.warning('Service restart required to apply new configuration')}`);
      
      return updatedConfig;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error(`Failed to update configuration: ${error.message}`)}`);
      throw error;
    }
  }
  
  /**
   * Start the SolanaEngine Service
   */
  async start() {
    try {
      if (this._initialized !== true) {
        await this.initialize();
      }
      
      logApi.info(`${formatLog.tag()} ${formatLog.header('STARTING')} SolanaEngine Service`);
      
      // Load tokens from database
      await this.loadWatchedTokens();
      
      // Set as running
      this.isStarted = true;
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('SolanaEngine Service started successfully')}`);
      return true;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to start SolanaEngine Service:')} ${error.message}`);
      this.isStarted = false;
      return false;
    }
  }

  /**
   * Stop the SolanaEngine Service
   */
  async stop() {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('STOPPING')} SolanaEngine Service`);
      
      // Unsubscribe from all tokens
      if (this.subscribedTokens.size > 0) {
        await jupiterClient.unsubscribeFromPrices(Array.from(this.subscribedTokens));
        this.subscribedTokens.clear();
      }
      
      // Set as not running
      this.isStarted = false;
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('SolanaEngine Service stopped successfully')}`);
      return true;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to stop SolanaEngine Service:')} ${error.message}`);
      return false;
    }
  }

  /**
   * Load cached tokens from Redis
   */
  async loadCachedTokens() {
    try {
      const cachedTokenList = await redisManager.get(this.redisKeys.tokenList);
      
      if (cachedTokenList) {
        const tokenList = JSON.parse(cachedTokenList);
        logApi.info(`${formatLog.tag()} ${formatLog.success('Loaded')} ${formatLog.count(tokenList.length)} tokens from cache`);
        
        // Subscribe to price updates for these tokens
        const tokenAddresses = tokenList.map(token => token.address);
        await this.subscribeToTokenPrices(tokenAddresses);
      } else {
        logApi.info(`${formatLog.tag()} ${formatLog.info('No cached tokens found')}`);
      }
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to load cached tokens:')} ${error.message}`);
    }
  }

  /**
   * Subscribe to price updates for specified tokens
   * @param {string[]} mintAddresses - Array of token mint addresses to subscribe to
   * @returns {boolean} - Success status
   */
  async subscribeToTokenPrices(mintAddresses) {
    try {
      // Filter out already subscribed tokens
      const newTokens = mintAddresses.filter(address => !this.subscribedTokens.has(address));
      
      if (newTokens.length === 0) {
        logApi.info(`${formatLog.tag()} ${formatLog.info('No new tokens to subscribe to')}`);
        return true;
      }
      
      logApi.info(`${formatLog.tag()} ${formatLog.header('SUBSCRIBING')} to prices for ${formatLog.count(newTokens.length)} tokens (via Jupiter client)`);
      // This delegates to jupiterClient.subscribeToPrices()
      
      // Subscribe to price updates via Jupiter
      const success = await jupiterClient.subscribeToPrices(newTokens);
      
      if (success) {
        // Add to our tracking set
        for (const address of newTokens) {
          this.subscribedTokens.add(address);
        }
        
        logApi.info(`${formatLog.tag()} ${formatLog.success('Successfully subscribed to')} ${formatLog.count(newTokens.length)} tokens`);
        return true;
      } else {
        logApi.warn(`${formatLog.tag()} ${formatLog.warning('Failed to subscribe to token prices')}`);
        return false;
      }
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to subscribe to token prices:')} ${error.message}`);
      return false;
    }
  }

  /**
   * Unsubscribe from price updates for specified tokens
   * @param {string[]} mintAddresses - Array of token mint addresses to unsubscribe from
   * @returns {boolean} - Success status
   */
  async unsubscribeFromTokenPrices(mintAddresses) {
    try {
      // Filter to only include tokens we're subscribed to
      const subscribedTokens = mintAddresses.filter(address => this.subscribedTokens.has(address));
      
      if (subscribedTokens.length === 0) {
        logApi.info(`${formatLog.tag()} ${formatLog.info('No tokens to unsubscribe from')}`);
        return true;
      }
      
      logApi.info(`${formatLog.tag()} ${formatLog.header('UNSUBSCRIBING')} from prices for ${formatLog.count(subscribedTokens.length)} tokens`);
      
      // Unsubscribe via Jupiter
      const success = await jupiterClient.unsubscribeFromPrices(subscribedTokens);
      
      if (success) {
        // Remove from our tracking set
        for (const address of subscribedTokens) {
          this.subscribedTokens.delete(address);
        }
        
        logApi.info(`${formatLog.tag()} ${formatLog.success('Successfully unsubscribed from')} ${formatLog.count(subscribedTokens.length)} tokens`);
        return true;
      } else {
        logApi.warn(`${formatLog.tag()} ${formatLog.warning('Failed to unsubscribe from token prices')}`);
        return false;
      }
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to unsubscribe from token prices:')} ${error.message}`);
      return false;
    }
  }

  /**
   * Load watched tokens and subscribe to price updates
   */
  async loadWatchedTokens() {
    try {
      // Get list of tokens to watch from the database
      const watchedTokens = await prisma.tokens.findMany({
        where: { is_active: true },
        select: { address: true }
      });
      
      const tokenAddresses = watchedTokens.map(token => token.address);
      
      if (tokenAddresses.length > 0) {
        // Subscribe to price updates for these tokens
        await this.subscribeToTokenPrices(tokenAddresses);
        logApi.info(`${formatLog.tag()} ${formatLog.success('Loaded')} ${formatLog.count(tokenAddresses.length)} tokens from database`);
      } else {
        logApi.info(`${formatLog.tag()} ${formatLog.info('No watched tokens found in database')}`);
      }
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to load watched tokens:')} ${error.message}`);
    }
  }

  /**
   * Handle price updates from Jupiter
   * @param {Object} priceData - Price data from Jupiter
   */
  async handlePriceUpdate(priceData) {
    try {
      const tokenCount = Object.keys(priceData).length;
      logApi.debug(`${formatLog.tag()} ${formatLog.info('Received price updates for')} ${formatLog.count(tokenCount)} tokens`);
      
      // Broadcast to WebSocket clients if connected
      if (this.wsServer) {
        this.wsServer.broadcastToTopic(this.wsTopics.tokenData, {
          type: 'price-update',
          data: priceData,
          timestamp: Date.now(),
        });
      }
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to handle price update:')} ${error.message}`);
    }
  }

  /**
   * Fetch token metadata and update cache
   * @param {string[]} mintAddresses - Array of token mint addresses
   * @returns {Object[]} - Array of token data objects
   */
  async fetchTokenMetadata(mintAddresses) {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('FETCHING')} metadata for ${formatLog.count(mintAddresses.length)} tokens`);
      
      // Get token metadata from Helius - no caching
      const tokenMetadata = await heliusClient.getTokensMetadata(mintAddresses);
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Successfully fetched metadata for')} ${formatLog.count(tokenMetadata.length)} tokens`);
      
      return tokenMetadata;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to fetch token metadata:')} ${error.message}`);
      throw error;
    }
  }

  /**
   * Fetch token prices and update cache
   * @param {string[]} mintAddresses - Array of token mint addresses
   * @returns {Object} - Map of token addresses to price data
   */
  async fetchTokenPrices(mintAddresses) {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('FETCHING')} prices for ${formatLog.count(mintAddresses.length)} tokens`);
      
      // Get token prices from Jupiter - no caching
      const tokenPrices = await jupiterClient.getPrices(mintAddresses);
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Successfully fetched prices for')} ${formatLog.count(Object.keys(tokenPrices).length)} tokens`);
      
      return tokenPrices;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to fetch token prices:')} ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Fetch token pools from DexScreener
   * @param {string[]} mintAddresses - Array of token mint addresses
   * @returns {Object} - Map of token addresses to pool data
   */
  async fetchTokenPools(mintAddresses) {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('FETCHING')} pools for ${formatLog.count(mintAddresses.length)} tokens from DexScreener`);
      
      // Get token pools from DexScreener
      const tokenPools = await dexscreenerClient.getMultipleTokenPools('solana', mintAddresses);
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Successfully fetched pools for')} ${formatLog.count(Object.keys(tokenPools).length)} tokens`);
      
      return tokenPools;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to fetch token pools:')} ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Fetch token profiles from DexScreener
   * @returns {Object} - Latest token profiles
   */
  async fetchTokenProfiles() {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('FETCHING')} token profiles from DexScreener`);
      
      // Get latest token profiles from DexScreener
      const tokenProfiles = await dexscreenerClient.getLatestTokenProfiles();
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Successfully fetched token profiles')}`);
      
      return tokenProfiles;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to fetch token profiles:')} ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Fetch pools for a specific pair search query
   * @param {string} query - Search query (e.g., "SOL/USDC")
   * @returns {Object} - Pair search results focused on Solana
   */
  async fetchPairsByQuery(query) {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('SEARCHING')} for pairs matching "${query}"`);
      
      // Search for pairs with the query
      const searchResults = await dexscreenerClient.searchPairs(query);
      
      // Filter results to focus on Solana pairs if there are any
      const allPairs = searchResults?.pairs || [];
      const solanaPairs = allPairs.filter(pair => pair.chainId === 'solana');
      
      // If we have Solana pairs, prioritize those, otherwise return all results
      const resultPairs = solanaPairs.length > 0 ? solanaPairs : allPairs;
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Found')} ${formatLog.count(resultPairs.length)} pairs matching "${query}" (${solanaPairs.length} on Solana)`);
      
      return {
        pairs: resultPairs,
        solanaOnly: solanaPairs.length > 0 && solanaPairs.length === resultPairs.length,
        totalResults: allPairs.length,
        solanaPairsCount: solanaPairs.length
      };
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to search for pairs:')} ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Fetch all pools for a token from DexScreener
   * @param {string} tokenAddress - Token address
   * @returns {Object} - All pools for the token on Solana
   */
  async fetchAllPoolsForToken(tokenAddress) {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('FETCHING')} all pools for token ${formatLog.token(tokenAddress)}`);
      
      // Always use 'solana' chain ID
      const chainId = 'solana';
      
      const pools = await dexscreenerClient.getTokenPools(chainId, tokenAddress);
      
      // Count active pools
      const activePools = pools?.pairs?.filter(pair => !pair.liquidity?.isInactive) || [];
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Found')} ${formatLog.count(activePools.length)} active pools for token ${formatLog.token(tokenAddress)}`);
      
      return {
        pools: pools?.pairs || [],
        activePools: activePools,
        activePoolsCount: activePools.length,
        totalPoolsCount: pools?.pairs?.length || 0
      };
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to fetch pools for token:')} ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Get all pools for a token on Solana
   * @param {string} tokenAddress - Token address on Solana
   * @returns {Object} - Pool data from DexScreener
   */
  async getSolanaPoolsForToken(tokenAddress) {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('FETCHING')} Solana pools for token ${formatLog.token(tokenAddress)}`);
      
      // This is the correct, direct method to get pools for a specific Solana token
      // DexScreener API: GET /token-pairs/v1/{chainId}/{tokenAddress} (300 req/min)
      const pools = await dexscreenerClient.getTokenPools('solana', tokenAddress);
      
      if (!pools || !pools.pairs) {
        logApi.warn(`${formatLog.tag()} ${formatLog.warning('No pools found for token')}`);
        return { 
          pairs: [],
          count: 0,
          activePairs: [],
          activeCount: 0
        };
      }
      
      // Get active pairs (not inactive)
      const activePairs = pools.pairs.filter(pair => !pair.liquidity?.isInactive);
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Found')} ${formatLog.count(pools.pairs.length)} pools for token ${formatLog.token(tokenAddress)} (${activePairs.length} active)`);
      
      return {
        pairs: pools.pairs,
        count: pools.pairs.length,
        activePairs: activePairs,
        activeCount: activePairs.length,
        tokenAddress
      };
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to fetch Solana pools for token:')} ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Get pools for multiple tokens on Solana
   * @param {string[]} tokenAddresses - Array of token addresses on Solana
   * @returns {Object} - Pool data by token address
   */
  async getMultipleTokenPools(tokenAddresses) {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('FETCHING')} pools for ${formatLog.count(tokenAddresses.length)} tokens on Solana`);
      
      // This leverages the client's built-in pooling for multiple tokens
      // Properly handles rate limits internally (300 req/min)
      const results = await dexscreenerClient.getMultipleTokenPools('solana', tokenAddresses);
      
      // Format and count the results
      let totalPools = 0;
      let totalActivePools = 0;
      const formattedResults = {};
      
      // Process each token's results
      for (const tokenAddress of tokenAddresses) {
        const tokenResult = results[tokenAddress];
        
        if (tokenResult && !tokenResult.error) {
          const pairs = tokenResult.pairs || [];
          const activePairs = pairs.filter(pair => !pair.liquidity?.isInactive);
          
          formattedResults[tokenAddress] = {
            pairs,
            count: pairs.length,
            activePairs,
            activeCount: activePairs.length
          };
          
          totalPools += pairs.length;
          totalActivePools += activePairs.length;
        } else {
          formattedResults[tokenAddress] = {
            pairs: [],
            count: 0,
            activePairs: [],
            activeCount: 0,
            error: tokenResult?.error || 'No data returned'
          };
        }
      }
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Found')} ${formatLog.count(totalPools)} total pools (${totalActivePools} active) across ${tokenAddresses.length} tokens`);
      
      return {
        results: formattedResults,
        totalPools,
        totalActivePools,
        tokenCount: tokenAddresses.length
      };
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to fetch multiple token pools:')} ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Search for pairs on DexScreener using a query - get only Solana results
   * @param {string} query - Search query (e.g., token symbol, name, or address)
   * @returns {Object} - Filtered Solana-only search results
   */
  async searchSolanaPairs(query) {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('SEARCHING')} for Solana pairs matching "${query}"`);
      
      // DexScreener API: GET /latest/dex/search?q={query} (300 req/min)
      const searchResults = await dexscreenerClient.searchPairs(query);
      
      if (!searchResults || !searchResults.pairs) {
        logApi.warn(`${formatLog.tag()} ${formatLog.warning('No search results for query')}`);
        return { 
          pairs: [],
          count: 0,
          totalResults: 0 
        };
      }
      
      // Filter to only include Solana pairs
      const solanaPairs = searchResults.pairs.filter(pair => pair.chainId === 'solana');
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Found')} ${formatLog.count(solanaPairs.length)} Solana pairs matching "${query}" out of ${searchResults.pairs.length} total results`);
      
      return {
        pairs: solanaPairs,
        count: solanaPairs.length,
        totalResults: searchResults.pairs.length,
        query
      };
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to search Solana pairs:')} ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Get detailed information about a specific pair on Solana
   * @param {string} pairAddress - Pair address/ID on Solana
   * @returns {Object} - Detailed pair information
   */
  async getSolanaPairDetails(pairAddress) {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('FETCHING')} details for Solana pair ${formatLog.token(pairAddress)}`);
      
      // DexScreener API: GET /latest/dex/pairs/{chainId}/{pairId} (300 req/min)
      const pairDetails = await dexscreenerClient.getPairDetails('solana', pairAddress);
      
      if (!pairDetails || !pairDetails.pairs || pairDetails.pairs.length === 0) {
        logApi.warn(`${formatLog.tag()} ${formatLog.warning('No details found for pair')}`);
        return null;
      }
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Successfully fetched details for Solana pair')}`);
      
      return pairDetails.pairs[0];
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to fetch Solana pair details:')} ${error.message}`);
      throw error;
    }
  }

  /**
   * Get complete token data (metadata + price) for specified tokens
   * @param {string[]} mintAddresses - Array of token mint addresses
   * @param {Object} options - Additional options
   * @param {boolean} options.includeDexscreenerData - Whether to include DexScreener pool data
   * @returns {Promise<Object[]>} - Array of complete token data objects
   */
  async getTokenData(mintAddresses, options = {}) {
    try {
      const includeDexscreenerData = options.includeDexscreenerData === true;
      
      logApi.info(`${formatLog.tag()} ${formatLog.header('GETTING')} data for ${formatLog.count(mintAddresses.length)} tokens${includeDexscreenerData ? ' (including DexScreener data)' : ''}`);
      
      // Set up all fetch operations - always get metadata and prices
      const fetchOperations = [
        this.fetchTokenMetadata(mintAddresses),
        this.fetchTokenPrices(mintAddresses)
      ];
      
      // Optionally add DexScreener pool data fetch
      if (includeDexscreenerData) {
        fetchOperations.push(this.fetchTokenPools(mintAddresses));
      }
      
      // Execute all fetch operations in parallel
      const fetchResults = await Promise.all(fetchOperations);
      
      // Extract results
      const metadata = fetchResults[0];
      const prices = fetchResults[1];
      const pools = includeDexscreenerData ? fetchResults[2] : null;
      
      // Create lookup map for metadata
      const metadataMap = metadata.reduce((map, token) => {
        if (token.mint) {
          map[token.mint] = token;
        }
        return map;
      }, {});
      
      // Combine all data
      const result = mintAddresses.map(address => {
        const tokenData = {
          address,
          metadata: metadataMap[address] || null,
          price: prices[address] || null,
          lastUpdated: Date.now()
        };
        
        // Add DexScreener data if available
        if (includeDexscreenerData && pools && pools[address]) {
          tokenData.dexscreener = pools[address];
        }
        
        return tokenData;
      });
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Fetched data for')} ${formatLog.count(result.length)} tokens`);
      
      return result;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to get token data:')} ${error.message}`);
      throw error;
    }
  }

  /**
   * Get token price using either pool data or Jupiter API
   * This method combines both real-time pool data and Jupiter API data,
   * providing the most accurate and up-to-date pricing available.
   * 
   * @param {string} mintAddress - The token mint address
   * @param {Object} [options] - Options for price fetching
   * @param {string} [options.source='auto'] - Where to get the price from: 'pools', 'jupiter', or 'auto' (try pools first)
   * @param {boolean} [options.fallback=true] - Whether to fall back to alternative source if primary fails
   * @param {boolean} [options.details=false] - Whether to return detailed price info or just the price
   * @returns {Promise<number|Object>} - Token price or detailed price info
   */
  async getTokenPrice(mintAddress, options = {}) {
    const { source = 'auto', fallback = true, details = false } = options;
    
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('FETCHING')} price for ${formatLog.token(mintAddress)} (source: ${source})`);
      
      let price = null;
      let priceDetails = null;
      let source1Success = false;
      
      // Try pool data first if source is 'auto' or 'pools'
      if (source === 'auto' || source === 'pools') {
        try {
          if (details) {
            priceDetails = await heliusPoolTracker.getTokenPriceWithConfidence(mintAddress);
            
            if (priceDetails) {
              price = priceDetails.price;
              source1Success = true;
              
              logApi.info(`${formatLog.tag()} ${formatLog.success('Got price from pool data:')} ${price} for ${formatLog.token(mintAddress)}`);
            }
          } else {
            price = await heliusPoolTracker.getTokenPrice(mintAddress);
            
            if (price !== null) {
              source1Success = true;
              
              logApi.info(`${formatLog.tag()} ${formatLog.success('Got price from pool data:')} ${price} for ${formatLog.token(mintAddress)}`);
            }
          }
        } catch (poolError) {
          logApi.warn(`${formatLog.tag()} ${formatLog.warning('Failed to get price from pool data:')} ${poolError.message}`);
        }
      }
      
      // Try Jupiter if needed (source is 'jupiter' or if pool data failed and fallback is true)
      if ((source === 'jupiter' || (source === 'auto' && !source1Success && fallback))) {
        try {
          const jupiterPriceData = await jupiterClient.getTokenPrice(mintAddress);
          
          if (jupiterPriceData) {
            price = jupiterPriceData.price || jupiterPriceData;
            
            if (details) {
              priceDetails = {
                price,
                source: 'jupiter',
                confidence: 0.8, // Jupiter is generally reliable
                lastUpdated: Date.now()
              };
            }
            
            logApi.info(`${formatLog.tag()} ${formatLog.success('Got price from Jupiter:')} ${price} for ${formatLog.token(mintAddress)}`);
          }
        } catch (jupiterError) {
          if (!source1Success) {
            logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to get price from any source for')} ${formatLog.token(mintAddress)}`);
            throw jupiterError;
          }
        }
      }
      
      // Return the result
      if (details) {
        return priceDetails || { price, source: source1Success ? 'pools' : 'jupiter', lastUpdated: Date.now() };
      } else {
        return price;
      }
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to get token price:')} ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Get token price from pools only
   * This is a direct method to get prices calculated from pool data,
   * without using any external API calls.
   * 
   * @param {string} mintAddress - The token mint address
   * @param {boolean} [details=false] - Whether to return detailed price info or just the price
   * @returns {Promise<number|Object>} - Token price or detailed price info
   */
  async getTokenPriceFromPools(mintAddress, details = false) {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('FETCHING')} price from pools for ${formatLog.token(mintAddress)}`);
      
      if (details) {
        const priceDetails = await heliusPoolTracker.getTokenPriceWithConfidence(mintAddress);
        
        if (!priceDetails) {
          throw new Error(`No pool data available for token ${mintAddress}`);
        }
        
        return priceDetails;
      } else {
        const price = await heliusPoolTracker.getTokenPrice(mintAddress);
        
        if (price === null) {
          throw new Error(`No pool data available for token ${mintAddress}`);
        }
        
        return price;
      }
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to get token price from pools:')} ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Get price history for a token
   * @param {string} mintAddress - Token mint address
   * @param {string} interval - Time interval (e.g., '1d', '7d', '30d')
   * @returns {Promise<Object>} - Price history data
   */
  async getTokenPriceHistory(mintAddress, interval = '7d') {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('FETCHING')} price history for ${formatLog.token(mintAddress)} over ${interval}`);
      
      const priceHistory = await jupiterClient.getPriceHistory(mintAddress, interval);
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Successfully fetched price history for')} ${formatLog.token(mintAddress)}`);
      
      return priceHistory;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to get token price history:')} ${error.message}`);
      throw error;
    }
  }

  /**
   * Get a quote for swapping between two tokens
   * @param {Object} params - Quote parameters
   * @returns {Promise<Object>} - Swap quote details
   */
  async getSwapQuote(params) {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('FETCHING')} swap quote from ${formatLog.token(params.inputMint)} to ${formatLog.token(params.outputMint)}`);
      
      const quote = await jupiterClient.getSwapQuote(params);
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Successfully fetched swap quote')}`);
      
      return quote;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to get swap quote:')} ${error.message}`);
      throw error;
    }
  }

  /**
   * Implements the onPerformOperation method required by BaseService
   * This gets called regularly by the BaseService to perform the service's main operation
   * and is used for circuit breaker recovery
   * @returns {Promise<boolean>} Success status
   */
  async onPerformOperation() {
    try {
      // Skip operation if service is not properly initialized or started
      if (!this.isOperational || !this._initialized) {
        logApi.debug(`${formatLog.tag()} Service not operational or initialized, skipping operation`);
        return true;
      }
      
      // Core operation: verify that connections to external services are working
      const connectionStatus = this.getConnectionStatus();
      
      // Check if any client is in error state
      if (connectionStatus.status === 'error') {
        logApi.warn(`${formatLog.tag()} ${formatLog.warning('Connection issue detected:')} ${connectionStatus.message}`);
      }
      
      // Check Solana Engine client
      const solanaEngineStatus = solanaEngine.isOperational();
      if (!solanaEngineStatus) {
        throw new Error('Solana Engine client is not operational');
      }

      // Check Jupiter client (most critical for price updates)
      const jupiterStatus = jupiterClient.isOperational();
      if (!jupiterStatus) {
        throw new Error('Jupiter client is not operational');
      }      
      
      // Check DexScreener client
      const dexscreenerStatus = dexscreenerClient.isOperational();
      if (!dexscreenerStatus) {
        throw new Error('DexScreener client is not operational');
      }

      // Check Helius main client
      const heliusClientStatus = heliusClient.isOperational();
      if (!heliusClientStatus) {
        throw new Error('Helius main client is not operational');
      }

      // Check Helius pool tracker client
      const heliusPoolTrackerStatus = heliusPoolTracker.isOperational();
      if (!heliusPoolTrackerStatus) {
        throw new Error('Helius pool tracker client is not operational');
      }

      // Check that we have at least some tokens subscribed
      if (this.subscribedTokens.size === 0 && this.isStarted) {
        logApi.warn(`${formatLog.tag()} ${formatLog.warning('No tokens subscribed for price updates')}`);
        // Try to reload tokens from database
        await this.loadWatchedTokens();
      }

      // Log health check every 30 seconds
      const now = Date.now();
      if (now - this._lastHealthLog > 30000) { // once every 30s max
        logApi.debug(`${formatLog.tag()} ${formatLog.success('Health check successful:')} Monitoring ${formatLog.count(this.subscribedTokens.size)} tokens`);
        this._lastHealthLog = now;
      }
      
      // Check Helius Kite connection
      if (!this.kiteConnection) {
        logApi.warn(`${formatLog.tag()} ${formatLog.warning('Helius Kite connection is not available during health check.')}`);
        // Optionally try to reinitialize kite connection here if it's critical for operation
      }
      
      // Return true to indicate success
      return true;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Perform operation error:')} ${error.message}`);
      throw error; // Important: re-throw to trigger circuit breaker
    }
  }
  
  /**
   * Handle WebSocket request
   * @param {Object} request - WebSocket request object
   * @param {Object} client - WebSocket client
   * @returns {Promise<Object>} - Response data
   */
  async handleWebSocketRequest(request, client) {
    try {
      const { action, params } = request;
      
      switch (action) {
        case 'getTokenData':
          return await this.getTokenData(params.mintAddresses, {
            includeDexscreenerData: params.includeDexscreenerData
          });
          
        case 'getTokenPriceHistory':
          return await this.getTokenPriceHistory(params.mintAddress, params.interval);
          
        case 'getSwapQuote':
          return await this.getSwapQuote(params);
          
        // DexScreener specific actions - Solana-focused
        case 'getSolanaPoolsForToken':
          return await this.getSolanaPoolsForToken(params.tokenAddress);
          
        case 'getMultipleTokenPools':
          return await this.getMultipleTokenPools(params.tokenAddresses);
          
        case 'searchSolanaPairs':
          return await this.searchSolanaPairs(params.query);
          
        case 'getSolanaPairDetails':
          return await this.getSolanaPairDetails(params.pairAddress);
          
        case 'getTokenProfiles':
          return await dexscreenerClient.getLatestTokenProfiles();
          
        case 'getOrdersByToken':
          // Always use 'solana' chain
          return await dexscreenerClient.getOrdersByToken('solana', params.tokenAddress);
          
        default:
          throw new Error(`Unknown action: ${action}`);
      }
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to handle WebSocket request:')} ${error.message}`);
      throw error;
    }
  }

  /**
   * Get the Helius Kite connection client.
   * @returns {object} The Helius Kite connection object.
   * @throws {Error} If SolanaEngine or Kite connection is not initialized.
   */
  getKiteConnection() {
    if (!this._initialized || !this.kiteConnection) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('getKiteConnection called but SolanaEngine or Kite is not initialized properly.')}`);
      throw new Error('Kite connection not available or SolanaEngine not initialized.');
    }
    return this.kiteConnection;
  }
}

// Create and export a singleton instance
export const solanaEngine = new SolanaEngineService();
export default solanaEngine;