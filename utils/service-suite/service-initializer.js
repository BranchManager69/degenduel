// utils/service-suite/service-initializer.js

/**
 * Service Initializer
 * 
 * @description This module is responsible for orchestrating the initialization of all DegenDuel services.
 * It ensures services are registered and initialized in the correct dependency order.
 * 
 * @author BranchManager69
 * @version 2.0.0
 * @created 2025-04-10
 * @updated 2025-05-24
 */

/**
 * NOTE:
 * This module is responsible for orchestrating the initialization of all DegenDuel services.
 * It ensures services are registered and initialized in the correct dependency order.
 */

// Service Suite
import serviceManager from './service-manager.js';
import { 
    SERVICE_NAMES, 
    //SERVICE_LAYERS, SERVICE_VERBOSITY
} from './service-constants.js';
// Logger
import { logApi } from '../logger-suite/logger.js';
import { fancyColors, serviceColors } from '../colors.js';
import AdminLogger from '../admin-logger.js';
//import prisma from '../../config/prisma.js';

// Config
import { config } from '../../config/config.js';

// Manual debug modes
const VERBOSE_SERVICE_INIT_LOGS = false;


/* Import all DegenDuel services */

//   (1)  Infrastructure Layer
import solanaEngine from '../../services/solana-engine/index.js';
import liquidityService from '../../services/liquidityService.js';
// REMOVED: Legacy solana service - replaced entirely by SolanaEngine
// REMOVED: walletGeneratorService - was over-engineered and barely used

//   (2)  Data Layer
import marketDataService from '../../services/market-data/index.js';
import tokenRefreshScheduler from '../../services/token-refresh-scheduler/index.js';
import tokenEnrichmentService from '../../services/token-enrichment/index.js';
import tokenActivationService from '../../services/token-activation/index.js';
import tokenDEXDataService from '../../services/token-dex-data-service/index.js';
import tokenDetectionService from '../../services/token-detection-service/index.js';
// REMOVED: tokenSyncService - no longer needed
// REMOVED: tokenWhitelistService - no longer needed

//   (3)  Comms Layer (?; call it whatever, not important)
import discordNotificationService from '../../services/discord/discordNotificationService.js';
import discordInteractiveService from '../../services/discord/discord-interactive-service.js';

//   (4)  Contest Layer
import contestEvaluationService from '../../services/contestEvaluationService.js';
import contestSchedulerService from '../../services/contestSchedulerService.js';
import achievementService from '../../services/achievementService.js';
import referralService from '../../services/referralService.js';
import levelingService from '../../services/levelingService.js';
import launchEventService from '../../services/launchEventService.js';
import portfolioSnapshotService from '../../services/portfolioSnapshotService.js';

//   (5)  Wallet Layer
import contestWalletService from '../../services/contest-wallet/index.js';
import adminWalletService from '../../services/admin-wallet/index.js';
import userBalanceTrackingService from '../../services/user-balance-tracking/index.js';
import vanityWalletService from '../../services/vanity-wallet/index.js';

//   (6) Application Layer (New)
import aiService from '../../services/ai-service/index.js';

//   (7?) ??? Client layer??? IDK.  What is this? I forget!
import { jupiterClient } from '../../services/solana-engine/jupiter-client.js';

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
            // Register all services by layer
            await this.registerInfrastructureLayer();
            await this.registerDataLayer();
            await this.registerContestLayer();
            await this.registerWalletLayer();
            await this.registerApplicationLayer();

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
        
        // SolanaEngine is the primary Solana connection service
        if (config.services.solana_engine_service) {
            serviceManager.register(solanaEngine);
        } else {
            logApi.info(`${fancyColors.YELLOW}Skipping registration of solana_engine_service - disabled in config${fancyColors.RESET}`);
        }
        // Legacy solanaService kept for compatibility until full migration
        // [EDIT 4/27/25: Now deprecated. Fully removed from here!]
        // if (config.services.solana_service) {
        //     serviceManager.register(solanaService);
        // } else {
        //     logApi.info(`${fancyColors.YELLOW}Skipping registration of solana_service - disabled in config${fancyColors.RESET}`);
        // }
        
        // Register liquidity service (no longer depends on wallet generator)
        if (config.services.liquidity) {
            serviceManager.register(liquidityService);
        } else {
            logApi.info(`${fancyColors.YELLOW}Skipping registration of liquidity_service - disabled in config${fancyColors.RESET}`);
        }
        
        // Register Discord notification service
        if (config.services.discord_notification_service) {
            serviceManager.register(discordNotificationService);
            logApi.info(`${fancyColors.CYAN}Registered Discord notification service${fancyColors.RESET}`);
        } else {
            logApi.info(`${fancyColors.YELLOW}Skipping registration of discord_notification_service - disabled in config${fancyColors.RESET}`);
        }

        // Register Discord interactive service
        if (config.services.discord_interactive_service) {
            serviceManager.register(discordInteractiveService);
            logApi.info(`${fancyColors.CYAN}Registered Discord interactive service${fancyColors.RESET}`);
        } else {
            logApi.info(`${fancyColors.YELLOW}Skipping registration of discord_interactive_service - disabled in config${fancyColors.RESET}`);
        }

        
        
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
    static async registerDataLayer() {
        if (VERBOSE_SERVICE_INIT_LOGS) {
            logApi.info(`${fancyColors.ORANGE}┏━━━━━━━━━━━━━━━━━━━━━━━ Data Layer (2/4) ━━━━━━━━━━━━━━━━━━━━━━━┓${fancyColors.RESET}`);
        }
        
        // Register JupiterClient Service first as other data services might depend on it
        // We need a config flag for jupiter_client itself in config.services if we want to control its registration
        // For now, assuming if other data services are on, jupiter_client should be registered.
        // Ensure SERVICE_NAMES.JUPITER_CLIENT (='jupiter_client') is defined in service-constants
        // and has metadata if it needs specific layer/criticality beyond default BaseService.
        if (config.services.jupiter_client !== false) {
            serviceManager.register(jupiterClient);
            logApi.info(`${fancyColors.GREEN}Registered JupiterClient Service${fancyColors.RESET}`);
        } else {
            logApi.info(`${fancyColors.YELLOW}Skipping registration of jupiter_client - explicitly disabled in config${fancyColors.RESET}`);
        }
        
        // Register market data service only if market_data service is enabled in config + what's in the service profile
        if (config.services.market_data) {
            serviceManager.register(marketDataService, [SERVICE_NAMES.SOLANA_ENGINE]);
            
            // Register advanced token refresh scheduler if enabled in config
            if (config.services.token_refresh_scheduler) {
                // Register the main scheduler directly (single service approach)
                serviceManager.register(tokenRefreshScheduler, [SERVICE_NAMES.MARKET_DATA, SERVICE_NAMES.SOLANA_ENGINE]);
                logApi.info(`${fancyColors.GREEN}Registered main token refresh scheduler${fancyColors.RESET}`);
            } else {
                logApi.info(`${fancyColors.YELLOW}Skipping registration of token_refresh_scheduler - disabled in config${fancyColors.RESET}`);
            }
            
            // Register token DEX data service if enabled in config
            if (config.services.token_dex_data_service) {
                serviceManager.register(tokenDEXDataService);
                logApi.info(`${fancyColors.GREEN}Registered token DEX data service${fancyColors.RESET}`);
            } else {
                logApi.info(`${fancyColors.YELLOW}Skipping registration of token_dex_data_service - disabled in config${fancyColors.RESET}`);
            }
            
            // Register token detection service if enabled in config
            if (config.services.token_detection_service) {
                serviceManager.register(tokenDetectionService, [SERVICE_NAMES.SOLANA_ENGINE]);
                logApi.info(`${fancyColors.GREEN}Registered token detection service${fancyColors.RESET}`);
            } else {
                logApi.info(`${fancyColors.YELLOW}Skipping registration of token_detection_service - disabled in config${fancyColors.RESET}`);
            }
            
            // Register token enrichment service if enabled in config
            if (config.services.token_enrichment_service) {
                serviceManager.register(tokenEnrichmentService, [SERVICE_NAMES.TOKEN_DETECTION, SERVICE_NAMES.SOLANA_ENGINE]);
                logApi.info(`${fancyColors.GREEN}Registered token enrichment service${fancyColors.RESET}`);
            } else {
                logApi.info(`${fancyColors.YELLOW}Skipping registration of token_enrichment_service - disabled in config${fancyColors.RESET}`);
            }

            // Register Token Activation Service here, as it depends on JupiterClient (part of SolanaEngine conceptually or directly)
            // and provides data for other services like MarketData or TokenRefreshScheduler.
            if (config.services.token_activation_service) {
                serviceManager.register(tokenActivationService, [SERVICE_NAMES.JUPITER_CLIENT]);
                logApi.info(`${fancyColors.GREEN}Registered Token Activation Service${fancyColors.RESET}`);
            } else {
                logApi.info(`${fancyColors.YELLOW}Skipping registration of token_activation_service - disabled in config${fancyColors.RESET}`);
            }

            // Token priority service is not fully implemented yet
            if (config.services.token_priority_service) {
                // Temporarily disabled until implementation is complete
                //serviceManager.register(tokenPriorityService, [SERVICE_NAMES.TOKEN_DETECTION, SERVICE_NAMES.SOLANA_ENGINE]);
                logApi.info(`${fancyColors.YELLOW}Token priority service is configured but not yet implemented${fancyColors.RESET}`);
            } else {
                logApi.info(`${fancyColors.YELLOW}Skipping registration of token_priority_service - disabled in config${fancyColors.RESET}`);
            }

        } else {
            logApi.info(`${fancyColors.YELLOW}Skipping registration of market_data_service and its dependents (like token_activation_service) - disabled in config${fancyColors.RESET}`);
        }
        
        // Token whitelist service has been permanently disabled (using token.is_active flag instead)
        // logApi.info(`${fancyColors.YELLOW}Skipping registration of token_whitelist_service - permanently disabled (using token.is_active flag instead)${fancyColors.RESET}`);
        
        // Log completion of data layer registration
        logApi.info(`${fancyColors.ORANGE}┗━━━━━━━━━━━ ✅ DATA LAYER REGISTRATION COMPLETE${fancyColors.RESET}`);
    }
    
    /**
     * Register Contest Layer services
     * These services manage contests and related features
     */
    static async registerContestLayer() {
        if (VERBOSE_SERVICE_INIT_LOGS) {
            logApi.info(`${fancyColors.YELLOW}┏━━━━━━━━━━━━━━━━━━━━━━━ Contest Layer (3/4) ━━━━━━━━━━━━━━━━━━━━━━━┓${fancyColors.RESET}`);
        }
        
        // Register contest related services only if enabled in config
        if (config.services.contest_evaluation) {
            serviceManager.register(contestEvaluationService, [SERVICE_NAMES.MARKET_DATA]);
        } else {
            logApi.info(`${fancyColors.YELLOW}Skipping registration of contest_evaluation_service - disabled in config${fancyColors.RESET}`);
        }
        
        // Register contest scheduler if enabled in the service profile
        if (config.services.contest_scheduler) {
            if (VERBOSE_SERVICE_INIT_LOGS) {
                logApi.info(`${fancyColors.YELLOW}┃ 🔹 Registering Contest Scheduler Service ${fancyColors.RESET}`);
            }
            // REMOVED dependency on WALLET_GENERATOR since that service was deleted
            serviceManager.register(contestSchedulerService);
        } else {
            logApi.info(`${fancyColors.YELLOW}Skipping registration of contest_scheduler_service - disabled in config${fancyColors.RESET}`);
        }
        
        // Register additional contest-related services only if enabled in config
        if (config.services.achievement_service) {
            serviceManager.register(achievementService, []); // No hard dependencies
        } else {
            logApi.info(`${fancyColors.YELLOW}Skipping registration of achievement_service - disabled in config${fancyColors.RESET}`);
        }
        
        if (config.services.leveling_service) {
            serviceManager.register(levelingService, []); // No hard dependencies
        } else {
            logApi.info(`${fancyColors.YELLOW}Skipping registration of leveling_service - disabled in config${fancyColors.RESET}`);
        }
        
        if (config.services.referral_service) {
            serviceManager.register(referralService, [SERVICE_NAMES.CONTEST_EVALUATION]);
        } else {
            logApi.info(`${fancyColors.YELLOW}Skipping registration of referral_service - disabled in config${fancyColors.RESET}`);
        }
        
        // Register Portfolio Snapshot Service if enabled
        // It depends on Market Data and Contest Evaluation (for active contests/participants)
        if (config.services.portfolio_snapshot_service) { // Assuming a config flag will be added
            serviceManager.register(portfolioSnapshotService, [SERVICE_NAMES.MARKET_DATA, SERVICE_NAMES.CONTEST_EVALUATION]);
        } else {
            logApi.info(`${fancyColors.YELLOW}Skipping registration of portfolio_snapshot_service - disabled in config${fancyColors.RESET}`);
        }
        
        // Register Launch Event Service if enabled
        if (config.services.launch_event) {
            if (VERBOSE_SERVICE_INIT_LOGS) {
                logApi.info(`${fancyColors.YELLOW}┃ 🔹 Registering Launch Event Service ${fancyColors.RESET}`);
            }
            serviceManager.register(launchEventService, []); // No hard dependencies for now
        } else {
            logApi.info(`${fancyColors.YELLOW}Skipping registration of Launch Event Service - disabled in config${fancyColors.RESET}`);
        }
        
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
        
        // Register wallet services only if enabled in config
        if (config.services.contest_wallet_service) {
            serviceManager.register(contestWalletService, [SERVICE_NAMES.CONTEST_EVALUATION]);
        } else {
            logApi.info(`${fancyColors.YELLOW}Skipping registration of contest_wallet_service - disabled in config${fancyColors.RESET}`);
        }
        
        if (config.services.admin_wallet_service) {
            serviceManager.register(adminWalletService, [SERVICE_NAMES.CONTEST_WALLET]);
        } else {
            logApi.info(`${fancyColors.YELLOW}Skipping registration of admin_wallet_service - disabled in config${fancyColors.RESET}`);
        }
        
        // DEPRECATED: walletRakeService - functionality has been integrated into contestWalletService
        // SAFETY CHECK: Skip registration of wallet_rake_service - it's deprecated
        if (config.services.wallet_rake) {
            logApi.info(`${fancyColors.YELLOW}Skipping registration of wallet_rake_service - deprecated and replaced by contest_wallet_service${fancyColors.RESET}`);
        }
        
        // Ensure schema exists for user balance tracking
        if (config.services.user_balance_tracking) {
            serviceManager.register(userBalanceTrackingService, [SERVICE_NAMES.SOLANA_ENGINE]);
        } else {
            logApi.info(`${fancyColors.YELLOW}Skipping registration of user_balance_tracking_service - disabled in config${fancyColors.RESET}`);
        }
        
        // Register vanity wallet service if enabled
        if (config.services.vanity_wallet_service) {
            // Properly handle vanity wallet service registration
            logApi.info(`${fancyColors.BLUE}Registering vanity_wallet_service...${fancyColors.RESET}`);
            
            // Verify vanityWalletService is properly structured before registration
            if (!vanityWalletService || typeof vanityWalletService !== 'object') {
                logApi.error(`${fancyColors.RED}Error: vanityWalletService is not a valid object${fancyColors.RESET}`);
            } else if (!vanityWalletService.init || !vanityWalletService.start || !vanityWalletService.stop) {
                logApi.error(`${fancyColors.RED}Error: vanityWalletService is missing required methods${fancyColors.RESET}`);
            } else {
                // Add required name property if missing (since the export structure in this case is different)
                if (!vanityWalletService.name) {
                    vanityWalletService.name = 'vanity_wallet_service';
                    logApi.info(`${fancyColors.YELLOW}Added missing 'name' property to vanityWalletService${fancyColors.RESET}`);
                }
                
                // Register the service
                try {
                    serviceManager.register(vanityWalletService, [SERVICE_NAMES.SOLANA_ENGINE]);
                    logApi.info(`${fancyColors.GREEN}Successfully registered vanity_wallet_service${fancyColors.RESET}`);
                } catch (error) {
                    logApi.error(`${fancyColors.RED}Failed to register vanity_wallet_service: ${error.message}${fancyColors.RESET}`);
                }
            }
        } else {
            logApi.info(`${fancyColors.YELLOW}Skipping registration of vanity_wallet_service - disabled in config${fancyColors.RESET}`);
        }
        
        if (VERBOSE_SERVICE_INIT_LOGS) {
            logApi.info(`${fancyColors.GREEN}┗━━━━━━━━━━━ ✅ WALLET LAYER REGISTRATION COMPLETE${fancyColors.RESET}`);
        }
        
        // COMPLETELY REMOVED: solana_service - it's fully deprecated now
        // We now import SolanaEngine instead of SolanaService
        logApi.info(`${fancyColors.YELLOW}NOTE: solana_service is deprecated - it has been completely removed and replaced by solanaEngine${fancyColors.RESET}`);
        
        if (VERBOSE_SERVICE_INIT_LOGS) {
            logApi.info(`${fancyColors.GREEN}┗━━━━━━━━━━━ ✅ WALLET LAYER REGISTRATION COMPLETE${fancyColors.RESET}`);
        }
    }

    /**
     * Register Application Layer services
     * High-level services used across the application
     */
    static async registerApplicationLayer() {
        if (VERBOSE_SERVICE_INIT_LOGS) {
            logApi.info(`${fancyColors.BLUE}┏━━━━━━━━━━━━━━━━━━ Application Layer (5/5) ━━━━━━━━━━━━━━━━━━┓${fancyColors.RESET}`);
        }

        // Register AI Service
        if (config.services.ai_service) { // Check config
            serviceManager.register(aiService); // Register the imported canonical instance
        } else {
            logApi.info(`${fancyColors.YELLOW}Skipping registration of ai_service - disabled in config${fancyColors.RESET}`);
        }

        // Register Dialect Service for Blinks
        if (config.services.dialect_service) { // Check config
            try {
                // Dynamic import for the dialect service
                const { default: dialectService } = await import('../../services/dialect/index.js');
                serviceManager.register(dialectService, [SERVICE_NAMES.SOLANA_ENGINE]);
                logApi.info(`${fancyColors.GREEN}Successfully registered dialect_service${fancyColors.RESET}`);
            } catch (error) {
                logApi.error(`${fancyColors.RED}Failed to register dialect_service: ${error.message}${fancyColors.RESET}`);
            }
        } else {
            logApi.info(`${fancyColors.YELLOW}Skipping registration of dialect_service - disabled in config${fancyColors.RESET}`);
        }

        // ... register other future application-level services here ...

        if (VERBOSE_SERVICE_INIT_LOGS) {
            logApi.info(`${fancyColors.BLUE}┗━━━━━━━━━━━ ✅ APPLICATION LAYER REGISTRATION COMPLETE${fancyColors.RESET}`);
        }
    }

    /**
     * Register the dependencies between the services
     * Respects service profiles to avoid dependency issues with disabled services
     */
    static registerDependencies() {
        // Helper function to check if a service is enabled in the current profile
        const isServiceEnabled = (serviceName) => {
            // Map service names to config property names
            const serviceConfigMap = {
                // TOKEN_SYNC has been permanently removed
                // TOKEN_WHITELIST has been permanently disabled
                [SERVICE_NAMES.MARKET_DATA]: 'market_data',
                [SERVICE_NAMES.CONTEST_EVALUATION]: 'contest_evaluation',
                [SERVICE_NAMES.LIQUIDITY]: 'liquidity',
                [SERVICE_NAMES.USER_BALANCE_TRACKING]: 'user_balance_tracking',
                [SERVICE_NAMES.WALLET_RAKE]: 'wallet_rake',
                [SERVICE_NAMES.CONTEST_SCHEDULER]: 'contest_scheduler',
                [SERVICE_NAMES.ACHIEVEMENT]: 'achievement_service',
                [SERVICE_NAMES.REFERRAL]: 'referral_service',
                [SERVICE_NAMES.LEVELING]: 'leveling_service',
                [SERVICE_NAMES.CONTEST_WALLET]: 'contest_wallet_service',
                [SERVICE_NAMES.ADMIN_WALLET]: 'admin_wallet_service',
                [SERVICE_NAMES.SOLANA_ENGINE]: 'solana_engine_service',
                [SERVICE_NAMES.VANITY_WALLET]: 'vanity_wallet_service',
                [SERVICE_NAMES.TOKEN_DEX_DATA]: 'token_dex_data_service',
                [SERVICE_NAMES.TOKEN_REFRESH_SCHEDULER]: 'token_refresh_scheduler',
                [SERVICE_NAMES.TOKEN_DETECTION]: 'token_detection_service',
                [SERVICE_NAMES.TOKEN_ENRICHMENT]: 'token_enrichment_service',
                [SERVICE_NAMES.PORTFOLIO_SNAPSHOT]: 'portfolio_snapshot_service',
                [SERVICE_NAMES.DIALECT]: 'dialect_service',
                // Add other services as they get profile support
            };
            
            const configProp = serviceConfigMap[serviceName];
            if (!configProp) return true; // If no mapping exists, assume enabled
            
            // Check if this service is in the forced disabled list
            const forcedDisabledServices = config.disable_services || {};
            if (forcedDisabledServices[configProp] === true) {
                logApi.info(`${fancyColors.YELLOW}Service ${serviceName} is forcefully disabled via config.disable_services${fancyColors.RESET}`);
                return false;
            }
            
            // Check if the service is enabled in the current profile
            return config.services[configProp] !== false;
        };
        
        // Helper function to add dependency only if both services are enabled
        const addDependencyIfEnabled = (service, dependency) => {
            if (isServiceEnabled(service) && isServiceEnabled(dependency)) {
                serviceManager.addDependency(service, dependency);
                logApi.info(`${fancyColors.MAGENTA}[ServiceInitializer]${fancyColors.RESET} ${fancyColors.GREEN}Added dependency: ${service} → ${dependency}${fancyColors.RESET}`);
            } else {
                // Log skipped dependency
                logApi.info(`${fancyColors.MAGENTA}[ServiceInitializer]${fancyColors.RESET} ${fancyColors.YELLOW}Skipping dependency: ${service} → ${dependency} (one or both services are disabled in the '${config.services.active_profile}' profile)${fancyColors.RESET}`);
            }
        };

        // Infrastructure Layer Dependencies
        // REMOVED: Liquidity service dependency on WALLET_GENERATOR since that service was deleted

        // Data Layer Dependencies
        // Removed dependency on TOKEN_SYNC as it's no longer needed
        // addDependencyIfEnabled(SERVICE_NAMES.MARKET_DATA, SERVICE_NAMES.TOKEN_SYNC);
        
        // IMPORTANT: We have COMPLETELY REMOVED all usage of solanaService
        // SolanaEngine now connects directly to Helius
        logApi.info(`${fancyColors.MAGENTA}[ServiceInitializer]${fancyColors.RESET} ${fancyColors.YELLOW}Skipping all solana_service dependencies - service has been deprecated${fancyColors.RESET}`);

        // Contest Layer Dependencies
        addDependencyIfEnabled(SERVICE_NAMES.CONTEST_EVALUATION, SERVICE_NAMES.MARKET_DATA);
        // We can optionally readd these now that we check if services are enabled:
        // addDependencyIfEnabled(SERVICE_NAMES.ACHIEVEMENT, SERVICE_NAMES.CONTEST_EVALUATION);
        // addDependencyIfEnabled(SERVICE_NAMES.REFERRAL, SERVICE_NAMES.CONTEST_EVALUATION);

        // Wallet Layer Dependencies
        // Only add this dependency if both services are enabled
        addDependencyIfEnabled(SERVICE_NAMES.CONTEST_WALLET, SERVICE_NAMES.CONTEST_EVALUATION);
        addDependencyIfEnabled(SERVICE_NAMES.ADMIN_WALLET, SERVICE_NAMES.CONTEST_WALLET);

        // Add dependencies for Portfolio Snapshot Service
        addDependencyIfEnabled(SERVICE_NAMES.PORTFOLIO_SNAPSHOT, SERVICE_NAMES.MARKET_DATA);
        addDependencyIfEnabled(SERVICE_NAMES.PORTFOLIO_SNAPSHOT, SERVICE_NAMES.CONTEST_EVALUATION);
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
            
            // Token Sync Service has been removed completely
            
            // Initialize all services using ServiceManager
            const results = await serviceManager.initializeAll();
            
            // Get list of intentionally disabled services
            const disabledServices = results.failed.filter(service => {
                // Check against the service profiles
                const serviceState = serviceManager.state.get(service);
                return serviceState && serviceState.status === 'disabled_by_config';
            });
            
            // Get actual failures (not intentionally disabled)
            const realFailures = results.failed.filter(service => {
                const serviceState = serviceManager.state.get(service);
                return !serviceState || serviceState.status !== 'disabled_by_config';
            });
            
            // Show initialization summary with clearer categories
            const successCount = results.initialized.length;
            const disabledCount = disabledServices.length;
            const realFailCount = realFailures.length;
            
            logApi.info(`✅ Services summary: ${successCount} succeeded, ${disabledCount} disabled by profile, ${realFailCount} failed`);
            
            // Log intentionally disabled services with a clear message
            if (disabledServices.length > 0) {
                logApi.warn(`${fancyColors.BG_YELLOW}${fancyColors.BLACK} PROFILE INFO ${fancyColors.RESET} ${fancyColors.YELLOW}Services disabled by profile configuration: ${disabledServices.join(', ')}${fancyColors.RESET}`);
            }
            
            // Always show real failures
            if (realFailures.length > 0) {
                logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} ERROR ${fancyColors.RESET} ${realFailures.length} services failed to initialize:`);
                realFailures.forEach(service => {
                    logApi.error(`❌ Failed to initialize service: ${service}`);
                });
            }
            
            // Log to admin logger for auditing
            await AdminLogger.logAction(
                'SYSTEM',
                AdminLogger.Actions.SERVICE.START,
                {
                    initialized: results.initialized,
                    failed: results.failed,
                    intentionallyDisabled: [],
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
            logApi.info(`[Svc Initlzr --> Shutdown] ✅ Services cleanup: ${successCount} succeeded, ${failCount} failed`);
            
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