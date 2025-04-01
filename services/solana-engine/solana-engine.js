// services/new-market-data/market-data-service.js

import { BaseService } from '../../utils/service-suite/base-service.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import { serviceColors, fancyColors } from '../../utils/colors.js';
import { heliusClient } from './helius-client.js';
import { jupiterClient } from './jupiter-client.js';
import { redisManager } from '../../utils/redis-suite/redis-manager.js';
import config from '../../config/config.js';
import { SERVICE_NAMES } from '../../utils/service-suite/service-constants.js';
import { Connection, PublicKey, Transaction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { ServiceError } from '../../utils/service-suite/service-error.js';
import connectionManager from './connection-manager.js';
import { PrismaClient } from '@prisma/client';

// Formatting helpers for consistent logging
const formatLog = {
  tag: () => `${serviceColors.solanaEngine.tag}[SolanaEngine]${fancyColors.RESET}`,
  header: (text) => `${serviceColors.solanaEngine.header} ${text} ${fancyColors.RESET}`,
  success: (text) => `${serviceColors.solanaEngine.success}${text}${fancyColors.RESET}`,
  warning: (text) => `${serviceColors.solanaEngine.warning}${text}${fancyColors.RESET}`,
  error: (text) => `${serviceColors.solanaEngine.error}${text}${fancyColors.RESET}`,
  info: (text) => `${serviceColors.solanaEngine.info}${text}${fancyColors.RESET}`,
  highlight: (text) => `${serviceColors.solanaEngine.highlight}${text}${fancyColors.RESET}`,
  token: (symbol) => `${serviceColors.solanaEngine.token}${symbol}${fancyColors.RESET}`,
  count: (num) => `${serviceColors.solanaEngine.count}${num}${fancyColors.RESET}`,
};

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
    super(SERVICE_NAMES.SOLANA_ENGINE);
    
    // Redis keys for caching data
    this.redisKeys = {
      tokenData: 'solana:token:data:', // Prefix for token data
      tokenList: 'solana:token:list',  // List of all known tokens
      lastSync: 'solana:last:sync',    // Timestamp of last sync
      walletTokens: 'solana:wallet:tokens:', // Prefix for wallet token data
      transactions: 'solana:transactions:', // Prefix for transaction data
    };
    
    // WebSocket topics for real-time data distribution
    this.wsTopics = {
      tokenData: config.websocket.topics.MARKET_DATA,
    };
    
    // Track subscribed tokens
    this.subscribedTokens = new Set();
    
    // Reference to the WebSocket server
    this.wsServer = null;
  }

  /**
   * Initialize the SolanaEngine Service
   */
  async initialize() {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('INITIALIZING')} SolanaEngine Service`);
      
      // Initialize ConnectionManager first (provides RPC access to other clients)
      const connectionManagerInitialized = await connectionManager.initialize();
      if (!connectionManagerInitialized) {
        logApi.warn(`${formatLog.tag()} ${formatLog.warning('ConnectionManager initialization failed')}`);
      }
      
      // Initialize Helius client
      const heliusInitialized = await heliusClient.initialize();
      if (!heliusInitialized) {
        logApi.warn(`${formatLog.tag()} ${formatLog.warning('Helius client initialization failed')}`);
      }
      
      // Initialize Jupiter client
      const jupiterInitialized = await jupiterClient.initialize();
      if (!jupiterInitialized) {
        logApi.warn(`${formatLog.tag()} ${formatLog.warning('Jupiter client initialization failed')}`);
      }
      
      // Set up Jupiter price update callback
      jupiterClient.onPriceUpdate((priceData) => {
        this.handlePriceUpdate(priceData);
      });
      
      // Get reference to the WebSocket server
      this.wsServer = config.websocket.unifiedWebSocket;
      
      // Track transaction stats
      this.transactionStats = {
        sent: 0,
        confirmed: 0,
        failed: 0,
        byEndpoint: {}
      };
      
      // Mark as initialized
      this.setInitialized(true);
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('SolanaEngine Service initialized successfully')}`);
      return true;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to initialize SolanaEngine Service:')} ${error.message}`);
      this.setInitialized(false);
      return false;
    }
  }
  
  // -----------------------------------------------------------------------------------
  // SOLANA CONNECTION METHODS - COMPATIBILITY WITH SOLANA SERVICE MANAGER
  // These methods provide a drop-in replacement for SolanaServiceManager
  // -----------------------------------------------------------------------------------
  
  /**
   * Get a Solana connection (compatible with SolanaServiceManager)
   * @returns {Connection} Solana web3.js Connection object
   */
  getConnection(options = {}) {
    // Get connection from manager with auto rotation
    const connInfo = connectionManager.getConnection(options);
    
    if (!connInfo || !connInfo.connection) {
      throw new ServiceError('solana_not_initialized', 'Solana connection not available');
    }
    
    return connInfo.connection;
  }
  
  /**
   * Get a connection explicitly specifying which endpoint to use
   * @param {string} endpointId - ID of the specific endpoint to use
   * @param {boolean} fallbackToRotation - Whether to fall back to rotation if endpoint is unhealthy
   * @returns {Connection} Solana web3.js Connection object
   */
  getSpecificConnection(endpointId, fallbackToRotation = true) {
    return this.getConnection({
      endpointId,
      fallbackToRotation
    });
  }
  
  /**
   * Execute a method on the Solana connection
   * @param {string} methodName - Name of the method to call
   * @param {...any} args - Arguments to pass to the method
   * @returns {Promise<any>} - Result of the method call
   */
  async executeConnectionMethod(methodName, ...args) {
    // Extract options if passed as last parameter
    const options = typeof args[args.length - 1] === 'object' && 
                  !Array.isArray(args[args.length - 1]) && 
                  !(args[args.length - 1] instanceof PublicKey) ? 
                  args.pop() : {};
    
    try {
      return await connectionManager.executeMethod(methodName, args, options);
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error(`Failed to execute method ${methodName}: ${error.message}`)}`);
      throw error;
    }
  }
  
  /**
   * Execute a custom RPC function with auto-rotation
   * @param {Function} rpcCall - Function that takes a connection and performs an RPC operation
   * @param {string} methodName - Name of the operation for logging
   * @param {Object} options - Options for execution
   * @returns {Promise<any>} - Result of the RPC call
   */
  async executeRpcRequest(rpcCall, methodName = 'custom', options = {}) {
    try {
      return await connectionManager.executeRpc(rpcCall, {
        ...options,
        methodName
      });
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error(`Failed to execute RPC request ${methodName}: ${error.message}`)}`);
      throw error;
    }
  }
  
  /**
   * Execute an RPC call with a specific endpoint
   * @param {string} endpointId - ID of the endpoint to use
   * @param {Function} rpcCall - Function that takes a connection and performs an RPC operation
   * @param {Object} options - Additional options
   * @returns {Promise<any>} - Result of the RPC call
   */
  async executeWithEndpoint(endpointId, rpcCall, options = {}) {
    return this.executeRpcRequest(rpcCall, options.methodName || 'custom-specific', {
      ...options,
      endpointId,
      fallbackToRotation: options.fallbackToRotation !== false
    });
  }
  
  /**
   * Send a transaction to the Solana blockchain
   * @param {Transaction|VersionedTransaction} transaction - The transaction to send
   * @param {Array} signers - Optional additional signers
   * @param {Object} options - Send options
   * @returns {Promise<string>} Transaction signature
   */
  async sendTransaction(transaction, signers = [], options = {}) {
    try {
      // Track transaction stats
      this.transactionStats.sent++;
      
      // Get preferred endpoint for transactions (if specified)
      const connInfo = options.endpointId ? 
        connectionManager.getConnection({ 
          endpointId: options.endpointId,
          fallbackToRotation: options.fallbackToRotation !== false
        }) : 
        connectionManager.getConnection({ 
          // Prefer endpoints with better performance for transactions
          preferLowLatency: true
        });
      
      // Increment endpoint-specific stats
      if (!this.transactionStats.byEndpoint[connInfo.id]) {
        this.transactionStats.byEndpoint[connInfo.id] = {
          sent: 0,
          confirmed: 0,
          failed: 0
        };
      }
      this.transactionStats.byEndpoint[connInfo.id].sent++;
      
      // Log transaction attempt
      logApi.info(`${formatLog.tag()} ${formatLog.header('SENDING TX')} via endpoint ${connInfo.id}`);
      
      // Different handling based on transaction type
      let signature;
      
      if (transaction instanceof VersionedTransaction) {
        // For versioned transactions, we don't need to add signatures
        signature = await connInfo.connection.sendTransaction(transaction, options);
      } else {
        // For legacy transactions, we need to add signatures if provided
        if (signers && signers.length > 0) {
          transaction.sign(...signers);
        }
        
        // Send with specified options
        signature = await connInfo.connection.sendTransaction(transaction, options);
      }
      
      // Log success
      logApi.info(`${formatLog.tag()} ${formatLog.success(`Transaction sent successfully: ${signature}`)}`);
      
      // If confirmation is requested, wait for confirmation
      if (options.skipConfirmation !== true) {
        const confirmOptions = {
          commitment: options.commitment || 'confirmed',
          maxRetries: options.maxRetries
        };
        
        try {
          // Wait for confirmation
          await connInfo.connection.confirmTransaction(signature, confirmOptions.commitment);
          
          // Update stats
          this.transactionStats.confirmed++;
          this.transactionStats.byEndpoint[connInfo.id].confirmed++;
          
          logApi.info(`${formatLog.tag()} ${formatLog.success(`Transaction confirmed: ${signature}`)}`);
        } catch (confirmError) {
          // Update stats
          this.transactionStats.failed++;
          this.transactionStats.byEndpoint[connInfo.id].failed++;
          
          logApi.error(`${formatLog.tag()} ${formatLog.error(`Transaction confirmation failed: ${confirmError.message}`)}`);
          
          // Rethrow with clear message
          throw new Error(`Transaction sent but confirmation failed: ${confirmError.message}`);
        }
      }
      
      return signature;
    } catch (error) {
      // Update stats
      this.transactionStats.failed++;
      
      logApi.error(`${formatLog.tag()} ${formatLog.error(`Failed to send transaction: ${error.message}`)}`);
      throw error;
    }
  }
  
  /**
   * Get the status of all RPC connections
   * @returns {Object} Status of all connections
   */
  getConnectionStatus() {
    return connectionManager.getStatus();
  }
  
  /**
   * Get the current SolanaEngine configuration from the database
   * @param {boolean} [includeStatus=false] - Whether to include connection status information
   * @returns {Promise<Object>} The current configuration
   */
  async getConfiguration(includeStatus = false) {
    try {
      const prisma = new PrismaClient();
      const config = await prisma.config_solana_engine.findFirst();
      
      if (!config) {
        throw new Error('SolanaEngine configuration not found in database');
      }
      
      // Include connection status if requested
      let result = { config };
      if (includeStatus) {
        result.status = connectionManager.getStatus();
      }
      
      await prisma.$disconnect();
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
      const prisma = new PrismaClient();
      
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
      
      await prisma.$disconnect();
      return updatedConfig;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error(`Failed to update configuration: ${error.message}`)}`);
      throw error;
    }
  }
  
  /**
   * Clear the cache for specific tokens or all tokens
   * @param {string[]} [mintAddresses=[]] - The token mint addresses to clear cache for (empty = all)
   * @returns {Promise<Object>} Result of the cache clearing operation
   */
  async clearCache(mintAddresses = []) {
    try {
      const result = {
        clearedTokenCount: 0,
        clearedPriceCount: 0
      };
      
      if (mintAddresses.length === 0) {
        // Clear all token cache
        const metadataKeys = await redisManager.keys(`${this.redisKeys.tokenData}*`);
        for (const key of metadataKeys) {
          await redisManager.del(key);
          result.clearedTokenCount++;
        }
        
        // Clear all price cache
        const priceKeys = await redisManager.keys(`helius:token:*`);
        const jupiterKeys = await redisManager.keys(`jupiter:token:*`);
        
        for (const key of [...priceKeys, ...jupiterKeys]) {
          await redisManager.del(key);
          result.clearedPriceCount++;
        }
        
        logApi.info(`${formatLog.tag()} ${formatLog.success(`Cleared all token caches (${result.clearedTokenCount} metadata, ${result.clearedPriceCount} prices)`)}`);
      } else {
        // Clear specific token caches
        for (const mintAddress of mintAddresses) {
          // Clear from SolanaEngine cache
          await redisManager.del(`${this.redisKeys.tokenData}${mintAddress}`);
          result.clearedTokenCount++;
          
          // Clear from Helius cache
          await redisManager.del(`helius:token:metadata:${mintAddress}`);
          
          // Clear from Jupiter cache
          await redisManager.del(`jupiter:token:prices:${mintAddress}`);
          result.clearedPriceCount++;
        }
        
        logApi.info(`${formatLog.tag()} ${formatLog.success(`Cleared cache for ${mintAddresses.length} tokens`)}`);
      }
      
      return result;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error(`Failed to clear cache: ${error.message}`)}`);
      throw error;
    }
  }

  /**
   * Start the SolanaEngine Service
   */
  async start() {
    try {
      if (!this.isInitialized()) {
        await this.initialize();
      }
      
      logApi.info(`${formatLog.tag()} ${formatLog.header('STARTING')} SolanaEngine Service`);
      
      // Load tokens from Redis if available
      await this.loadCachedTokens();
      
      // Set as running
      this.setRunning(true);
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('SolanaEngine Service started successfully')}`);
      return true;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to start SolanaEngine Service:')} ${error.message}`);
      this.setRunning(false);
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
      this.setRunning(false);
      
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
      
      logApi.info(`${formatLog.tag()} ${formatLog.header('SUBSCRIBING')} to prices for ${formatLog.count(newTokens.length)} tokens`);
      
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
   * Handle price updates from Jupiter
   * @param {Object} priceData - Price data from Jupiter
   */
  async handlePriceUpdate(priceData) {
    try {
      const tokenCount = Object.keys(priceData).length;
      logApi.debug(`${formatLog.tag()} ${formatLog.info('Received price updates for')} ${formatLog.count(tokenCount)} tokens`);
      
      // Update Redis cache with the latest combined data
      for (const [mintAddress, priceInfo] of Object.entries(priceData)) {
        const existingData = await redisManager.get(`${this.redisKeys.tokenData}${mintAddress}`);
        let tokenData = existingData ? JSON.parse(existingData) : { address: mintAddress };
        
        // Update price data
        tokenData.price = priceInfo;
        tokenData.lastUpdated = Date.now();
        
        // Save to Redis
        await redisManager.set(
          `${this.redisKeys.tokenData}${mintAddress}`, 
          JSON.stringify(tokenData), 
          60 * 60 // 1 hour
        );
      }
      
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
      
      // Get token metadata from Helius
      const tokenMetadata = await heliusClient.getTokensMetadata(mintAddresses);
      
      // For each token, update our combined data store
      for (const metadata of tokenMetadata) {
        const mintAddress = metadata.mint;
        
        const existingData = await redisManager.get(`${this.redisKeys.tokenData}${mintAddress}`);
        let tokenData = existingData ? JSON.parse(existingData) : { address: mintAddress };
        
        // Update metadata
        tokenData.metadata = metadata;
        tokenData.lastUpdated = Date.now();
        
        // Save to Redis
        await redisManager.set(
          `${this.redisKeys.tokenData}${mintAddress}`, 
          JSON.stringify(tokenData), 
          60 * 60 * 24 // 24 hours
        );
      }
      
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
      
      // Get token prices from Jupiter
      const tokenPrices = await jupiterClient.getPrices(mintAddresses);
      
      // For each token, update our combined data store
      for (const [mintAddress, priceInfo] of Object.entries(tokenPrices)) {
        const existingData = await redisManager.get(`${this.redisKeys.tokenData}${mintAddress}`);
        let tokenData = existingData ? JSON.parse(existingData) : { address: mintAddress };
        
        // Update price data
        tokenData.price = priceInfo;
        tokenData.lastUpdated = Date.now();
        
        // Save to Redis
        await redisManager.set(
          `${this.redisKeys.tokenData}${mintAddress}`, 
          JSON.stringify(tokenData), 
          60 * 60 // 1 hour
        );
      }
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Successfully fetched prices for')} ${formatLog.count(Object.keys(tokenPrices).length)} tokens`);
      
      return tokenPrices;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to fetch token prices:')} ${error.message}`);
      throw error;
    }
  }

  /**
   * Get complete token data (metadata + price) for specified tokens
   * @param {string[]} mintAddresses - Array of token mint addresses
   * @returns {Promise<Object[]>} - Array of complete token data objects
   */
  async getTokenData(mintAddresses) {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('GETTING')} data for ${formatLog.count(mintAddresses.length)} tokens`);
      
      const result = [];
      const missingTokens = [];
      
      // Check which tokens we already have in cache
      for (const mintAddress of mintAddresses) {
        const cachedData = await redisManager.get(`${this.redisKeys.tokenData}${mintAddress}`);
        
        if (cachedData) {
          const tokenData = JSON.parse(cachedData);
          result.push(tokenData);
        } else {
          missingTokens.push(mintAddress);
          result.push({ address: mintAddress, pending: true });
        }
      }
      
      // If we have missing tokens, fetch their data asynchronously
      if (missingTokens.length > 0) {
        logApi.info(`${formatLog.tag()} ${formatLog.info('Fetching data for')} ${formatLog.count(missingTokens.length)} missing tokens`);
        
        // Start async fetches - don't await these since we want to return quickly
        this.fetchTokenMetadata(missingTokens).catch(error => {
          logApi.error(`${formatLog.tag()} ${formatLog.error('Async metadata fetch failed:')} ${error.message}`);
        });
        
        this.fetchTokenPrices(missingTokens).catch(error => {
          logApi.error(`${formatLog.tag()} ${formatLog.error('Async price fetch failed:')} ${error.message}`);
        });
      }
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Returning data for')} ${formatLog.count(result.length)} tokens (${formatLog.count(missingTokens.length)} being fetched asynchronously)`);
      
      return result;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to get token data:')} ${error.message}`);
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
          return await this.getTokenData(params.mintAddresses);
          
        case 'getTokenPriceHistory':
          return await this.getTokenPriceHistory(params.mintAddress, params.interval);
          
        case 'getSwapQuote':
          return await this.getSwapQuote(params);
          
        default:
          throw new Error(`Unknown action: ${action}`);
      }
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to handle WebSocket request:')} ${error.message}`);
      throw error;
    }
  }
}

// Create and export a singleton instance
export const solanaEngine = new SolanaEngineService();
export default solanaEngine;