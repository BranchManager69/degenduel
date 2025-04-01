// services/new-market-data/jupiter-client.js

import axios from 'axios';
import WebSocket from 'ws';
import { logApi } from '../../utils/logger-suite/logger.js';
import { serviceSpecificColors, fancyColors } from '../../utils/colors.js';
import { jupiterConfig } from '../../config/external-api/jupiter-config.js';
import { redisManager } from '../../utils/redis-suite/redis-manager.js';
import connectionManager from './connection-manager.js';

// Formatting helpers for consistent logging
const formatLog = {
  tag: () => `${serviceSpecificColors.jupiterClient.tag}[jupiterClient]${fancyColors.RESET}`,
  header: (text) => `${serviceSpecificColors.jupiterClient.header} ${text} ${fancyColors.RESET}`,
  success: (text) => `${serviceSpecificColors.jupiterClient.success}${text}${fancyColors.RESET}`,
  warning: (text) => `${serviceSpecificColors.jupiterClient.warning}${text}${fancyColors.RESET}`,
  error: (text) => `${serviceSpecificColors.jupiterClient.error}${text}${fancyColors.RESET}`,
  info: (text) => `${serviceSpecificColors.jupiterClient.info}${text}${fancyColors.RESET}`,
  highlight: (text) => `${serviceSpecificColors.jupiterClient.highlight}${text}${fancyColors.RESET}`,
  token: (symbol) => `${serviceSpecificColors.jupiterClient.token}${symbol}${fancyColors.RESET}`,
  price: (price) => `${serviceSpecificColors.jupiterClient.price}${price}${fancyColors.RESET}`,
  count: (num) => `${serviceSpecificColors.jupiterClient.count}${num}${fancyColors.RESET}`,
};

/**
 * Jupiter Client for fetching market data and swap quotes
 */
class JupiterClient {
  constructor() {
    this.config = jupiterConfig;
    this.wsClient = null;
    this.wsConnected = false;
    this.reconnectAttempts = 0;
    this.subscriptions = new Map();
    this.tokenList = null;
    this.tokenMap = null;
    this.initialized = false;
    this.priceUpdateCallbacks = [];
  }

  /**
   * Initialize the Jupiter client
   */
  async initialize() {
    if (!this.config.apiKey) {
      logApi.warn(`${formatLog.tag()} ${formatLog.warning('Jupiter API key not configured. Market data features will be limited.')}`);
    }

    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('INITIALIZING')} Jupiter client`);
      
      // Set up Redis keys for market data
      this.redisKeys = {
        tokenPrices: 'jupiter:token:prices:', // Prefix for token prices
        tokenList: 'jupiter:token:list',      // List of all tokens
        lastUpdate: 'jupiter:last:update',    // Timestamp of last update
      };
      
      // Initialize token list and map
      await this.initializeTokenList();
      
      // Initialize WebSocket if enabled
      if (this.config.websocket.enabled) {
        this.initializeWebSocket();
      }
      
      this.initialized = true;
      logApi.info(`${formatLog.tag()} ${formatLog.success('Jupiter client initialized successfully')}`);
      return true;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to initialize Jupiter client:')} ${error.message}`);
      return false;
    }
  }

  /**
   * Initialize token list and token map
   */
  async initializeTokenList() {
    try {
      // Check if we have the token list in Redis
      const cachedTokenList = await redisManager.get(this.redisKeys.tokenList);
      
      if (cachedTokenList) {
        this.tokenList = JSON.parse(cachedTokenList);
        logApi.info(`${formatLog.tag()} ${formatLog.success('Using cached token list with')} ${formatLog.count(this.tokenList.length)} tokens`);
      } else {
        // Fetch token list from Jupiter API
        logApi.info(`${formatLog.tag()} ${formatLog.header('FETCHING')} token list from Jupiter API`);
        
        const response = await axios.get(this.config.endpoints.tokens.getTokens, {
          headers: this.config.getHeaders(),
        });
        
        this.tokenList = response.data;
        
        // Cache the token list
        await redisManager.set(
          this.redisKeys.tokenList, 
          JSON.stringify(this.tokenList), 
          connectionManager.cacheTTLs?.tokenMetadataTTL || 60 * 60 * 24 // Use config or fallback to 24 hours
        );
        
        logApi.info(`${formatLog.tag()} ${formatLog.success('Fetched token list with')} ${formatLog.count(this.tokenList.length)} tokens`);
      }
      
      // Create a map of mint address to token info for quick lookups
      this.tokenMap = this.tokenList.reduce((map, token) => {
        map[token.address] = token;
        return map;
      }, {});
      
      return this.tokenList;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to initialize token list:')} ${error.message}`);
      throw error;
    }
  }

  /**
   * Initialize WebSocket connection to Jupiter price API
   */
  initializeWebSocket() {
    try {
      if (!this.config.websocket.priceUrl) {
        logApi.warn(`${formatLog.tag()} ${formatLog.warning('WebSocket URL not configured for Jupiter')}`);
        return;
      }

      logApi.info(`${formatLog.tag()} ${formatLog.header('CONNECTING')} to Jupiter Price WebSocket`);
      
      this.wsClient = new WebSocket(this.config.websocket.priceUrl);
      
      this.wsClient.on('open', () => {
        this.wsConnected = true;
        this.reconnectAttempts = 0;
        logApi.info(`${formatLog.tag()} ${formatLog.success('Connected to Jupiter Price WebSocket')}`);
        
        // Resubscribe to previously subscribed tokens
        this.resubscribeToTokens();
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
        logApi.warn(`${formatLog.tag()} ${formatLog.warning('Disconnected from Jupiter Price WebSocket')}`);
        
        // Attempt to reconnect with exponential backoff
        if (this.reconnectAttempts < this.config.websocket.maxReconnectAttempts) {
          const reconnectDelay = this.config.websocket.reconnectInterval * Math.pow(2, this.reconnectAttempts);
          this.reconnectAttempts++;
          
          logApi.info(`${formatLog.tag()} ${formatLog.info(`Reconnecting in ${reconnectDelay / 1000}s (attempt ${this.reconnectAttempts}/${this.config.websocket.maxReconnectAttempts})`)}`);
          
          setTimeout(() => {
            this.initializeWebSocket();
          }, reconnectDelay);
        } else {
          logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to reconnect to Jupiter Price WebSocket after maximum attempts')}`);
        }
      });
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to initialize Jupiter WebSocket:')} ${error.message}`);
    }
  }

  /**
   * Resubscribe to previously subscribed tokens after reconnecting
   */
  resubscribeToTokens() {
    if (!this.wsConnected || this.subscriptions.size === 0) {
      return;
    }
    
    try {
      const subscriptionMessage = {
        type: 'subscribe',
        tokens: Array.from(this.subscriptions.keys()),
      };
      
      this.wsClient.send(JSON.stringify(subscriptionMessage));
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Resubscribed to')} ${formatLog.count(this.subscriptions.size)} tokens`);
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to resubscribe to tokens:')} ${error.message}`);
    }
  }

  /**
   * Handle incoming WebSocket messages
   * @param {Object} message - The message received from WebSocket
   */
  handleWebSocketMessage(message) {
    try {
      // Handle price update messages
      if (message.type === 'price') {
        // Update Redis cache with the latest prices
        this.updateTokenPrices(message.data);
        
        // Notify all registered callbacks
        this.notifyPriceUpdateCallbacks(message.data);
      } else if (message.type === 'error') {
        logApi.error(`${formatLog.tag()} ${formatLog.error('WebSocket error message:')} ${message.error}`);
      } else {
        logApi.debug(`${formatLog.tag()} ${formatLog.info('Received WebSocket message:')} ${JSON.stringify(message)}`);
      }
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to handle WebSocket message:')} ${error.message}`);
    }
  }

  /**
   * Update token prices in Redis
   * @param {Object} priceData - Price data from Jupiter WebSocket
   */
  async updateTokenPrices(priceData) {
    try {
      for (const [mintAddress, priceInfo] of Object.entries(priceData)) {
        // Store price data in Redis
        await redisManager.set(
          `${this.redisKeys.tokenPrices}${mintAddress}`,
          JSON.stringify(priceInfo),
          connectionManager.cacheTTLs?.tokenPriceTTL || 60 * 60 // Use config or fallback to 1 hour
        );
      }
      
      // Update the last update timestamp
      await redisManager.set(this.redisKeys.lastUpdate, Date.now().toString());
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to update token prices in Redis:')} ${error.message}`);
    }
  }

  /**
   * Notify all registered callbacks about price updates
   * @param {Object} priceData - Price data from Jupiter WebSocket
   */
  notifyPriceUpdateCallbacks(priceData) {
    if (this.priceUpdateCallbacks.length === 0) {
      return;
    }
    
    for (const callback of this.priceUpdateCallbacks) {
      try {
        callback(priceData);
      } catch (error) {
        logApi.error(`${formatLog.tag()} ${formatLog.error('Error in price update callback:')} ${error.message}`);
      }
    }
  }

  /**
   * Register a callback function for price updates
   * @param {Function} callback - Function to call when prices are updated
   */
  onPriceUpdate(callback) {
    if (typeof callback !== 'function') {
      throw new Error('Callback must be a function');
    }
    
    this.priceUpdateCallbacks.push(callback);
    logApi.info(`${formatLog.tag()} ${formatLog.success('Registered new price update callback')}`);
    
    return () => {
      this.priceUpdateCallbacks = this.priceUpdateCallbacks.filter(cb => cb !== callback);
      logApi.info(`${formatLog.tag()} ${formatLog.success('Unregistered price update callback')}`);
    };
  }

  /**
   * Subscribe to price updates for specified tokens
   * @param {string[]} mintAddresses - Array of token mint addresses to subscribe to
   * @returns {boolean} - Success status
   */
  async subscribeToPrices(mintAddresses) {
    if (!this.wsConnected) {
      logApi.warn(`${formatLog.tag()} ${formatLog.warning('Cannot subscribe to prices: WebSocket not connected')}`);
      return false;
    }
    
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('SUBSCRIBING')} to prices for ${formatLog.count(mintAddresses.length)} tokens`);
      
      // Filter out already subscribed tokens
      const newTokens = mintAddresses.filter(address => !this.subscriptions.has(address));
      
      if (newTokens.length === 0) {
        logApi.info(`${formatLog.tag()} ${formatLog.info('All tokens already subscribed')}`);
        return true;
      }
      
      // Create subscription message
      const subscriptionMessage = {
        type: 'subscribe',
        tokens: newTokens,
      };
      
      // Send subscription request
      this.wsClient.send(JSON.stringify(subscriptionMessage));
      
      // Update subscriptions map
      for (const address of newTokens) {
        this.subscriptions.set(address, true);
      }
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Subscribed to prices for')} ${formatLog.count(newTokens.length)} new tokens`);
      return true;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to subscribe to prices:')} ${error.message}`);
      return false;
    }
  }

  /**
   * Unsubscribe from price updates for specified tokens
   * @param {string[]} mintAddresses - Array of token mint addresses to unsubscribe from
   * @returns {boolean} - Success status
   */
  async unsubscribeFromPrices(mintAddresses) {
    if (!this.wsConnected) {
      logApi.warn(`${formatLog.tag()} ${formatLog.warning('Cannot unsubscribe from prices: WebSocket not connected')}`);
      return false;
    }
    
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('UNSUBSCRIBING')} from prices for ${formatLog.count(mintAddresses.length)} tokens`);
      
      // Filter out tokens that aren't subscribed
      const subscribedTokens = mintAddresses.filter(address => this.subscriptions.has(address));
      
      if (subscribedTokens.length === 0) {
        logApi.info(`${formatLog.tag()} ${formatLog.info('No tokens to unsubscribe from')}`);
        return true;
      }
      
      // Create unsubscription message
      const unsubscriptionMessage = {
        type: 'unsubscribe',
        tokens: subscribedTokens,
      };
      
      // Send unsubscription request
      this.wsClient.send(JSON.stringify(unsubscriptionMessage));
      
      // Update subscriptions map
      for (const address of subscribedTokens) {
        this.subscriptions.delete(address);
      }
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Unsubscribed from prices for')} ${formatLog.count(subscribedTokens.length)} tokens`);
      return true;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to unsubscribe from prices:')} ${error.message}`);
      return false;
    }
  }

  /**
   * Get current prices for specified tokens
   * @param {string[]} mintAddresses - Array of token mint addresses
   * @returns {Promise<Object>} - Map of token addresses to price data
   */
  async getPrices(mintAddresses) {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('FETCHING')} prices for ${formatLog.count(mintAddresses.length)} tokens`);
      
      // Check if we have data in Redis first
      const cachedPrices = {};
      const missingTokens = [];
      
      // Check which tokens we already have in cache
      for (const mintAddress of mintAddresses) {
        const cachedData = await redisManager.get(`${this.redisKeys.tokenPrices}${mintAddress}`);
        if (cachedData) {
          cachedPrices[mintAddress] = JSON.parse(cachedData);
        } else {
          missingTokens.push(mintAddress);
        }
      }
      
      // If we have all tokens in cache, return them
      if (missingTokens.length === 0) {
        logApi.info(`${formatLog.tag()} ${formatLog.success('Using cached prices for all')} ${formatLog.count(mintAddresses.length)} tokens`);
        return cachedPrices;
      }
      
      // Fetch missing tokens from Jupiter API
      logApi.info(`${formatLog.tag()} ${formatLog.info('Fetching prices for')} ${formatLog.count(missingTokens.length)} tokens from Jupiter API`);
      
      const queryString = missingTokens.join(',');
      const response = await axios.get(`${this.config.endpoints.price.getPrices}?ids=${queryString}`, {
        headers: this.config.getHeaders(),
      });
      
      if (!response.data || !response.data.data) {
        throw new Error('Invalid response from Jupiter API');
      }
      
      const fetchedPrices = response.data.data;
      
      // Cache the fetched prices
      for (const [mintAddress, priceInfo] of Object.entries(fetchedPrices)) {
        await redisManager.set(
          `${this.redisKeys.tokenPrices}${mintAddress}`, 
          JSON.stringify(priceInfo), 
          connectionManager.cacheTTLs?.tokenPriceTTL || 60 * 60 // Use config or fallback to 1 hour
        );
      }
      
      // Update the last update timestamp
      await redisManager.set(this.redisKeys.lastUpdate, Date.now().toString());
      
      // Combine cached and fetched prices
      const allPrices = { ...cachedPrices, ...fetchedPrices };
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Successfully fetched prices for')} ${formatLog.count(Object.keys(allPrices).length)} tokens`);
      
      return allPrices;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to fetch prices:')} ${error.message}`);
      throw error;
    }
  }

  /**
   * Get price history for a token
   * @param {string} mintAddress - Token mint address
   * @param {string} interval - Time interval (e.g., '1d', '7d', '30d')
   * @returns {Promise<Object>} - Price history data
   */
  async getPriceHistory(mintAddress, interval = '7d') {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('FETCHING')} price history for token ${formatLog.token(mintAddress)} over ${interval}`);
      
      const response = await axios.get(this.config.endpoints.price.getPriceHistory(mintAddress), {
        headers: this.config.getHeaders(),
        params: { interval },
      });
      
      if (!response.data || !response.data.data || !response.data.data[mintAddress]) {
        throw new Error('Invalid response from Jupiter API');
      }
      
      const priceHistory = response.data.data[mintAddress];
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Successfully fetched price history for')} ${formatLog.token(mintAddress)}`);
      
      return priceHistory;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to fetch price history:')} ${error.message}`);
      throw error;
    }
  }

  /**
   * Get a swap quote between two tokens
   * @param {Object} params - Quote parameters (inputMint, outputMint, amount, etc.)
   * @returns {Promise<Object>} - Swap quote details
   */
  async getSwapQuote(params) {
    try {
      logApi.info(`${formatLog.tag()} ${formatLog.header('FETCHING')} swap quote from ${formatLog.token(params.inputMint)} to ${formatLog.token(params.outputMint)}`);
      
      const response = await axios.get(this.config.endpoints.quote.getQuote, {
        headers: this.config.getHeaders(),
        params,
      });
      
      if (!response.data) {
        throw new Error('Invalid response from Jupiter API');
      }
      
      logApi.info(`${formatLog.tag()} ${formatLog.success('Successfully fetched swap quote')} with best price: ${formatLog.price(response.data.outAmount)}`);
      
      return response.data;
    } catch (error) {
      logApi.error(`${formatLog.tag()} ${formatLog.error('Failed to fetch swap quote:')} ${error.message}`);
      throw error;
    }
  }

  /**
   * Get details about a specific token
   * @param {string} mintAddress - Token mint address
   * @returns {Object|null} - Token details or null if not found
   */
  getTokenInfo(mintAddress) {
    if (!this.tokenMap) {
      logApi.warn(`${formatLog.tag()} ${formatLog.warning('Token map not initialized')}`);
      return null;
    }
    
    return this.tokenMap[mintAddress] || null;
  }
}

// Create and export a singleton instance
export const jupiterClient = new JupiterClient();
export default jupiterClient;