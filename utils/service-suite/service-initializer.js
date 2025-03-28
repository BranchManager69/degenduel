// utils/service-suite/service-initializer.js

/*
 * This module is responsible for orchestrating the initialization of all DegenDuel services.
 * It ensures services are registered and initialized in the correct dependency order.
 */

// Service initialization verbosity - disable verbosity
const VERBOSE_SERVICE_INIT_LOGS = false;

import { logApi } from '../logger-suite/logger.js';
import AdminLogger from '../admin-logger.js';
import serviceManager from './service-manager.js';
import { SERVICE_NAMES, SERVICE_LAYERS } from './service-constants.js';
import { fancyColors, serviceColors } from '../colors.js';
/* Import all services (14 at the time of writing) */
// VERIFIED TO BE IN INITIALIZATION INFO LOGS:
import solanaService from '../../services/solanaService.js'; // #1 of 7
import liquidityService from '../../services/liquidityService.js'; // #2 of 7
import marketDataService from '../../services/marketDataService.js'; // #3 of 7
import contestEvaluationService from '../../services/contestEvaluationService.js'; // #4 of 7
import contestSchedulerService from '../../services/contestSchedulerService.js'; // New contest scheduler service
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
// systemSettingsService is not a service, but a WebSocket handler

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
            logApi.info(`📋 Registering services...`);
        } else {
            logApi.info(`${fancyColors.NEON}╭───────────────────────<< ${fancyColors.BOLD}${fancyColors.BG_BLACK} REGISTERING CORE SERVICES ${fancyColors.RESET}${fancyColors.NEON} >>───────────────────────╮${fancyColors.RESET}`);
            logApi.info(`${fancyColors.NEON}|                                                             |${fancyColors.RESET}`);
        }
        
        try {
            // Infrastructure Layer
            if (!VERBOSE_SERVICE_INIT_LOGS) {
                // Register in a less verbose way
                serviceManager.register(solanaService);
                serviceManager.register(walletGeneratorService);
                serviceManager.register(liquidityService, [SERVICE_NAMES.WALLET_GENERATOR]);
            } else {
                logApi.info(`${fancyColors.RED}┏━━━━━━━━━━━━━━━━━━ Infrastructure Layer (1/4) ━━━━━━━━━━━━━━━━━━┓${fancyColors.RESET}`);
                
                // Register Solana Service first (most fundamental)
                logApi.info(`${fancyColors.RED}${fancyColors.BOLD}┣${fancyColors.RESET} ${fancyColors.LIGHT_MAGENTA}[ServiceManager]${fancyColors.RESET} Attempting to register solanaService...`);
                serviceManager.register(solanaService);
                // Register other infrastructure services
                logApi.info(`${fancyColors.RED}${fancyColors.BOLD}┣${fancyColors.RESET} ${fancyColors.LIGHT_MAGENTA}[ServiceManager]${fancyColors.RESET} Attempting to register walletGeneratorService...`);
                serviceManager.register(walletGeneratorService);
                logApi.info(`${fancyColors.RED}${fancyColors.BOLD}┣${fancyColors.RESET} ${fancyColors.LIGHT_MAGENTA}[ServiceManager]${fancyColors.RESET} Attempting to register liquidityService...`);
                serviceManager.register(liquidityService, [SERVICE_NAMES.WALLET_GENERATOR]);
                logApi.info(`${fancyColors.RED}┗━━━━━━━━━━━ ✅ INFRASTRUCTURE LAYER REGISTRATION COMPLETE${fancyColors.RESET}`);
            }

            // Market Data Layer
            if (!VERBOSE_SERVICE_INIT_LOGS) {
                // Register without verbose logging
                serviceManager.register(tokenSyncService);
                serviceManager.register(marketDataService, [SERVICE_NAMES.TOKEN_SYNC]);
                serviceManager.register(tokenWhitelistService);
            } else {
                logApi.info(`${fancyColors.ORANGE}┏━━━━━━━━━━━━━━━━━━━━━━━ Data Layer (2/4) ━━━━━━━━━━━━━━━━━━━━━━━┓${fancyColors.RESET}`);
                logApi.info(`${fancyColors.ORANGE}${fancyColors.BOLD}┣${fancyColors.RESET} ${fancyColors.LIGHT_MAGENTA}[ServiceManager]${fancyColors.RESET} Attempting to register tokenSyncService...`);
                serviceManager.register(tokenSyncService);
                logApi.info(`${fancyColors.ORANGE}${fancyColors.BOLD}┣${fancyColors.RESET} ${fancyColors.LIGHT_MAGENTA}[ServiceManager]${fancyColors.RESET} Attempting to register marketDataService...`);
                serviceManager.register(marketDataService, [SERVICE_NAMES.TOKEN_SYNC]);
                logApi.info(`${fancyColors.ORANGE}${fancyColors.BOLD}┣${fancyColors.RESET} ${fancyColors.LIGHT_MAGENTA}[ServiceManager]${fancyColors.RESET} Attempting to register tokenWhitelistService...`);
                serviceManager.register(tokenWhitelistService);
                logApi.info(`${fancyColors.ORANGE}┗━━━━━━━━━━━ ✅ DATA LAYER REGISTRATION COMPLETE${fancyColors.RESET}`);
            }

            // Contest Layer
            if (!VERBOSE_SERVICE_INIT_LOGS) {
                // Register without verbose logging
                serviceManager.register(contestEvaluationService, [SERVICE_NAMES.MARKET_DATA]);
                serviceManager.register(contestSchedulerService, [SERVICE_NAMES.WALLET_GENERATOR]);
                serviceManager.register(achievementService, []); // No hard dependencies
                serviceManager.register(levelingService, []); // No hard dependencies
                serviceManager.register(referralService, [SERVICE_NAMES.CONTEST_EVALUATION]);
            } else {
                logApi.info('\x1b[38;5;226m┏━━━━━━━━━━━━━━━━━━━━━━━ Contest Layer (3/4) ━━━━━━━━━━━━━━━━━━━━━━━┓\x1b[0m');
                // Log service names before registration (only in verbose mode)
                logApi.info(`${fancyColors.YELLOW}${fancyColors.BOLD}┣${fancyColors.RESET} ${fancyColors.LIGHT_MAGENTA}[ServiceManager]${fancyColors.RESET} ${fancyColors.YELLOW}${fancyColors.ITALIC}Registering Contest Layer services...${fancyColors.RESET}`);
                logApi.info(`${fancyColors.YELLOW}${fancyColors.BOLD}┣${fancyColors.RESET} ${fancyColors.LIGHT_MAGENTA}[ServiceManager]${fancyColors.RESET} ${fancyColors.YELLOW}${fancyColors.ITALIC}Attempting to register contestEvaluationService...${fancyColors.RESET}`);
                serviceManager.register(contestEvaluationService, [SERVICE_NAMES.MARKET_DATA]);
                logApi.info(`${fancyColors.YELLOW}${fancyColors.BOLD}┣${fancyColors.RESET} ${fancyColors.LIGHT_MAGENTA}[ServiceManager]${fancyColors.RESET} ${fancyColors.YELLOW}${fancyColors.ITALIC}Attempting to register contestSchedulerService...${fancyColors.RESET}`);
                serviceManager.register(contestSchedulerService, [SERVICE_NAMES.WALLET_GENERATOR]);
                logApi.info(`${fancyColors.YELLOW}${fancyColors.BOLD}┣${fancyColors.RESET} ${fancyColors.LIGHT_MAGENTA}[ServiceManager]${fancyColors.RESET} ${fancyColors.YELLOW}${fancyColors.ITALIC}Attempting to register achievementService...${fancyColors.RESET}`);
                serviceManager.register(achievementService, []); // No hard dependencies
                logApi.info(`${fancyColors.YELLOW}${fancyColors.BOLD}┣${fancyColors.RESET} ${fancyColors.LIGHT_MAGENTA}[ServiceManager]${fancyColors.RESET} ${fancyColors.YELLOW}${fancyColors.ITALIC}Attempting to register levelingService...${fancyColors.RESET}`);
                serviceManager.register(levelingService, []); // No hard dependencies
                logApi.info(`${fancyColors.YELLOW}${fancyColors.BOLD}┣${fancyColors.RESET} ${fancyColors.LIGHT_MAGENTA}[ServiceManager]${fancyColors.RESET} ${fancyColors.YELLOW}${fancyColors.ITALIC}Attempting to register referralService...${fancyColors.RESET}`);
                serviceManager.register(referralService, [SERVICE_NAMES.CONTEST_EVALUATION]);
                logApi.info('\x1b[38;5;226m┗━━━━━━━━━━━ ✅ CONTEST LAYER REGISTRATION COMPLETE\x1b[0m');
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
                logApi.info(`${fancyColors.GREEN}${fancyColors.BOLD}┣${fancyColors.RESET} ${fancyColors.LIGHT_MAGENTA}[ServiceManager]${fancyColors.RESET} ${fancyColors.YELLOW}${fancyColors.ITALIC}Attempting to register contestWalletService...${fancyColors.RESET}`);
                serviceManager.register(contestWalletService, [SERVICE_NAMES.CONTEST_EVALUATION]);
                logApi.info(`${fancyColors.GREEN}${fancyColors.BOLD}┣${fancyColors.RESET} ${fancyColors.LIGHT_MAGENTA}[ServiceManager]${fancyColors.RESET} ${fancyColors.YELLOW}${fancyColors.ITALIC}Attempting to register adminWalletService...${fancyColors.RESET}`);
                serviceManager.register(adminWalletService, [SERVICE_NAMES.CONTEST_WALLET]);
                logApi.info(`${fancyColors.GREEN}${fancyColors.BOLD}┣${fancyColors.RESET} ${fancyColors.LIGHT_MAGENTA}[ServiceManager]${fancyColors.RESET} ${fancyColors.YELLOW}${fancyColors.ITALIC}Attempting to register walletRakeService...${fancyColors.RESET}`);
                serviceManager.register(walletRakeService, [SERVICE_NAMES.CONTEST_WALLET]);
                // (ensure schema exists for user balance tracking)
                logApi.info(`${fancyColors.GREEN}${fancyColors.BOLD}┣${fancyColors.RESET} ${fancyColors.LIGHT_MAGENTA}[ServiceManager]${fancyColors.RESET} ${fancyColors.YELLOW}${fancyColors.ITALIC}Ensuring database schema for user balance tracking...${fancyColors.RESET}`);
                await ensureSchemaExists();
                logApi.info(`${fancyColors.GREEN}${fancyColors.BOLD}┣${fancyColors.RESET} ${fancyColors.LIGHT_MAGENTA}[ServiceManager]${fancyColors.RESET} ${fancyColors.YELLOW}${fancyColors.ITALIC}Attempting to register userBalanceTrackingService...${fancyColors.RESET}`);
                serviceManager.register(userBalanceTrackingService, []);
                logApi.info('\x1b[38;5;82m┗━━━━━━━━━━━ ✅ WALLET LAYER REGISTRATION COMPLETE\x1b[0m');
            }

            // Register dependencies
            if (VERBOSE_SERVICE_INIT_LOGS) logApi.info(`${fancyColors.DARK_MAGENTA}[SERVICE INIT]${fancyColors.RESET} ${fancyColors.PURPLE}${fancyColors.ITALIC}Registering service dependencies...${fancyColors.RESET}`);
            this.registerDependencies();
            if (VERBOSE_SERVICE_INIT_LOGS) logApi.info(`${fancyColors.DARK_MAGENTA}[SERVICE INIT]${fancyColors.RESET} ${fancyColors.GREEN}${fancyColors.ITALIC}Service dependencies registered successfully${fancyColors.RESET}`);

            // Log completion of services registration
            const registeredServices = Array.from(serviceManager.services.keys());
            if (VERBOSE_SERVICE_INIT_LOGS) {
                logApi.info(`${fancyColors.DARK_MAGENTA}[SERVICE INIT]${fancyColors.RESET} 😎 ${fancyColors.PURPLE}${fancyColors.ITALIC}Successfully registered ${registeredServices.length} services:${fancyColors.RESET}`, {
                //    total: registeredServices.length,
                //    services: registeredServices
                });
            } else {
                logApi.info(`🔌 Registered ${registeredServices.length} services`);
            }

        } catch (error) {
            // Log the service registration failed
            logApi.error(`${serviceColors.failed}┏━━━━━━━━━━━ Service Registration Failed ━━━━━━━━━━━┓${fancyColors.RESET}`);
            logApi.error(`${serviceColors.failed}┃ Error: ${error.message}${fancyColors.RESET}`);
            logApi.error(`${serviceColors.failed}┃ Stack: ${error.stack}${fancyColors.RESET}`);
            logApi.error(`${serviceColors.failed}┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛${fancyColors.RESET}`);
            throw error;
        }

        logApi.info(`${fancyColors.NEON}╰─────────────────────────────────────────────────────────────╯${fancyColors.RESET}\n`);
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
            logApi.info(`🚀 Initializing services...`);
        } else {
            logApi.info(`\n${fancyColors.NEON}╭─────────────────────── Initializing Services ───────────────────────╮${fancyColors.RESET}`);
        }

        try {
            // Services should already be registered by now
            if (VERBOSE_SERVICE_INIT_LOGS) logApi.info(`${fancyColors.MAGENTA}[ServiceInitializer]${fancyColors.RESET} ${fancyColors.ORANGE}${fancyColors.ITALIC}Services already registered.${fancyColors.RESET} ${fancyColors.YELLOW}${fancyColors.ITALIC}Proceeding to initialization...${fancyColors.RESET}`);

            // Get initialization order
            const initOrder = serviceManager.calculateInitializationOrder();
            if (VERBOSE_SERVICE_INIT_LOGS) logApi.info(`${fancyColors.MAGENTA}[ServiceInitializer]${fancyColors.RESET} ${fancyColors.YELLOW}${fancyColors.ITALIC}Ordering initialization of services...${fancyColors.RESET}`, {
            //    order: initOrder
            });

            // Initialize all services
            if (VERBOSE_SERVICE_INIT_LOGS) logApi.info(`${fancyColors.MAGENTA}[ServiceInitializer]${fancyColors.RESET} ${fancyColors.YELLOW}${fancyColors.ITALIC}Starting service initialization...${fancyColors.RESET}`);
            const results = await serviceManager.initializeAll();
            
            // Log initialization results
            if (!VERBOSE_SERVICE_INIT_LOGS) {
                logApi.info(`✅ Services initialized: ${results.initialized.length} succeeded, ${results.failed.length} failed`);
                
                // Always show failed services, even in non-verbose mode
                if (results.failed.length > 0) {
                    results.failed.forEach(service => {
                        logApi.error(`❌ Failed to initialize service: ${service}`);
                    });
                }
            } else {
                logApi.info('\x1b[38;5;82m┏━━━━━━━━━━━━━━━━━ Initialization Results ━━━━━━━━━━━━━━━━━┓\x1b[0m');
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
                logApi.info('\x1b[38;5;82m┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\x1b[0m');
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
            logApi.error(`${serviceColors.failed}[SERVICE INIT] Error initializing services: ${error.message}${fancyColors.RESET}`);
            throw error;
        }
    }

    /**
     * Cleanup all services
     */
    static async cleanup() {
        if (!VERBOSE_SERVICE_INIT_LOGS) {
            logApi.info(`🧹 Cleaning up services...`);
        } else {
            logApi.info(`\n${fancyColors.NEON}╭───────────────── Cleaning Up Services ─────────────────╮${fancyColors.RESET}`);
        }

        try {
            const results = await serviceManager.cleanup();
            
            if (!VERBOSE_SERVICE_INIT_LOGS) {
                logApi.info(`✅ Services cleanup: ${results.successful.length} succeeded, ${results.failed.length} failed`);
                
                // Always show failed cleanups, even in non-verbose mode
                if (results.failed.length > 0) {
                    results.failed.forEach(service => {
                        logApi.error(`❌ Failed to cleanup service: ${service}`);
                    });
                }
            } else {
                logApi.info('\x1b[38;5;82m┏━━━━━━━━━━━ Cleanup Results ━━━━━━━━━━━┓\x1b[0m');
                if (results.successful.length > 0) {
                    logApi.info(`\x1b[38;5;82m┃ Successfully cleaned: ${results.successful.length} services\x1b[0m`);
                    results.successful.forEach(service => {
                        logApi.info(`\x1b[38;5;82m┃ ✓ ${service}\x1b[0m`);
                    });
                } else {
                    logApi.warn('\x1b[38;5;208m┃ No services were cleaned!\x1b[0m');
                }
                if (results.failed.length > 0) {
                    logApi.error(`\x1b[38;5;196m┃ Failed to clean: ${results.failed.length} services\x1b[0m`);
                    results.failed.forEach(failure => {
                        logApi.error(`\x1b[38;5;196m┃ - ${failure.service}: ${failure.error}\x1b[0m`);
                    });
                }
                logApi.info('\x1b[38;5;82m┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\x1b[0m');
            }

            // Log to admin logger (admin logs are always kept for auditing)
            await AdminLogger.logAction(
                'SYSTEM',
                AdminLogger.Actions.SERVICE.STOP,
                {
                    cleaned: results.successful,
                    failed: results.failed
                }
            );

            return results;
        } catch (error) {
            logApi.error(`${serviceColors.failed}[SERVICE CLEANUP] Error cleaning up services: ${error.message}${fancyColors.RESET}`);
            throw error;
        }
    }
}

export default ServiceInitializer; 