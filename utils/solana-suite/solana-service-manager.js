import { Connection } from '@solana/web3.js';
import os from 'os';
import { validateSolanaConfig } from '../../config/config.js';
import WalletGenerator from '../../services/walletGenerationService.js';
import { VanityPool } from './vanity-pool.js';
import FaucetManager from '../../services/faucetService.js';
import { logApi } from '../logger-suite/logger.js';
import serviceManager from '../service-suite/service-manager.js';
import { SERVICE_NAMES, SERVICE_LAYERS } from '../service-suite/service-constants.js';

const SOLANA_SERVICES = [
    SERVICE_NAMES.WALLET_GENERATOR,
    SERVICE_NAMES.FAUCET,
    SERVICE_NAMES.TOKEN_SYNC,
    SERVICE_NAMES.MARKET_DATA,
    SERVICE_NAMES.TOKEN_WHITELIST,
    SERVICE_NAMES.CONTEST_EVALUATION,
    SERVICE_NAMES.ACHIEVEMENT,
    SERVICE_NAMES.REFERRAL,
    SERVICE_NAMES.CONTEST_WALLET,
    SERVICE_NAMES.VANITY_WALLET,
    SERVICE_NAMES.WALLET_RAKE,
    SERVICE_NAMES.ADMIN_WALLET
];

/**
 * Manages Solana-specific functionality and coordinates with the main ServiceManager
 */
class SolanaServiceManager {
    static connection = null;
    static isInitialized = false;
    static monitoringInterval = null;
    static vanityPool = null;  // Add instance storage

    static async initialize() {
        if (this.isInitialized) return;

        try {
            // Validate configuration
            validateSolanaConfig();

            // Initialize Solana connection with failover
            this.connection = new Connection(
                process.env.QUICKNODE_MAINNET_HTTP,
                {
                    commitment: 'confirmed',
                    confirmTransactionInitialTimeout: 120000,
                    wsEndpoint: process.env.QUICKNODE_MAINNET_WSS
                }
            );

            // Test connection
            await this.connection.getVersion();

            // Start monitoring connection
            this.startConnectionMonitoring();

            this.isInitialized = true;
            logApi.info('Solana Service Manager initialized successfully');

        } catch (error) {
            logApi.error('Failed to initialize Solana Service Manager:', error);
            await this.cleanup();
            throw error;
        }
    }

    static async cleanup() {
        try {
            logApi.info('Starting Solana Service Manager cleanup...');

            // Clear monitoring interval
            if (this.monitoringInterval) {
                clearInterval(this.monitoringInterval);
                this.monitoringInterval = null;
            }

            // Clear connection
            this.connection = null;
            this.isInitialized = false;

            logApi.info('Solana Service Manager cleanup completed');
        } catch (error) {
            logApi.error('Error during Solana Service Manager cleanup:', error);
            throw error;
        }
    }

    static startConnectionMonitoring() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
        }

        this.monitoringInterval = setInterval(async () => {
            try {
                await this.connection.getVersion();
            } catch (error) {
                logApi.error('Solana connection error:', error);
                await this.reconnect();
            }
        }, 30000); // Check every 30 seconds
    }

    static async reconnect() {
        try {
            this.connection = new Connection(
                process.env.QUICKNODE_MAINNET_HTTP,
                {
                    commitment: 'confirmed',
                    confirmTransactionInitialTimeout: 120000,
                    wsEndpoint: process.env.QUICKNODE_MAINNET_WSS
                }
            );
            await this.connection.getVersion();
            logApi.info('Solana connection re-established');
        } catch (error) {
            logApi.error('Failed to reconnect to Solana:', error);
        }
    }

    static getConnection() {
        if (!this.connection) {
            throw new Error('Solana Service Manager not initialized');
        }
        return this.connection;
    }
}

export default SolanaServiceManager; 