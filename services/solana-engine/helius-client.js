// services/new-market-data/helius-client.js

import axios from 'axios';
import WebSocket from 'ws';
import { logApi } from '../../utils/logger-suite/logger.js';
import { serviceSpecificColors, fancyColors } from '../../utils/colors.js';
import { heliusConfig } from '../../config/external-api/helius-config.js';
import redisManager from '../../utils/redis-suite/redis-manager.js';
import { cacheTTLs } from './connection-manager.js';

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

// Default cache TTL (24 hours) - only used if cacheTTLs import fails
const DEFAULT_TOKEN_METADATA_TTL = 60 * 60 * 24;

/**
 * Helius Client for fetching token metadata and managing WebSocket connections
 */
class HeliusClient {
  constructor() {
    this.config = heliusConfig;
    this.wsClient = null;
    this.wsConnected = false;
    this.reconnectAttempts = 0;
    this.totalReconnections = 0; // Track total reconnections since service start
    this.pendingRequests = new Map();
    this.requestTimeouts = new Map();
    this.initialized = false;
    this.requestId = 1;
    this.lastConnectionTime = null; // Track when the last connection was established
    
    // Set up Redis keys for token metadata
    this.redisKeys = {
      tokenMetadata: 'helius:token:metadata:', // Prefix for token metadata
      tokenList: 'helius:token:list',          // List of all tokens
      lastUpdate: 'helius:last:update',        // Timestamp of last update
    };
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
        this.initializeWebSocket();
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
   * Initialize WebSocket connection to Helius
   */
  initializeWebSocket() {
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
            this.initializeWebSocket();
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
    } else {
      // Handle subscription updates
      // TODO: Implement subscription handling
      logApi.debug(`${formatLog.tag()} ${formatLog.info('Received WebSocket message:')} ${JSON.stringify(message)}`);
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
   * Get token metadata for a list of mint addresses
   * @param {string[]} mintAddresses - Array of token mint addresses
   * @returns {Promise<Object[]>} - Array of token metadata objects
   */
  async getTokensMetadata(mintAddresses) {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('FETCHING')} metadata for ${formatLog.count(mintAddresses.length)} tokens`);
      
      // Check if we have data in Redis first
      const cachedTokens = [];
      const missingTokens = [];
      
      // Check which tokens we already have in cache
      for (const mintAddress of mintAddresses) {
        const cachedData = await redisManager.get(`${this.redisKeys.tokenMetadata}${mintAddress}`);
        if (cachedData) {
          cachedTokens.push(JSON.parse(cachedData));
        } else {
          missingTokens.push(mintAddress);
        }
      }
      
      // If we have all tokens in cache, return them
      if (missingTokens.length === 0) {
        logApi.info(`${formatLog.tag()} ${formatLog.success('Using cached metadata for all')} ${formatLog.count(mintAddresses.length)} tokens`);
        return cachedTokens;
      }
      
      // Fetch missing tokens from Helius
      logApi.info(`${formatLog.tag()} ${formatLog.info('Fetching metadata for')} ${formatLog.count(missingTokens.length)} tokens from Helius API`);
      
      let fetchedTokens = [];
      
      // Try multiple methods to get metadata with fallbacks
      try {
        // First try getTokenMetadata method
        fetchedTokens = await this.fetchFromHeliusRPC('getTokenMetadata', [missingTokens]);
      } catch (primaryError) {
        logApi.warn(`${formatLog.tag()} ${formatLog.warning('Primary metadata method failed, trying fallback:')} ${primaryError.message}`);
        
        try {
          // Fallback to getAsset method for each token individually
          const fetchPromises = missingTokens.map(async (mintAddress) => {
            try {
              const assetData = await this.fetchFromHeliusRPC('getAsset', [mintAddress]);
              return this.mapAssetToTokenMetadata(assetData);
            } catch (assetError) {
              logApi.debug(`${formatLog.tag()} ${formatLog.warning(`Fallback failed for token ${mintAddress}:`)} ${assetError.message}`);
              // Return a minimal object with just the mint address
              return { mint: mintAddress };
            }
          });
          
          fetchedTokens = await Promise.all(fetchPromises);
        } catch (fallbackError) {
          logApi.error(`${formatLog.tag()} ${formatLog.error('All metadata methods failed:')} ${fallbackError.message}`);
          // Return empty array as last resort
          fetchedTokens = missingTokens.map(mint => ({ mint }));
        }
      }
      
      // Get TTL from global cacheTTLs object (with fallback)
      const tokenMetadataTTL = cacheTTLs.tokenMetadataTTL || DEFAULT_TOKEN_METADATA_TTL;
      
      // Cache the fetched tokens
      for (const token of fetchedTokens) {
        if (token && token.mint) {
          await redisManager.set(
            `${this.redisKeys.tokenMetadata}${token.mint}`, 
            JSON.stringify(token), 
            tokenMetadataTTL
          );
        }
      }
      
      // Combine cached and fetched tokens
      return [...cachedTokens, ...fetchedTokens];
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to fetch token metadata:')} ${error.message}`);
      return mintAddresses.map(mint => ({ mint }));
    }
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
   * Search for assets using Digital Asset Standard (DAS) API
   * @param {Object} params - Search parameters
   * @returns {Promise<Object>} - Search results
   */
  async searchAssets(params) {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('SEARCHING')} for assets with params: ${JSON.stringify(params)}`);
      
      const response = await axios.post(this.config.rpcUrl, {
        jsonrpc: '2.0',
        id: 'helius-client',
        method: 'searchAssets',
        params: [params],
      });
      
      if (!response.data || !response.data.result) {
        throw new Error('Invalid response from Helius API');
      }
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Successfully searched for assets')}`);
      
      return response.data.result;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to search assets:')} ${error.message}`);
      throw error;
    }
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

// Create and export a singleton instance
export const heliusClient = new HeliusClient();
export default heliusClient;