// services/userBalanceTrackingService.js

import { BaseService } from '../utils/service-suite/base-service.js';
import { ServiceError } from '../utils/service-suite/service-error.js';
import { logApi } from '../utils/logger-suite/logger.js';
import prisma from '../config/prisma.js';
import SolanaServiceManager from '../utils/solana-suite/solana-service-manager.js';
import { PublicKey } from '@solana/web3.js';
import { SERVICE_NAMES } from '../utils/service-suite/service-constants.js';
import { fancyColors } from '../utils/colors.js';

// Rate limit configuration
const BALANCE_TRACKING_CONFIG = {
    name: SERVICE_NAMES.USER_BALANCE_TRACKING || 'user_balance_tracking',
    description: 'Tracks user wallet balances on Solana',
    checkIntervalMs: 1 * 60 * 1000, // Check every 1 minute for new users/scheduling
    maxRetries: 3,
    retryDelayMs: 5000,
    circuitBreaker: {
        failureThreshold: 5,
        resetTimeoutMs: 60000,
        minHealthyPeriodMs: 120000
    },
    rateLimit: {
        // Configurable rate limits
        queriesPerHour: 1000, // Default, can be changed via system settings
        minCheckIntervalMs: 60 * 1000, // Minimum 1 minute between balance checks for any user
        maxCheckIntervalMs: 30 * 60 * 1000, // Maximum 30 minutes between checks
    },
    batchSize: 20 // Max users to check in parallel
};

/**
 * Service for tracking user Solana wallet balances
 */
class UserBalanceTrackingService extends BaseService {
    constructor() {
        super(BALANCE_TRACKING_CONFIG);
        
        // Track user check schedule
        this.userSchedule = new Map();
        this.activeChecks = new Set();
        
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
     */
    async initialize() {
        try {
            await super.initialize();
            
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
            
            // Calculate check interval based on user count
            this.calculateCheckInterval(activeUsers);
            
            logApi.info(`${fancyColors.BOLD}${fancyColors.DARK_CYAN}User Balance Tracking Service${fancyColors.RESET} ${fancyColors.DARK_CYAN}initialized with ${fancyColors.BOLD_YELLOW}${activeUsers}${fancyColors.RESET} ${fancyColors.DARK_CYAN}users${fancyColors.RESET}`);
            logApi.info(`${fancyColors.BOLD}${fancyColors.DARK_CYAN}Checking each user every ${Math.round(this.effectiveCheckIntervalMs / 1000 / 60)} minutes${fancyColors.RESET}`);
            
            return true;
        } catch (error) {
            logApi.error('Failed to initialize User Balance Tracking Service:', error);
            throw error;
        }
    }
    
    /**
     * Calculate optimal check interval based on user count and rate limits
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
        
        logApi.info(`${fancyColors.BOLD}${fancyColors.DARK_CYAN}Balance check interval calculated:${fancyColors.RESET} ${fancyColors.DARK_CYAN}${Math.round(this.effectiveCheckIntervalMs / 1000)} seconds${fancyColors.RESET}`);
    }
    
    /**
     * Required implementation of performOperation - main service loop
     */
    async performOperation() {
        const startTime = Date.now();
        
        try {
            // 1. Update user count and recalculate interval if needed
            await this.updateUserCount();
            
            // 2. Schedule balance checks for any new users
            await this.scheduleNewUsers();
            
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
            
            return {
                duration: Date.now() - startTime,
                checksPerformed: results.checksPerformed,
                checksScheduled: results.checksScheduled
            };
        } catch (error) {
            this.trackingStats.operations.failed++;
            this.trackingStats.operations.total++;
            throw error;
        }
    }
    
    /**
     * Update user count and recalculate check interval if needed
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
     */
    async executeScheduledChecks() {
        const now = Date.now();
        const checksToExecute = [];
        
        // Find users due for checks
        for (const [walletAddress, schedule] of this.userSchedule.entries()) {
            if (schedule.nextCheck <= now && !this.activeChecks.has(walletAddress)) {
                checksToExecute.push(walletAddress);
                this.activeChecks.add(walletAddress);
            }
            
            // Stop if we hit batch size limit
            if (checksToExecute.length >= this.config.batchSize) break;
        }
        
        // Execute checks in batches
        const checkResults = await Promise.allSettled(
            checksToExecute.map(wallet => this.checkWalletBalance(wallet))
        );
        
        // Process results
        let successful = 0;
        let failed = 0;
        
        checkResults.forEach((result, index) => {
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
                
                logApi.warn(`Failed balance check for ${wallet}, retry in ${Math.round(backoffMs/1000)}s:`, result.reason);
            }
            
            // Update schedule
            this.userSchedule.set(wallet, schedule);
        });
        
        // Update stats
        this.trackingStats.balanceChecks.total += checksToExecute.length;
        this.trackingStats.balanceChecks.successful += successful;
        this.trackingStats.balanceChecks.failed += failed;
        this.trackingStats.balanceChecks.lastCheck = now;
        
        return {
            checksPerformed: checksToExecute.length,
            checksScheduled: this.userSchedule.size,
            successful,
            failed
        };
    }
    
    /**
     * Check balance for a specific wallet
     */
    async checkWalletBalance(walletAddress) {
        const startTime = Date.now();
        
        try {
            // Get Solana connection
            const connection = SolanaServiceManager.getConnection();
            
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
            
            // Get balance from Solana
            const balance = await connection.getBalance(new PublicKey(walletAddress));
            
            // Record balance history
            await prisma.wallet_balance_history.create({
                data: {
                    wallet_address: walletAddress,
                    balance_lamports: balance,
                    timestamp: new Date()
                }
            });
            
            // Update user record with latest balance
            await prisma.users.update({
                where: { wallet_address: walletAddress },
                data: { 
                    last_balance_check: new Date(),
                    last_known_balance: balance
                }
            });
            
            return {
                wallet: walletAddress,
                balance: balance,
                timestamp: new Date(),
                duration: Date.now() - startTime
            };
        } catch (error) {
            this.trackingStats.solana.errors++;
            throw new ServiceError(
                'balance_check_failed',
                `Failed to check balance for ${walletAddress}: ${error.message}`
            );
        }
    }
    
    /**
     * Manually trigger a balance check for a specific wallet
     * Used by external services that need immediate balance info
     */
    async forceBalanceCheck(walletAddress) {
        try {
            // Only check if not already being checked
            if (this.activeChecks.has(walletAddress)) {
                return {
                    status: 'already_checking',
                    message: 'Balance check already in progress'
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
                timestamp: result.timestamp
            };
        } catch (error) {
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
            
            return {
                status: 'error',
                message: error.message
            };
        }
    }
    
    /**
     * Clean up resources
     */
    async stop() {
        await super.stop();
        this.userSchedule.clear();
        this.activeChecks.clear();
        this.trackingStats.users.trackedUsers.clear();
        logApi.info('User Balance Tracking Service stopped');
    }

    /**
     * Get detailed service status for monitoring
     */
    getServiceStatus() {
        // TODO: Implement this
        // const baseStatus = super.getServiceStatus();

        // Instead, return our own status
        return {
            isRunning: this.isStarted,
            status: this.isStarted ? 'running' : 'stopped',
            metrics: {
                ...this.stats,
                trackingStats: this.trackingStats,
                serviceStartTime: this.stats.history.lastStarted
            }
        };
    }
}

// Verify Prisma schema is properly set up for wallet balance tracking
async function ensureSchemaExists() {
    try {
        // We no longer need to create tables manually as they'll be created by Prisma
        // This function now just verifies the tables exist through Prisma
        
        // Verify wallet_balance_history table exists by doing a count query
        const historyCount = await prisma.wallet_balance_history.count();
        
        // Since we've already generated the Prisma client with the new schema,
        // this should work. If it fails, it means there may be a discrepancy
        // between our Prisma schema and the database
        
        logApi.info(`${fancyColors.MAGENTA}[userBalanceTrackingService]${fancyColors.RESET} ${fancyColors.DARK_CYAN} ✅ ${fancyColors.BOLD}${fancyColors.DARK_CYAN}wallet_balance_history${fancyColors.RESET} ${fancyColors.DARK_CYAN}table exists (records: ${historyCount})`);
        
        return true;
    } catch (error) {
        logApi.error('Error verifying balance tracking schema:', error);
        throw new Error(`Balance tracking schema verification failed: ${error.message}`);
    }
}

// First ensure schema exists, then create and export service
const userBalanceTrackingService = new UserBalanceTrackingService();

// Export with schema check wrapper
export default userBalanceTrackingService;

// Export schema check function for initialization
export { ensureSchemaExists };