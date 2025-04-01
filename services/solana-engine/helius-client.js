// services/new-market-data/helius-client.js

import axios from 'axios';
import WebSocket from 'ws';
import { logApi } from '../../utils/logger-suite/logger.js';
import { serviceSpecificColors, fancyColors } from '../../utils/colors.js';
import { heliusConfig } from '../../config/external-api/helius-config.js';
import { redisManager } from '../../utils/redis-suite/redis-manager.js';
import connectionManager from './connection-manager.js';

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

/**
 * Helius Client for fetching token metadata and managing WebSocket connections
 */
class HeliusClient {
  constructor() {
    this.config = heliusConfig;
    this.wsClient = null;
    this.wsConnected = false;
    this.reconnectAttempts = 0;
    this.pendingRequests = new Map();
    this.requestTimeouts = new Map();
    this.initialized = false;
    this.requestId = 1;
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
      
      // Set up Redis keys for token metadata
      this.redisKeys = {
        tokenMetadata: 'helius:token:metadata:', // Prefix for token metadata
        tokenList: 'helius:token:list',          // List of all tokens
        lastUpdate: 'helius:last:update',        // Timestamp of last update
      };
      
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

      logApi.info(`${formatLog.tag()} ${formatLog.header('CONNECTING')} to Helius WebSocket`);
      
      this.wsClient = new WebSocket(this.config.websocket.url);
      
      this.wsClient.on('open', () => {
        this.wsConnected = true;
        this.reconnectAttempts = 0;
        logApi.info(`${formatLog.tag()} ${formatLog.success('Connected to Helius WebSocket')}`);
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
          
          logApi.info(`${formatLog.tag()} ${formatLog.info(`Reconnecting in ${reconnectDelay / 1000}s (attempt ${this.reconnectAttempts}/${this.config.websocket.maxReconnectAttempts})`)}`);
          
          setTimeout(() => {
            this.initializeWebSocket();
          }, reconnectDelay);
        } else {
          logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to reconnect to Helius WebSocket after maximum attempts')}`);
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
      
      const response = await axios.post(this.config.rpcUrl, {
        jsonrpc: '2.0',
        id: 'helius-client',
        method: 'getTokenMetadata',
        params: [missingTokens],
      });
      
      if (!response.data || !response.data.result) {
        throw new Error('Invalid response from Helius API');
      }
      
      const fetchedTokens = response.data.result;
      
      // Cache the fetched tokens
      for (const token of fetchedTokens) {
        await redisManager.set(
          `${this.redisKeys.tokenMetadata}${token.mint}`, 
          JSON.stringify(token), 
          connectionManager.cacheTTLs?.tokenMetadataTTL || 60 * 60 * 24 // Use config or fallback to 24 hours
        );
      }
      
      // Update the last update timestamp
      await redisManager.set(this.redisKeys.lastUpdate, Date.now().toString());
      
      // Combine cached and fetched tokens
      const allTokens = [...cachedTokens, ...fetchedTokens];
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Successfully fetched metadata for')} ${formatLog.count(allTokens.length)} tokens`);
      
      return allTokens;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to fetch token metadata:')} ${error.message}`);
      throw error;
    }
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
}

// Create and export a singleton instance
export const heliusClient = new HeliusClient();
export default heliusClient;