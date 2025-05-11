// services/dialect/index.js

/**
 * Dialect Services Module
 * 
 * Entry point for Dialect integration services including:
 * - Blinks Registry for Solana Actions
 * 
 * @version 1.0.0
 * @created 2025-05-11
 */

import { logApi } from '../../utils/logger-suite/logger.js';
import { BaseService } from '../../utils/service-suite/base-service.js';
import { SERVICE_NAMES, getServiceMetadata, DEFAULT_CIRCUIT_BREAKER_CONFIG } from '../../utils/service-suite/service-constants.js';
import blinksRegistry from './blinks-registry.js';

/**
 * Dialect Service
 * 
 * Manages integration with Dialect services including Blinks
 */
class DialectService extends BaseService {
  constructor() {
    const serviceName = SERVICE_NAMES.DIALECT_SERVICE || 'dialect_service';
    const metadata = getServiceMetadata(serviceName) || {};
    super({
      name: serviceName,
      description: metadata.description || 'Manages Dialect Protocol integrations (Blinks, etc.)',
      dependencies: metadata.dependencies || [SERVICE_NAMES.SOLANA_ENGINE],
      layer: metadata.layer || 'INTEGRATION',
      criticalLevel: metadata.criticalLevel || 'MEDIUM',
      checkIntervalMs: metadata.checkIntervalMs || 0,
      circuitBreaker: {
        ...(metadata.circuitBreaker || DEFAULT_CIRCUIT_BREAKER_CONFIG),
        enabled: metadata.circuitBreaker?.enabled !== undefined ? metadata.circuitBreaker.enabled : false
      },
      autostart: false
    });
    
    this.dialect = null;
    this.initialized = false;
    this.registeredBlinks = [];
  }
  
  /**
   * Initialize the Dialect service
   */
  async initialize() {
    try {
      const logger = this.logger || logApi;
      logger.info('Initializing Dialect Service');
      
      this.dialect = await blinksRegistry.initializeDialect();
      this.registeredBlinks = await blinksRegistry.registerDefaultBlinks(this.dialect);
      
      this.initialized = true;
      logger.info('Dialect Service initialized successfully', {
        registeredBlinks: this.registeredBlinks.length,
      });
      
      return true;
    } catch (error) {
      const logger = this.logger || logApi;
      logger.error('Failed to initialize Dialect Service', { error });
      return false;
    }
  }
  
  /**
   * Get all registered blinks
   * 
   * @returns {Promise<Array>} - Array of registered blinks
   */
  async getAllBlinks() {
    if (!this.initialized) {
      await this.initialize();
    }
    
    return blinksRegistry.getAllBlinks(this.dialect);
  }
  
  /**
   * Get a blink by ID
   *
   * @param {string} blinkId - The ID of the blink to get
   * @returns {Promise<Object>} - The blink data
   */
  async getBlink(blinkId) {
    if (!this.initialized) {
      await this.initialize();
    }

    return blinksRegistry.getBlink(this.dialect, blinkId);
  }

  /**
   * Track usage of a blink with Dialect
   *
   * @param {string} blinkId - ID of the blink that was used
   * @param {string} walletAddress - Wallet address of the user
   * @param {Object} metadata - Additional metadata about the usage
   * @returns {Promise<Object>} - Result of tracking
   */
  async trackBlinkUsage(blinkId, walletAddress, metadata = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      // First validate the blink exists in our registry
      const blink = await this.getBlink(blinkId);

      if (!blink) {
        throw new Error(`Blink ${blinkId} not found in registry`);
      }

      // Track usage with Dialect (if they provide a method for this)
      // This is a placeholder - Dialect SDK may not have this functionality yet
      // return this.dialect.blinks.trackUsage(blinkId, walletAddress, metadata);

      // For now, just log that we would track usage
      this.logger.info(`[PLACEHOLDER] Tracked blink usage: ${blinkId} by ${walletAddress}`, {
        blink_id: blinkId,
        wallet_address: walletAddress,
        metadata
      });

      return { success: true };
    } catch (error) {
      this.logger.error(`Error tracking blink usage: ${error.message}`, {
        error,
        blink_id: blinkId,
        wallet_address: walletAddress
      });
      throw error;
    }
  }
  
  /**
   * Exchange Dialect OAuth code for access token
   *
   * @param {string} code - OAuth authorization code
   * @returns {Promise<Object>} - Token response with access_token, refresh_token, and expires_in
   */
  async exchangeDialectCode(code) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      // This is a placeholder implementation
      // Dialect SDK may provide a proper method to exchange code for token
      this.logger.info('Exchanging OAuth code for Dialect access token');

      // For now, return a mock token response
      return {
        access_token: `mock_access_token_${crypto.randomUUID()}`,
        refresh_token: `mock_refresh_token_${crypto.randomUUID()}`,
        expires_in: 3600 // 1 hour
      };
    } catch (error) {
      this.logger.error(`Error exchanging Dialect OAuth code: ${error.message}`, { error });
      throw error;
    }
  }

  /**
   * Register a new blink
   *
   * @param {Object} blinkData - The blink data to register
   * @returns {Promise<Object>} - The registered blink
   */
  async registerBlink(blinkData) {
    if (!this.initialized) {
      await this.initialize();
    }
    
    return blinksRegistry.registerBlink(this.dialect, blinkData);
  }
  
  /**
   * Update a blink
   * 
   * @param {string} blinkId - The ID of the blink to update
   * @param {Object} updateData - The data to update
   * @returns {Promise<Object>} - The updated blink
   */
  async updateBlink(blinkId, updateData) {
    if (!this.initialized) {
      await this.initialize();
    }
    
    return blinksRegistry.updateBlink(this.dialect, blinkId, updateData);
  }
  
  /**
   * Delete a blink
   * 
   * @param {string} blinkId - The ID of the blink to delete
   * @returns {Promise<boolean>} - Whether the deletion was successful
   */
  async deleteBlink(blinkId) {
    if (!this.initialized) {
      await this.initialize();
    }
    
    return blinksRegistry.deleteBlink(this.dialect, blinkId);
  }
  
  /**
   * Start the Dialect service
   */
  async start() {
    if (!this.initialized) {
      await this.initialize();
    }
    
    this.logger.info('Dialect Service started');
    return true;
  }
  
  /**
   * Stop the Dialect service
   */
  async stop() {
    const logger = this.logger || logApi;
    logger.info('Dialect Service stopped');
    return true;
  }
}

// Create and export a singleton instance
const dialectService = new DialectService();
export default dialectService;

// Export other utilities
export { blinksRegistry };