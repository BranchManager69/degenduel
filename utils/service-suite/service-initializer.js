/*
 * This module is responsible for orchestrating the initialization of all DegenDuel services.
 * It ensures services are registered and initialized in the correct dependency order.
 */

import { logApi } from '../logger-suite/logger.js';
import AdminLogger from '../admin-logger.js';
import serviceManager from './service-manager.js';
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
import walletRakeService from '../../services/walletRakeService.js';
import liquidityService from '../../services/liquidityService.js';
import walletGeneratorService from '../../services/walletGenerationService.js';
import levelingService from '../../services/levelingService.js';

class ServiceInitializer {
    static async registerCoreServices() {
        logApi.info('\x1b[38;5;199m╭───────────────<< REGISTERING CORE SERVICES >>───────────────╮\x1b[0m');
        
        try {
            // Infrastructure Layer
            logApi.info('\x1b[38;5;196m┏━━━━━━━━━━━━━━━━━━━━━━━ Infrastructure Layer (1/4) ━━━━━━━━━━━━━━━━━━━━━━━┓\x1b[0m');
            logApi.info('Attempting to register walletGeneratorService...');
            serviceManager.register(walletGeneratorService);
            logApi.info('Attempting to register liquidityService...');
            serviceManager.register(liquidityService, [SERVICE_NAMES.WALLET_GENERATOR]);
            logApi.info('\x1b[38;5;196m┗━━━━━━━━━━━ ✅ Infrastructure Services Registered\x1b[0m');

            // Data Layer
            logApi.info('\x1b[38;5;208m┏━━━━━━━━━━━━━━━━━━━━━━━ Data Layer (2/4) ━━━━━━━━━━━━━━━━━━━━━━━┓\x1b[0m');
            logApi.info('Attempting to register tokenSyncService...');
            serviceManager.register(tokenSyncService);
            logApi.info('Attempting to register marketDataService...');
            serviceManager.register(marketDataService, [SERVICE_NAMES.TOKEN_SYNC]);
            logApi.info('Attempting to register tokenWhitelistService...');
            serviceManager.register(tokenWhitelistService);
            logApi.info('\x1b[38;5;208m┗━━━━━━━━━━━ ✅ Data Services Registered\x1b[0m');

            // Contest Layer
            logApi.info('\x1b[38;5;226m┏━━━━━━━━━━━━━━━━━━━━━━━ Contest Layer (3/4) ━━━━━━━━━━━━━━━━━━━━━━━┓\x1b[0m');
            // Log service names before registration
            logApi.info('Registering Contest Layer services:', {
                contestEvaluation: SERVICE_NAMES.CONTEST_EVALUATION,
                achievement: SERVICE_NAMES.ACHIEVEMENT,
                referral: SERVICE_NAMES.REFERRAL
            });
            
            logApi.info('Attempting to register contestEvaluationService...');
            serviceManager.register(contestEvaluationService, [SERVICE_NAMES.MARKET_DATA]);
            logApi.info('Attempting to register achievementService...');
            serviceManager.register(achievementService, []); // No hard dependencies
            logApi.info('Attempting to register levelingService...');
            serviceManager.register(levelingService, []); // No hard dependencies
            logApi.info('Attempting to register referralService...');
            serviceManager.register(referralService, [SERVICE_NAMES.CONTEST_EVALUATION]);
            logApi.info('\x1b[38;5;226m┗━━━━━━━━━━━ ✅ Contest Services Registered\x1b[0m');

            // Wallet Layer
            logApi.info('\x1b[38;5;82m┏━━━━━━━━━━━━━━━━━━━━━━━ Wallet Layer (4/4) ━━━━━━━━━━━━━━━━━━━━━━━┓\x1b[0m');
            logApi.info('Attempting to register contestWalletService...');
            serviceManager.register(contestWalletService, [SERVICE_NAMES.CONTEST_EVALUATION]);
            logApi.info('Attempting to register adminWalletService...');
            serviceManager.register(adminWalletService, [SERVICE_NAMES.CONTEST_WALLET]);
            logApi.info('Attempting to register walletRakeService...');
            serviceManager.register(walletRakeService, [SERVICE_NAMES.CONTEST_WALLET]);
            logApi.info('\x1b[38;5;82m┗━━━━━━━━━━━ ✅ Wallet Services Registered\x1b[0m');

            // Register dependencies
            logApi.info('Registering service dependencies...');
            this.registerDependencies();
            logApi.info('Service dependencies registered successfully');

            // Log registered services summary
            const registeredServices = Array.from(serviceManager.services.keys());
            logApi.info('Successfully registered services:', {
                total: registeredServices.length,
                services: registeredServices
            });

        } catch (error) {
            logApi.error('\x1b[38;5;196m┏━━━━━━━━━━━ Service Registration Failed ━━━━━━━━━━━┓\x1b[0m');
            logApi.error(`\x1b[38;5;196m┃ Error: ${error.message}\x1b[0m`);
            logApi.error(`\x1b[38;5;196m┃ Stack: ${error.stack}\x1b[0m`);
            logApi.error('\x1b[38;5;196m┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\x1b[0m');
            throw error;
        }

        logApi.info('\x1b[38;5;199m╰─────────────────────────────────────────────────────────────╯\x1b[0m\n');
    }

    static registerDependencies() {
        // Infrastructure Layer Dependencies
        serviceManager.addDependency(SERVICE_NAMES.LIQUIDITY, SERVICE_NAMES.WALLET_GENERATOR);

        // Data Layer Dependencies
        serviceManager.addDependency(SERVICE_NAMES.MARKET_DATA, SERVICE_NAMES.TOKEN_SYNC);

        // Contest Layer Dependencies
        serviceManager.addDependency(SERVICE_NAMES.CONTEST_EVALUATION, SERVICE_NAMES.MARKET_DATA);
        // Removed hard dependency: serviceManager.addDependency(SERVICE_NAMES.ACHIEVEMENT, SERVICE_NAMES.CONTEST_EVALUATION);
        // Removed hard dependency: serviceManager.addDependency(SERVICE_NAMES.REFERRAL, SERVICE_NAMES.CONTEST_EVALUATION);

        // Wallet Layer Dependencies
        serviceManager.addDependency(SERVICE_NAMES.CONTEST_WALLET, SERVICE_NAMES.CONTEST_EVALUATION);
        serviceManager.addDependency(SERVICE_NAMES.ADMIN_WALLET, SERVICE_NAMES.CONTEST_WALLET);
        serviceManager.addDependency(SERVICE_NAMES.WALLET_RAKE, SERVICE_NAMES.CONTEST_WALLET);
    }

    static async initializeServices() {
        logApi.info('\n\x1b[38;5;199m╭───────────────── Initializing Services ─────────────────╮\x1b[0m');

        try {
            // First register core services
            logApi.info('Starting core service registration...');
            await this.registerCoreServices();
            logApi.info('Core service registration completed');

            // Get initialization order
            logApi.info('Calculating service initialization order...');
            const initOrder = serviceManager.calculateInitializationOrder();
            logApi.info('Service initialization order:', initOrder);

            // Initialize all services
            logApi.info('Starting service initialization...');
            const results = await serviceManager.initializeAll();
            
            // Log initialization results
            logApi.info('\x1b[38;5;82m┏━━━━━━━━━━━ Initialization Results ━━━━━━━━━━━┓\x1b[0m');
            if (results.initialized.length > 0) {
                logApi.info(`\x1b[38;5;82m┃ Successfully initialized: ${results.initialized.length} services\x1b[0m`);
                results.initialized.forEach(service => {
                    logApi.info(`\x1b[38;5;82m┃ ✓ ${service}\x1b[0m`);
                });
            } else {
                logApi.warn('\x1b[38;5;208m┃ No services were initialized!\x1b[0m');
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
                    failed: results.failed,
                    registeredServices: Array.from(serviceManager.services.keys())
                }
            );

            return results;
        } catch (error) {
            logApi.error('\x1b[38;5;196m┏━━━━━━━━━━━ Service Initialization Failed ━━━━━━━━━━━┓\x1b[0m');
            logApi.error(`\x1b[38;5;196m┃ Error: ${error.message}\x1b[0m`);
            logApi.error(`\x1b[38;5;196m┃ Stack: ${error.stack}\x1b[0m`);
            logApi.error('\x1b[38;5;196m┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\x1b[0m');
            throw error;
        }

        logApi.info('\x1b[38;5;199m╰─────────────────────────────────────────────────────────────╯\x1b[0m\n');
    }

    static async cleanup() {
        logApi.info('\n\x1b[38;5;199m╭───────────────── Cleaning Up Services ─────────────────╮\x1b[0m');

        try {
            const results = await serviceManager.cleanup();
            
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