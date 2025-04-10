// services/solana-engine/connection-manager.js

/**
 * Connection Manager for Solana RPC endpoints
 * 
 * Simple implementation using a single Helius endpoint
 */

import { Connection } from '@solana/web3.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Default commitment level
const DEFAULT_COMMITMENT = 'confirmed';

/**
 * Simple Connection Manager for Solana RPC access
 * Uses a single Helius endpoint
 */
class ConnectionManager {
  constructor() {
    // Singleton instance
    if (ConnectionManager.instance) {
      return ConnectionManager.instance;
    }
    ConnectionManager.instance = this;
    
    this.connection = null;
    this.endpoint = null;
    this.initialized = false;
  }

  /**
   * Initialize the connection manager
   * @returns {Promise<boolean>} - Initialization success
   */
  async initialize() {
    try {
      logApi.info('Initializing ConnectionManager');
      
      // Get RPC endpoint from environment variables
      const rpcEndpoint = process.env.SOLANA_MAINNET_HTTP || process.env.SOLANA_RPC_ENDPOINT;
      
      if (!rpcEndpoint) {
        logApi.error('SOLANA_MAINNET_HTTP or SOLANA_RPC_ENDPOINT not found in environment variables');
        return false;
      }
      
      // Create connection with default commitment level
      this.connection = new Connection(rpcEndpoint, {
        commitment: DEFAULT_COMMITMENT,
        confirmTransactionInitialTimeout: 60000, // 60 seconds
      });
      
      // Test the connection with a simple RPC call
      await this.connection.getSlot();
      
      this.endpoint = rpcEndpoint;
      this.initialized = true;
      
      logApi.info('Helius connection established successfully');
      return true;
    } catch (error) {
      logApi.error(`Failed to initialize ConnectionManager: ${error.message}`);
      return false;
    }
  }

  /**
   * Get the Solana connection
   * @returns {Connection} - Solana web3.js Connection object
   */
  getConnection() {
    if (!this.initialized || !this.connection) {
      throw new Error('ConnectionManager not initialized');
    }
    
    return this.connection;
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
    
    return {
      status: 'connected',
      endpoint: 'helius'
    };
  }

  /**
   * Execute an RPC call
   * @param {Function} rpcCall - Function that takes a connection and returns a promise
   * @returns {Promise<any>} - Result of the RPC call
   */
  async executeRpc(rpcCall) {
    if (!this.initialized || !this.connection) {
      await this.initialize();
      if (!this.initialized) {
        throw new Error('Failed to initialize ConnectionManager');
      }
    }
    
    try {
      return await rpcCall(this.connection);
    } catch (err) {
      logApi.error(`RPC error: ${err.message}`);
      throw err;
    }
  }

  /**
   * Execute a connection method
   * @param {string} methodName - Name of the method to call
   * @param {Array} args - Arguments for the method
   * @returns {Promise<any>} - Result of the method call
   */
  async executeMethod(methodName, args = []) {
    return this.executeRpc(connection => {
      return connection[methodName](...args);
    });
  }
}

// Create and export a singleton instance
const connectionManager = new ConnectionManager();
export default connectionManager;