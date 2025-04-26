// services/tokenMonitorService.js
import { BaseService } from '../utils/service-suite/base-service.js';
import { logApi } from '../utils/logger-suite/logger.js';
import { fancyColors } from '../utils/colors.js';
import { config } from '../config/config.js';
import { SERVICE_NAMES } from '../utils/service-suite/service-constants.js';
import serviceEvents from '../utils/service-suite/service-events.js';
import { SERVICE_EVENTS } from '../utils/service-suite/service-events.js';
import prisma from '../config/prisma.js';

// Dynamically import Helius and Jupiter clients to avoid circular dependencies
let heliusClient, jupiterClient, solanaEngine;

/**
 * Service for monitoring specific token transactions and emitting events
 * Uses Helius API for transaction monitoring and Jupiter for price data
 */
class TokenMonitorService extends BaseService {
  constructor() {
    super({
      name: 'token_monitor_service',
      description: 'Monitors specific token transactions',
      checkIntervalMs: 60 * 1000, // 1 minute
    });
    
    // Tokens we're actively monitoring (address -> data mapping)
    this.monitoredTokens = new Map();
    
    // Cache price data to avoid excessive API calls
    this.priceCache = new Map();
    this.lastPriceUpdate = 0;
    
    // Connect to events from Jupiter client when available
    this.jupiterInitialized = false;
    
    // Track if we've registered with the Helius client
    this.tokenTransferHandlerRegistered = false;
  }
  
  /**
   * Initialize the service
   */
  async initialize() {
    try {
      // Check if token monitor service is disabled via service profile
      if (!config.services.token_monitor) {
        logApi.warn(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} SERVICE DISABLED ${fancyColors.RESET} Token Monitor Service is disabled in the '${config.services.active_profile}' service profile`);
        return false;
      }
      
      await super.initialize();
      
      // Dynamically import dependencies
      const solanaEngineModule = await import('../services/solana-engine/index.js');
      solanaEngine = solanaEngineModule.default;
      
      const heliusClientModule = await import('../services/solana-engine/helius-client.js');
      heliusClient = heliusClientModule.default;
      
      const jupiterClientModule = await import('../services/solana-engine/jupiter-client.js');
      jupiterClient = jupiterClientModule.default;
      
      // Initialize Solana engine if it's not already
      if (!solanaEngine.isInitialized()) {
        await solanaEngine.initialize();
      }
      
      // Load previously monitored tokens from database
      await this.loadMonitoredTokens();
      
      // Set up event listeners for Jupiter client
      if (!this.jupiterInitialized && jupiterClient) {
        jupiterClient.onPriceUpdate(this.handlePriceUpdate.bind(this));
        this.jupiterInitialized = true;
      }
      
      logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.GREEN}Token Monitor Service initialized with ${this.monitoredTokens.size} tokens${fancyColors.RESET}`);
      return true;
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.RED}Initialization error:${fancyColors.RESET}`, error);
      return false;
    }
  }
  
  /**
   * Load previously monitored tokens from database
   */
  async loadMonitoredTokens() {
    try {
      // Check if the monitored_tokens table exists, otherwise create it
      // This is a temporary solution - in a real app, this would be part of a migration
      const monitored_tokens = await prisma.$queryRaw`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public'
          AND table_name = 'monitored_tokens'
        );
      `;
      
      const tableExists = monitored_tokens[0].exists;
      
      if (!tableExists) {
        // Create the table if it doesn't exist
        await prisma.$executeRaw`
          CREATE TABLE monitored_tokens (
            token_address TEXT PRIMARY KEY,
            token_name TEXT,
            token_symbol TEXT,
            decimals INTEGER DEFAULT 9,
            monitor_buys BOOLEAN DEFAULT TRUE,
            monitor_sells BOOLEAN DEFAULT TRUE,
            min_transaction_value DECIMAL(20, 8) DEFAULT 0,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          );
        `;
        
        logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.GREEN}Created monitored_tokens table${fancyColors.RESET}`);
        return;
      }
      
      // Load tokens from database
      const tokens = await prisma.$queryRaw`
        SELECT * FROM monitored_tokens WHERE monitor_buys = TRUE OR monitor_sells = TRUE;
      `;
      
      // Add to monitored tokens
      tokens.forEach(token => {
        this.monitoredTokens.set(token.token_address, {
          token_address: token.token_address,
          token_name: token.token_name,
          token_symbol: token.token_symbol,
          decimals: token.decimals,
          monitor_buys: token.monitor_buys,
          monitor_sells: token.monitor_sells,
          min_transaction_value: token.min_transaction_value
        });
      });
      
      logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.GREEN}Loaded ${tokens.length} tokens from database${fancyColors.RESET}`);
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.RED}Error loading monitored tokens:${fancyColors.RESET}`, error);
    }
  }
  
  /**
   * Add a token to the monitoring list
   * @param {string} tokenAddress - The token address to monitor
   * @param {Object} options - Monitoring options
   */
  async addTokenToMonitor(tokenAddress, options = {}) {
    try {
      // Validate token address
      if (!tokenAddress || typeof tokenAddress !== 'string') {
        throw new Error('Invalid token address');
      }
      
      // Check if token already monitored
      if (this.monitoredTokens.has(tokenAddress)) {
        // Update options if provided
        const currentOptions = this.monitoredTokens.get(tokenAddress);
        this.monitoredTokens.set(tokenAddress, {
          ...currentOptions,
          ...options,
          token_address: tokenAddress
        });
        
        logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.GREEN}Updated monitoring options for ${tokenAddress}${fancyColors.RESET}`);
      } else {
        // Fetch token metadata if not provided
        if (!options.token_name || !options.token_symbol) {
          try {
            // Use Jupiter client to get token metadata
            const tokenInfo = await jupiterClient.getTokenInfo(tokenAddress);
            options.token_name = tokenInfo.name || 'Unknown Token';
            options.token_symbol = tokenInfo.symbol || 'UNKNOWN';
            options.decimals = tokenInfo.decimals || 9;
          } catch (metadataError) {
            logApi.warn(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.YELLOW}Could not fetch token metadata:${fancyColors.RESET}`, metadataError);
            options.token_name = options.token_name || 'Unknown Token';
            options.token_symbol = options.token_symbol || 'UNKNOWN';
            options.decimals = options.decimals || 9;
          }
        }
        
        // Add to monitored tokens with defaults
        this.monitoredTokens.set(tokenAddress, {
          token_address: tokenAddress,
          token_name: options.token_name || 'Unknown Token',
          token_symbol: options.token_symbol || 'UNKNOWN',
          decimals: options.decimals || 9,
          monitor_buys: options.monitor_buys !== undefined ? options.monitor_buys : true,
          monitor_sells: options.monitor_sells !== undefined ? options.monitor_sells : true,
          min_transaction_value: options.min_transaction_value || 0
        });
        
        logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.GREEN}Started monitoring token ${tokenAddress} (${options.token_symbol || 'UNKNOWN'})${fancyColors.RESET}`);
      }
      
      // Subscribe to price updates for this token
      jupiterClient.subscribeToPrices([tokenAddress]);
      
      // Save to database
      await this.saveTokenToDatabase(tokenAddress);
      
      // Set up Helius webhooks/subscriptions
      this.setupTokenMonitoring(tokenAddress);
      
      return true;
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.RED}Error adding token to monitor:${fancyColors.RESET}`, error);
      return false;
    }
  }
  
  /**
   * Save token monitoring configuration to database
   * @param {string} tokenAddress - The token address
   */
  async saveTokenToDatabase(tokenAddress) {
    try {
      const tokenData = this.monitoredTokens.get(tokenAddress);
      if (!tokenData) return;
      
      // Insert or update token in database
      await prisma.$executeRaw`
        INSERT INTO monitored_tokens (
          token_address, token_name, token_symbol, decimals,
          monitor_buys, monitor_sells, min_transaction_value, updated_at
        ) VALUES (
          ${tokenData.token_address},
          ${tokenData.token_name},
          ${tokenData.token_symbol},
          ${tokenData.decimals},
          ${tokenData.monitor_buys},
          ${tokenData.monitor_sells},
          ${tokenData.min_transaction_value},
          CURRENT_TIMESTAMP
        )
        ON CONFLICT (token_address) DO UPDATE SET
          token_name = EXCLUDED.token_name,
          token_symbol = EXCLUDED.token_symbol,
          decimals = EXCLUDED.decimals,
          monitor_buys = EXCLUDED.monitor_buys,
          monitor_sells = EXCLUDED.monitor_sells,
          min_transaction_value = EXCLUDED.min_transaction_value,
          updated_at = CURRENT_TIMESTAMP;
      `;
      
      logApi.debug(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Saved token ${tokenAddress} to database`);
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.RED}Error saving token to database:${fancyColors.RESET}`, error);
    }
  }
  
  /**
   * Remove a token from the monitoring list
   * @param {string} tokenAddress - The token address to stop monitoring
   */
  async removeTokenFromMonitor(tokenAddress) {
    try {
      if (!this.monitoredTokens.has(tokenAddress)) {
        return false;
      }
      
      // Remove from monitored tokens
      this.monitoredTokens.delete(tokenAddress);
      
      // Remove from database
      await prisma.$executeRaw`
        UPDATE monitored_tokens
        SET monitor_buys = FALSE, monitor_sells = FALSE, updated_at = CURRENT_TIMESTAMP
        WHERE token_address = ${tokenAddress};
      `;
      
      logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.GREEN}Stopped monitoring token ${tokenAddress}${fancyColors.RESET}`);
      return true;
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.RED}Error removing token from monitor:${fancyColors.RESET}`, error);
      return false;
    }
  }
  
  /**
   * Set up token monitoring with Helius
   * @param {string} tokenAddress - The token address to monitor
   */
  async setupTokenMonitoring(tokenAddress) {
    try {
      // Now that we've implemented the Helius WebSocket handling,
      // we can use it to monitor token transfers
      
      logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.GREEN}Setting up Helius monitoring for ${tokenAddress}${fancyColors.RESET}`);
      
      // Register a token transfer handler with the Helius client
      if (!this.tokenTransferHandlerRegistered) {
        // Add a handler for token transfers
        heliusClient.onTokenTransfer(this.handleTokenTransfer.bind(this));
        this.tokenTransferHandlerRegistered = true;
        logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.GREEN}Registered token transfer handler with Helius client${fancyColors.RESET}`);
      }
      
      // Subscribe to token transfers for this token
      const success = await heliusClient.subscribeToTokenTransfers(tokenAddress);
      
      if (success) {
        logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.GREEN}Successfully subscribed to transfers for ${tokenAddress}${fancyColors.RESET}`);
      } else {
        logApi.warn(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.YELLOW}Failed to subscribe to transfers for ${tokenAddress}${fancyColors.RESET}`);
      }
      
      return success;
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.RED}Error setting up token monitoring:${fancyColors.RESET}`, error);
      return false;
    }
  }
  
  /**
   * Handle token transfer events from Helius
   * @param {Object} transferInfo - Token transfer information
   */
  handleTokenTransfer(transferInfo) {
    try {
      const { tokenAddress, fromAddress, toAddress, amount, type, signature } = transferInfo;
      
      // Check if we're monitoring this token
      if (!this.monitoredTokens.has(tokenAddress)) {
        return;
      }
      
      const tokenData = this.monitoredTokens.get(tokenAddress);
      
      // Check if we're monitoring this type of transaction
      if ((type === 'buy' && !tokenData.monitor_buys) || 
          (type === 'sell' && !tokenData.monitor_sells)) {
        return;
      }
      
      // Get price from cache
      const priceData = this.priceCache.get(tokenAddress) || { price_usd: 0 };
      
      // Calculate USD value
      const usdValue = (amount / Math.pow(10, tokenData.decimals)) * priceData.price_usd;
      
      // Check minimum transaction value
      if (usdValue < tokenData.min_transaction_value) {
        return;
      }
      
      // Create event data
      const eventData = {
        token_address: tokenAddress,
        token_name: tokenData.token_name,
        token_symbol: tokenData.token_symbol,
        decimals: tokenData.decimals,
        amount: amount / Math.pow(10, tokenData.decimals), // Convert to human-readable amount
        price_usd: priceData.price_usd,
        tx_signature: signature,
        timestamp: Date.now()
      };
      
      // Handle different transaction types
      if (type === 'buy') {
        eventData.buyer_address = toAddress;
        logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.GREEN}Detected purchase of ${eventData.amount} ${tokenData.token_symbol} (${usdValue.toFixed(2)} USD)${fancyColors.RESET}`);
        serviceEvents.emit(SERVICE_EVENTS.TOKEN_PURCHASE, eventData);
      } else if (type === 'sell') {
        eventData.seller_address = fromAddress;
        logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.GREEN}Detected sale of ${eventData.amount} ${tokenData.token_symbol} (${usdValue.toFixed(2)} USD)${fancyColors.RESET}`);
        serviceEvents.emit(SERVICE_EVENTS.TOKEN_SALE, eventData);
      } else if (type === 'transfer') {
        // For regular transfers, we'll emit both purchase and sale events
        // This is a simplified approach; in a production environment you might want to
        // analyze the transaction more deeply to determine if it's a buy or sell
        eventData.buyer_address = toAddress;
        eventData.seller_address = fromAddress;
        
        logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.GREEN}Detected transfer of ${eventData.amount} ${tokenData.token_symbol} (${usdValue.toFixed(2)} USD)${fancyColors.RESET}`);
        
        if (tokenData.monitor_buys) {
          serviceEvents.emit(SERVICE_EVENTS.TOKEN_PURCHASE, { ...eventData });
        }
        
        if (tokenData.monitor_sells) {
          serviceEvents.emit(SERVICE_EVENTS.TOKEN_SALE, { ...eventData });
        }
      }
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.RED}Error handling token transfer:${fancyColors.RESET}`, error);
    }
  }
  
  /**
   * Handle price updates from Jupiter
   * @param {Object} priceData - Price data from Jupiter
   */
  handlePriceUpdate(priceData) {
    try {
      // Track changes for detailed logging
      const significantChanges = [];
      
      // Update price cache
      for (const [tokenAddress, priceInfo] of Object.entries(priceData)) {
        if (this.monitoredTokens.has(tokenAddress)) {
          // Get token data
          const tokenData = this.monitoredTokens.get(tokenAddress);
          const symbol = tokenData.token_symbol || 'UNKNOWN';
          
          // Get previous price data if available
          const previousPriceData = this.priceCache.get(tokenAddress);
          const previousPrice = previousPriceData?.price_usd;
          
          // Current price from Jupiter
          const currentPrice = typeof priceInfo === 'object' ? 
            (priceInfo.price || 0) : 
            (priceInfo || 0);
            
          // Extra data from Jupiter if available
          const marketCap = priceInfo.marketCap;
          const volume24h = priceInfo.volume24h;
          const priceChange24h = priceInfo.priceChange24h;
            
          // Calculate price change if we have previous data
          let priceChangeAmount = 0;
          let priceChangePercent = 0;
          
          if (previousPrice !== undefined && previousPrice !== null && previousPrice > 0) {
            priceChangeAmount = currentPrice - previousPrice;
            priceChangePercent = (priceChangeAmount / previousPrice) * 100;
          }
          
          // Update cache with new price
          this.priceCache.set(tokenAddress, {
            price_usd: currentPrice,
            previous_price: previousPrice,
            market_cap: marketCap,
            volume_24h: volume24h,
            price_change_percent: priceChangePercent,
            last_updated: Date.now()
          });
          
          // Add to significant changes if price change is notable (>0.5%)
          // or this is a first-time price
          if (Math.abs(priceChangePercent) > 0.5 || previousPrice === undefined) {
            significantChanges.push({
              address: tokenAddress,
              symbol,
              currentPrice,
              previousPrice,
              changePercent: priceChangePercent,
              changeAmount: priceChangeAmount,
              marketCap,
              volume24h
            });
          }
        }
      }
      
      // Log significant changes
      if (significantChanges.length > 0) {
        for (const change of significantChanges) {
          const direction = change.changePercent >= 0 ? 'up' : 'down';
          const absChange = Math.abs(change.changePercent).toFixed(2);
          
          let message = `${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Price ${direction} by ${absChange}%: `;
          message += `${fancyColors.YELLOW}${change.symbol}${fancyColors.RESET} `;
          
          if (change.previousPrice) {
            message += `$${change.previousPrice.toFixed(8)} → $${change.currentPrice.toFixed(8)}`;
          } else {
            message += `New price: $${change.currentPrice.toFixed(8)}`;
          }
          
          // Add volume and market cap if available
          if (change.volume24h) {
            message += ` | Vol: $${change.volume24h.toLocaleString()}`;
          }
          
          if (change.marketCap) {
            message += ` | MCap: $${change.marketCap.toLocaleString()}`;
          }
          
          logApi.info(message);
          
          // Emit price update event for this token
          serviceEvents.emit(SERVICE_EVENTS.TOKEN_PRICE_UPDATE, {
            token_address: change.address,
            token_symbol: change.symbol,
            price: change.currentPrice,
            previous_price: change.previousPrice || 0,
            price_change_percent: change.changePercent,
            market_cap: change.marketCap,
            volume_24h: change.volume24h,
            timestamp: Date.now()
          });
        }
      }
      
      this.lastPriceUpdate = Date.now();
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.RED}Error handling price update:${fancyColors.RESET}`, error);
    }
  }
  
  /**
   * Process a token transaction manually
   * @param {Object} transaction - The transaction data
   * 
   * @deprecated This method is now deprecated in favor of handleTokenTransfer
   * which is called automatically by the Helius WebSocket handler.
   * Keep this method for backward compatibility with test scripts.
   */
  processTokenTransaction(transaction) {
    try {
      // This is now a wrapper around handleTokenTransfer for backward compatibility
      const {
        tokenAddress,
        amount,
        buyer,
        seller,
        signature,
        type // 'buy' or 'sell'
      } = transaction;
      
      // Convert to handleTokenTransfer format
      const transferInfo = {
        tokenAddress,
        amount,
        toAddress: buyer,
        fromAddress: seller,
        signature,
        type
      };
      
      // Use the real handler
      this.handleTokenTransfer(transferInfo);
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.RED}Error processing token transaction:${fancyColors.RESET}`, error);
    }
  }
  
  /**
   * Get a list of all monitored tokens
   * @returns {Array} List of monitored tokens
   */
  getMonitoredTokens() {
    return Array.from(this.monitoredTokens.values());
  }
  
  /**
   * Check if a token is being monitored
   * @param {string} tokenAddress - The token address to check
   * @returns {boolean} True if the token is being monitored
   */
  isTokenMonitored(tokenAddress) {
    return this.monitoredTokens.has(tokenAddress);
  }
  
  /**
   * Refresh price data for all monitored tokens
   */
  async refreshPriceData() {
    try {
      if (this.monitoredTokens.size === 0) return;
      
      // Get token addresses
      const tokenAddresses = Array.from(this.monitoredTokens.keys());
      
      // Get price data
      const priceData = await jupiterClient.getPrices(tokenAddresses);
      
      // Update price cache
      for (const [tokenAddress, price] of Object.entries(priceData)) {
        this.priceCache.set(tokenAddress, {
          price_usd: price,
          last_updated: Date.now()
        });
      }
      
      this.lastPriceUpdate = Date.now();
      logApi.debug(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Refreshed price data for ${tokenAddresses.length} tokens`);
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.RED}Error refreshing price data:${fancyColors.RESET}`, error);
    }
  }
  
  /**
   * Perform service operation (called periodically)
   */
  async performOperation() {
    try {
      // Refresh price data if necessary
      if (Date.now() - this.lastPriceUpdate > 5 * 60 * 1000) { // 5 minutes
        await this.refreshPriceData();
      }
      
      return true;
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.RED}Error in performOperation:${fancyColors.RESET}`, error);
      return false;
    }
  }

  /**
   * Perform operation required by the circuit breaker system
   * This wraps the performOperation method with additional checks
   */
  async onPerformOperation() {
    try {
      // Skip operation if service is not properly initialized or started
      if (!this.isOperational || !this._initialized) {
        logApi.debug(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Service not operational or initialized, skipping operation`);
        return true;
      }
      
      // Check that Helius and Jupiter clients are available
      if (!heliusClient || !jupiterClient) {
        logApi.debug(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Helius or Jupiter client not available, skipping operation`);
        return false;
      }
      
      // Call the actual operation implementation
      return await this.performOperation();
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.RED}Perform operation error:${fancyColors.RESET} ${error.message}`);
      throw error; // Important: re-throw to trigger circuit breaker
    }
  }
}

// Export singleton instance
const tokenMonitorService = new TokenMonitorService();
export default tokenMonitorService;