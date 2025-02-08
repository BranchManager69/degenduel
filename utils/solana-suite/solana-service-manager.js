import { Connection } from '@solana/web3.js';
import os from 'os';
import { logApi } from '../logger-suite/logger.js';
import { validateSolanaConfig } from '../../config/config.js';
import { WalletGenerator } from './wallet-generator.js';
import { VanityPool } from './vanity-pool.js';
import { FaucetManager } from './faucet-manager.js';
import ServiceManager, { SERVICE_NAMES } from '../service-manager.js';

class SolanaServiceManager {
    static instance = null;
    static connection = null;
    static isInitialized = false;
    static monitoringInterval = null;
    static activeServices = new Set();

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

            // Initialize wallet generator
            await WalletGenerator.initialize();
            this.activeServices.add('wallet-generator');

            // Initialize vanity pool with optimal settings
            VanityPool.maxWorkers = Math.max(1, os.cpus().length - 1);
            VanityPool.targetUtilization = 0.80;
            this.activeServices.add('vanity-pool');

            // Initialize faucet manager
            await FaucetManager.checkBalance();
            this.activeServices.add('faucet-manager');

            // Update service states
            await this.updateServiceStates();

            this.isInitialized = true;
            logApi.info('Solana Service Manager initialized successfully');

            // Start monitoring connection
            this.startConnectionMonitoring();

        } catch (error) {
            logApi.error('Failed to initialize Solana Service Manager:', error);
            await this.cleanup(); // Attempt cleanup on initialization failure
            throw error;
        }
    }

    static async updateServiceStates() {
        const services = [
            {
                name: SERVICE_NAMES.VANITY_WALLET,
                config: {
                    max_workers: VanityPool.maxWorkers,
                    target_utilization: VanityPool.targetUtilization
                }
            },
            {
                name: SERVICE_NAMES.ADMIN_WALLET,
                config: {
                    cache_ttl: WalletGenerator.walletCache.ttl
                }
            }
        ];

        for (const service of services) {
            await ServiceManager.updateServiceState(
                service.name,
                {
                    running: true,
                    status: 'active',
                    last_check: new Date().toISOString()
                },
                service.config
            );
        }
    }

    static startConnectionMonitoring() {
        // Clear any existing interval
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
        }

        this.monitoringInterval = setInterval(async () => {
            try {
                await this.connection.getVersion();
            } catch (error) {
                logApi.error('Solana connection error:', error);
                // Attempt to reconnect
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

    static getInstance() {
        if (!this.instance) {
            this.instance = new SolanaServiceManager();
        }
        return this.instance;
    }

    static getConnection() {
        if (!this.connection) {
            throw new Error('Solana Service Manager not initialized');
        }
        return this.connection;
    }

    // Cleanup method
    static async cleanup() {
        try {
            logApi.info('Starting Solana Service Manager cleanup...');

            // Clear monitoring interval
            if (this.monitoringInterval) {
                clearInterval(this.monitoringInterval);
                this.monitoringInterval = null;
            }

            // Cleanup active services
            for (const service of this.activeServices) {
                try {
                    switch (service) {
                        case 'wallet-generator':
                            await WalletGenerator.cleanupCache();
                            break;
                        case 'vanity-pool':
                            VanityPool.stopUtilizationMonitoring();
                            break;
                        case 'faucet-manager':
                            // Add any faucet cleanup if needed
                            break;
                    }
                } catch (error) {
                    logApi.error(`Error cleaning up ${service}:`, error);
                }
            }

            // Clear connection
            this.connection = null;
            this.isInitialized = false;
            this.activeServices.clear();

            // Update service states one final time
            await this.updateServiceStates();

            logApi.info('Solana Service Manager cleanup completed');
        } catch (error) {
            logApi.error('Error during Solana Service Manager cleanup:', error);
            throw error;
        }
    }
}

export default SolanaServiceManager; 