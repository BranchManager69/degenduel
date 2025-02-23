/*
 * This module is responsible for orchestrating the initialization of all DegenDuel services.
 * It ensures services are registered and initialized in the correct dependency order.
 */

import { logApi } from '../logger-suite/logger.js';
import AdminLogger from '../admin-logger.js';
import ServiceManager from './service-manager.js';
import { SERVICE_NAMES, SERVICE_LAYERS } from './service-constants.js';

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

        // Infrastructure Layer
        logApi.info('\x1b[38;5;196m┏━━━━━━━━━━━━━━━━━━━━━━━ Infrastructure Layer ━━━━━━━━━━━━━━━━━━━━━━┓\x1b[0m');
        ServiceManager.register(walletGeneratorService);
        ServiceManager.register(faucetService, [SERVICE_NAMES.WALLET_GENERATOR]);
        logApi.info('\x1b[38;5;196m┗━━━━━━━━━━━ ✅ Infrastructure Services Registered\x1b[0m');

        // Data Layer
        logApi.info('\x1b[38;5;208m┏━━━━━━━━━━━━━━━━━━━━━━━ Data Layer ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓\x1b[0m');
        ServiceManager.register(tokenSyncService);
        ServiceManager.register(marketDataService, [SERVICE_NAMES.TOKEN_SYNC]);
        ServiceManager.register(tokenWhitelistService);
        logApi.info('\x1b[38;5;208m┗━━━━━━━━━━━ ✅ Data Services Registered\x1b[0m');

        // Contest Layer
        logApi.info('\x1b[38;5;226m┏━━━━━━━━━━━━━━━━━━━━━━━ Contest Layer ━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓\x1b[0m');
        // Log service names before registration
        logApi.info('Registering Contest Layer services:', {
            contestEvaluation: SERVICE_NAMES.CONTEST_EVALUATION,
            achievement: SERVICE_NAMES.ACHIEVEMENT,
            referral: SERVICE_NAMES.REFERRAL
        });
        
        ServiceManager.register(contestEvaluationService, [SERVICE_NAMES.MARKET_DATA]);
        ServiceManager.register(achievementService, [SERVICE_NAMES.CONTEST_EVALUATION]);
        ServiceManager.register(referralService, [SERVICE_NAMES.CONTEST_EVALUATION]);
        logApi.info('\x1b[38;5;226m┗━━━━━━━━━━━ ✅ Contest Services Registered\x1b[0m');

        // Wallet Layer
        logApi.info('\x1b[38;5;82m┏━━━━━━━━━━━━━━━━━━━━━━━ Wallet Layer ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓\x1b[0m');
        ServiceManager.register(vanityWalletService, [SERVICE_NAMES.WALLET_GENERATOR]);
        ServiceManager.register(contestWalletService, [SERVICE_NAMES.VANITY_WALLET, SERVICE_NAMES.CONTEST_EVALUATION]);
        ServiceManager.register(adminWalletService, [SERVICE_NAMES.CONTEST_WALLET]);
        ServiceManager.register(walletRakeService, [SERVICE_NAMES.CONTEST_WALLET]);
        logApi.info('\x1b[38;5;82m┗━━━━━━━━━━━ ✅ Wallet Services Registered\x1b[0m');

        // Register dependencies
        this.registerDependencies();

        logApi.info('\x1b[38;5;199m╰─────────────────────────────────────────────────────────────╯\x1b[0m\n');
    }

    static registerDependencies() {
        // Infrastructure Layer Dependencies
        ServiceManager.addDependency(SERVICE_NAMES.FAUCET, SERVICE_NAMES.WALLET_GENERATOR);

        // Data Layer Dependencies
        ServiceManager.addDependency(SERVICE_NAMES.MARKET_DATA, SERVICE_NAMES.TOKEN_SYNC);

        // Contest Layer Dependencies
        ServiceManager.addDependency(SERVICE_NAMES.CONTEST_EVALUATION, SERVICE_NAMES.MARKET_DATA);
        ServiceManager.addDependency(SERVICE_NAMES.ACHIEVEMENT, SERVICE_NAMES.CONTEST_EVALUATION);
        ServiceManager.addDependency(SERVICE_NAMES.REFERRAL, SERVICE_NAMES.CONTEST_EVALUATION);

        // Wallet Layer Dependencies
        ServiceManager.addDependency(SERVICE_NAMES.VANITY_WALLET, SERVICE_NAMES.WALLET_GENERATOR);
        ServiceManager.addDependency(SERVICE_NAMES.CONTEST_WALLET, [SERVICE_NAMES.VANITY_WALLET, SERVICE_NAMES.CONTEST_EVALUATION]);
        ServiceManager.addDependency(SERVICE_NAMES.ADMIN_WALLET, SERVICE_NAMES.CONTEST_WALLET);
        ServiceManager.addDependency(SERVICE_NAMES.WALLET_RAKE, SERVICE_NAMES.CONTEST_WALLET);
    }

    static async initializeServices() {
        logApi.info('\n\x1b[38;5;199m╭───────────────── Initializing Services ─────────────────╮\x1b[0m');

        try {
            const results = await ServiceManager.initializeAll();
            
            // Log initialization results
            logApi.info('\x1b[38;5;82m┏━━━━━━━━━━━ Initialization Results ━━━━━━━━━━━┓\x1b[0m');
            if (results.initialized.length > 0) {
                logApi.info(`\x1b[38;5;82m┃ Successfully initialized: ${results.initialized.length} services\x1b[0m`);
                results.initialized.forEach(service => {
                    logApi.info(`\x1b[38;5;82m┃ ✓ ${service}\x1b[0m`);
                });
            }
            if (results.failed.length > 0) {
                logApi.error(`\x1b[38;5;196m┃ Failed to initialize: ${results.failed.length} services\x1b[0m`);
                results.failed.forEach(service => {
                    logApi.error(`\x1b[38;5;196m┃ ✗ ${service}\x1b[0m`);
                });
            }
            logApi.info('\x1b[38;5;82m┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\x1b[0m');

            // Log to admin logger
            await AdminLogger.logAction(
                'SYSTEM',
                AdminLogger.Actions.SERVICE.START,
                {
                    initialized: results.initialized,
                    failed: results.failed
                }
            );

            return results;
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
            logApi.error('\x1b[38;5;196m┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\x1b[0m');
            throw error;
        }

        logApi.info('\x1b[38;5;199m╰─────────────────────────────────────────────────────────────╯\x1b[0m\n');
    }
}

export default ServiceInitializer; 