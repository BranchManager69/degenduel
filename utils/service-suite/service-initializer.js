// utils/service-suite/service-initializer.js

/*
 * This module is responsible for orchestrating the initialization of all DegenDuel services.
 * It ensures services are registered and initialized in the correct dependency order.
 */

// Service initialization verbosity
const VERBOSE_SERVICE_INIT_LOGS = true;

import { logApi } from '../logger-suite/logger.js';
import AdminLogger from '../admin-logger.js';
import serviceManager from './service-manager.js';
import { SERVICE_NAMES, SERVICE_LAYERS } from './service-constants.js';
/* Import all services (14 at the time of writing) */
// VERIFIED TO BE IN INITIALIZATION INFO LOGS:
import solanaService from '../../services/solanaService.js'; // #1 of 7
import liquidityService from '../../services/liquidityService.js'; // #2 of 7
import marketDataService from '../../services/marketDataService.js'; // #3 of 7
import contestEvaluationService from '../../services/contestEvaluationService.js'; // #4 of 7
import levelingService from '../../services/levelingService.js'; // #5 of 7
import contestWalletService from '../../services/contestWalletService.js'; // #6 of 7
import walletRakeService from '../../services/walletRakeService.js'; // #7 of 7
// NOT SHOWING UP IN INITIALIZATION INFO LOGS:
import achievementService from '../../services/achievementService.js';
import adminWalletService from '../../services/adminWalletService.js';
import referralService from '../../services/referralService.js';
import tokenSyncService from '../../services/tokenSyncService.js';
import tokenWhitelistService from '../../services/tokenWhitelistService.js';
import walletGeneratorService from '../../services/walletGenerationService.js';
import userBalanceTrackingService, { ensureSchemaExists } from '../../services/userBalanceTrackingService.js';

/**
 * ServiceInitializer class
 * 
 * This class is responsible for orchestrating the initialization of all DegenDuel services.
 * It ensures services are registered and initialized in the correct dependency order.
 */
class ServiceInitializer {
    /**
     * Get all registered service names
     * @returns {Array<string>} Array of service names
     */
    static getServiceNames() {
        return Array.from(serviceManager.services.keys());
    }

    /**
     * Register the core services
     */
    static async registerCoreServices() {
        if (!VERBOSE_SERVICE_INIT_LOGS) {
            logApi.info('Registering core services...');
        } else {
            logApi.info('\x1b[38;5;199m╭───────────────<< REGISTERING CORE SERVICES >>───────────────╮\x1b[0m');
        }
        
        try {
            // Infrastructure Layer
            if (!VERBOSE_SERVICE_INIT_LOGS) {
                // Register in a less verbose way
                serviceManager.register(solanaService);
                serviceManager.register(walletGeneratorService);
                serviceManager.register(liquidityService, [SERVICE_NAMES.WALLET_GENERATOR]);
            } else {
                logApi.info('\x1b[38;5;196m┏━━━━━━━━━━━━━━━━━━━━━━━ Infrastructure Layer (1/4) ━━━━━━━━━━━━━━━━━━━━━━━┓\x1b[0m');
                
                // Register Solana Service first (most fundamental)
                logApi.info('Attempting to register solanaService...');
                serviceManager.register(solanaService);
                
                // Register other infrastructure services
                logApi.info('Attempting to register walletGeneratorService...');
                serviceManager.register(walletGeneratorService);
                logApi.info('Attempting to register liquidityService...');
                serviceManager.register(liquidityService, [SERVICE_NAMES.WALLET_GENERATOR]);
                logApi.info('\x1b[38;5;196m┗━━━━━━━━━━━ ✅ Infrastructure Services Registered\x1b[0m');
            }

            // Data Layer
            if (!VERBOSE_SERVICE_INIT_LOGS) {
                // Register without verbose logging
                serviceManager.register(tokenSyncService);
                serviceManager.register(marketDataService, [SERVICE_NAMES.TOKEN_SYNC]);
                serviceManager.register(tokenWhitelistService);
            } else {
                logApi.info('\x1b[38;5;208m┏━━━━━━━━━━━━━━━━━━━━━━━ Data Layer (2/4) ━━━━━━━━━━━━━━━━━━━━━━━┓\x1b[0m');
                logApi.info('Attempting to register tokenSyncService...');
                serviceManager.register(tokenSyncService);
                logApi.info('Attempting to register marketDataService...');
                serviceManager.register(marketDataService, [SERVICE_NAMES.TOKEN_SYNC]);
                logApi.info('Attempting to register tokenWhitelistService...');
                serviceManager.register(tokenWhitelistService);
                logApi.info('\x1b[38;5;208m┗━━━━━━━━━━━ ✅ Data Services Registered\x1b[0m');
            }

            // Contest Layer
            if (!VERBOSE_SERVICE_INIT_LOGS) {
                // Register without verbose logging
                serviceManager.register(contestEvaluationService, [SERVICE_NAMES.MARKET_DATA]);
                serviceManager.register(achievementService, []); // No hard dependencies
                serviceManager.register(levelingService, []); // No hard dependencies
                serviceManager.register(referralService, [SERVICE_NAMES.CONTEST_EVALUATION]);
            } else {
                logApi.info('\x1b[38;5;226m┏━━━━━━━━━━━━━━━━━━━━━━━ Contest Layer (3/4) ━━━━━━━━━━━━━━━━━━━━━━━┓\x1b[0m');
                // Log service names before registration (only in verbose mode)
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
            }

            // Wallet Layer
            if (!VERBOSE_SERVICE_INIT_LOGS) {
                // Register wallet services without logging
                serviceManager.register(contestWalletService, [SERVICE_NAMES.CONTEST_EVALUATION]);
                serviceManager.register(adminWalletService, [SERVICE_NAMES.CONTEST_WALLET]);
                serviceManager.register(walletRakeService, [SERVICE_NAMES.CONTEST_WALLET]);
                
                // Ensure schema exists for user balance tracking
                await ensureSchemaExists();
                serviceManager.register(userBalanceTrackingService, []);
            } else {
                logApi.info('\x1b[38;5;82m┏━━━━━━━━━━━━━━━━━━━━━━━ Wallet Layer (4/4) ━━━━━━━━━━━━━━━━━━━━━━━┓\x1b[0m');
                logApi.info('Attempting to register contestWalletService...');
                serviceManager.register(contestWalletService, [SERVICE_NAMES.CONTEST_EVALUATION]);
                logApi.info('Attempting to register adminWalletService...');
                serviceManager.register(adminWalletService, [SERVICE_NAMES.CONTEST_WALLET]);
                logApi.info('Attempting to register walletRakeService...');
                serviceManager.register(walletRakeService, [SERVICE_NAMES.CONTEST_WALLET]);
                
                // Ensure schema exists for user balance tracking
                logApi.info('Ensuring database schema for user balance tracking...');
                await ensureSchemaExists();
                
                logApi.info('Attempting to register userBalanceTrackingService...');
                serviceManager.register(userBalanceTrackingService, []);
                
                logApi.info('\x1b[38;5;82m┗━━━━━━━━━━━ ✅ Wallet Services Registered\x1b[0m');
            }

            // Register dependencies
            if (VERBOSE_SERVICE_INIT_LOGS) logApi.info('Registering service dependencies...');
            this.registerDependencies();
            if (VERBOSE_SERVICE_INIT_LOGS) logApi.info('Service dependencies registered successfully');

            // Log registered services summary with count only in normal mode
            const registeredServices = Array.from(serviceManager.services.keys());
            if (VERBOSE_SERVICE_INIT_LOGS) {
                logApi.info('Successfully registered services:', {
                    total: registeredServices.length,
                    services: registeredServices
                });
            } else {
                logApi.info(`Successfully registered ${registeredServices.length} services`);
            }

        } catch (error) {
            // Log the service registration failed
            logApi.error('\x1b[38;5;196m┏━━━━━━━━━━━ Service Registration Failed ━━━━━━━━━━━┓\x1b[0m');
            logApi.error(`\x1b[38;5;196m┃ Error: ${error.message}\x1b[0m`);
            logApi.error(`\x1b[38;5;196m┃ Stack: ${error.stack}\x1b[0m`);
            logApi.error('\x1b[38;5;196m┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\x1b[0m');
            throw error;
        }

        logApi.info('\x1b[38;5;199m╰─────────────────────────────────────────────────────────────╯\x1b[0m\n');
    }

    /**
     * Register the dependencies between the services
     */
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

    /**
     * Initialize the services
     */
    static async initializeServices() {
        if (!VERBOSE_SERVICE_INIT_LOGS) {
            logApi.info('Initializing services...');
        } else {
            logApi.info('\n\x1b[38;5;199m╭───────────────── Initializing Services ─────────────────╮\x1b[0m');
        }

        try {
            // Services should already be registered by now
            if (VERBOSE_SERVICE_INIT_LOGS) logApi.info('Services already registered, proceeding to initialization...');

            // Get initialization order
            const initOrder = serviceManager.calculateInitializationOrder();
            if (VERBOSE_SERVICE_INIT_LOGS) logApi.info('Service initialization order:', initOrder);

            // Initialize all services
            if (VERBOSE_SERVICE_INIT_LOGS) logApi.info('Starting service initialization...');
            const results = await serviceManager.initializeAll();
            
            // Log initialization results
            if (!VERBOSE_SERVICE_INIT_LOGS) {
                logApi.info(`Services initialization: ${results.initialized.length} succeeded, ${results.failed.length} failed`);
                
                // Always show failed services, even in non-verbose mode
                if (results.failed.length > 0) {
                    results.failed.forEach(service => {
                        logApi.error(`Failed to initialize service: ${service}`);
                    });
                }
            } else {
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
            }

            // Log to admin logger (admin logs are always kept for auditing)
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
            if (VERBOSE_SERVICE_INIT_LOGS) {
                logApi.error(`\x1b[38;5;196m┃ Stack: ${error.stack}\x1b[0m`);
            }
            logApi.error('\x1b[38;5;196m┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\x1b[0m');
            throw error;
        }

        logApi.info('\x1b[38;5;199m╰─────────────────────────────────────────────────────────────╯\x1b[0m\n');
    }

    /**
     * Clean up the services
     */
    static async cleanup() {
        logApi.info('\n\x1b[38;5;199m╭───────────────── Cleaning Up Services ─────────────────╮\x1b[0m');

        try {
            // Clean up the services
            const results = await serviceManager.cleanup();
            
            // Log the cleanup results
            logApi.info('\x1b[38;5;82m┏━━━━━━━━━━━ Cleanup Results ━━━━━━━━━━━┓\x1b[0m');
            logApi.info(`\x1b[38;5;82m┃ Successfully cleaned: ${results.successful.length} services\x1b[0m`);
            if (VERBOSE_SERVICE_INIT_LOGS && results.successful.length > 0) {
                // Log the successful cleanups in verbose mode
                results.successful.forEach(service => {
                    logApi.info(`\x1b[38;5;82m┃ ✓ ${service}\x1b[0m`);
                });
            }
            
            if (results.failed.length > 0) {
                // Log the failed cleanups, even in non-verbose mode
                logApi.error(`\x1b[38;5;196m┃ Failed to clean: ${results.failed.length} services\x1b[0m`);
                results.failed.forEach(failure => {
                    logApi.error(`\x1b[38;5;196m┃ - ${failure.service}: ${failure.error}\x1b[0m`);
                });
            }
            logApi.info('\x1b[38;5;82m┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\x1b[0m');

            // Log to admin logger (admin logs are always kept for auditing)
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
            // Log the stack trace in verbose mode
            if (VERBOSE_SERVICE_INIT_LOGS) {
                logApi.error(`\x1b[38;5;196m┃ Stack: ${error.stack}\x1b[0m`);
            }
            logApi.error('\x1b[38;5;196m┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\x1b[0m');
            throw error;
        }

        logApi.info('\x1b[38;5;199m╰─────────────────────────────────────────────────────────────╯\x1b[0m\n');
    }
}

export default ServiceInitializer; 