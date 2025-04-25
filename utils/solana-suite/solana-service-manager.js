/**
 * COMPATIBILITY LAYER - Adapter for the new SolanaService
 * 
 * This file maintains backward compatibility with existing code while
 * using the new service-based implementation. It's a transitional adapter.
 * 
 * It now forwards RPC methods through the central request queue to provide
 * global rate limiting across the entire application.
 * 
 * @deprecated This adapter is maintained for backward compatibility. 
 * New code should use SolanaService directly.
 */

import solanaService from '../../services/solanaService.js';
import { logApi } from '../logger-suite/logger.js';
import { SERVICE_NAMES } from '../service-suite/service-constants.js';
import { Connection } from '@solana/web3.js';

// Keep this for backward compatibility
export const SOLANA_SERVICES = [
    SERVICE_NAMES.CONTEST_WALLET,
    SERVICE_NAMES.WALLET_RAKE,
    SERVICE_NAMES.ADMIN_WALLET
];

/**
 * Enhanced proxy handler for Connection objects that routes all calls through
 * the centralized rate-limited queue
 */
class ConnectionProxy {
    constructor(actualConnection) {
        this.actualConnection = actualConnection;
        
        // Create a proxy to intercept all method calls
        return new Proxy(this, {
            get: (target, prop) => {
                // Special case for rpcEndpoint to avoid going through the queue
                if (prop === 'rpcEndpoint') {
                    return this.actualConnection.rpcEndpoint;
                }
                
                // If the prop is a function on the actual connection
                if (typeof this.actualConnection[prop] === 'function') {
                    // Return a function that routes through the central queue
                    return (...args) => {
                        return solanaService.executeRpcRequest(
                            () => this.actualConnection[prop](...args),
                            prop
                        );
                    };
                }
                
                // Otherwise return the actual property
                return this.actualConnection[prop];
            }
        });
    }
}

/**
 * Adapter class that forwards calls to the new SolanaService implementation
 * with enhanced rate limiting through the central request queue
 * @deprecated Use solanaService directly in new code
 */
class SolanaServiceManager {
    // Connection property that returns a proxied connection object
    static get connection() {
        const actualConnection = solanaService.connection;
        if (!actualConnection) return null;
        
        // Return a proxy to the actual connection that routes all calls through the central queue
        return new ConnectionProxy(actualConnection);
    }
    
    static get isInitialized() {
        return solanaService.isInitialized;
    }
    
    // Forward methods to the actual service
    static async initialize() {
        logApi.warn('SolanaServiceManager.initialize is deprecated. Using solanaService instead.');
        
        if (!solanaService.isInitialized) {
            try {
                await solanaService.initialize();
                
                // If the service isn't automatically started, start it
                if (!solanaService.isStarted) {
                    await solanaService.start();
                }
                
                return solanaService.isInitialized;
            } catch (error) {
                logApi.error('Failed to initialize Solana via new service:', error);
                throw error;
            }
        }
        
        return solanaService.isInitialized;
    }
    
    static async cleanup() {
        logApi.warn('SolanaServiceManager.cleanup is deprecated. Using solanaService.stop instead.');
        return solanaService.stop();
    }
    
    static startConnectionMonitoring() {
        logApi.warn('SolanaServiceManager.startConnectionMonitoring is deprecated. Connection monitoring is now handled automatically by the service.');
        // No action needed - the service handles monitoring
        return true;
    }
    
    static async reconnect() {
        logApi.warn('SolanaServiceManager.reconnect is deprecated. Using solanaService.reconnect instead.');
        return solanaService.reconnect();
    }
    
    /**
     * Get a Solana connection that routes all calls through the central request queue
     * for proper rate limiting across the entire application
     */
    static getConnection() {
        try {
            const actualConnection = solanaService.getConnection();
            
            // Return a proxied connection to intercept all method calls
            return new ConnectionProxy(actualConnection);
        } catch (error) {
            // Maintain original error format for compatibility
            throw new Error('Solana Service Manager not initialized');
        }
    }
    
    /**
     * Execute an RPC method directly through the central request queue
     * This is the preferred way for services to execute Solana RPC methods
     * @param {string} methodName - Name of the Connection method to call
     * @param {...any} args - Arguments to pass to the method
     * @returns {Promise<any>} - Result of the RPC call
     */
    static async executeConnectionMethod(methodName, ...args) {
        return solanaService.executeConnectionMethod(methodName, ...args);
    }
    
    /**
     * Execute an arbitrary RPC request function through the central queue
     * This allows executing custom RPC calls through the global rate limiter
     * @param {Function} rpcCall - Function that performs the RPC call
     * @param {string} callName - Name of the call for logging
     * @returns {Promise<any>} - Result of the RPC call
     */
    static async executeRpcRequest(rpcCall, callName = 'custom-rpc') {
        return solanaService.executeRpcRequest(rpcCall, callName);
    }
}

export default SolanaServiceManager;