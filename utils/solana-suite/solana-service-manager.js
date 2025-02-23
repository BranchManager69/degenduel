import { Connection } from '@solana/web3.js';
import os from 'os';
import { validateSolanaConfig } from '../../config/config.js';
import { WalletGenerator } from './wallet-generator.js';
import { VanityPool } from './vanity-pool.js';
import { FaucetManager } from './faucet-manager.js';
import { logApi } from '../logger-suite/logger.js';
import ServiceManager, { SERVICE_NAMES, SERVICE_LAYERS } from '../service-suite/service-manager.js';

/**
 * Manages Solana-specific functionality and coordinates with the main ServiceManager
 */
class SolanaServiceManager {
    static connection = null;
    static isInitialized = false;
    static monitoringInterval = null;

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

            // Initialize infrastructure services
            await this.initializeInfrastructureServices();

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

    static async initializeInfrastructureServices() {
        // Initialize wallet generator service
        const walletGeneratorConfig = {
            maxWorkers: Math.max(1, os.cpus().length - 1),
            targetUtilization: 0.80
        };
        await WalletGenerator.initialize();
        ServiceManager.register(WalletGenerator, [], walletGeneratorConfig);

        // Initialize vanity pool service
        const vanityPoolConfig = {
            maxWorkers: Math.max(1, os.cpus().length - 1),
            targetUtilization: 0.80
        };
        await VanityPool.initialize();
        ServiceManager.register(VanityPool, [], vanityPoolConfig);

        // Initialize faucet service
        await FaucetManager.initialize();
        ServiceManager.register(FaucetManager, [SERVICE_NAMES.WALLET_GENERATOR]);

        // Update service states
        await this.updateInfrastructureServiceStates();
    }

    static async updateInfrastructureServiceStates() {
        const services = [
            {
                name: SERVICE_NAMES.WALLET_GENERATOR,
                config: {
                    maxWorkers: WalletGenerator.maxWorkers,
                    targetUtilization: WalletGenerator.targetUtilization
                }
            },
            {
                name: SERVICE_NAMES.VANITY_WALLET,
                config: {
                    maxWorkers: VanityPool.maxWorkers,
                    targetUtilization: VanityPool.targetUtilization
                }
            },
            {
                name: SERVICE_NAMES.FAUCET,
                config: FaucetManager.config
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

    static async cleanup() {
        try {
            logApi.info('Starting Solana Service Manager cleanup...');

            // Clear monitoring interval
            if (this.monitoringInterval) {
                clearInterval(this.monitoringInterval);
                this.monitoringInterval = null;
            }

            // Clean up infrastructure services through ServiceManager
            const infraServices = ServiceManager.getServicesInLayer(SERVICE_LAYERS.INFRASTRUCTURE);
            for (const serviceName of infraServices) {
                try {
                    await ServiceManager.markServiceStopped(serviceName);
                } catch (error) {
                    logApi.error(`Error stopping ${serviceName}:`, error);
                }
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
}

export default SolanaServiceManager; 