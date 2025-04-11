// services/solana-engine/helius-client.js

import axios from 'axios';
import WebSocket from 'ws';
import { logApi } from '../../utils/logger-suite/logger.js';
import { serviceSpecificColors, fancyColors } from '../../utils/colors.js';
import { heliusConfig } from '../../config/external-api/helius-config.js';
import redisManager from '../../utils/redis-suite/redis-manager.js';

// Formatting helpers for consistent logging
const formatLog = {
  tag: () => `${serviceSpecificColors.heliusClient.tag}[heliusClient]${fancyColors.RESET}`,
  header: (text) => `${serviceSpecificColors.heliusClient.header} ${text} ${fancyColors.RESET}`,
  success: (text) => `${serviceSpecificColors.heliusClient.success}${text}${fancyColors.RESET}`,
  warning: (text) => `${serviceSpecificColors.heliusClient.warning}${text}${fancyColors.RESET}`,
  error: (text) => `${serviceSpecificColors.heliusClient.error}${text}${fancyColors.RESET}`,
  info: (text) => `${serviceSpecificColors.heliusClient.info}${text}${fancyColors.RESET}`,
  highlight: (text) => `${serviceSpecificColors.heliusClient.highlight}${text}${fancyColors.RESET}`,
  token: (symbol) => `${serviceSpecificColors.heliusClient.token}${symbol}${fancyColors.RESET}`,
  address: (addr) => `${serviceSpecificColors.heliusClient.address}${addr}${fancyColors.RESET}`,
  count: (num) => `${serviceSpecificColors.heliusClient.count}${num}${fancyColors.RESET}`,
};

// Default token metadata cache TTL (24 hours)
const DEFAULT_TOKEN_METADATA_TTL = 60 * 60 * 24;

/**
 * Base class for Helius API modules
 */
class HeliusBase {
  constructor(config, redisKeyPrefix) {
    this.config = config;
    this.redisKeyPrefix = redisKeyPrefix || 'helius:';
  }

  /**
   * Fetch data from Helius RPC with proper error handling
   * @param {string} method - RPC method name
   * @param {Array} params - Method parameters
   * @returns {Promise<any>} - Response data
   */
  async fetchFromHeliusRPC(method, params) {
    try {
      const response = await axios.post(this.config.rpcUrl, {
        jsonrpc: '2.0',
        id: 'helius-client',
        method,
        params,
      }, {
        timeout: 15000 // 15 second timeout
      });
      
      if (!response.data || response.data.error) {
        throw new Error(response.data?.error?.message || 'Invalid response from Helius API');
      }
      
      return response.data.result;
    } catch (error) {
      const errorMessage = error.response?.data?.error?.message || error.message;
      logApi.error(`${formatLog.tag()} ${formatLog.error(`Failed to fetch from Helius RPC (${method}):`)} ${errorMessage}`);
      throw error;
    }
  }
}

/**
 * WebSocket connection management module
 */
class HeliusWebSocketManager extends HeliusBase {
  constructor(config) {
    super(config);
    this.wsClient = null;
    this.wsConnected = false;
    this.reconnectAttempts = 0;
    this.totalReconnections = 0;
    this.pendingRequests = new Map();
    this.requestTimeouts = new Map();
    this.requestId = 1;
    this.lastConnectionTime = null;
  }

  /**
   * Initialize WebSocket connection to Helius
   */
  initialize() {
    try {
      if (!this.config.websocket.url) {
        logApi.warn(`${formatLog.tag()} ${formatLog.warning('WebSocket URL not configured for Helius')}`);
        return;
      }

      logApi.info(`${formatLog.tag()} ${formatLog.header('CONNECTING')} to Helius WebSocket (reconnection #${this.totalReconnections})`);
      
      this.wsClient = new WebSocket(this.config.websocket.url);
      
      this.wsClient.on('open', () => {
        this.wsConnected = true;
        this.reconnectAttempts = 0;
        this.lastConnectionTime = new Date();
        logApi.info(`${formatLog.tag()} ${formatLog.success('Connected to Helius WebSocket')} (total reconnections: ${this.totalReconnections}, last connected: ${this.lastConnectionTime.toISOString()})`);
      });
      
      this.wsClient.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          this.handleWebSocketMessage(message);
        } catch (error) {
          logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to parse WebSocket message:')} ${error.message}`);
        }
      });
      
      this.wsClient.on('error', (error) => {
        logApi.error(`${formatLog.tag()} ${formatLog.error('WebSocket error:')} ${error.message}`);
      });
      
      this.wsClient.on('close', () => {
        this.wsConnected = false;
        logApi.warn(`${formatLog.tag()} ${formatLog.warning('Disconnected from Helius WebSocket')}`);
        
        // Attempt to reconnect with exponential backoff
        if (this.reconnectAttempts < this.config.websocket.maxReconnectAttempts) {
          const reconnectDelay = this.config.websocket.reconnectInterval * Math.pow(2, this.reconnectAttempts);
          this.reconnectAttempts++;
          this.totalReconnections++; // Increment total reconnections counter
          
          logApi.info(`${formatLog.tag()} ${formatLog.info(`Reconnecting in ${reconnectDelay / 1000}s (attempt ${this.reconnectAttempts}/${this.config.websocket.maxReconnectAttempts}, total reconnections: ${this.totalReconnections})`)}`);
          
          setTimeout(() => {
            this.initialize();
          }, reconnectDelay);
        } else {
          logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to reconnect to Helius WebSocket after maximum attempts')} (total reconnections attempted: ${this.totalReconnections})`);
        }
      });
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to initialize Helius WebSocket:')} ${error.message}`);
    }
  }

  /**
   * Handle incoming WebSocket messages
   * @param {Object} message - The message received from WebSocket
   */
  handleWebSocketMessage(message) {
    // Check if this is a response to a pending request
    if (message.id && this.pendingRequests.has(message.id)) {
      const { resolve, reject } = this.pendingRequests.get(message.id);
      this.pendingRequests.delete(message.id);
      
      // Clear the timeout for this request
      if (this.requestTimeouts.has(message.id)) {
        clearTimeout(this.requestTimeouts.get(message.id));
        this.requestTimeouts.delete(message.id);
      }
      
      if (message.error) {
        reject(new Error(message.error.message || 'Unknown error'));
      } else {
        resolve(message.result);
      }
    } else if (message.method === 'accountNotification' || message.method === 'logsNotification') {
      // Handle SPL token transfer notifications
      this.handleTokenTransferNotification(message);
    } else {
      // Handle other subscription updates
      logApi.debug(`${formatLog.tag()} ${formatLog.info('Received WebSocket message:')} ${JSON.stringify(message)}`);
    }
  }
  
  /**
   * Handle token transfer notifications from WebSocket
   * @param {Object} message - The subscription notification message
   */
  handleTokenTransferNotification(message) {
    try {
      if (!message.params || !message.params.result) {
        return;
      }
      
      const { signature, value } = message.params.result;
      
      // Process logs notification (transaction logs)
      if (message.method === 'logsNotification') {
        const logs = value.logs;
        
        if (!logs || !Array.isArray(logs)) {
          return;
        }
        
        // Check for SPL token transfer logs
        const tokenTransferInfo = this.parseTokenTransferLogs(logs, signature);
        
        if (tokenTransferInfo) {
          // Emit token transfer event
          logApi.info(`${formatLog.tag()} ${formatLog.success('Detected token transfer:')} ${formatLog.token(tokenTransferInfo.tokenAddress)} - ${formatLog.count(tokenTransferInfo.amount)} ${tokenTransferInfo.type === 'buy' ? 'purchased' : 'sold'}`);
          
          // Emit events based on transfer type
          this.emitTokenTransferEvent(tokenTransferInfo);
        }
      }
      
      // Process account notification (account data changes)
      else if (message.method === 'accountNotification') {
        // Handle account updates if needed
        // This could be used to track token account balance changes
      }
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Error handling token transfer notification:')} ${error.message}`);
    }
  }
  
  /**
   * Parse transaction logs to detect token transfers
   * @param {string[]} logs - Transaction logs
   * @param {string} signature - Transaction signature
   * @returns {Object|null} - Token transfer information or null if not a relevant transfer
   */
  parseTokenTransferLogs(logs, signature) {
    try {
      // Look for SPL token transfer logs
      // Example: "Program log: Instruction: Transfer"
      // Example: "Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke"
      
      const hasTokenProgram = logs.some(log => 
        log.includes('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
      );
      
      const hasTransferInstruction = logs.some(log => 
        log.includes('Instruction: Transfer')
      );
      
      // Check if this is a token transfer
      if (!hasTokenProgram || !hasTransferInstruction) {
        return null;
      }
      
      // Try to extract token address, amount, from/to addresses
      // This is a simplified parser and may need enhancement for complex transactions
      let tokenAddress = null;
      let fromAddress = null;
      let toAddress = null;
      let amount = 0;
      
      // Look for token mint account
      for (const log of logs) {
        // Extract mint account from logs if possible
        if (log.includes('mint:')) {
          const mintMatch = log.match(/mint: ([A-Za-z0-9]{32,44})/);
          if (mintMatch && mintMatch[1]) {
            tokenAddress = mintMatch[1];
          }
        }
        
        // Try to extract from/to accounts
        if (log.includes('source:')) {
          const sourceMatch = log.match(/source: ([A-Za-z0-9]{32,44})/);
          if (sourceMatch && sourceMatch[1]) {
            fromAddress = sourceMatch[1];
          }
        }
        
        if (log.includes('destination:')) {
          const destMatch = log.match(/destination: ([A-Za-z0-9]{32,44})/);
          if (destMatch && destMatch[1]) {
            toAddress = destMatch[1];
          }
        }
        
        // Try to extract amount
        if (log.includes('amount:')) {
          const amountMatch = log.match(/amount: (\d+)/);
          if (amountMatch && amountMatch[1]) {
            amount = parseInt(amountMatch[1], 10);
          }
        }
      }
      
      // If we couldn't extract basic info, return null
      if (!tokenAddress || (!fromAddress && !toAddress)) {
        return null;
      }
      
      // Determine if this is a buy or sell (simplified for now)
      // This is a rudimentary determination and will need refinement
      // A more sophisticated approach would analyze the full transaction
      const type = fromAddress && toAddress ? 'transfer' : (fromAddress ? 'sell' : 'buy');
      
      return {
        tokenAddress,
        fromAddress,
        toAddress,
        amount,
        type,
        signature,
        timestamp: Date.now()
      };
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Error parsing token transfer logs:')} ${error.message}`);
      return null;
    }
  }
  
  /**
   * Emit token transfer event
   * @param {Object} transferInfo - Token transfer information
   */
  emitTokenTransferEvent(transferInfo) {
    // This will be called by the WebSocket handler when a token transfer is detected
    // Extend HeliusClient to handle this event (see methods at bottom of class)
    if (this.heliusClient && this.heliusClient.tokenTransferHandlers && this.heliusClient.tokenTransferHandlers.length > 0) {
      this.heliusClient.tokenTransferHandlers.forEach(handler => {
        try {
          handler(transferInfo);
        } catch (error) {
          logApi.error(`${formatLog.tag()} ${formatLog.error('Error in token transfer handler:')} ${error.message}`);
        }
      });
    }
  }

  /**
   * Send a request through the WebSocket connection
   * @param {string} method - The RPC method to call
   * @param {Array} params - The parameters for the RPC method
   * @param {number} timeout - Timeout in milliseconds
   * @returns {Promise<any>} - The response from the RPC call
   */
  async sendWebSocketRequest(method, params = [], timeout = 30000) {
    if (!this.wsConnected) {
      throw new Error('WebSocket not connected');
    }
    
    const id = this.requestId++;
    const request = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };
    
    return new Promise((resolve, reject) => {
      // Store the promise callbacks
      this.pendingRequests.set(id, { resolve, reject });
      
      // Set a timeout for this request
      const timeoutId = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timed out after ${timeout}ms`));
        }
      }, timeout);
      
      this.requestTimeouts.set(id, timeoutId);
      
      // Send the request
      this.wsClient.send(JSON.stringify(request));
    });
  }

  /**
   * Get WebSocket connection stats
   * @returns {Object} - Connection statistics
   */
  getConnectionStats() {
    return {
      connected: this.wsConnected,
      totalReconnections: this.totalReconnections,
      currentReconnectAttempt: this.reconnectAttempts,
      maxReconnectAttempts: this.config.websocket.maxReconnectAttempts,
      lastConnectionTime: this.lastConnectionTime ? this.lastConnectionTime.toISOString() : null,
      connectionDuration: this.lastConnectionTime && this.wsConnected ? 
        Math.floor((Date.now() - this.lastConnectionTime.getTime()) / 1000) : 0,
      apiKey: !!this.config.apiKey
    };
  }
}

/**
 * Token services module - handles token metadata and operations
 */
class TokenService extends HeliusBase {
  constructor(config) {
    super(config, 'helius:token:');
    
    // Set up Redis keys for token metadata
    this.redisKeys = {
      tokenMetadata: 'helius:token:metadata:',  // Prefix for token metadata
      tokenList: 'helius:token:list',           // List of all tokens
      lastUpdate: 'helius:token:last:update',   // Timestamp of last update
    };
  }

  /**
   * Get token metadata for a list of mint addresses
   * @param {string[]} mintAddresses - Array of token mint addresses
   * @returns {Promise<Object[]>} - Array of token metadata objects
   */
  async getTokensMetadata(mintAddresses) {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('FETCHING')} metadata for ${mintAddresses.length} tokens`);
      
      // Fetch tokens directly from Helius - no caching
      let fetchedTokens = [];
      
      try {
        // Use getAssetBatch for bulk processing - this is the proper method per Helius docs
        // https://github.com/helius-labs/helius-sdk
        // Process in batches of 100 to avoid request size limitations
        const BATCH_SIZE = 100;
        const batches = [];
        
        // Split into batches
        for (let i = 0; i < mintAddresses.length; i += BATCH_SIZE) {
          batches.push(mintAddresses.slice(i, i + BATCH_SIZE));
        }
        
        // Process each batch
        const batchResults = [];
        for (let i = 0; i < batches.length; i++) {
          const batch = batches[i];
          try {
            logApi.info(`${formatLog.tag()} ${formatLog.info(`Processing batch ${i+1}/${batches.length} (${batch.length} tokens)`)}`);
            // Use getAssetBatch if available, otherwise fall back to individual getAsset calls
            try {
              const batchData = await this.fetchFromHeliusRPC('getAssetBatch', [batch]);
              batchResults.push(...batchData.map(asset => this.mapAssetToTokenMetadata(asset)));
            } catch (batchError) {
              logApi.warn(`${formatLog.tag()} ${formatLog.warning('getAssetBatch method failed, trying individual getAsset calls:')} ${batchError.message}`);
              
              // Fall back to individual getAsset calls
              const individualResults = await Promise.all(batch.map(async (mintAddress) => {
                try {
                  const assetData = await this.fetchFromHeliusRPC('getAsset', [mintAddress]);
                  return this.mapAssetToTokenMetadata(assetData);
                } catch (assetError) {
                  logApi.debug(`${formatLog.tag()} ${formatLog.warning(`getAsset failed for token ${mintAddress}:`)} ${assetError.message}`);
                  return { mint: mintAddress };
                }
              }));
              
              batchResults.push(...individualResults);
            }
          } catch (error) {
            logApi.warn(`${formatLog.tag()} ${formatLog.warning(`Error processing batch ${i+1}/${batches.length}:`)} ${error.message}`);
            // Add minimal objects for failed batch
            batchResults.push(...batch.map(mint => ({ mint })));
          }
          
          // Add a small delay between batches to avoid rate limiting
          if (i < batches.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
        
        fetchedTokens = batchResults;
      } catch (error) {
        logApi.error(`${formatLog.tag()} ${formatLog.error('All metadata methods failed:')} ${error.message}`);
        // Return minimal objects as last resort
        fetchedTokens = mintAddresses.map(mint => ({ mint }));
      }
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Successfully fetched metadata for')} ${formatLog.count(fetchedTokens.length)} tokens`);
      
      return fetchedTokens;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to fetch token metadata:')} ${error.message}`);
      return mintAddresses.map(mint => ({ mint }));
    }
  }

  /**
   * Convert getAsset response to token metadata format
   * @param {Object} assetData - Response from getAsset
   * @returns {Object} - Converted token metadata
   */
  mapAssetToTokenMetadata(assetData) {
    if (!assetData) return null;
    
    return {
      mint: assetData.id,
      name: assetData.content?.metadata?.name || '',
      symbol: assetData.content?.metadata?.symbol || '',
      decimals: assetData.content?.metadata?.decimals || 0,
      logoURI: assetData.content?.files?.[0]?.uri || null,
      uri: assetData.content?.json_uri || null,
      metadata: {
        name: assetData.content?.metadata?.name || '',
        symbol: assetData.content?.metadata?.symbol || '',
        description: assetData.content?.metadata?.description || '',
        image: assetData.content?.files?.[0]?.uri || null,
      }
    };
  }

  /**
   * Get token accounts for a specific mint or owner
   * @param {Object} params - Parameters for the request
   * @param {string} [params.mint] - Mint address to get token accounts for
   * @param {string} [params.owner] - Owner address to get token accounts for
   * @returns {Promise<Object>} - Token account information
   */
  async getTokenAccounts(params) {
    try {
      if (!params.mint && !params.owner) {
        throw new Error('Either mint or owner parameter is required');
      }

      const searchParam = params.mint ? { mint: params.mint } : { owner: params.owner };
      logApi.info(`${formatLog.tag()} ${formatLog.header('FETCHING')} token accounts for ${params.mint ? 'mint' : 'owner'}: ${formatLog.address(params.mint || params.owner)}`);
      
      const result = await this.fetchFromHeliusRPC('getTokenAccounts', [searchParam]);
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Successfully fetched')} ${formatLog.count(result.tokens?.length || 0)} token accounts`);
      
      return result;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to fetch token accounts:')} ${error.message}`);
      throw error;
    }
  }

  /**
   * Get assets (tokens/NFTs) by owner address
   * @param {Object} params - Parameters for the request
   * @param {string} params.ownerAddress - Owner address to get assets for
   * @param {number} [params.page] - Page number for pagination
   * @param {number} [params.limit] - Number of items per page
   * @returns {Promise<Object>} - List of assets
   */
  async getAssetsByOwner(params) {
    try {
      if (!params.ownerAddress) {
        throw new Error('ownerAddress parameter is required');
      }

      logApi.info(`${formatLog.tag()} ${formatLog.header('FETCHING')} assets for owner: ${formatLog.address(params.ownerAddress)}`);
      
      const result = await this.fetchFromHeliusRPC('getAssetsByOwner', [params]);
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Successfully fetched')} ${formatLog.count(result.items?.length || 0)} assets for owner`);
      
      return result;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to fetch assets by owner:')} ${error.message}`);
      throw error;
    }
  }

  /**
   * Get assets by a group key and value
   * @param {Object} params - Parameters for the request
   * @param {string} params.groupKey - Group key to search by
   * @param {string} params.groupValue - Group value to search for
   * @param {number} [params.page] - Page number for pagination
   * @param {number} [params.limit] - Number of items per page
   * @returns {Promise<Object>} - List of assets
   */
  async getAssetsByGroup(params) {
    try {
      if (!params.groupKey || !params.groupValue) {
        throw new Error('groupKey and groupValue parameters are required');
      }

      logApi.info(`${formatLog.tag()} ${formatLog.header('FETCHING')} assets for group ${params.groupKey}=${params.groupValue}`);
      
      const result = await this.fetchFromHeliusRPC('getAssetsByGroup', [params]);
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Successfully fetched')} ${formatLog.count(result.items?.length || 0)} assets for group`);
      
      return result;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to fetch assets by group:')} ${error.message}`);
      throw error;
    }
  }
}

/**
 * DAS (Digital Asset Standard) API module
 */
class DasService extends HeliusBase {
  constructor(config) {
    super(config, 'helius:das:');
  }

  /**
   * Search for assets using Digital Asset Standard (DAS) API
   * @param {Object} params - Search parameters
   * @returns {Promise<Object>} - Search results
   */
  async searchAssets(params) {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('SEARCHING')} for assets with params: ${JSON.stringify(params)}`);
      
      const response = await this.fetchFromHeliusRPC('searchAssets', [params]);
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Successfully searched for assets')}`);
      
      return response;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to search assets:')} ${error.message}`);
      throw error;
    }
  }

  /**
   * Get a single asset by its ID
   * @param {string} assetId - The asset ID (mint address)
   * @returns {Promise<Object>} - Asset details
   */
  async getAsset(assetId) {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('FETCHING')} asset ${formatLog.address(assetId)}`);
      
      const response = await this.fetchFromHeliusRPC('getAsset', [assetId]);
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Successfully fetched asset')}`);
      
      return response;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to fetch asset:')} ${error.message}`);
      throw error;
    }
  }
}

/**
 * Webhook management module
 */
class WebhookService extends HeliusBase {
  constructor(config) {
    super(config);
  }

  /**
   * Create a webhook for real-time notifications
   * @param {Object} webhookConfig - Webhook configuration
   * @returns {Promise<Object>} - Created webhook details
   */
  async createWebhook(webhookConfig) {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('CREATING')} webhook with config: ${JSON.stringify(webhookConfig)}`);
      
      const response = await axios.post(this.config.endpoints.webhooks.create, webhookConfig);
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Successfully created webhook')}`);
      
      return response.data;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to create webhook:')} ${error.message}`);
      throw error;
    }
  }

  /**
   * Get all webhooks for the current API key
   * @returns {Promise<Object[]>} - Array of webhook objects
   */
  async getWebhooks() {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('FETCHING')} all webhooks`);
      
      const response = await axios.get(this.config.endpoints.webhooks.get);
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Successfully fetched webhooks')}`);
      
      return response.data;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to fetch webhooks:')} ${error.message}`);
      throw error;
    }
  }

  /**
   * Delete a webhook by ID
   * @param {string} webhookId - The ID of the webhook to delete
   * @returns {Promise<Object>} - Result of the delete operation
   */
  async deleteWebhook(webhookId) {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('DELETING')} webhook ${webhookId}`);
      
      const response = await axios.delete(`${this.config.endpoints.webhooks.delete}&webhook_id=${webhookId}`);
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Successfully deleted webhook')}`);
      
      return response.data;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to delete webhook:')} ${error.message}`);
      throw error;
    }
  }
}

/**
 * Main Helius Client that integrates all the modules
 */
class HeliusClient {
  constructor() {
    this.config = heliusConfig;
    this.initialized = false;
    
    // Initialize services
    this.websocket = new HeliusWebSocketManager(this.config);
    this.tokens = new TokenService(this.config);
    this.das = new DasService(this.config);
    this.webhooks = new WebhookService(this.config);
    
    // Token transfer monitoring
    this.monitoredTokens = new Set();
    this.tokenTransferHandlers = [];
    this.tokenSubscriptions = new Map();
  }

  /**
   * Initialize the Helius client
   */
  async initialize() {
    if (!this.config.apiKey) {
      logApi.warn(`${formatLog.tag()} ${formatLog.warning('Helius API key not configured. Token metadata features will be limited.')}`);
      return false;
    }

    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('INITIALIZING')} Helius client`);
      
      // Initialize WebSocket if enabled
      if (this.config.websocket.enabled) {
        this.websocket.initialize();
      }
      
      this.initialized = true;
      logApi.info(`${formatLog.tag()} ${formatLog.success('Helius client initialized successfully')}`);
      return true;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to initialize Helius client:')} ${error.message}`);
      return false;
    }
  }

  /**
   * Get token metadata for a list of mint addresses - Proxy method to token service
   * @param {string[]} mintAddresses - Array of token mint addresses
   * @returns {Promise<Object[]>} - Array of token metadata objects
   */
  async getTokensMetadata(mintAddresses) {
    return this.tokens.getTokensMetadata(mintAddresses);
  }
  
  /**
   * Search for assets using Digital Asset Standard (DAS) API - Proxy method to DAS service
   * @param {Object} params - Search parameters
   * @returns {Promise<Object>} - Search results
   */
  async searchAssets(params) {
    return this.das.searchAssets(params);
  }

  /**
   * Create a webhook for real-time notifications - Proxy method to webhook service
   * @param {Object} webhookConfig - Webhook configuration
   * @returns {Promise<Object>} - Created webhook details
   */
  async createWebhook(webhookConfig) {
    return this.webhooks.createWebhook(webhookConfig);
  }

  /**
   * Get all webhooks for the current API key - Proxy method to webhook service
   * @returns {Promise<Object[]>} - Array of webhook objects
   */
  async getWebhooks() {
    return this.webhooks.getWebhooks();
  }

  /**
   * Delete a webhook by ID - Proxy method to webhook service
   * @param {string} webhookId - The ID of the webhook to delete
   * @returns {Promise<Object>} - Result of the delete operation
   */
  async deleteWebhook(webhookId) {
    return this.webhooks.deleteWebhook(webhookId);
  }

  /**
   * Get WebSocket connection stats - Proxy method to websocket service
   * @returns {Object} - Connection statistics
   */
  getConnectionStats() {
    return this.websocket.getConnectionStats();
  }
  
  /**
   * Subscribe to token transfers for a specific token
   * @param {string} tokenAddress - The token address to monitor
   * @returns {Promise<boolean>} - Success status
   */
  async subscribeToTokenTransfers(tokenAddress) {
    try {
      if (!this.websocket.wsConnected) {
        logApi.warn(`${formatLog.tag()} ${formatLog.warning('Cannot subscribe to token transfers - WebSocket not connected')}`);
        return false;
      }
      
      // Already subscribed to this token
      if (this.monitoredTokens.has(tokenAddress)) {
        return true;
      }
      
      logApi.info(`${formatLog.tag()} ${formatLog.header('SUBSCRIBING')} to transfers for token ${formatLog.address(tokenAddress)}`);
      
      // Create transaction subscription for token program (TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA)
      const subscriptionId = await this.websocket.sendWebSocketRequest('logsSubscribe', [
        {
          mentions: [`spl-token:${tokenAddress}`],
        },
        {
          commitment: 'confirmed',
          encoding: 'jsonParsed'
        }
      ]);
      
      this.tokenSubscriptions.set(tokenAddress, subscriptionId);
      this.monitoredTokens.add(tokenAddress);
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Successfully subscribed to token transfers:')} ${formatLog.address(tokenAddress)} (${subscriptionId})`);
      
      return true;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to subscribe to token transfers:')} ${error.message}`);
      return false;
    }
  }
  
  /**
   * Unsubscribe from token transfers for a specific token
   * @param {string} tokenAddress - The token address to stop monitoring
   * @returns {Promise<boolean>} - Success status
   */
  async unsubscribeFromTokenTransfers(tokenAddress) {
    try {
      if (!this.websocket.wsConnected) {
        logApi.warn(`${formatLog.tag()} ${formatLog.warning('Cannot unsubscribe from token transfers - WebSocket not connected')}`);
        return false;
      }
      
      // Not subscribed to this token
      if (!this.monitoredTokens.has(tokenAddress)) {
        return true;
      }
      
      const subscriptionId = this.tokenSubscriptions.get(tokenAddress);
      if (!subscriptionId) {
        this.monitoredTokens.delete(tokenAddress);
        return true;
      }
      
      logApi.info(`${formatLog.tag()} ${formatLog.header('UNSUBSCRIBING')} from transfers for token ${formatLog.address(tokenAddress)}`);
      
      // Unsubscribe from transaction logs
      await this.websocket.sendWebSocketRequest('logsUnsubscribe', [subscriptionId]);
      
      this.tokenSubscriptions.delete(tokenAddress);
      this.monitoredTokens.delete(tokenAddress);
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Successfully unsubscribed from token transfers:')} ${formatLog.address(tokenAddress)}`);
      
      return true;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to unsubscribe from token transfers:')} ${error.message}`);
      return false;
    }
  }
  
  /**
   * Add a handler for token transfer events
   * @param {Function} handler - The handler function for token transfers
   */
  onTokenTransfer(handler) {
    if (typeof handler === 'function') {
      this.tokenTransferHandlers.push(handler);
    }
  }
  
  /**
   * Remove a handler for token transfer events
   * @param {Function} handler - The handler function to remove
   */
  removeTokenTransferHandler(handler) {
    const index = this.tokenTransferHandlers.indexOf(handler);
    if (index !== -1) {
      this.tokenTransferHandlers.splice(index, 1);
    }
  }
  
  /**
   * Get a list of all currently monitored tokens
   * @returns {string[]} - Array of monitored token addresses
   */
  getMonitoredTokens() {
    return Array.from(this.monitoredTokens);
  }
}

// Create and export a singleton instance
export const heliusClient = new HeliusClient();
export default heliusClient;