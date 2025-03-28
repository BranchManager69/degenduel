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
import { config } from '../../config/config.js';
/* Import all DegenDuel services */
// Infrastructure Layer
import solanaService from '../../services/solanaService.js';
import walletGeneratorService from '../../services/walletGenerationService.js';
import liquidityService from '../../services/liquidityService.js';

// Data Layer
import tokenSyncService from '../../services/tokenSyncService.js';
import marketDataService from '../../services/marketDataService.js';
import tokenWhitelistService from '../../services/tokenWhitelistService.js';

// Contest Layer
import contestEvaluationService from '../../services/contestEvaluationService.js';
import contestSchedulerService from '../../services/contestSchedulerService.js';
import achievementService from '../../services/achievementService.js';
import referralService from '../../services/referralService.js';
import levelingService from '../../services/levelingService.js';

// Wallet Layer
import contestWalletService from '../../services/contestWalletService.js';
import walletRakeService from '../../services/walletRakeService.js';
import adminWalletService from '../../services/adminWalletService.js';
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
     * Register all services with the ServiceManager
     * Organizes services by layer for clean initialization order
     */
    static async registerCoreServices() {
        // Log header
        logApi.info(`${VERBOSE_SERVICE_INIT_LOGS ? 
            `${fancyColors.NEON}╭─────────────── REGISTERING SERVICES BY LAYER ───────────────╮${fancyColors.RESET}` : 
            `📋 Registering services...`}`);
        
        try {
            // Handle token sync service dependency decision before registration
            const tokenSyncDisabled = config.services.disable_token_sync;
            if (tokenSyncDisabled) {
                logApi.info(`${fancyColors.YELLOW}Token sync service disabled via configuration${fancyColors.RESET}`);
            }
            
            // Register all services by layer
            await this.registerInfrastructureLayer();
            await this.registerDataLayer(tokenSyncDisabled);
            await this.registerContestLayer();
            await this.registerWalletLayer();

            // Register all service dependencies
            this.registerDependencies();
            
            // Log summary
            const registeredServices = Array.from(serviceManager.services.keys());
            logApi.info(`🔌 Registered ${registeredServices.length} services across 4 layers`);
        } catch (error) {
            logApi.error(`${serviceColors.failed}Service Registration Failed: ${error.message}${fancyColors.RESET}`, {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }
    
    /**
     * Register Infrastructure Layer services
     * These are the most fundamental services that other services depend on
     */
    static async registerInfrastructureLayer() {
        if (VERBOSE_SERVICE_INIT_LOGS) {
            logApi.info(`${fancyColors.RED}┏━━━━━━━━━━━━━━━━━━ Infrastructure Layer (1/4) ━━━━━━━━━━━━━━━━━━┓${fancyColors.RESET}`);
        }
        
        // Register services - order matters!
        serviceManager.register(solanaService);
        serviceManager.register(walletGeneratorService);
        serviceManager.register(liquidityService, [SERVICE_NAMES.WALLET_GENERATOR]);
        
        if (VERBOSE_SERVICE_INIT_LOGS) {
            logApi.info(`${fancyColors.RED}┗━━━━━━━━━━━ ✅ INFRASTRUCTURE LAYER REGISTRATION COMPLETE${fancyColors.RESET}`);
        }
    }
    
    /**
     * Register Data Layer services
     * These services provide data to the application
     * 
     * @param {boolean} tokenSyncDisabled - Whether token sync service is disabled
     */
    static async registerDataLayer(tokenSyncDisabled) {
        if (VERBOSE_SERVICE_INIT_LOGS) {
            logApi.info(`${fancyColors.ORANGE}┏━━━━━━━━━━━━━━━━━━━━━━━ Data Layer (2/4) ━━━━━━━━━━━━━━━━━━━━━━━┓${fancyColors.RESET}`);
        }
        
        // Always register token sync, even if disabled (initialization will be skipped)
        serviceManager.register(tokenSyncService);
        
        // For market data, use conditional dependencies based on tokenSyncDisabled flag
        // Dependencies will be formally set in registerDependencies()
        serviceManager.register(marketDataService);
        
        // Register token whitelist service
        serviceManager.register(tokenWhitelistService);
        
        if (VERBOSE_SERVICE_INIT_LOGS) {
            logApi.info(`${fancyColors.ORANGE}┗━━━━━━━━━━━ ✅ DATA LAYER REGISTRATION COMPLETE${fancyColors.RESET}`);
        }
    }
    
    /**
     * Register Contest Layer services
     * These services manage contests and related features
     */
    static async registerContestLayer() {
        if (VERBOSE_SERVICE_INIT_LOGS) {
            logApi.info(`${fancyColors.YELLOW}┏━━━━━━━━━━━━━━━━━━━━━━━ Contest Layer (3/4) ━━━━━━━━━━━━━━━━━━━━━━━┓${fancyColors.RESET}`);
        }
        
        // Register contest related services
        serviceManager.register(contestEvaluationService, [SERVICE_NAMES.MARKET_DATA]);
        serviceManager.register(contestSchedulerService, [SERVICE_NAMES.WALLET_GENERATOR]);
        
        // Register additional contest-related services
        serviceManager.register(achievementService, []); // No hard dependencies
        serviceManager.register(levelingService, []); // No hard dependencies
        serviceManager.register(referralService, [SERVICE_NAMES.CONTEST_EVALUATION]);
        
        if (VERBOSE_SERVICE_INIT_LOGS) {
            logApi.info(`${fancyColors.YELLOW}┗━━━━━━━━━━━ ✅ CONTEST LAYER REGISTRATION COMPLETE${fancyColors.RESET}`);
        }
    }
    
    /**
     * Register Wallet Layer services
     * These services manage wallet operations
     */
    static async registerWalletLayer() {
        if (VERBOSE_SERVICE_INIT_LOGS) {
            logApi.info(`${fancyColors.GREEN}┏━━━━━━━━━━━━━━━━━━━━━━━ Wallet Layer (4/4) ━━━━━━━━━━━━━━━━━━━━━━━┓${fancyColors.RESET}`);
        }
        
        // Register wallet services 
        serviceManager.register(contestWalletService, [SERVICE_NAMES.CONTEST_EVALUATION]);
        serviceManager.register(adminWalletService, [SERVICE_NAMES.CONTEST_WALLET]);
        serviceManager.register(walletRakeService, [SERVICE_NAMES.CONTEST_WALLET]);
        
        // Ensure schema exists for user balance tracking
        await ensureSchemaExists();
        serviceManager.register(userBalanceTrackingService, []);
        
        if (VERBOSE_SERVICE_INIT_LOGS) {
            logApi.info(`${fancyColors.GREEN}┗━━━━━━━━━━━ ✅ WALLET LAYER REGISTRATION COMPLETE${fancyColors.RESET}`);
        }
    }

    /**
     * Register the dependencies between the services
     */
    static registerDependencies() {
        // Infrastructure Layer Dependencies
        serviceManager.addDependency(SERVICE_NAMES.LIQUIDITY, SERVICE_NAMES.WALLET_GENERATOR);

        // Data Layer Dependencies
        // Only add TokenSync dependency if it's enabled
        if (config.services.token_sync) {
            serviceManager.addDependency(SERVICE_NAMES.MARKET_DATA, SERVICE_NAMES.TOKEN_SYNC);
        } else {
            // Log that we're skipping this dependency
            logApi.info(`${fancyColors.MAGENTA}[ServiceInitializer]${fancyColors.RESET} ${fancyColors.YELLOW}TokenSync service is disabled in the '${config.services.active_profile}' profile, not adding it as a dependency for MarketData service${fancyColors.RESET}`);
        }

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
     * Initialize all registered services in dependency order
     * @returns {Promise<Object>} Results of service initialization
     */
    static async initializeServices() {
        // Log initialization start
        logApi.info(VERBOSE_SERVICE_INIT_LOGS ? 
            `\n${fancyColors.NEON}╭─────────────────────── INITIALIZING SERVICES ───────────────────────╮${fancyColors.RESET}` : 
            `🚀 Initializing services...`);

        try {
            // Calculate initialization order based on dependencies
            const initOrder = serviceManager.calculateInitializationOrder();
            
            // Note if token sync is disabled
            if (config.services.disable_token_sync) {
                logApi.info(`${fancyColors.YELLOW}Token Sync Service will be skipped during initialization${fancyColors.RESET}`);
            }
            
            // Initialize all services using ServiceManager
            const results = await serviceManager.initializeAll();
            
            // Always show initialization summary
            const successCount = results.initialized.length;
            const failCount = results.failed.length;
            logApi.info(`✅ Services initialized: ${successCount} succeeded, ${failCount} failed`);
            
            // Always show failed services
            if (failCount > 0) {
                // Special handling for TOKEN_SYNC if it was intentionally disabled
                const realFailures = results.failed.filter(service => 
                    !(service === SERVICE_NAMES.TOKEN_SYNC && config.services.disable_token_sync)
                );
                
                if (realFailures.length > 0) {
                    realFailures.forEach(service => {
                        logApi.error(`❌ Failed to initialize service: ${service}`);
                    });
                }
            }
            
            // Log to admin logger for auditing
            await AdminLogger.logAction(
                'SYSTEM',
                AdminLogger.Actions.SERVICE.START,
                {
                    initialized: results.initialized,
                    failed: results.failed,
                    intentionallyDisabled: config.services.disable_token_sync ? [SERVICE_NAMES.TOKEN_SYNC] : [],
                    registeredServices: Array.from(serviceManager.services.keys())
                }
            );

            return results;
        } catch (error) {
            logApi.error(`${serviceColors.failed}Service initialization error: ${error.message}${fancyColors.RESET}`, {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Clean up all services before shutdown
     * @returns {Promise<Object>} Results of service cleanup
     */
    static async cleanup() {
        // Log cleanup start
        logApi.info(VERBOSE_SERVICE_INIT_LOGS ?
            `\n${fancyColors.NEON}╭───────────────── CLEANING UP SERVICES ─────────────────╮${fancyColors.RESET}` :
            `🧹 Cleaning up services...`);

        try {
            // Perform cleanup using ServiceManager
            const results = await serviceManager.cleanup();
            
            // Log cleanup results
            const successCount = results.successful.length;
            const failCount = results.failed.length;
            logApi.info(`✅ Services cleanup: ${successCount} succeeded, ${failCount} failed`);
            
            // Always show failed cleanups
            if (failCount > 0) {
                results.failed.forEach(failure => {
                    const serviceName = typeof failure === 'object' ? failure.service : failure;
                    const errorMsg = typeof failure === 'object' ? failure.error : 'Unknown error';
                    logApi.error(`❌ Failed to cleanup service: ${serviceName} - ${errorMsg}`);
                });
            }
            
            // Log to admin logger for auditing
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