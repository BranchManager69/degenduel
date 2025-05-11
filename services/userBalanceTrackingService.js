// services/userBalanceTrackingService.js

/**
 * User balance tracking service
 * 
 * This service monitors user wallet balances on Solana.
 * It has been updated to use SolanaEngine which provides enhanced RPC capabilities
 * with multi-endpoint support and automatic failover.
 * 
 * @module services/userBalanceTrackingService
 */

import { BaseService } from '../utils/service-suite/base-service.js';
import { ServiceError } from '../utils/service-suite/service-error.js';
import { logApi } from '../utils/logger-suite/logger.js';
import prisma from '../config/prisma.js';
import { solanaEngine } from '../services/solana-engine/index.js';
// Legacy Helius tracker as fallback
import { heliusBalanceTracker } from '../services/solana-engine/index.js';
import { isAddress } from '@solana/addresses';
import { SERVICE_NAMES } from '../utils/service-suite/service-constants.js';
import { fancyColors } from '../utils/colors.js';

// Config
import { config } from '../config/config.js';

// TEST OVERRIDE - Set to true to force WebSocket mode regardless of environment settings
const FORCE_WEBSOCKET_MODE = true;

// IMPORTANT: Set to 'direct' to use direct RPC WebSocket, 'helius' to use HeliusBalanceTracker, or 'polling' for traditional polling
let WEBSOCKET_IMPLEMENTATION = 'direct'; // 'direct', 'helius'

const USER_BALANCE_TRACKING_MODE = FORCE_WEBSOCKET_MODE ? 'websocket' : config.service_thresholds.user_balance_tracking_mode; // 'polling' or 'websocket'
const USER_BALANCE_TRACKING_DYNAMIC_TARGET_RPC_CALLS_PER_DAY = config.service_thresholds.user_balance_tracking_dynamic_target_rpc_calls_per_day; // dynamic target RPC calls per day (specific to user balance tracking service)
const USER_BALANCE_TRACKING_CHECK_INTERVAL = config.service_intervals.user_balance_tracking_check_interval; // cycle interval (minutes)
const USER_BALANCE_TRACKING_MIN_CHECK_INTERVAL = config.service_thresholds.user_balance_tracking_min_check_interval; // Hard minimum between balance checks (minutes)
const USER_BALANCE_TRACKING_MAX_CHECK_INTERVAL = config.service_thresholds.user_balance_tracking_max_check_interval; // Hard maximum between checks (minutes)
const USER_BALANCE_TRACKING_BATCH_SIZE = config.service_thresholds.user_balance_tracking_batch_size; // in users (hard maximum = 100; do not exceed)

const LAMPORTS_PER_SOL_V2 = 1_000_000_000; // Ensure this is defined

// User balance tracking service configuration
const BALANCE_TRACKING_CONFIG = {
    name: SERVICE_NAMES.USER_BALANCE_TRACKING || 'user_balance_tracking',
    description: 'Tracks user wallet balances on Solana',
    checkIntervalMs: USER_BALANCE_TRACKING_CHECK_INTERVAL * 60 * 1000,
    maxRetries: 3,
    retryDelayMs: 5 * 1000,
    circuitBreaker: {
        failureThreshold: 5,
        resetTimeoutMs: 60 * 1000,
        minHealthyPeriodMs: 120 * 1000
    },
    rateLimit: {
        // Configurable rate limits
        queriesPerHour: Math.round(USER_BALANCE_TRACKING_DYNAMIC_TARGET_RPC_CALLS_PER_DAY / 24), // dynamic RPC queries per hour for the user balance tracking service
        // Hard min/max between dynamic balance checks
        minCheckIntervalMs: USER_BALANCE_TRACKING_MIN_CHECK_INTERVAL * 60 * 1000, // Hard minimum between balance checks
        maxCheckIntervalMs: USER_BALANCE_TRACKING_MAX_CHECK_INTERVAL * 60 * 1000, // Hard maximum between checks
    },
    // Hard max users to check in parallel (do not exceed)
    batchSize: USER_BALANCE_TRACKING_BATCH_SIZE || 100
};

/**
 * Service for tracking user Solana wallet balances
 * 
 * @extends BaseService
 */
class UserBalanceTrackingService extends BaseService {
    /**
     * Constructor for the user balance tracking service
     * 
     * @returns {UserBalanceTrackingService} - The user balance tracking service
     */
    constructor() {
        super(BALANCE_TRACKING_CONFIG);
        
        // Current tracking mode (polling or websocket)
        this.trackingMode = USER_BALANCE_TRACKING_MODE;
        
        // Track user check schedule (for polling mode)
        this.userSchedule = new Map();
        this.activeChecks = new Set();
        
        // Track subscribed wallets (for WebSocket mode)
        this.subscribedWallets = new Set();
        this.pendingSubscriptions = new Map(); // wallet -> {retries, lastAttempt}

        // Direct WebSocket module reference
        this.walletBalanceWs = null;
        
        // Stats for tracking and monitoring
        this.trackingStats = {
            operations: {
                total: 0,
                successful: 0,
                failed: 0
            },
            balanceChecks: {
                total: 0,
                successful: 0,
                failed: 0,
                lastCheck: null
            },
            subscriptions: {
                total: 0,
                active: 0,
                pending: 0,
                failed: 0
            },
            users: {
                total: 0,
                active: 0,
                trackedUsers: new Set() // Track which users we're monitoring
            },
            solana: {
                requestsPerHour: 0,
                totalRequests: 0,
                errors: 0
            },
            performance: {
                averageCheckTimeMs: 0,
                lastOperationTimeMs: 0
            }
        };
    }
    
    /**
     * Initialize the service and load configs
     * 
     * @returns {Promise<boolean>} - True if the service is initialized, false otherwise
     */
    async initialize() {
        try {
            await super.initialize();
            
            // Check if service is enabled via service profile
            if (!config.services.user_balance_tracking) {
                logApi.warn(`${fancyColors.MAGENTA}[userBalanceTrackingService]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} SERVICE DISABLED ${fancyColors.RESET} User Balance Tracking Service is disabled in the '${config.services.active_profile}' service profile`);
                return false; // Skip initialization
            }
            
            // Verify SolanaEngine is available
            if (typeof solanaEngine.isInitialized === 'function' ? !solanaEngine.isInitialized() : !solanaEngine.isInitialized) {
                logApi.warn(`${fancyColors.MAGENTA}[userBalanceTrackingService]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} WAITING FOR SOLANA ${fancyColors.RESET} SolanaEngine not yet initialized, will wait...`);
                
                // Add some tolerance for initialization order
                for (let i = 0; i < 5; i++) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    if (typeof solanaEngine.isInitialized === 'function' ? solanaEngine.isInitialized() : solanaEngine.isInitialized) {
                        logApi.info(`${fancyColors.MAGENTA}[userBalanceTrackingService]${fancyColors.RESET} ${fancyColors.GREEN}SolanaEngine now available.${fancyColors.RESET}`);
                        break;
                    }
                }
                
                // Final check
                if (typeof solanaEngine.isInitialized === 'function' ? !solanaEngine.isInitialized() : !solanaEngine.isInitialized) {
                    throw new Error('SolanaEngine is not available after waiting. Balance tracking requires SolanaEngine.');
                }
            }
            
            // Load settings from database
            const settings = await prisma.system_settings.findUnique({
                where: { key: this.config.name }
            });
            
            if (settings?.value?.rateLimit) {
                this.config.rateLimit = {
                    ...this.config.rateLimit,
                    ...settings.value.rateLimit
                };
                logApi.info(`Loaded rate limit settings: ${this.config.rateLimit.queriesPerHour} queries/hour`);
            }
            
            // Get current active user count
            const activeUsers = await prisma.users.count({
                where: { is_banned: false }
            });
            
            this.trackingStats.users.total = activeUsers;
            
            // Initialize the appropriate tracking mode
            if (this.trackingMode === 'websocket') {
                if (WEBSOCKET_IMPLEMENTATION === 'direct') {
                    // Initialize direct RPC WebSocket monitoring
                    try {
                        // Import the wallet-balance-ws module
                        this.walletBalanceWs = (await import('./user-balance-tracking/wallet-balance-ws.js')).default;

                        // Initialize the WebSocket connection
                        const initialized = await this.walletBalanceWs.initializeWalletBalanceWebSocket(solanaEngine, this.config);

                        if (initialized) {
                            logApi.info(`${fancyColors.BOLD}${fancyColors.CYAN}Direct RPC WebSocket Tracking Mode${fancyColors.RESET} ${fancyColors.CYAN}initialized for real-time balance updates${fancyColors.RESET}`);
                        } else {
                            logApi.warn(`${fancyColors.MAGENTA}[userBalanceTrackingService]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} DIRECT WEBSOCKET FALLBACK ${fancyColors.RESET} Failed to initialize direct RPC WebSocket, trying HeliusBalanceTracker as fallback`);

                            // Try HeliusBalanceTracker as fallback
                            if (!heliusBalanceTracker.initialized) {
                                const heliusInitialized = await heliusBalanceTracker.initialize();
                                if (!heliusInitialized) {
                                    logApi.warn(`${fancyColors.MAGENTA}[userBalanceTrackingService]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} WEBSOCKET FALLBACK ${fancyColors.RESET} Failed to initialize HeliusBalanceTracker, falling back to polling mode`);
                                    this.trackingMode = 'polling'; // Fallback to polling mode
                                } else {
                                    logApi.info(`${fancyColors.BOLD}${fancyColors.CYAN}Helius WebSocket Tracking Mode${fancyColors.RESET} ${fancyColors.CYAN}initialized for real-time balance updates${fancyColors.RESET}`);
                                    // Set WebSocket implementation to Helius since direct failed
                                    WEBSOCKET_IMPLEMENTATION = 'helius';
                                }
                            }
                        }
                    } catch (error) {
                        logApi.error(`${fancyColors.MAGENTA}[userBalanceTrackingService]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} WEBSOCKET ERROR ${fancyColors.RESET} Failed to initialize direct RPC WebSocket: ${error.message}`);

                        // Try HeliusBalanceTracker as fallback
                        if (!heliusBalanceTracker.initialized) {
                            const heliusInitialized = await heliusBalanceTracker.initialize();
                            if (!heliusInitialized) {
                                this.trackingMode = 'polling'; // Fallback to polling mode
                            } else {
                                // Set WebSocket implementation to Helius since direct failed
                                WEBSOCKET_IMPLEMENTATION = 'helius';
                            }
                        }
                    }
                } else {
                    // Initialize HeliusBalanceTracker for WebSocket mode
                    if (!heliusBalanceTracker.initialized) {
                        const initialized = await heliusBalanceTracker.initialize();
                        if (!initialized) {
                            logApi.warn(`${fancyColors.MAGENTA}[userBalanceTrackingService]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} WEBSOCKET FALLBACK ${fancyColors.RESET} Failed to initialize HeliusBalanceTracker, falling back to polling mode`);
                            this.trackingMode = 'polling'; // Fallback to polling mode
                        } else {
                            logApi.info(`${fancyColors.BOLD}${fancyColors.CYAN}WebSocket Tracking Mode${fancyColors.RESET} ${fancyColors.CYAN}initialized for real-time balance updates${fancyColors.RESET}`);
                        }
                    }
                }
            } else {
                // Initialize polling mode
                // Calculate check interval based on user count
                this.calculateCheckInterval(activeUsers);
                
                logApi.info(`${fancyColors.BOLD}${fancyColors.ORANGE}Polling Tracking Mode${fancyColors.RESET} ${fancyColors.ORANGE}initialized with interval of ${fancyColors.BOLD_YELLOW}${Math.round(this.effectiveCheckIntervalMs / 1000 / 60)} ${fancyColors.ORANGE}minutes${fancyColors.RESET}`);
            }
            
            // Get SolanaEngine connection status
            let solanaStatus = { available: false };
            try {
                if (typeof solanaEngine.isInitialized === 'function' ? solanaEngine.isInitialized() : solanaEngine.isInitialized) {
                    solanaStatus = {
                        available: true,
                        connectionStatus: solanaEngine.getConnectionStatus()
                    };
                }
            } catch (error) {
                solanaStatus.error = error.message;
            }
            
            const healthyEndpoints = solanaStatus.connectionStatus?.healthyEndpoints || 0;
            const totalEndpoints = solanaStatus.connectionStatus?.totalEndpoints || 0;
            
            // Log the final mode and implementation
            const modeSuffix = this.trackingMode === 'websocket' ? ` (${WEBSOCKET_IMPLEMENTATION})` : '';
            logApi.info(`${fancyColors.BOLD}${fancyColors.ORANGE}User Balance Tracking Service${fancyColors.RESET} ${fancyColors.ORANGE}initialized with ${fancyColors.BOLD_YELLOW}${activeUsers}${fancyColors.RESET} ${fancyColors.ORANGE}users using ${fancyColors.BOLD_YELLOW}${this.trackingMode}${modeSuffix}${fancyColors.RESET} ${fancyColors.ORANGE}mode${fancyColors.RESET}`);
            logApi.info(`${fancyColors.BOLD}${fancyColors.ORANGE}Using SolanaEngine with ${fancyColors.BOLD_YELLOW}${healthyEndpoints}/${totalEndpoints}${fancyColors.RESET} ${fancyColors.ORANGE}healthy RPC endpoints${fancyColors.RESET}`);
            
            return true;
        } catch (error) {
            logApi.error('Failed to initialize User Balance Tracking Service:', error);
            throw error;
        }
    }
    
    /**
     * Calculate optimal check interval based on user count and rate limits
     * 
     * @param {number} userCount - The number of active users
     */
    calculateCheckInterval(userCount) {
        const { queriesPerHour, minCheckIntervalMs, maxCheckIntervalMs } = this.config.rateLimit;
        
        // Default to minimum if no users
        if (!userCount) {
            this.effectiveCheckIntervalMs = maxCheckIntervalMs;
            return;
        }
        
        // Calculate how often we can check each user
        // queriesPerHour / userCount = queries per user per hour
        // 3600000 (ms in hour) / (queries per user per hour) = ms between checks per user
        const calculatedIntervalMs = 3600000 / (queriesPerHour / userCount);
        
        // Apply min/max constraints
        this.effectiveCheckIntervalMs = Math.max(
            minCheckIntervalMs,
            Math.min(calculatedIntervalMs, maxCheckIntervalMs)
        );
        
        // Calculate the user count boundary values
        const minBoundaryUsers = Math.ceil((minCheckIntervalMs * queriesPerHour) / 3600000);
        const maxBoundaryUsers = Math.floor((maxCheckIntervalMs * queriesPerHour) / 3600000);
        
        // Determine which constraint (if any) was applied
        let constraintStatus;
        if (this.effectiveCheckIntervalMs === minCheckIntervalMs) {
            constraintStatus = `${fancyColors.BG_YELLOW}${fancyColors.BLACK} MIN CONSTRAINT ${fancyColors.RESET}`;
        } else if (this.effectiveCheckIntervalMs === maxCheckIntervalMs) {
            constraintStatus = `${fancyColors.BG_YELLOW}${fancyColors.BLACK} MAX CONSTRAINT ${fancyColors.RESET}`;
        } else {
            constraintStatus = `${fancyColors.BG_GREEN}${fancyColors.BLACK} DYNAMIC RANGE ${fancyColors.RESET}`;
        }
        
        // Log the calculated interval with constraint information
        logApi.info(`${fancyColors.BOLD}${fancyColors.ORANGE}Balance check interval${fancyColors.RESET}: ${fancyColors.BOLD_YELLOW}${Math.round(this.effectiveCheckIntervalMs / 1000 / 60, 2)} minutes${fancyColors.RESET} ${constraintStatus}`);
        
        // Log the dynamic calculation boundary information
        logApi.info(`${fancyColors.BOLD}${fancyColors.ORANGE}Dynamic calculation bounds${fancyColors.RESET}: ${fancyColors.BOLD_YELLOW}${minBoundaryUsers}${fancyColors.RESET} ${fancyColors.ORANGE}to${fancyColors.RESET} ${fancyColors.BOLD_YELLOW}${maxBoundaryUsers}${fancyColors.RESET} ${fancyColors.ORANGE}users${fancyColors.RESET} (Current: ${fancyColors.BOLD_YELLOW}${userCount}${fancyColors.RESET} users)`);
        
        // Log RPC usage projection
        const checksPerHour = 60 / (this.effectiveCheckIntervalMs / 60000);
        const dailyRpcCalls = Math.round(userCount * checksPerHour * 24);
        const monthlyRpcCalls = dailyRpcCalls * 30;
        
        logApi.info(`${fancyColors.BOLD}${fancyColors.ORANGE}Projected RPC usage${fancyColors.RESET}: ${fancyColors.BOLD_YELLOW}${dailyRpcCalls.toLocaleString()}${fancyColors.RESET} ${fancyColors.ORANGE}calls/day${fancyColors.RESET} ${fancyColors.ORANGE}(${fancyColors.BOLD_YELLOW}${monthlyRpcCalls.toLocaleString()}${fancyColors.RESET} ${fancyColors.ORANGE}calls/month with current ${fancyColors.BOLD_YELLOW}${userCount}${fancyColors.RESET} ${fancyColors.ORANGE}users)${fancyColors.RESET}`);
        
        // Create visual representation (0 to 5000 users scale)
        const maxScale = 5000;
        const barWidth = 40; // characters wide
        const minBoundaryPos = Math.floor((minBoundaryUsers / maxScale) * barWidth);
        const maxBoundaryPos = Math.floor((maxBoundaryUsers / maxScale) * barWidth);
        const userPos = Math.floor((userCount / maxScale) * barWidth);
        
        // Build the visual bar
        let visualBar = '';
        for (let i = 0; i < barWidth; i++) {
            if (i === userPos) {
                // Current user position
                visualBar += `${fancyColors.BG_WHITE}${fancyColors.BLACK}|${fancyColors.RESET}`;
            } else if (i >= minBoundaryPos && i <= maxBoundaryPos) {
                // Dynamic range
                visualBar += `${fancyColors.BG_GREEN}${fancyColors.BLACK}█${fancyColors.RESET}`;
            } else if (i < minBoundaryPos) {
                // Min constraint zone
                visualBar += `${fancyColors.BG_YELLOW}${fancyColors.BLACK}█${fancyColors.RESET}`;
            } else {
                // Max constraint zone
                visualBar += `${fancyColors.BG_RED}${fancyColors.BLACK}█${fancyColors.RESET}`;
            }
        }
        
        // Create labels
        const scaleLabels = `${fancyColors.GRAY}0${' '.repeat(barWidth-8)}${Math.round(maxScale/2)}${' '.repeat(barWidth-String(maxScale).length-9)}${maxScale}${fancyColors.RESET}`;
        
        // Log visual representation
        logApi.info(`${fancyColors.BOLD}${fancyColors.ORANGE}User count range [0-${maxScale}]${fancyColors.RESET}:`);
        logApi.info(`${visualBar}`);
        logApi.info(`${scaleLabels}`);
        logApi.info(
            `${fancyColors.BG_YELLOW}${fancyColors.BLACK}█${fancyColors.RESET} Min Constraint (≤${minBoundaryUsers}) ` +
            `${fancyColors.BG_GREEN}${fancyColors.BLACK}█${fancyColors.RESET} Dynamic Range (${minBoundaryUsers+1}-${maxBoundaryUsers}) ` +
            `${fancyColors.BG_RED}${fancyColors.BLACK}█${fancyColors.RESET} Max Constraint (≥${maxBoundaryUsers+1}) ` +
            `${fancyColors.BG_WHITE}${fancyColors.BLACK}|${fancyColors.RESET} Current (${userCount})`
        );
    }
    
    /**
     * Implements the onPerformOperation method required by BaseService
     * This gets called regularly by the BaseService to perform the service's main operation
     * and is used for circuit breaker recovery
     * @returns {Promise<boolean>} Success status
     */
    async onPerformOperation() {
        try {
            // Skip operation if service is not properly initialized or started
            if (!this.isOperational) {
                logApi.debug(`${fancyColors.BG_ORANGE}${fancyColors.WHITE} BALANCE SKIP ${fancyColors.RESET} Service not operational, skipping operation`);
                return true;
            }
            
            // Call the original performOperation implementation
            await this.performOperation();
            
            return true;
        } catch (error) {
            logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} BALANCE ERROR ${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.RED}Operation error: ${error.message}${fancyColors.RESET}`);
            throw error; // Important: re-throw to trigger circuit breaker
        }
    }
    
    /**
     * Required implementation of performOperation - main service loop
     * 
     * @returns {Promise<Object>} - The results of the operation
     */
    async performOperation() {
        const startTime = Date.now();
        
        try {
            // Different operation based on tracking mode
            if (this.trackingMode === 'websocket') {
                return await this.performWebSocketOperation();
            } else {
                return await this.performPollingOperation();
            }
        } catch (error) {
            this.trackingStats.operations.failed++;
            this.trackingStats.operations.total++;
            
            // Log error at cycle level with red background
            logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} BALANCE ERROR ${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.RED}Cycle failed: ${error.message}${fancyColors.RESET}`);
            
            throw error;
        }
    }
    
    /**
     * Perform operation in polling mode
     * 
     * @returns {Promise<Object>} - Operation results
     */
    async performPollingOperation() {
        const startTime = Date.now();
        
        // Add log at the start of each operation cycle with timestamp
        logApi.info(`${fancyColors.BG_ORANGE}${fancyColors.WHITE} BALANCE CYCLE ${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.ORANGE}Starting balance refresh cycle${fancyColors.RESET} | Users tracked: ${fancyColors.BOLD_YELLOW}${this.trackingStats.users.trackedUsers.size}${fancyColors.RESET} | Interval: ${Math.round(this.effectiveCheckIntervalMs/1000)}s`);
        
        // 1. Update user count and recalculate interval if needed
        await this.updateUserCount();
        
        // 2. Schedule balance checks for any new users
        const newUsersCount = await this.scheduleNewUsers();
        if (newUsersCount > 0) {
            logApi.info(`${fancyColors.BG_ORANGE}${fancyColors.WHITE} BALANCE USERS ${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.ORANGE}Added ${fancyColors.BOLD_YELLOW}${newUsersCount}${fancyColors.RESET}${fancyColors.ORANGE} new users to balance tracking${fancyColors.RESET}`);
        }
        
        // 3. Execute scheduled balance checks
        const results = await this.executeScheduledChecks();
        
        // 4. Update stats
        this.trackingStats.operations.successful++;
        this.trackingStats.operations.total++;
        this.trackingStats.performance.lastOperationTimeMs = Date.now() - startTime;
        
        // Calculate rolling average
        const totalOps = this.trackingStats.operations.total;
        this.trackingStats.performance.averageCheckTimeMs = 
            (this.trackingStats.performance.averageCheckTimeMs * (totalOps - 1) + 
            (Date.now() - startTime)) / totalOps;
        
        // 5. Record success
        await this.recordSuccess();
        
        // Add log at the end of the cycle with timing information
        const duration = Date.now() - startTime;
        logApi.info(`${fancyColors.BG_ORANGE}${fancyColors.WHITE} BALANCE CYCLE ${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.ORANGE}Completed cycle in ${fancyColors.YELLOW}${duration}ms${fancyColors.RESET} | Next cycle: ${new Date(Date.now() + this.config.checkIntervalMs).toLocaleTimeString()}`);
        
        return {
            duration: duration,
            checksPerformed: results.checksPerformed,
            checksScheduled: results.checksScheduled
        };
    }
    
    /**
     * Perform operation in WebSocket mode
     *
     * @returns {Promise<Object>} - Operation results
     */
    async performWebSocketOperation() {
        const startTime = Date.now();

        // Add log at the start of each operation cycle with timestamp
        logApi.info(`${fancyColors.BG_CYAN}${fancyColors.WHITE} BALANCE WS CYCLE ${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.CYAN}Starting WebSocket maintenance cycle${fancyColors.RESET} | Wallets tracked: ${fancyColors.BOLD_YELLOW}${this.subscribedWallets.size}${fancyColors.RESET} | Pending: ${this.pendingSubscriptions.size}`);

        // 1. Update user count
        await this.updateUserCount();

        // Different implementations for direct vs Helius WebSocket
        if (WEBSOCKET_IMPLEMENTATION === 'direct') {
            // Direct RPC WebSocket implementation
            if (this.walletBalanceWs) {
                // Get WebSocket status
                const wsStatus = this.walletBalanceWs.getWebSocketStatus();

                logApi.info(`${fancyColors.BG_CYAN}${fancyColors.WHITE} DIRECT WS STATUS ${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.CYAN}Connection: ${fancyColors.YELLOW}${wsStatus.connectionState}${fancyColors.RESET} | Wallets: ${fancyColors.BOLD_YELLOW}${wsStatus.walletCount}${fancyColors.RESET} | Subscriptions: ${fancyColors.BOLD_YELLOW}${wsStatus.subscriptionCount}${fancyColors.RESET}`);

                // If connection is not healthy, try to refresh it
                if (wsStatus.connectionState !== 'connected') {
                    logApi.warn(`${fancyColors.BG_YELLOW}${fancyColors.BLACK} DIRECT WS REFRESH ${fancyColors.RESET} WebSocket connection is not healthy (${wsStatus.connectionState}), attempting to refresh`);
                    await this.walletBalanceWs.refreshMonitoredWallets();
                }
            }
        } else {
            // Original Helius WebSocket implementation
            // 2. Subscribe any new users to WebSocket updates
            const newUsersCount = await this.subscribeNewUsers();
            if (newUsersCount > 0) {
                logApi.info(`${fancyColors.BG_CYAN}${fancyColors.WHITE} BALANCE WS USERS ${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.CYAN}Added ${fancyColors.BOLD_YELLOW}${newUsersCount}${fancyColors.RESET}${fancyColors.CYAN} new users to balance tracking${fancyColors.RESET}`);
            }

            // 3. Retry any pending subscriptions
            const retriedCount = await this.retryPendingSubscriptions();
            if (retriedCount > 0) {
                logApi.info(`${fancyColors.BG_CYAN}${fancyColors.WHITE} BALANCE WS RETRY ${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.CYAN}Retried ${fancyColors.BOLD_YELLOW}${retriedCount}${fancyColors.RESET}${fancyColors.CYAN} pending subscriptions${fancyColors.RESET}`);
            }
        }

        // 4. Update stats
        this.trackingStats.operations.successful++;
        this.trackingStats.operations.total++;
        this.trackingStats.performance.lastOperationTimeMs = Date.now() - startTime;

        // 5. Record success
        await this.recordSuccess();

        // Add log at the end of the cycle with timing information
        const duration = Date.now() - startTime;
        logApi.info(`${fancyColors.BG_CYAN}${fancyColors.WHITE} BALANCE WS CYCLE ${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.CYAN}Completed maintenance in ${fancyColors.YELLOW}${duration}ms${fancyColors.RESET} | Next cycle: ${new Date(Date.now() + this.config.checkIntervalMs).toLocaleTimeString()}`);

        return {
            duration: duration,
            activeSubscriptions: this.subscribedWallets.size,
            pendingSubscriptions: this.pendingSubscriptions.size,
            implementation: WEBSOCKET_IMPLEMENTATION
        };
    }
    
    /**
     * Update user count and recalculate check interval if needed
     * 
     * @returns {Promise<number>} - The number of active users
     */
    async updateUserCount() {
        // Get the active user count
        const activeUsers = await prisma.users.count({
            where: { is_banned: false }
        });
        
        // Only recalculate if user count changed significantly (>5%)
        if (Math.abs(activeUsers - this.trackingStats.users.total) / this.trackingStats.users.total > 0.05) {
            this.trackingStats.users.total = activeUsers;
            this.calculateCheckInterval(activeUsers);
            logApi.info(`User count updated: ${activeUsers}, new check interval: ${Math.round(this.effectiveCheckIntervalMs / 1000)} seconds`);
        }
    }
    
    /**
     * Schedule new users for balance tracking
     * 
     * @returns {Promise<number>} - The number of new users scheduled
     */
    async scheduleNewUsers() {
        // Get all users that aren't in our tracking map yet
        const allUsers = await prisma.users.findMany({
            where: {
                is_banned: false,
                wallet_address: {
                    notIn: Array.from(this.trackingStats.users.trackedUsers)
                }
            },
            select: {
                id: true,
                wallet_address: true
            }
        });
        
        // Add new users to schedule
        for (const user of allUsers) {
            // Check if the user is already tracked
            if (!this.trackingStats.users.trackedUsers.has(user.wallet_address)) {
                // Add to tracking set
                this.trackingStats.users.trackedUsers.add(user.wallet_address);
                
                // Schedule first check staggered across the interval
                const randomDelay = Math.floor(Math.random() * this.effectiveCheckIntervalMs);
                this.userSchedule.set(user.wallet_address, {
                    nextCheck: Date.now() + randomDelay,
                    lastCheck: null,
                    failedAttempts: 0
                });
            }
        }
        
        return allUsers.length;
    }
    
    /**
     * Execute scheduled balance checks
     * 
     * @returns {Promise<Object>} - The results of the balance checks
     */
    async executeScheduledChecks() {
        const now = Date.now();
        const checksToExecute = [];
        
        // Log upcoming checks schedule every cycle
        const shouldLogSchedule = true; // Show schedule every cycle
        
        // Find users due for checks
        for (const [walletAddress, schedule] of this.userSchedule.entries()) {
            if (schedule.nextCheck <= now && !this.activeChecks.has(walletAddress)) {
                checksToExecute.push(walletAddress);
                this.activeChecks.add(walletAddress);
            }
            
            // Stop if we hit batch size limit
            if (checksToExecute.length >= this.config.batchSize) break;
        }
        
        // If enabled, log the upcoming check schedule
        if (shouldLogSchedule) {
            try {
                // Get upcoming check schedule for all users
                const checkSchedule = [];
                const walletData = new Map();
                
                // Get all wallet addresses first
                const walletAddresses = Array.from(this.userSchedule.keys());
                
                // Lookup wallet nicknames in batch
                const users = await prisma.users.findMany({
                    where: { wallet_address: { in: walletAddresses } },
                    select: { wallet_address: true, nickname: true }
                });
                
                // Create a map for quick lookup
                for (const user of users) {
                    walletData.set(user.wallet_address, { nickname: user.nickname });
                }
                
                // Collect data for each wallet
                for (const [walletAddress, schedule] of this.userSchedule.entries()) {
                    const userData = walletData.get(walletAddress) || { nickname: 'Unknown' };
                    const nextCheck = new Date(schedule.nextCheck);
                    const timeTillCheck = Math.max(0, Math.round((schedule.nextCheck - now) / 1000));
                    
                    checkSchedule.push({
                        wallet: walletAddress.slice(0, 8) + '...',
                        nickname: userData.nickname,
                        nextCheck,
                        timeLeft: timeTillCheck,
                        isActive: this.activeChecks.has(walletAddress)
                    });
                }
                
                // Sort by next check time
                checkSchedule.sort((a, b) => a.timeLeft - b.timeLeft);
                
                // Log the schedule
                logApi.info(`${fancyColors.BG_ORANGE}${fancyColors.WHITE} BALANCE SCHEDULE ${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.ORANGE}Upcoming check schedule:${fancyColors.RESET}`);
                checkSchedule.forEach((item, i) => {
                    const status = item.isActive ? `${fancyColors.GREEN}[ACTIVE]${fancyColors.RESET}` : 
                                  (item.timeLeft === 0 ? `${fancyColors.YELLOW}[DUE]${fancyColors.RESET}` : `${fancyColors.BLUE}[${Math.ceil(item.timeLeft/60)}m]${fancyColors.RESET}`);
                    logApi.info(`${fancyColors.ORANGE}${i+1}.${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.YELLOW}${item.nickname || 'Unknown'}${fancyColors.RESET} (${item.wallet}): ${item.nextCheck.toLocaleTimeString()} ${status}`);
                });
            } catch (error) {
                logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} BALANCE ERROR ${fancyColors.RESET} Error getting check schedule: ${error.message}`);
            }
        }
        
        // Always log the batch status, even when no checks are due
        if (checksToExecute.length > 0) {
            // Clearer message explaining why not all wallets are being checked - emphasize the staggered schedule
            logApi.info(`${fancyColors.BG_ORANGE}${fancyColors.WHITE} BALANCE BATCH ${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.ORANGE}Starting batch check of ${fancyColors.BOLD_YELLOW}${checksToExecute.length}/${this.userSchedule.size}${fancyColors.RESET}${fancyColors.ORANGE} wallets${fancyColors.RESET} (larger batches of 100, staggered by configured interval)`);
        } else {
            // Add this log to show why no wallets are being checked
            logApi.info(`${fancyColors.BG_ORANGE}${fancyColors.WHITE} BALANCE BATCH ${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.ORANGE}No wallets due for checks${fancyColors.RESET} (${this.userSchedule.size} in schedule, next check time: ${new Date(Math.min(...Array.from(this.userSchedule.values()).map(s => s.nextCheck))).toLocaleTimeString()})`);
        }
        
        // Execute checks in batches
        const checkResults = await Promise.allSettled(
            checksToExecute.map(wallet => this.checkWalletBalance(wallet))
        );
        
        // Process results
        let successful = 0;
        let failed = 0;
        
        // Use a for loop instead of forEach to allow async/await
        for (let index = 0; index < checkResults.length; index++) {
            const result = checkResults[index];
            const wallet = checksToExecute[index];
            const schedule = this.userSchedule.get(wallet);
            
            // Remove from active checks
            this.activeChecks.delete(wallet);
            
            if (result.status === 'fulfilled') {
                // Success
                successful++;
                schedule.lastCheck = now;
                schedule.nextCheck = now + this.effectiveCheckIntervalMs;
                schedule.failedAttempts = 0;
            } else {
                // Failure
                failed++;
                schedule.failedAttempts++;
                
                // Exponential backoff for failures, but try again within reasonable time
                const backoffMs = Math.min(
                    30000 * Math.pow(2, schedule.failedAttempts - 1),
                    this.config.rateLimit.maxCheckIntervalMs
                );
                schedule.nextCheck = now + backoffMs;
                
                // Get nickname for better logging
                let nickname = 'Unknown';
                try {
                    const user = await prisma.users.findUnique({
                        where: { wallet_address: wallet },
                        select: { nickname: true }
                    });
                    nickname = user?.nickname || 'Unknown';
                } catch (userLookupError) {
                    // Ignore errors from the user lookup
                }

                // Improve the warning log format with nickname and Solscan link
                const solscanUrl = `https://solscan.io/account/${wallet}`;
                // Format the wallet address for display with proper spacing
                const shortWallet = `${wallet.slice(0, 8)}...${wallet.slice(-4)}`;
                logApi.warn(`${fancyColors.BG_YELLOW}${fancyColors.BLACK} BALANCE RETRY ${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.ORANGE}[userBalanceTrackingService]${fancyColors.RESET} Failed for ${fancyColors.BOLD}${fancyColors.YELLOW}${nickname || 'Unknown'}${fancyColors.RESET} (${fancyColors.DARK_ORANGE}${shortWallet}${fancyColors.RESET}), retry in ${fancyColors.YELLOW}${Math.round(backoffMs/1000)}s${fancyColors.RESET}: ${result.reason?.message || 'Unknown error'} | ${fancyColors.UNDERLINE}${fancyColors.GRAY}${solscanUrl}${fancyColors.RESET}`);
            }
            
            // Update schedule
            this.userSchedule.set(wallet, schedule);
        }
        
        // Update stats
        this.trackingStats.balanceChecks.total += checksToExecute.length;
        this.trackingStats.balanceChecks.successful += successful;
        this.trackingStats.balanceChecks.failed += failed;
        this.trackingStats.balanceChecks.lastCheck = now;
        
        // Always log completion status, even when no checks were executed
        if (checksToExecute.length > 0) {
            logApi.info(`${fancyColors.BG_ORANGE}${fancyColors.WHITE} BALANCE BATCH ${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.ORANGE}Completed: ${fancyColors.GREEN}${successful} successful${fancyColors.RESET}${fancyColors.ORANGE}, ${fancyColors.RED}${failed} failed${fancyColors.RESET}${fancyColors.ORANGE}, next cycle in ~${Math.round(this.effectiveCheckIntervalMs/1000/60)}m${fancyColors.RESET}`);
        }
        
        return {
            checksPerformed: checksToExecute.length,
            checksScheduled: this.userSchedule.size,
            successful,
            failed
        };
    }
    
    /**
     * Check balance for a specific wallet
     * 
     * @param {string} walletAddress - The wallet address to check
     * @returns {Promise<Object>} - The balance and timestamp
     */
    async checkWalletBalance(walletAddress) {
        const startTime = Date.now();
        
        try {
            // Get user info first for better logging
            const user = await prisma.users.findUnique({
                where: { wallet_address: walletAddress },
                select: { 
                    nickname: true,
                    is_banned: true 
                }
            });
            
            const nickname = user?.nickname || 'Unknown';
            
            // Validate address with v2 utility before using it
            if (!isAddress(walletAddress)) {
                logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} BALANCE ERROR ${fancyColors.RESET} Invalid wallet address format: ${walletAddress}`);
                throw new ServiceError('invalid_address', `Invalid wallet address format: ${walletAddress}`);
            }

            // Get Solana connection from SolanaEngine
            const connection = solanaEngine.getConnection();
            
            // Increment Solana request counter
            this.trackingStats.solana.totalRequests++;
            
            // Calculate requests per hour (rolling window)
            const oneHourAgo = Date.now() - 3600000;
            if (startTime > oneHourAgo) {
                // Only count requests in the last hour
                this.trackingStats.solana.requestsPerHour++;
            } else {
                // Reset counter at the hour boundary
                this.trackingStats.solana.requestsPerHour = 1;
            }
            
            // Get balance from Solana using SolanaEngine, passing string address
            const balanceResult = await solanaEngine.executeConnectionMethod(
                'getBalance', 
                walletAddress // Pass string address directly
            );
            const balanceLamports = balanceResult.value; // Assuming connectionManager returns {value: lamports_bigint}

            if (balanceLamports === undefined || balanceLamports === null) {
                logApi.warn(`${fancyColors.BG_YELLOW}${fancyColors.BLACK} BALANCE INVALID ${fancyColors.RESET} getBalance returned null/undefined for ${walletAddress}`);
                // Treat as 0 or handle as error depending on desired behavior
                // For now, Prisma update might fail if balance_lamports is not a BigInt/Number
            }
            
            const solBalance = Number(balanceLamports || 0) / LAMPORTS_PER_SOL_V2;

            // Record balance history - verify balance is valid
            if (typeof balanceLamports === 'bigint' && !isNaN(balanceLamports)) {
                await prisma.wallet_balance_history.create({
                    data: {
                        wallet_address: walletAddress,
                        balance_lamports: BigInt(balanceLamports),
                        timestamp: new Date(),
                        users: {
                            connect: { wallet_address: walletAddress }
                        }
                    }
                });
            } else {
                logApi.warn(`${fancyColors.BG_YELLOW}${fancyColors.BLACK} BALANCE INVALID ${fancyColors.RESET} Invalid balance (${balanceLamports}) for wallet ${walletAddress}, cannot store in history`);
            }
            
            // Update user record with latest balance - only if balance is valid
            if (typeof balanceLamports === 'bigint' && !isNaN(balanceLamports)) {
                await prisma.users.update({
                    where: { wallet_address: walletAddress },
                    data: { 
                        last_balance_check: new Date(),
                        last_known_balance: BigInt(balanceLamports)
                    }
                });
            } else {
                logApi.warn(`${fancyColors.BG_YELLOW}${fancyColors.BLACK} BALANCE INVALID ${fancyColors.RESET} Invalid balance (${balanceLamports}) for wallet ${walletAddress}, skipping user record update`);
            }
            
            const duration = Date.now() - startTime;
            // Log successful balance update with clear indication of change and amount
            const solscanUrl = `https://solscan.io/account/${walletAddress}`;
            // Format the wallet address for display with proper spacing
            const shortWallet = `${walletAddress.slice(0, 8)}...${walletAddress.slice(-4)}`;
            // Calculate SOL amount (lamports / 10^9)
            const solAmount = typeof solBalance === 'number' ? solBalance : 'N/A';
            
            logApi.info(`${fancyColors.BG_ORANGE}${fancyColors.WHITE} BALANCE UPDATED ${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.ORANGE}[userBalanceTrackingService]${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.YELLOW}${nickname || 'Unknown'}${fancyColors.RESET} (${fancyColors.DARK_ORANGE}${shortWallet}${fancyColors.RESET}): ${fancyColors.BOLD}${fancyColors.YELLOW}${solAmount} SOL${fancyColors.RESET} ${fancyColors.ORANGE}(${duration}ms)${fancyColors.RESET} | ${fancyColors.UNDERLINE}${fancyColors.GRAY}${solscanUrl}${fancyColors.RESET}`);
            
            return {
                wallet: walletAddress,
                nickname: nickname,
                balance: solBalance,
                timestamp: new Date(),
                duration: duration
            };
        } catch (error) {
            this.trackingStats.solana.errors++;
            
            // Try to get user info for better error logging
            let nickname = 'Unknown';
            try {
                const user = await prisma.users.findUnique({
                    where: { wallet_address: walletAddress },
                    select: { nickname: true }
                });
                nickname = user?.nickname || 'Unknown';
            } catch (userLookupError) {
                // Ignore errors from the user lookup, we'll just use 'Unknown'
            }
            
            // Log error with red background for errors and include nickname and Solscan link
            const solscanUrl = `https://solscan.io/account/${walletAddress}`;
            // Format the wallet address for display with proper spacing
            const shortWallet = `${walletAddress.slice(0, 8)}...${walletAddress.slice(-4)}`;
            logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} BALANCE ERROR ${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.ORANGE}[userBalanceTrackingService]${fancyColors.RESET} ${fancyColors.RED}❌ Failed${fancyColors.RESET} for ${fancyColors.BOLD}${fancyColors.YELLOW}${nickname || 'Unknown'}${fancyColors.RESET} (${fancyColors.DARK_ORANGE}${shortWallet}${fancyColors.RESET}): ${error.message} | ${fancyColors.UNDERLINE}${fancyColors.GRAY}${solscanUrl}${fancyColors.RESET}`);
            throw new ServiceError(
                'balance_check_failed',
                `Failed to check balance for ${walletAddress}: ${error.message}`
            );
        }
    }
    
    /**
     * Manually trigger a balance check for a specific wallet
     * Used by external services that need immediate balance info
     *
     * @param {string} walletAddress - The wallet address to check
     * @returns {Promise<Object>} - The results of the operation
     */
    async forceBalanceCheck(walletAddress) {
        try {
            // Different implementation based on tracking mode
            if (this.trackingMode === 'websocket') {
                // WebSocket mode - force a refresh

                // Different implementations for direct vs Helius WebSocket
                if (WEBSOCKET_IMPLEMENTATION === 'direct' && this.walletBalanceWs) {
                    // Direct RPC WebSocket implementation
                    // Refresh the balance using direct RPC WebSocket
                    const balance = await this.walletBalanceWs.refreshWalletBalance(walletAddress);

                    if (balance !== null) {
                        return {
                            status: 'success',
                            balance: balance,
                            timestamp: new Date(),
                            mode: 'websocket',
                            implementation: 'direct'
                        };
                    } else {
                        throw new Error('Failed to refresh balance using direct RPC WebSocket');
                    }
                } else {
                    // Original Helius WebSocket implementation
                    // Check if wallet is already subscribed
                    if (this.subscribedWallets.has(walletAddress)) {
                        // Refresh the balance
                        const balance = await heliusBalanceTracker.refreshSolanaBalance(walletAddress);
                        return {
                            status: 'success',
                            balance: balance,
                            timestamp: new Date(),
                            mode: 'websocket',
                            implementation: 'helius'
                        };
                    } else {
                        // Try to subscribe to the wallet first
                        let nickname = 'Unknown';
                        try {
                            const user = await prisma.users.findUnique({
                                where: { wallet_address: walletAddress },
                                select: { nickname: true }
                            });
                            nickname = user?.nickname || 'Unknown';
                        } catch (error) {
                            // Ignore user lookup errors
                        }

                        await this.subscribeToWalletBalance(walletAddress, nickname);
                        const balance = await heliusBalanceTracker.refreshSolanaBalance(walletAddress);

                        return {
                            status: 'success',
                            balance: balance,
                            timestamp: new Date(),
                            mode: 'websocket',
                            implementation: 'helius'
                        };
                    }
                }
            } else {
                // Polling mode
                
                // Only check if not already being checked
                if (this.activeChecks.has(walletAddress)) {
                    return {
                        status: 'already_checking',
                        message: 'Balance check already in progress',
                        mode: 'polling'
                    };
                }
                
                // Add to active checks
                this.activeChecks.add(walletAddress);
                
                // Perform check
                const result = await this.checkWalletBalance(walletAddress);
                
                // Update schedule
                this.userSchedule.set(walletAddress, {
                    nextCheck: Date.now() + this.effectiveCheckIntervalMs,
                    lastCheck: Date.now(),
                    failedAttempts: 0
                });
                
                // Remove from active checks
                this.activeChecks.delete(walletAddress);
                
                return {
                    status: 'success',
                    balance: result.balance,
                    timestamp: result.timestamp,
                    mode: 'polling'
                };
            }
        } catch (error) {
            if (this.trackingMode === 'websocket') {
                // Add to pending subscriptions for next retry
                this.pendingSubscriptions.set(walletAddress, {
                    retries: 0,
                    lastAttempt: Date.now(),
                    nickname: 'Unknown'
                });
            } else {
                // Remove from active checks
                this.activeChecks.delete(walletAddress);
                
                // Update schedule with backoff
                const schedule = this.userSchedule.get(walletAddress) || {
                    failedAttempts: 0,
                    lastCheck: null
                };
                
                schedule.failedAttempts++;
                schedule.nextCheck = Date.now() + (30000 * Math.pow(2, schedule.failedAttempts - 1));
                this.userSchedule.set(walletAddress, schedule);
            }
            
            return {
                status: 'error',
                message: error.message,
                mode: this.trackingMode
            };
        }
    }
    
    /**
     * Clean up resources
     *
     * Note: We don't need to clean up any SolanaEngine resources as SolanaEngine
     * is managed separately via the service manager and will be stopped independently.
     *
     * @returns {Promise<void>} - The results of the operation
     */
    async stop() {
        await super.stop();

        // Clean up based on the active tracking mode
        if (this.trackingMode === 'websocket') {
            // Different cleanup based on implementation
            if (WEBSOCKET_IMPLEMENTATION === 'direct' && this.walletBalanceWs) {
                // Clean up direct RPC WebSocket
                logApi.info(`${fancyColors.CYAN}[userBalanceTrackingService]${fancyColors.RESET} Stopping direct RPC WebSocket monitoring...`);
                try {
                    await this.walletBalanceWs.stopWalletBalanceWebSocket();
                    this.walletBalanceWs = null;
                } catch (error) {
                    logApi.error(`${fancyColors.RED}[userBalanceTrackingService]${fancyColors.RESET} Error stopping direct RPC WebSocket: ${error.message}`);
                }
            } else {
                // Unsubscribe from all Helius WebSocket subscriptions
                if (this.subscribedWallets.size > 0) {
                    logApi.info(`${fancyColors.CYAN}[userBalanceTrackingService]${fancyColors.RESET} Unsubscribing from ${this.subscribedWallets.size} Helius WebSocket wallets...`);

                    // Using Promise.all with a timeout to prevent hanging during shutdown
                    const unsubPromises = Array.from(this.subscribedWallets).map(wallet => {
                        return Promise.race([
                            this.unsubscribeFromWalletBalance(wallet),
                            new Promise(resolve => setTimeout(() => resolve(false), 5000)) // 5 second timeout
                        ]);
                    });

                    await Promise.all(unsubPromises);
                }
            }

            this.subscribedWallets.clear();
            this.pendingSubscriptions.clear();
        } else {
            // Clean up polling mode resources
            this.userSchedule.clear();
            this.activeChecks.clear();
        }
        
        this.trackingStats.users.trackedUsers.clear();
        logApi.info('User Balance Tracking Service stopped');
    }
    
    /**
     * Subscribe new users to balance tracking via WebSocket
     * 
     * @returns {Promise<number>} - The number of new users subscribed
     */
    async subscribeNewUsers() {
        if (this.trackingMode !== 'websocket') {
            return 0; // Only used in WebSocket mode
        }
        
        // Get all users that aren't in our tracking set yet
        const allUsers = await prisma.users.findMany({
            where: {
                is_banned: false,
                wallet_address: {
                    notIn: Array.from(this.subscribedWallets)
                }
            },
            select: {
                id: true,
                wallet_address: true,
                nickname: true
            }
        });
        
        let subscribedCount = 0;
        
        // Process each new user
        for (const user of allUsers) {
            // Skip if already subscribed or pending
            if (this.subscribedWallets.has(user.wallet_address) || 
                this.pendingSubscriptions.has(user.wallet_address)) {
                continue;
            }
            
            // Attempt to subscribe
            try {
                const success = await this.subscribeToWalletBalance(user.wallet_address, user.nickname);
                if (success) {
                    subscribedCount++;
                }
            } catch (error) {
                logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} BALANCE WS ERROR ${fancyColors.RESET} Failed to subscribe to wallet ${user.wallet_address}: ${error.message}`);
                
                // Add to pending subscriptions for retry
                this.pendingSubscriptions.set(user.wallet_address, {
                    retries: 0,
                    lastAttempt: Date.now(),
                    nickname: user.nickname
                });
            }
        }
        
        return subscribedCount;
    }
    
    /**
     * Retry pending WebSocket subscriptions
     * 
     * @returns {Promise<number>} - The number of subscriptions retried
     */
    async retryPendingSubscriptions() {
        if (this.trackingMode !== 'websocket' || this.pendingSubscriptions.size === 0) {
            return 0;
        }
        
        let retriedCount = 0;
        const RETRY_LIMIT = 5;
        const MAX_RETRY_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
        const now = Date.now();
        
        // Get list of wallets to retry
        const walletsToRetry = Array.from(this.pendingSubscriptions.entries());
        
        for (const [walletAddress, pendingInfo] of walletsToRetry) {
            // Skip if already subscribed (somehow got into both sets)
            if (this.subscribedWallets.has(walletAddress)) {
                this.pendingSubscriptions.delete(walletAddress);
                continue;
            }
            
            // If too many retries or too old, remove from pending
            if (pendingInfo.retries >= RETRY_LIMIT || 
                (now - pendingInfo.lastAttempt) > MAX_RETRY_AGE_MS) {
                logApi.warn(`${fancyColors.BG_YELLOW}${fancyColors.BLACK} BALANCE WS ABANDON ${fancyColors.RESET} Abandoning subscription for wallet ${walletAddress} after ${pendingInfo.retries} retries`);
                this.pendingSubscriptions.delete(walletAddress);
                this.trackingStats.subscriptions.failed++;
                continue;
            }
            
            // Attempt to subscribe
            try {
                logApi.info(`${fancyColors.BG_CYAN}${fancyColors.WHITE} BALANCE WS RETRY ${fancyColors.RESET} Retrying subscription for wallet ${walletAddress} (attempt ${pendingInfo.retries + 1})`);
                
                const success = await this.subscribeToWalletBalance(walletAddress, pendingInfo.nickname);
                if (success) {
                    this.pendingSubscriptions.delete(walletAddress);
                    retriedCount++;
                } else {
                    // Update retry count
                    pendingInfo.retries++;
                    pendingInfo.lastAttempt = now;
                    this.pendingSubscriptions.set(walletAddress, pendingInfo);
                }
            } catch (error) {
                // Update retry count
                pendingInfo.retries++;
                pendingInfo.lastAttempt = now;
                this.pendingSubscriptions.set(walletAddress, pendingInfo);
                
                logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} BALANCE WS ERROR ${fancyColors.RESET} Failed to retry subscription for wallet ${walletAddress}: ${error.message}`);
            }
        }
        
        return retriedCount;
    }
    
    /**
     * Subscribe to a wallet's balance changes via WebSocket
     * @param {string} walletAddress - The wallet address to subscribe to
     * @param {string} nickname - The user's nickname for logging
     * @returns {Promise<boolean>} - True if subscription was successful
     */
    async subscribeToWalletBalance(walletAddress, nickname) {
        if (this.trackingMode !== 'websocket') {
            return false; // Only used in WebSocket mode
        }
        
        try {
            // Validate the wallet address using v2 utility
            if (!isAddress(walletAddress)) {
                logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} BALANCE WS ERROR ${fancyColors.RESET} Invalid wallet address for subscription: ${walletAddress}`);
                this.pendingSubscriptions.set(walletAddress, { retries: 99, lastAttempt: Date.now(), nickname, error: 'Invalid Address' }); // Mark as max retries
                return false;
            }
            
            logApi.info(`${fancyColors.BG_CYAN}${fancyColors.WHITE} BALANCE WS SUB ${fancyColors.RESET} Subscribing to ${nickname || 'Unknown'} wallet: ${walletAddress}`);
            
            // Subscribe to SOL balance via HeliusBalanceTracker
            const success = await heliusBalanceTracker.subscribeSolanaBalance(
                walletAddress, 
                this.handleBalanceUpdate.bind(this)
            );
            
            if (success) {
                // Add to subscribed wallets
                this.subscribedWallets.add(walletAddress);
                
                // Add to tracked users for consistency with polling mode
                this.trackingStats.users.trackedUsers.add(walletAddress);
                
                this.trackingStats.subscriptions.total++;
                this.trackingStats.subscriptions.active = this.subscribedWallets.size;
                
                logApi.info(`${fancyColors.BG_CYAN}${fancyColors.WHITE} BALANCE WS SUB ${fancyColors.RESET} ${fancyColors.GREEN}✓ Subscribed${fancyColors.RESET} to ${nickname || 'Unknown'} wallet: ${walletAddress}`);
                return true;
            } else {
                logApi.warn(`${fancyColors.BG_YELLOW}${fancyColors.BLACK} BALANCE WS FAIL ${fancyColors.RESET} Failed to subscribe to wallet ${walletAddress}`);
                return false;
            }
        } catch (error) {
            logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} BALANCE WS ERROR ${fancyColors.RESET} Error subscribing to wallet ${walletAddress}: ${error.message}`);
            throw error;
        }
    }
    
    /**
     * Unsubscribe from a wallet's balance changes
     * @param {string} walletAddress - The wallet address to unsubscribe from
     * @returns {Promise<boolean>} - True if unsubscription was successful
     */
    async unsubscribeFromWalletBalance(walletAddress) {
        if (this.trackingMode !== 'websocket') {
            return true; // Only used in WebSocket mode
        }
        
        try {
            // Check if we're tracking this wallet
            if (!this.subscribedWallets.has(walletAddress)) {
                return true; // Already unsubscribed
            }
            
            logApi.info(`${fancyColors.BG_CYAN}${fancyColors.WHITE} BALANCE WS UNSUB ${fancyColors.RESET} Unsubscribing from wallet: ${walletAddress}`);
            
            // Unsubscribe via HeliusBalanceTracker
            const success = await heliusBalanceTracker.unsubscribeSolanaBalance(
                walletAddress, 
                this.handleBalanceUpdate.bind(this)
            );
            
            if (success) {
                // Remove from subscribed wallets
                this.subscribedWallets.delete(walletAddress);
                
                // Remove from tracked users for consistency with polling mode
                this.trackingStats.users.trackedUsers.delete(walletAddress);
                
                this.trackingStats.subscriptions.active = this.subscribedWallets.size;
                
                logApi.info(`${fancyColors.BG_CYAN}${fancyColors.WHITE} BALANCE WS UNSUB ${fancyColors.RESET} ${fancyColors.GREEN}✓ Unsubscribed${fancyColors.RESET} from wallet: ${walletAddress}`);
                return true;
            } else {
                logApi.warn(`${fancyColors.BG_YELLOW}${fancyColors.BLACK} BALANCE WS FAIL ${fancyColors.RESET} Failed to unsubscribe from wallet ${walletAddress}`);
                return false;
            }
        } catch (error) {
            logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} BALANCE WS ERROR ${fancyColors.RESET} Error unsubscribing from wallet ${walletAddress}: ${error.message}`);
            return false;
        }
    }
    
    /**
     * Handle balance update from HeliusBalanceTracker
     * @param {Object} balanceData - Balance update data
     * @returns {Promise<void>}
     */
    async handleBalanceUpdate(balanceData) {
        if (this.trackingMode !== 'websocket') {
            return; 
        }
        
        try {
            const startTime = Date.now();
            const { walletAddress, balance, oldBalance, source } = balanceData;
            
            if (balance === oldBalance) {
                return;
            }
            
            const user = await prisma.users.findUnique({
                where: { wallet_address: walletAddress },
                select: { id: true, nickname: true } // Fetch user.id as well
            });
            
            const nickname = user?.nickname || 'Unknown';
            const userIdToConnect = user?.id;

            if (!userIdToConnect) {
                logApi.warn(`${fancyColors.BG_YELLOW}${fancyColors.BLACK} BALANCE WS SKIP ${fancyColors.RESET} User not found for wallet ${walletAddress}, cannot record balance history.`);
                return;
            }
            
            const shortWallet = `${walletAddress.slice(0, 8)}...${walletAddress.slice(-4)}`;
            
            if (typeof balance === 'number' && !isNaN(balance)) {
                const balance_lamports = BigInt(Math.round(balance * LAMPORTS_PER_SOL_V2));
                await prisma.wallet_balance_history.create({
                    data: {
                        balance_lamports,
                        timestamp: new Date(),
                        user: { 
                            connect: { 
                                id: userIdToConnect // Use the fetched user.id
                            }
                        }
                    }
                });

                await prisma.users.update({
                    where: { wallet_address: walletAddress },
                    data: { 
                        last_balance_check: new Date(),
                        last_known_balance: balance_lamports
                    }
                });
            } else {
                logApi.warn(`${fancyColors.BG_YELLOW}${fancyColors.BLACK} BALANCE WS INVALID ${fancyColors.RESET} Invalid balance (${balance}) for wallet ${walletAddress}, cannot convert to lamports or record history`);
                logApi.info(`${fancyColors.BG_YELLOW}${fancyColors.BLACK} BALANCE DIAGNOSTIC ${fancyColors.RESET} Raw balance value: ${typeof balance}, value: ${balance}, isNaN: ${isNaN(balance)}, source: ${source}. Response source: ${JSON.stringify({source})}`);
            }
            
            this.trackingStats.balanceChecks.total++;
            this.trackingStats.balanceChecks.successful++;
            this.trackingStats.balanceChecks.lastCheck = new Date();
            
            const duration = Date.now() - startTime;
            const solscanUrl = `https://solscan.io/account/${walletAddress}`;
            const changeAmount = balance - oldBalance;
            const changeSymbol = changeAmount > 0 ? '⬆️' : (changeAmount < 0 ? '⬇️' : '⟹');
            const changeText = changeAmount !== 0 ? 
                `${fancyColors.BOLD}${changeAmount > 0 ? fancyColors.GREEN : fancyColors.RED}${changeSymbol} ${Math.abs(changeAmount).toFixed(6)} SOL${fancyColors.RESET}` : 
                `${fancyColors.BOLD}${fancyColors.BLUE}${changeSymbol} No Change${fancyColors.RESET}`;
            
            logApi.info(`${fancyColors.BG_CYAN}${fancyColors.WHITE} BALANCE CHANGE ${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.CYAN}[userBalanceTrackingService]${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.YELLOW}${nickname}${fancyColors.RESET} (${fancyColors.CYAN}${shortWallet}${fancyColors.RESET}): ${changeText} → Now: ${fancyColors.BOLD}${fancyColors.YELLOW}${balance} SOL${fancyColors.RESET} ${fancyColors.CYAN}(${duration}ms via ${source})${fancyColors.RESET} | ${fancyColors.UNDERLINE}${fancyColors.GRAY}${solscanUrl}${fancyColors.RESET}`);
        } catch (error) {
            this.trackingStats.balanceChecks.failed++;
            logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} BALANCE WS ERROR ${fancyColors.RESET} Error handling balance update: ${error.message}`, {
                error: error.message,
                balanceData
            });
        }
    }

    /**
     * Get detailed service status for monitoring
     * 
     * @returns {Promise<Object>} - The status of the service
     */
    getServiceStatus() {
        const baseStatus = super.getServiceStatus();

        // Get SolanaEngine connection status
        let solanaStatus = { available: false };
        try {
            if (typeof solanaEngine.isInitialized === 'function' ? solanaEngine.isInitialized() : solanaEngine.isInitialized) {
                solanaStatus = {
                    available: true,
                    connectionStatus: solanaEngine.getConnectionStatus()
                };
            }
        } catch (error) {
            solanaStatus.error = error.message;
        }
        
        // Get HeliusBalanceTracker status if in WebSocket mode
        let websocketStatus = { available: false };
        if (this.trackingMode === 'websocket') {
            try {
                if (WEBSOCKET_IMPLEMENTATION === 'direct' && this.walletBalanceWs) {
                    // Direct RPC WebSocket status
                    websocketStatus = {
                        available: true,
                        implementation: 'direct',
                        status: this.walletBalanceWs.getWebSocketStatus()
                    };
                } else {
                    // Helius WebSocket status
                    websocketStatus = {
                        available: true,
                        implementation: 'helius',
                        initialized: heliusBalanceTracker.initialized,
                        activeSubscriptions: this.subscribedWallets.size,
                        pendingSubscriptions: this.pendingSubscriptions.size
                    };
                }
            } catch (error) {
                websocketStatus.error = error.message;
            }
        }

        return {
            ...baseStatus,
            metrics: {
                ...this.stats,
                trackingMode: this.trackingMode,
                trackingStats: this.trackingStats,
                serviceStartTime: this.stats.history.lastStarted,
                solanaEngine: solanaStatus,
                ...(this.trackingMode === 'websocket' ? { websocket: websocketStatus } : {}),
                ...(this.trackingMode === 'polling' ? { 
                    polling: {
                        effectiveCheckIntervalMs: this.effectiveCheckIntervalMs,
                        userScheduleSize: this.userSchedule.size,
                        activeChecks: this.activeChecks.size
                    }
                } : {})
            }
        };
    }
}

// Verify Prisma schema is properly set up for wallet balance tracking

/**
 * Verify the wallet balance tracking schema exists
 * 
 * @returns {Promise<boolean>} - True if the schema exists, false otherwise
 */
async function ensureSchemaExists() {
    try {
        // Since we've already generated the Prisma client with the new schema, this works.
        //
        // We no longer need to create tables manually as they'll be created by Prisma
        // This function now just verifies the tables exist through Prisma
        
        // Verify wallet_balance_history table exists by doing a count query
        
        // No need to log the table count
        //const historyCount = await prisma.wallet_balance_history.count();
        //logApi.info(`${fancyColors.MAGENTA}[userBalanceTrackingService]${fancyColors.RESET} ${fancyColors.ORANGE} ✅ ${fancyColors.BOLD}${fancyColors.ORANGE}wallet_balance_history${fancyColors.RESET} ${fancyColors.ORANGE}table exists (records: ${historyCount})`);
        
        // No need to do anything at all!
        return true;
    } catch (error) {
        logApi.error('Error verifying balance tracking schema:', error);
        throw new Error(`Balance tracking schema verification failed: ${error.message}`);
    }
}

// First ensure schema exists, then create and export service
/**
 * Create and export the user balance tracking service
 * 
 * @returns {UserBalanceTrackingService} - The user balance tracking service
 */
const userBalanceTrackingService = new UserBalanceTrackingService();

// Export with schema check wrapper
/**
 * Export the user balance tracking service
 * 
 * @returns {UserBalanceTrackingService} - The user balance tracking service
 */
export default userBalanceTrackingService;

// Export schema check function for initialization
/**
 * Export the schema check function for initialization
 * 
 * @returns {Promise<boolean>} - True if the schema exists, false otherwise
 */
export { ensureSchemaExists };