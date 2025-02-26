/**
 * COMPATIBILITY LAYER - Adapter for the new SolanaService
 * 
 * This file maintains backward compatibility with existing code while
 * using the new service-based implementation. It's a transitional adapter.
 * 
 * @deprecated This adapter is maintained for backward compatibility. 
 * New code should use SolanaService directly.
 */

import solanaService from '../../services/solanaService.js';
import { logApi } from '../logger-suite/logger.js';
import { SERVICE_NAMES } from '../service-suite/service-constants.js';

// Keep this for backward compatibility
export const SOLANA_SERVICES = [
    SERVICE_NAMES.CONTEST_WALLET,
    SERVICE_NAMES.WALLET_RAKE,
    SERVICE_NAMES.ADMIN_WALLET
];

/**
 * Adapter class that forwards calls to the new SolanaService implementation
 * @deprecated Use solanaService directly in new code
 */
class SolanaServiceManager {
    // Forward properties to the actual service
    static get connection() {
        return solanaService.connection;
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
    
    static getConnection() {
        try {
            return solanaService.getConnection();
        } catch (error) {
            // Maintain original error format for compatibility
            throw new Error('Solana Service Manager not initialized');
        }
    }
}

export default SolanaServiceManager;