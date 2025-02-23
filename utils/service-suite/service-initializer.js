/*
 * This module is responsible for orchestrating the initialization of all DegenDuel services.
 * It ensures services are registered and initialized in the correct dependency order.
 */

import { logApi } from '../logger-suite/logger.js';
import AdminLogger from '../admin-logger.js';
import ServiceManager from './service-manager.js';
import { SERVICE_LAYERS } from './service-constants.js';

// Import all services
import achievementService from '../../services/achievementService.js';
import adminWalletService from '../../services/adminWalletService.js';
import contestEvaluationService from '../../services/contestEvaluationService.js';
import contestWalletService from '../../services/contestWalletService.js';
import marketDataService from '../../services/marketDataService.js';
import referralService from '../../services/referralService.js';
import tokenSyncService from '../../services/tokenSyncService.js';
import tokenWhitelistService from '../../services/tokenWhitelistService.js';
import vanityWalletService from '../../services/vanityWalletService.js';
import walletRakeService from '../../services/walletRakeService.js';
import faucetService from '../../services/faucetService.js';
import walletGeneratorService from '../../services/walletGenerationService.js';

class ServiceInitializer {
    static async registerCoreServices() {
        logApi.info('\n\x1b[38;5;199m╭───────────────── Registering Core Services ─────────────────╮\x1b[0m');

        // Register services by layer
        await this.registerInfrastructureLayer();
        await this.registerDataLayer();
        await this.registerContestLayer();
        await this.registerWalletLayer();

        logApi.info('\x1b[38;5;199m╰─────────────────────────────────────────────────────────────╯\x1b[0m\n');
    }

    static async registerInfrastructureLayer() {
        logApi.info('\x1b[38;5;196m┏━━━━━━━━━━━━━━━━━━━━━━━ \x1b[1m\x1b[7mInfrastructure Layer\x1b[0m\x1b[38;5;196m ━━━━━━━━━━━━━━━━━━━━━━━┓\x1b[0m');
        
        // Register infrastructure services
        ServiceManager.register(walletGeneratorService);
        ServiceManager.register(faucetService, []);
        
        logApi.info('\x1b[38;5;196m┗━━━━━━━━━━━ ✅ Infrastructure Services Registered\x1b[0m\n');
    }

    static async registerDataLayer() {
        logApi.info('\x1b[38;5;208m┏━━━━━━━━━━━━━━━━━━━━━━━ \x1b[1m\x1b[7mData Layer\x1b[0m\x1b[38;5;208m ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓\x1b[0m');
        
        // Register data layer services
        ServiceManager.register(tokenSyncService);
        ServiceManager.register(marketDataService);
        ServiceManager.register(tokenWhitelistService);
        
        logApi.info('\x1b[38;5;208m┗━━━━━━━━━━━ ✅ Data Services Registered\x1b[0m\n');
    }

    static async registerContestLayer() {
        logApi.info('\x1b[38;5;226m┏━━━━━━━━━━━━━━━━━━━━━━━ \x1b[1m\x1b[7mContest Layer\x1b[0m\x1b[38;5;226m ━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓\x1b[0m');
        
        // Register contest layer services
        ServiceManager.register(contestEvaluationService.service);
        ServiceManager.register(achievementService);
        ServiceManager.register(referralService);
        
        logApi.info('\x1b[38;5;226m┗━━━━━━━━━━━ ✅ Contest Services Registered\x1b[0m\n');
    }

    static async registerWalletLayer() {
        logApi.info('\x1b[38;5;46m┏━━━━━━━━━━━━━━━━━━━━━━━ \x1b[1m\x1b[7mWallet Layer\x1b[0m\x1b[38;5;46m ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓\x1b[0m');
        
        // Register wallet layer services
        ServiceManager.register(vanityWalletService);
        ServiceManager.register(contestWalletService);
        ServiceManager.register(adminWalletService);
        ServiceManager.register(walletRakeService);
        
        logApi.info('\x1b[38;5;46m┗━━━━━━━━━━━ ✅ Wallet Services Registered\x1b[0m\n');
    }

    static async initializeServices() {
        logApi.info('\n\x1b[38;5;199m╭───────────────── Initializing Services ─────────────────╮\x1b[0m');

        try {
            const results = await ServiceManager.initializeAll();
            
            // Log initialization results
            logApi.info('\x1b[38;5;82m┏━━━━━━━━━━━ Initialization Results ━━━━━━━━━━━┓\x1b[0m');
            logApi.info(`\x1b[38;5;82m┃ Successfully initialized: ${results.initialized.length} services\x1b[0m`);
            if (results.failed.length > 0) {
                logApi.error(`\x1b[38;5;196m┃ Failed to initialize: ${results.failed.length} services\x1b[0m`);
                results.failed.forEach(service => {
                    logApi.error(`\x1b[38;5;196m┃ - ${service}\x1b[0m`);
                });
            }
            logApi.info('\x1b[38;5;82m┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\x1b[0m');

            // Log to admin logger
            await AdminLogger.logAction(
                'SYSTEM',
                AdminLogger.Actions.SERVICE.START,
                {
                    initialized: results.initialized,
                    failed: results.failed
                }
            );

        } catch (error) {
            logApi.error('\x1b[38;5;196m┏━━━━━━━━━━━ Service Initialization Failed ━━━━━━━━━━━┓\x1b[0m');
            logApi.error(`\x1b[38;5;196m┃ Error: ${error.message}\x1b[0m`);
            logApi.error('\x1b[38;5;196m┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\x1b[0m');
            throw error;
        }

        logApi.info('\x1b[38;5;199m╰─────────────────────────────────────────────────────────────╯\x1b[0m\n');
    }

    static async cleanup() {
        logApi.info('\n\x1b[38;5;199m╭───────────────── Cleaning Up Services ─────────────────╮\x1b[0m');

        try {
            const results = await ServiceManager.cleanup();
            
            logApi.info('\x1b[38;5;82m┏━━━━━━━━━━━ Cleanup Results ━━━━━━━━━━━┓\x1b[0m');
            logApi.info(`\x1b[38;5;82m┃ Successfully cleaned: ${results.successful.length} services\x1b[0m`);
            if (results.failed.length > 0) {
                logApi.error(`\x1b[38;5;196m┃ Failed to clean: ${results.failed.length} services\x1b[0m`);
                results.failed.forEach(failure => {
                    logApi.error(`\x1b[38;5;196m┃ - ${failure.service}: ${failure.error}\x1b[0m`);
                });
            }
            logApi.info('\x1b[38;5;82m┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\x1b[0m');

            // Log to admin logger
            await AdminLogger.logAction(
                'SYSTEM',
                AdminLogger.Actions.SERVICE.STOP,
                {
                    successful: results.successful,
                    failed: results.failed
                }
            );

        } catch (error) {
            logApi.error('\x1b[38;5;196m┏━━━━━━━━━━━ Service Cleanup Failed ━━━━━━━━━━━┓\x1b[0m');
            logApi.error(`\x1b[38;5;196m┃ Error: ${error.message}\x1b[0m`);
            logApi.error('\x1b[38;5;196m┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\x1b[0m');
            throw error;
        }

        logApi.info('\x1b[38;5;199m╰─────────────────────────────────────────────────────────────╯\x1b[0m\n');
    }
}

export default ServiceInitializer; 