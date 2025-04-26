// services/contestEvaluationService.js

/*
 * This service is responsible for managing contest lifecycle and evaluation.
 * It handles contest start, end, and prize distribution, ensuring fair and
 * accurate evaluation of contest results.
 */

// ** Global Configuration Flags **
const REFUND_SINGLE_PARTICIPANT_CONTESTS = true; // When true, contests with only one participant will be cancelled and refunded

// ** Service Auth **
//import { generateServiceAuthHeader } from '../config/service-auth.js';
// ** Service Class **
import { BaseService } from '../utils/service-suite/base-service.js';
import { ServiceError, ServiceErrorTypes } from '../utils/service-suite/service-error.js';
import { config } from '../config/config.js';
import { logApi } from '../utils/logger-suite/logger.js';
import AdminLogger from '../utils/admin-logger.js';
import prisma from '../config/prisma.js';
import { fancyColors, serviceSpecificColors } from '../utils/colors.js';
// ** Service Manager **
import serviceManager from '../utils/service-suite/service-manager.js';
import { SERVICE_NAMES, getServiceMetadata } from '../utils/service-suite/service-constants.js';
// Solana
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import crypto from 'crypto';
// Import SolanaEngine (for centralized connection management)
import { solanaEngine } from './solana-engine/index.js';
// Other
import { Decimal } from '@prisma/client/runtime/library';
//import marketDataService from './marketDataService.js';
import levelingService from './levelingService.js';

const VERBOSE_CONTEST_EVALUATION_INIT = false;

const CONTEST_EVALUATION_CONFIG = {
    name: 
        SERVICE_NAMES.CONTEST_EVALUATION,
    description: 
        getServiceMetadata(SERVICE_NAMES.CONTEST_EVALUATION).description,
    checkIntervalMs: 
        config.service_intervals.contest_evaluation_check_interval * 1000, // seconds
    maxRetries: 
        config.service_thresholds.contest_evaluation_max_retries, // max retries for contest evaluation
    retryDelayMs: 
        config.service_thresholds.contest_evaluation_retry_delay * 1000, // seconds
    circuitBreaker: {
        failureThreshold: 
            config.service_thresholds.contest_evaluation_circuit_breaker_failure_threshold, // number of service failures before circuit breaker trips
        resetTimeoutMs: 
            config.service_intervals.contest_evaluation_circuit_breaker_reset_timeout * 1000, // seconds
        minHealthyPeriodMs: 
            config.service_intervals.contest_evaluation_circuit_breaker_min_healthy_period * 1000, // seconds
    },
    backoff: {
        initialDelayMs: 
            config.service_intervals.contest_evaluation_circuit_breaker_backoff_initial_delay * 1000, // seconds
        maxDelayMs: 
            config.service_intervals.contest_evaluation_circuit_breaker_backoff_max_delay * 1000, // seconds
        factor: 
            config.service_thresholds.contest_evaluation_circuit_breaker_backoff_factor, // exponential backoff factor
    },
    dependencies: [SERVICE_NAMES.MARKET_DATA],
    evaluation: {
        maxParallelEvaluations: 
            config.service_thresholds.contest_evaluation_max_parallel_evaluations, // max concurrent contest evaluations
        minPrizeAmount: 
            config.service_thresholds.contest_evaluation_min_prize_amount, // SOL - min amount to distribute as prize
        maxRetries: 
            config.service_thresholds.contest_evaluation_max_retries, // max retries for distribution of contest prizes
        retryDelayMs: 
            config.service_thresholds.contest_evaluation_retry_delay * 1000, // seconds
        timeoutMs: 
            config.service_intervals.contest_evaluation_timeout * 1000, // seconds
    },
    // Auto-cancel window for contests with insufficient participants
    autoCancelWindow: // Time to wait before auto-cancelling contests that don't meet minimum participant requirements
        (config.service_intervals.contest_evaluation_auto_cancel_window_days * 24 * 60 * 60 * 1000) + // 0 days
        (config.service_intervals.contest_evaluation_auto_cancel_window_hours * 60 * 60 * 1000) + // 0 hours
        (config.service_intervals.contest_evaluation_auto_cancel_window_minutes * 60 * 1000) + // 0 minutes
        (config.service_intervals.contest_evaluation_auto_cancel_window_seconds * 1000), // 59 seconds
    states: {
        PENDING: 'pending',
        ACTIVE: 'active',
        COMPLETED: 'completed',
        CANCELLED: 'cancelled'
    },
    refunds: {
        maxRetries: 
            config.service_thresholds.contest_evaluation_max_retries, // max retries for distributing contest refunds
        retryDelayMs: 
            config.service_thresholds.contest_evaluation_retry_delay * 1000, // seconds
    }
};

// Contest Evaluation Service
/**
 * Contest Evaluation Service
 * @extends BaseService
 */
class ContestEvaluationService extends BaseService {
    /**
     * Constructor for the Contest Evaluation Service
     */
    constructor() {
        // Add logging before super call
        if (VERBOSE_CONTEST_EVALUATION_INIT) {
            logApi.info(`${serviceSpecificColors.contestEvaluation.tag}[contestEvaluationService]${fancyColors.RESET} Initializing Contest Evaluation Service with config:`, {
                name: SERVICE_NAMES.CONTEST_EVALUATION,
                config: CONTEST_EVALUATION_CONFIG
            });
        }
        
        // Initialize the service
        super(CONTEST_EVALUATION_CONFIG);
        
        // Add logging after super call
        if (VERBOSE_CONTEST_EVALUATION_INIT) {
            logApi.info(`${serviceSpecificColors.contestEvaluation.tag}[contestEvaluationService]${fancyColors.RESET} Contest Evaluation Service base initialization complete:`, {
                name: this.name,
                config: this.config
            });
        }
        
        // We no longer initialize our own Solana connection
        // Instead we use the centralized solanaEngine for all RPC operations
        // This provides better resource management and centralized error handling
        
        // Log integration with SolanaEngine
        logApi.info(`${serviceSpecificColors.contestEvaluation.tag}[contestEvaluationService]${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.WHITE} 🌐 Using SolanaEngine for Solana RPC access`);

        // Initialize service-specific stats
        this.evaluationStats = {
            operations: {
                total: 0,
                successful: 0,
                failed: 0
            },
            contests: {
                total: 0,
                active: 0,
                completed: 0,
                failed: 0,
                by_status: {}
            },
            evaluations: {
                total: 0,
                successful: 0,
                failed: 0,
                retried: 0,
                average_duration_ms: 0
            },
            prizes: {
                total_distributed: 0,
                successful_distributions: 0,
                failed_distributions: 0,
                total_amount: 0
            },
            refunds: {
                total: 0,
                successful: 0,
                failed: 0,
                total_amount: 0
            },
            performance: {
                average_evaluation_time_ms: 0,
                last_operation_time_ms: 0,
                average_prize_distribution_time_ms: 0
            },
            dependencies: {
                marketData: {
                    status: 'unknown',
                    lastCheck: null,
                    errors: 0
                }
            }
        };

        // Active evaluations tracking
        this.activeEvaluations = new Map();
        this.evaluationTimeouts = new Set();
        
        // Dynamic interval tracking
        this.lastIntervalUpdate = Date.now();
        this.dynamicIntervalCheck();
    }
    
    /**
     * Periodically check if the service interval has changed in the database
     * This allows for dynamic adjustment of the service interval without restart
     */
    async dynamicIntervalCheck() {
        try {
            // Import here to avoid circular dependencies
            const { getServiceInterval } = await import('../utils/service-suite/service-interval-adapter.js');
            
            // Get the current interval from the new service_configuration table
            const configuredInterval = await getServiceInterval(
                this.name,
                this.config.checkIntervalMs // Default from static config
            );
            
            // Only update if different from current interval
            if (this.config.checkIntervalMs !== configuredInterval) {
                logApi.info(`${serviceSpecificColors.contestEvaluation.tag}[contestEvaluationService]${fancyColors.RESET} ${fancyColors.BG_CYAN}${fancyColors.BLACK} INTERVAL UPDATED ${fancyColors.RESET} ${fancyColors.CYAN}${this.config.checkIntervalMs}ms → ${configuredInterval}ms${fancyColors.RESET}`);
                
                // Update the config
                this.config.checkIntervalMs = configuredInterval;
                
                // If the service is already running, restart the interval with new timing
                if (this.isStarted && this.operationInterval) {
                    clearInterval(this.operationInterval);
                    this.operationInterval = setInterval(
                        () => this.performOperation().catch(error => this.handleError(error)),
                        this.config.checkIntervalMs
                    );
                }
            }
        } catch (error) {
            // Don't let errors in interval checking break the service
            logApi.error(`${serviceSpecificColors.contestEvaluation.tag}[contestEvaluationService]${fancyColors.RESET} ${fancyColors.RED}Error checking for interval updates:${fancyColors.RESET}`, {
                error: error.message
            });
        }
        
        // Schedule next check (every 30 seconds)
        setTimeout(() => this.dynamicIntervalCheck(), 30000);
    }

    // Initialize the service
    /**
     * Initializes the service
     * @returns {Promise<boolean>} - True if successful
     */
    async initialize() {
        try {
            // Check if service is enabled via service profile
            if (!config.services.contest_evaluation) {
                logApi.warn(`${serviceSpecificColors.contestEvaluation.tag}[contestEvaluationService]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} SERVICE DISABLED ${fancyColors.RESET} Contest Evaluation Service is disabled in the '${config.services.active_profile}' service profile`);
                return false; // Skip initialization
            }
            
            // Call parent initialize first
            await super.initialize();
            
            // Check SolanaEngine dependency first - using same pattern as contest-wallet service
            if (typeof solanaEngine.isInitialized === 'function' ? !solanaEngine.isInitialized() : !solanaEngine.isInitialized) {
                logApi.warn(`${serviceSpecificColors.contestEvaluation.tag}[contestEvaluationService]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} INITIALIZING SOLANAENGINE ${fancyColors.RESET} SolanaEngine was not initialized, attempting to initialize it now`);
                await solanaEngine.initialize();
                
                // Check again after initialization
                if (typeof solanaEngine.isInitialized === 'function' ? !solanaEngine.isInitialized() : !solanaEngine.isInitialized) {
                    throw ServiceError.initialization('Failed to initialize SolanaEngine');
                }
                
                logApi.info(`${serviceSpecificColors.contestEvaluation.tag}[contestEvaluationService]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} SOLANAENGINE READY ${fancyColors.RESET} SolanaEngine initialized successfully`);
            }
            
            // Check other dependencies
            const marketDataStatus = await serviceManager.checkServiceHealth(SERVICE_NAMES.MARKET_DATA);
            if (!marketDataStatus) {
                throw ServiceError.initialization('Market Data Service not healthy');
            }

            // Load configuration from database
            const settings = await prisma.system_settings.findUnique({
                where: { key: this.name }
            });

            // Load configuration from database, if it exists
            if (settings?.value) {
                const dbConfig = typeof settings.value === 'string' 
                    ? JSON.parse(settings.value)
                    : settings.value;

                // Merge configs carefully preserving circuit breaker setting // TODO: Fix this mess
                this.config = {
                    ...this.config,
                    ...dbConfig,
                    circuitBreaker: {
                        ...this.config.circuitBreaker,
                        ...(dbConfig.circuitBreaker || {})
                    }
                };
            }

            // Load initial contest state
            const [activeContests, completedContests, cancelledContests] = await Promise.all([
                prisma.contests.count({ where: { status: 'active' } }),
                prisma.contests.count({ where: { status: 'completed' } }),
                prisma.contests.count({ where: { status: 'cancelled' } })
            ]);

            this.evaluationStats.contests.total = await prisma.contests.count();
            this.evaluationStats.contests.active = activeContests;
            this.evaluationStats.contests.completed = completedContests;
            this.evaluationStats.contests.cancelled = cancelledContests;

            // Ensure stats are JSON-serializable for ServiceManager
            const serializableStats = JSON.parse(JSON.stringify({
                ...this.stats,
                evaluationStats: this.evaluationStats
            }));

            // Mark the service as started
            await serviceManager.markServiceStarted(
                this.name,
                JSON.parse(JSON.stringify(this.config)),
                serializableStats
            );

            // Log initialization details
            if (VERBOSE_CONTEST_EVALUATION_INIT) {
                logApi.info(`${serviceSpecificColors.contestEvaluation.tag}[contestEvaluationService]${fancyColors.RESET} Contest Evaluation Service initialized:`, {
                    activeContests,
                    completedContests,
                    cancelledContests
                });
            }

            return true;
        } catch (error) {
            logApi.error(`${serviceSpecificColors.contestEvaluation.tag}[contestEvaluationService]${fancyColors.RESET} ${fancyColors.RED}Contest Evaluation Service initialization error:${fancyColors.RESET}`, {
                error: error.message
            });
            await this.handleError(error);
            throw error;
        }
    }

    // Perform the main operation of the service
    /**
     * Implementation of service's main operation
     * Performs the main operation of the service 
     * @returns {Promise<Object>} - The result of the operation
     */
    async onPerformOperation() {
        // Original implementation - don't modify
        return this.performOperationImpl();
    }

    // Stop the service
    /**
     * Stops the service
     * @returns {Promise<void>} - A promise that resolves when the service is stopped
     */
    async stop() {
        try {
            // Call parent stop first
            await super.stop();
            
            // Clear all timeouts
            for (const timeout of this.evaluationTimeouts) {
                clearTimeout(timeout);
            }
            this.evaluationTimeouts.clear();
            
            // Clear active evaluations
            this.activeEvaluations.clear();
            
            // We no longer need to close the connection explicitly
            // as it's now managed by the solanaEngine
            
            // Final stats update
            await serviceManager.markServiceStopped(
                this.name,
                this.config,
                {
                    ...this.stats,
                    evaluationStats: this.evaluationStats
                }
            );
            
            logApi.info(`${serviceSpecificColors.contestEvaluation.tag}[contestEvaluationService]${fancyColors.RESET} Contest Evaluation Service stopped successfully`);
        } catch (error) {
            logApi.error(`${serviceSpecificColors.contestEvaluation.tag}[contestEvaluationService]${fancyColors.RESET} ${fancyColors.RED}Error stopping Contest Evaluation Service:${fancyColors.RESET}`, {
                error: error.message
            });
            throw error;
        }
    }

    // Utility functions
    /**
     * Decrypts a private key
     * @param {string} encryptedData - The encrypted data
     * @returns {string} - The decrypted private key
     */
    decryptPrivateKey(encryptedData) {
        try {
            const { encrypted, iv, tag, aad } = JSON.parse(encryptedData);
            const decipher = crypto.createDecipheriv(
                'aes-256-gcm',
                Buffer.from(process.env.WALLET_ENCRYPTION_KEY, 'hex'),
                Buffer.from(iv, 'hex')
            );
            
            decipher.setAuthTag(Buffer.from(tag, 'hex'));
            if (aad) decipher.setAAD(Buffer.from(aad));
            
            const decrypted = Buffer.concat([
                decipher.update(Buffer.from(encrypted, 'hex')),
                decipher.final()
            ]);
            
            return decrypted.toString();
        } catch (error) {
            throw ServiceError.operation('Failed to decrypt private key', {
                error: error.message,
                type: 'DECRYPTION_ERROR'
            });
        }
    }

    // Perform a blockchain transfer
    /**
     * Performs a blockchain transfer using SolanaEngine
     * @param {Object} contestWallet - The contest wallet object
     * @param {string} recipientAddress - The recipient address
     * @param {number} amount - The amount to transfer in SOL
     * @returns {Promise<string>} - The signature of the transaction
     */
    async performBlockchainTransfer(contestWallet, recipientAddress, amount) {
        try {
            // Decrypt the private key
            const decryptedPrivateKey = this.decryptPrivateKey(contestWallet.private_key);
            const privateKeyBytes = bs58.decode(decryptedPrivateKey);
            const fromKeypair = Keypair.fromSecretKey(privateKeyBytes);

            // Create transaction object - standard SOL transfer
            const transaction = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: fromKeypair.publicKey,
                    toPubkey: new PublicKey(recipientAddress),
                    lamports: Math.round(amount * LAMPORTS_PER_SOL) // Convert SOL to lamports, using round instead of floor
                })
            );
            
            // Send the transaction using SolanaEngine with optimal configuration
            const result = await solanaEngine.sendTransaction(
                transaction, 
                [fromKeypair], 
                {
                    commitment: 'confirmed',
                    skipPreflight: false,
                    maxRetries: 3,
                    blockHeightRetries: 2
                }
            );
            
            // Log successful transaction
            logApi.info(`${serviceSpecificColors.contestEvaluation.tag}[contestEvaluationService]${fancyColors.RESET} ${fancyColors.BOLD_GREEN}Transaction successful:${fancyColors.RESET} Sent ${amount} SOL to ${recipientAddress.substring(0, 6)}...${recipientAddress.substring(recipientAddress.length - 4)}, signature: ${result.signature}`);
            
            // Return only the signature string as expected by calling methods
            return result.signature;
        } catch (error) {
            // Proper error handling with blockchain service error category
            logApi.error(`${serviceSpecificColors.contestEvaluation.tag}[contestEvaluationService]${fancyColors.RESET} ${fancyColors.RED}Transaction failed:${fancyColors.RESET} ${error.message}`);
            
            throw ServiceError.blockchain('Blockchain transfer failed', {
                error: error.message,
                contestWallet: contestWallet.wallet_address,
                recipient: recipientAddress,
                amount,
                timestamp: new Date().toISOString()
            });
        }
    }

    // Distribute a prize with retry logic
    /**
     * Distributes a prize with retry logic
     * @param {Object} participant - The participant object
     * @param {number} place - The place of the participant
     * @param {number} prizeAmount - The amount of the prize
     * @param {Object} contest - The contest object
     * @returns {Promise<boolean>} - True if successful
     */
    async distributePrizeWithRetry(participant, place, prizeAmount, contest) {
        for (let attempt = 1; attempt <= this.config.prizeDistribution.maxRetries; attempt++) {
            let transaction;
            try {
                const contestWallet = await prisma.contest_wallets.findUnique({
                    where: { contest_id: contest.id }
                });

                if (!contestWallet) {
                    throw ServiceError.validation(`No wallet found for contest ${contest.id}`);
                }

                transaction = await prisma.transactions.create({
                    data: {
                        wallet_address: participant.wallet_address,
                        type: config.transaction_types.PRIZE_PAYOUT,
                        amount: prizeAmount,
                        balance_before: participant.current_balance,
                        balance_after: participant.current_balance.add(prizeAmount),
                        contest_id: contest.id,
                        description: `Prize payout for ${place}${place === 1 ? 'st' : place === 2 ? 'nd' : 'rd'} place in contest ${contest.contest_code}`,
                        status: config.transaction_statuses.PENDING,
                        created_at: new Date(),
                        user_id: participant.user_id
                    }
                });

                const signature = await this.performBlockchainTransfer(
                    contestWallet,
                    participant.wallet_address,
                    prizeAmount
                );
                
                await prisma.transactions.update({
                    where: { id: transaction.id },
                    data: {
                        status: config.transaction_statuses.COMPLETED,
                        blockchain_signature: signature,
                        completed_at: new Date()
                    }
                });

                await prisma.contest_participants.update({
                    where: {
                        contest_id_wallet_address: {
                            contest_id: contest.id,
                            wallet_address: participant.wallet_address
                        }
                    },
                    data: {
                        final_rank: place,
                        prize_amount: prizeAmount,
                        prize_paid_at: new Date()
                    }
                });

                this.evaluationStats.prizes.successful_distributions++;
                this.evaluationStats.prizes.total_amount += prizeAmount;

                logApi.info(`Successfully distributed prize for place ${place}`, {
                    contest_id: contest.id,
                    wallet: participant.wallet_address,
                    amount: prizeAmount.toString(),
                    signature,
                    attempt
                });
                
                return true;
            } catch (error) {
                if (transaction?.id) {
                    await prisma.transactions.update({
                        where: { id: transaction.id },
                        data: {
                            status: config.transaction_statuses.FAILED,
                            error_details: JSON.stringify(error),
                            completed_at: new Date()
                        }
                    });
                }

                logApi.error(`Prize distribution failed (attempt ${attempt}/${this.config.prizeDistribution.maxRetries})`, {
                    error: error.message,
                    contest_id: contest.id,
                    wallet: participant.wallet_address,
                    place,
                    amount: prizeAmount.toString()
                });

                if (attempt === this.config.prizeDistribution.maxRetries) {
                    this.evaluationStats.prizes.failed_distributions++;
                    throw error;
                }

                await new Promise(resolve => setTimeout(resolve, this.config.prizeDistribution.retryDelayMs));
            }
        }
        return false;
    }

    // Get participant tie-break stats
    /**
     * Gets the participant tie-break stats
     * @param {Object} participant - The participant object
     * @param {Object} contest - The contest object
     * @returns {Promise<Object>} - The participant tie-break stats
     */
    async getParticipantTiebreakStats(participant, contest) {
        // Default stats for no-trade scenario
        const defaultStats = {
            wallet_address: participant.wallet_address,
            final_balance: participant.current_dxd_points || new Decimal(0),
            profitable_trades: 0,
            total_trades: 0,
            win_rate: 0,
            biggest_win: new Decimal(0),
            avg_profit_per_trade: new Decimal(0),
            time_in_profitable_positions: 0,
            earliest_profit_time: null,
            total_profit: new Decimal(0)
        };

        // If participant has no initial points (shouldn't happen but let's be safe)
        if (!participant.initial_dxd_points) {
            return defaultStats;
        }

        // Get all trades for this participant in this contest
        const trades = await prisma.contest_portfolio_trades.findMany({
            where: {
                contest_id: contest.id,
                wallet_address: participant.wallet_address
            },
            orderBy: {
                created_at: 'asc'
            }
        });

        // If no trades were made, calculate basic stats based on points difference
        if (trades.length === 0) {
            const profitLoss = participant.current_dxd_points.sub(participant.initial_dxd_points);
            return {
                ...defaultStats,
                total_profit: profitLoss.gt(0) ? profitLoss : new Decimal(0)
            };
        }

        // If there are trades, calculate detailed stats
        let profitableTrades = 0;
        let totalTrades = trades.length;
        let biggestWin = new Decimal(0);
        let avgProfitPerTrade = new Decimal(0);
        let totalProfit = new Decimal(0);
        let timeInProfitablePositions = 0;
        let earliestProfitTime = null;

        for (let i = 0; i < trades.length; i++) {
            const trade = trades[i];
            // Calculate profit based on price_at_trade and virtual_amount
            const profit = new Decimal(trade.price_at_trade).mul(trade.virtual_amount);
            
            if (profit.gt(0)) {
                profitableTrades++;
                totalProfit = totalProfit.add(profit);
                biggestWin = profit.gt(biggestWin) ? profit : biggestWin;
                
                // Track time to first profit
                if (!earliestProfitTime && profit.gt(0)) {
                    earliestProfitTime = trade.created_at;
                }

                // Calculate time in profitable position
                if (trade.executed_at) {
                    timeInProfitablePositions += trade.executed_at.getTime() - trade.created_at.getTime();
                }
            }
        }

        avgProfitPerTrade = totalTrades > 0 ? totalProfit.div(totalTrades) : new Decimal(0);

        return {
            wallet_address: participant.wallet_address,
            final_balance: participant.current_dxd_points,
            profitable_trades: profitableTrades,
            total_trades: totalTrades,
            win_rate: totalTrades > 0 ? (profitableTrades / totalTrades) : 0,
            biggest_win: biggestWin,
            avg_profit_per_trade: avgProfitPerTrade,
            time_in_profitable_positions: timeInProfitablePositions,
            earliest_profit_time: earliestProfitTime,
            total_profit: totalProfit
        };
    }

    // Resolve ties between participants
    /**
     * Resolves ties between participants
     * @param {Array} tiedParticipants - The participants to resolve ties between
     * @param {Object} contest - The contest object
     * @returns {Promise<Array>} - The resolved participants
     */
    async resolveTies(tiedParticipants, contest) {
        // Get detailed stats for all tied participants
        const participantStats = await Promise.all(
            tiedParticipants.map(p => this.getParticipantTiebreakStats(p, contest))
        );

        // Sort participants using multiple tie-breaking criteria in order of importance
        return participantStats.sort((a, b) => {
            // 1. Higher final balance
            if (!a.final_balance.eq(b.final_balance)) {
                return b.final_balance.sub(a.final_balance).toNumber();
            }

            // 2. Higher win rate
            if (a.win_rate !== b.win_rate) {
                return b.win_rate - a.win_rate;
            }

            // 3. More profitable trades
            if (a.profitable_trades !== b.profitable_trades) {
                return b.profitable_trades - a.profitable_trades;
            }

            // 4. Higher average profit per trade
            if (!a.avg_profit_per_trade.eq(b.avg_profit_per_trade)) {
                return b.avg_profit_per_trade.sub(a.avg_profit_per_trade).toNumber();
            }

            // 5. Bigger single winning trade
            if (!a.biggest_win.eq(b.biggest_win)) {
                return b.biggest_win.sub(a.biggest_win).toNumber();
            }

            // 6. More time spent in profitable positions
            if (a.time_in_profitable_positions !== b.time_in_profitable_positions) {
                return b.time_in_profitable_positions - a.time_in_profitable_positions;
            }

            // 7. Earlier first profitable trade
            if (a.earliest_profit_time && b.earliest_profit_time) {
                return a.earliest_profit_time.getTime() - b.earliest_profit_time.getTime();
            }

            // 8. If still tied, use wallet address for deterministic ordering
            return a.wallet_address.localeCompare(b.wallet_address);
        });
    }

    // Group participants by their current balance
    /**
     * Groups participants by their current balance
     * @param {Array} participants - The participants to group
     * @returns {Promise<Array>} - The grouped participants
     */
    async groupParticipantsByBalance(participants) {
        // Group participants by their current balance
        const balanceGroups = new Map();
        
        participants.forEach(participant => {
            // Use current_dxd_points
            const balance = participant.current_dxd_points || 0;
            const balanceKey = balance.toString();
            if (!balanceGroups.has(balanceKey)) {
                balanceGroups.set(balanceKey, []);
            }
            balanceGroups.get(balanceKey).push(participant);
        });

        // For each group with more than one participant, resolve ties
        const resolvedParticipants = [];
        
        for (const [balance, group] of balanceGroups) {
            if (group.length === 1) {
                resolvedParticipants.push(group[0]);
            } else {
                const resolvedGroup = await this.resolveTies(group, group[0].contest_id);
                resolvedParticipants.push(...resolvedGroup);
            }
        }

        // Sort final list by balance and tie-break order
        return resolvedParticipants.sort((a, b) => {
            const balanceDiff = b.final_balance.sub(a.final_balance);
            if (!balanceDiff.eq(0)) {
                return balanceDiff.toNumber();
            }
            // If balances are equal, maintain the order from tie resolution
            return resolvedParticipants.indexOf(a) - resolvedParticipants.indexOf(b);
        });
    }

    // Validate the contest wallet balance
    /**
     * Validates the contest wallet balance
     * @param {Object} contestWallet - The contest wallet object
     * @param {Decimal} totalPrizePool - The total prize pool
     * @returns {Promise<Object>} - The result of the validation
     */
    async validateContestWalletBalance(contestWallet, totalPrizePool) {
        try {
            // Use solanaEngine to execute the RPC call instead of direct connection
            const balance = await solanaEngine.executeConnectionMethod('getBalance', new PublicKey(contestWallet.wallet_address));
            const minimumBuffer = config.master_wallet.min_contest_wallet_balance * LAMPORTS_PER_SOL; // 0.01 SOL
            const requiredBalance = Math.ceil(totalPrizePool * LAMPORTS_PER_SOL) + minimumBuffer;
            
            if (balance < requiredBalance) {
                throw new Error(`Insufficient contest wallet balance. Required: ${(requiredBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL (including ${config.master_wallet.min_contest_wallet_balance} SOL buffer), Available: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
            }

            return {
                isValid: true,
                balance: balance / LAMPORTS_PER_SOL,
                required: requiredBalance / LAMPORTS_PER_SOL,
                buffer: minimumBuffer / LAMPORTS_PER_SOL
            };
        } catch (error) {
            logApi.error('Contest wallet balance validation failed:', error);
            throw error;
        }
    }

    // Validate the token balance
    /**
     * Validates the token balance
     * @param {Object} wallet - The wallet object
     * @param {string} mint - The mint address
     * @param {number} amount - The amount to validate
     * @returns {Promise<Object>} - The result of the validation
     */
    async validateTokenBalance(wallet, mint, amount) {
        try {
            // Dynamic import of SPL token functions to avoid direct dependencies
            const { getAssociatedTokenAddress, getAccount } = await import('@solana/spl-token');
            
            const associatedTokenAddress = await getAssociatedTokenAddress(
                new PublicKey(mint),
                new PublicKey(wallet.wallet_address)
            );

            try {
                // Use solanaEngine's connection via executeRpc
                const tokenAccount = await solanaEngine.executeRpc(
                    connection => getAccount(connection, associatedTokenAddress)
                );
                
                if (tokenAccount.amount < BigInt(amount)) {
                    throw new Error(`Insufficient token balance. Required: ${amount}, Available: ${tokenAccount.amount}`);
                }
                return {
                    isValid: true,
                    balance: Number(tokenAccount.amount),
                    required: amount
                };
            } catch (error) {
                if (error.name === 'TokenAccountNotFoundError') {
                    throw new Error(`Token account not found for mint ${mint}`);
                }
                throw error;
            }
        } catch (error) {
            logApi.error('Token balance validation failed:', error);
            throw error;
        }
    }

    // Evaluate a contest
    /**
     * Evaluates a contest
     * @param {Object} contest - The contest object
     * @returns {Promise<Object>} - The result of the evaluation
     */
    async evaluateContest(contest) {
        try {
            const previousStatus = contest.status;
            // Get the contest's settings for payout structure
            let payout_structure = contest.settings?.payout_structure;

            // If no payout structure is defined, create a default one
            if (!payout_structure) {
                logApi.warn(`No payout structure found for contest ${contest.id}, using default structure`, {
                    contest_id: contest.id,
                    settings: contest.settings
                });
                
                // Default structure pays top 3 participants
                payout_structure = {
                    "place_1": 0.69,  // 69% to first place
                    "place_2": 0.20,  // 20% to second place
                    "place_3": 0.11   // 11% to third place
                };
            }

            // Get all participants
            const participants = await prisma.contest_participants.findMany({
                where: { contest_id: contest.id },
                include: {
                    // No need for trades - those would be tracked in contest_portfolio_trades
                    // but we don't need them for simple evaluation
                }
            });

            // Handle no participants case
            if (participants.length === 0) {
                await this.handleNoParticipants(contest);
                return {
                    status: 'completed',
                    message: 'Contest had no participants'
                };
            }

            // Check minimum participants requirement
            const minParticipants = contest.settings?.minimum_participants || 1;
            if (participants.length < minParticipants) {
                await this.handleInsufficientParticipants(contest, participants.length, minParticipants);
                return {
                    status: 'cancelled',
                    message: `Insufficient participants (${participants.length}/${minParticipants})`
                };
            }

            // Resolve any ties and get final ordered list
            const resolvedParticipants = await this.groupParticipantsByBalance(participants);

            // Store tie-break details for transparency
            await this.recordTieBreakDetails(contest, resolvedParticipants);

            // Calculate prize pool and platform fee
            const { actualPrizePool, platformFeeAmount } = this.calculatePrizePoolAndFee(contest);

            // Get and validate contest wallet
            const contestWallet = await this.getAndValidateContestWallet(contest, actualPrizePool, platformFeeAmount);

            // Distribute prizes to winners
            const prizeDistributionResults = await this.distributePrizes(
                contest,
                resolvedParticipants,
                actualPrizePool,
                payout_structure
            );

            // Record platform fee for rake service to collect later
            // TODO: Nonsensical; platform fee should not be recorded until it is collected, I would think... But it's fine
            await this.recordPlatformFee(contest, platformFeeAmount);

            // Award XP for participation
            for (const participant of participants) {
                try {
                    await levelingService.awardXP(
                        participant.wallet_address,
                        100, // Base XP for participating
                        {
                            type: 'CONTEST_PARTICIPATION',
                            contest_id: contest.id
                        }
                    );
                } catch (error) {
                    logApi.error('Failed to award participation XP:', {
                        wallet: participant.wallet_address,
                        contest_id: contest.id,
                        error: error.message
                    });
                    // Continue execution - non-critical error
                }
            }

            // Award XP for winners
            const winners = participants.filter(p => p.final_rank <= 3);
            for (const winner of winners) {
                try {
                    const winnerXP = {
                        1: 1000,  // 1st place
                        2: 500,  // 2nd place
                        3: 250   // 3rd place
                    }[winner.final_rank] || 0;

                    if (winnerXP > 0) {
                        await levelingService.awardXP(
                            winner.wallet_address,
                            winnerXP,
                            {
                                type: 'CONTEST_WIN',
                                contest_id: contest.id,
                                rank: winner.final_rank
                            }
                        );
                    }
                } catch (error) {
                    logApi.error('Failed to award winner XP:', {
                        wallet: winner.wallet_address,
                        contest_id: contest.id,
                        rank: winner.final_rank,
                        error: error.message
                    });
                    // Continue execution - non-critical error
                }
            }

            // Update contest status to completed
            await prisma.contests.update({
                where: { id: contest.id },
                data: { 
                    status: 'completed',
                }
            });
            
            // Emit contest completed event for Discord notifications
            try {
                // Dynamically import service events to avoid circular dependencies
                const { default: serviceEvents, SERVICE_EVENTS } = await import('../utils/service-suite/service-events.js');
                
                // Get winner details from participants
                const winners = resolvedParticipants.slice(0, 3).map((participant, index) => {
                    const place = index + 1;
                    const placeKey = `place_${place}`;
                    const prizePercentage = payout_structure[placeKey] || 0;
                    const prizeAmount = actualPrizePool.mul(prizePercentage);
                    
                    return {
                        wallet_address: participant.wallet_address,
                        place,
                        prize_amount: prizeAmount.toString(),
                        // Find user details if available
                        user_id: participant.user_id
                    };
                });
                
                // Get user display names for winners
                const winnerDetails = await Promise.all(winners.map(async (winner) => {
                    try {
                        // Get user details if available
                        if (winner.user_id) {
                            const user = await prisma.users.findUnique({
                                where: { id: winner.user_id }
                            });
                            
                            if (user) {
                                return {
                                    ...winner,
                                    display_name: user.nickname || user.username || winner.wallet_address.substring(0, 6) + '...'
                                };
                            }
                        }
                        
                        // Fallback to wallet address
                        return {
                            ...winner,
                            display_name: winner.wallet_address.substring(0, 6) + '...' + winner.wallet_address.substring(winner.wallet_address.length - 4)
                        };
                    } catch (error) {
                        logApi.warn(`Failed to get user details for winner: ${error.message}`);
                        return {
                            ...winner,
                            display_name: winner.wallet_address.substring(0, 6) + '...'
                        };
                    }
                }));
                
                // Emit the event
                serviceEvents.emit(SERVICE_EVENTS.CONTEST_COMPLETED, {
                    contest_id: contest.id,
                    contest_name: contest.contest_name || `Contest #${contest.id}`,
                    contest_code: contest.contest_code,
                    prize_pool: actualPrizePool.toString(),
                    platform_fee: platformFeeAmount.toString(),
                    participant_count: participants.length,
                    winners: winnerDetails,
                    start_time: contest.start_time,
                    end_time: contest.end_time
                });
            } catch (discordError) {
                logApi.warn(`Failed to emit contest completion event: ${discordError.message}`, {
                    error: discordError
                });
                // Non-critical error, continue execution
            }
            
            // Log contest completion
            await this.logContestCompletion(contest, prizeDistributionResults, platformFeeAmount);
            // Log contest status change
            logApi.info(`Contest Status Change: ${contest.contest_name || `Contest #${contest.id}`}`, {
                contest_id: contest.id,
                previous_status: `\x1b[33m${previousStatus}\x1b[0m`, // yellow for previous
                new_status: `\x1b[36mcompleted\x1b[0m`, // cyan for completed
                prize_distributions: prizeDistributionResults,
                platform_fee: platformFeeAmount.toString(),
                message: `Contest evaluation completed successfully`
            });

            return {
                status: 'success',
                message: `Contest ${contest.id} evaluated and prizes distributed`,
                prizeDistributions: prizeDistributionResults,
                platformFee: platformFeeAmount.toString()
            };
        } catch (error) {
            logApi.error(`Failed to evaluate contest ${contest.id}: ${error.message}`);
            throw error;
        }
    }

    // Common contest cancellation logic
    /**
     * Cancels a contest
     * @param {Object} contest - The contest object
     * @param {string} status - The new status of the contest
     * @param {string} reason - The reason for the cancellation
     * @param {string} logAction - The action to log
     * @param {Object} additionalData - Additional data to log
     * @returns {Promise<boolean>} - True if successful
     */
    async cancelContest(contest, status, reason, logAction, additionalData = {}) {
        const contestId = contest.id;
        const contestName = contest.contest_name || `Contest #${contestId}`;
        const previousStatus = contest.status;

        try {
            // Update contest status in database
            await prisma.contests.update({
                where: { id: contestId },
                data: { 
                    status: status,
                    cancellation_reason: reason
                }
            });

            // Log the action with colored status
            const statusColor = {
                'pending': '\x1b[33m', // yellow
                'active': '\x1b[32m',  // green
                'completed': '\x1b[36m', // cyan
                'cancelled': '\x1b[31m'  // red
            }[status] || '\x1b[0m';     // default/reset

            logApi.info(`${serviceSpecificColors.contestEvaluation.tag}[contestEvaluationService]${fancyColors.RESET} Contest Status Change: ${contestName}`, {
                contest_id: contestId,
                previous_status: `${statusColor}${previousStatus}\x1b[0m`,
                new_status: `${statusColor}${status}\x1b[0m`,
                reason: reason,
                ...additionalData
            });

            // Log the admin action
            await AdminLogger.logAction(
                'SYSTEM',
                logAction,
                {
                    contest_id: contestId,
                    reason: `${reason}`,
                    contest_name: contestName,
                    previous_status: previousStatus,
                    new_status: status,
                    ...additionalData
                }
            );

            // Update service stats
            if (status === this.config.states.CANCELLED) {
                this.evaluationStats.contests.cancelled = (this.evaluationStats.contests.cancelled || 0) + 1;
            }
            
            return true;
        } catch (error) {
            logApi.error(`${fancyColors.BG_RED}[contestEvaluationService]${fancyColors.RESET} ${fancyColors.BG_LIGHT_RED}Failed to update contest ${contestId} status:${fancyColors.RESET}`, {
                error: error.message
            });
            throw error;
        }
    }

    // Helper methods for contest evaluation
    /**
     * Handles no participants
     * @param {Object} contest - The contest object
     * @returns {Promise<boolean>} - True if successful
     */
    async handleNoParticipants(contest) {
        return this.cancelContest(
            contest,
            this.config.states.COMPLETED,
            `Contest ${contest.contest_name} completed with no participants`,
            AdminLogger.Actions.CONTEST.END
        );
    }

    // Handle insufficient participants
    /**
     * Handles insufficient participants
     * @param {Object} contest - The contest object
     * @param {number} actualCount - The actual number of participants
     * @param {number} requiredCount - The required number of participants
     * @returns {Promise<boolean>} - True if successful
     */
    async handleInsufficientParticipants(contest, actualCount, requiredCount) {
        return this.cancelContest(
            contest,
            this.config.states.CANCELLED,
            `Contest cancelled due to insufficient participants (${actualCount}/${requiredCount})`,
            AdminLogger.Actions.CONTEST.CANCEL,
            {
                required_participants: requiredCount,
                actual_participants: actualCount
            }
        );
    }

    // Calculate prize pool and fee
    /**
     * Calculates the actual prize pool and fee
     * @param {Object} contest - The contest object
     * @returns {Object} - The actual prize pool and fee
     */
    calculatePrizePoolAndFee(contest) {
        // Use current_prize_pool instead of prize_pool for actual prize calculations
        const prizePool = contest.current_prize_pool ? new Decimal(contest.current_prize_pool) : new Decimal(0);
        const platformFeePercentage = new Decimal(this.config.platformFee || 0);

        // Calculate actual prize pool and fee
        const actualPrizePool = prizePool.mul(new Decimal('1').sub(platformFeePercentage));
        const platformFeeAmount = prizePool.mul(platformFeePercentage);

        return { actualPrizePool, platformFeeAmount };
    }

    // Get and validate contest wallet
    /**
     * Gets and validates the contest wallet
     * @param {Object} contest - The contest object
     * @param {Decimal} actualPrizePool - The actual prize pool
     * @param {Decimal} platformFeeAmount - The platform fee amount
     * @returns {Promise<Object>} - The contest wallet object
    */
    async getAndValidateContestWallet(contest, actualPrizePool, platformFeeAmount) {
        const contestWallet = await prisma.contest_wallets.findUnique({
            where: { contest_id: contest.id }
        });

        if (!contestWallet) {
            throw new Error(`No wallet found for contest ${contest.id}`);
        }

        // Calculate total prize pool needed
        let totalPrizeNeeded = new Decimal(0);
        const payout_structure = contest.settings?.payout_structure || {
            "place_1": 0.69,  // 69% to first place
            "place_2": 0.20,  // 20% to second place
            "place_3": 0.11   // 11% to third place
        };

        for (let i = 1; i <= 3; i++) {
            const placeKey = `place_${i}`;
            const percentage = payout_structure[placeKey] || 0;
            totalPrizeNeeded = totalPrizeNeeded.add(actualPrizePool.mul(percentage));
        }

        // Validate wallet balance
        const balanceValidation = await this.validateContestWalletBalance(
            contestWallet,
            totalPrizeNeeded.add(platformFeeAmount).toNumber()
        );

        logApi.info(`${serviceSpecificColors.contestEvaluation.tag}[contestEvaluationService]${fancyColors.RESET} Contest wallet balance validated`, {
            contest_id: contest.id,
            wallet: contestWallet.wallet_address,
            actualPrizePool: actualPrizePool.toString(),
            platformFee: platformFeeAmount.toString(),
            ...balanceValidation
        });

        // Validate SPL token balance if needed
        if (contest.token_mint) {
            await this.validateTokenBalance(
                contestWallet,
                contest.token_mint,
                totalPrizeNeeded.add(platformFeeAmount).toNumber()
            );
        }

        return contestWallet;
    }

    // Distribute prizes
    /**
     * Distributes prizes to the top 3 participants
     * @param {Object} contest - The contest object
     * @param {Array} resolvedParticipants - The resolved participants from the tiebreak
     * @param {Decimal} actualPrizePool - The actual prize pool
     * @param {Object} payout_structure - The payout structure
     * @returns {Promise<Array>} - The results of the prize distribution
     */
    async distributePrizes(contest, resolvedParticipants, actualPrizePool, payout_structure) {
        const prizeDistributionResults = [];

        // Distribute prizes to top 3 participants
        for (let i = 0; i < Math.min(3, resolvedParticipants.length); i++) {
            const participant = resolvedParticipants[i];
            const place = i + 1;
            const placeKey = `place_${place}`;
            const prizePercentage = payout_structure[placeKey] || 0;
            const prizeAmount = actualPrizePool.mul(prizePercentage);

            // Distribute prize to participant
            if (prizeAmount.gt(0)) {
                try {
                    // Distribute prize to participant
                    await this.distributePrizeWithRetry(participant, place, prizeAmount, contest);
                    prizeDistributionResults.push({
                        place,
                        wallet: participant.wallet_address,
                        amount: prizeAmount.toString(),
                        status: 'success'
                    });
                } catch (error) {
                    // Log failed prize distribution
                    prizeDistributionResults.push({
                        place,
                        wallet: participant.wallet_address,
                        amount: prizeAmount.toString(),
                        status: 'failed',
                        error: error.message
                    });
                }
            }
        }

        // Return results
        return prizeDistributionResults;
    }

    // Record platform fee at time of evaluation (contest end)
    /**
     * Records the platform fee at time of evaluation (contest end)
     * @param {Object} contest - The contest object
     * @param {Decimal} platformFeeAmount - The platform fee amount
     * @returns {Promise<boolean>} - True if successful
    */
    async recordPlatformFee(contest, platformFeeAmount) {
        // Create a pending platform fee transaction record
        await prisma.transactions.create({
            data: {
                type: 'WITHDRAWAL',
                amount: platformFeeAmount,
                balance_before: contest.current_prize_pool, // TODO: this is non-sensical, but it's what we have
                balance_after: contest.current_prize_pool.sub(platformFeeAmount), // TODO: this is non-sensical, but it's what we have
                description: `Platform fee for contest ${contest.contest_code} (pending collection by rake service)`,
                status: config.transaction_statuses.PENDING,
                contest_id: contest.id,
                created_at: new Date()
            }
        });

        // Log platform fee recording
        logApi.info(`${serviceSpecificColors.contestEvaluation.tag}[contestEvaluationService]${fancyColors.RESET} Platform fee recorded for Contest ${contest.id}. The Solana balance is awaiting collection by the Rake Service`, {
            contest_id: contest.id,
            amount: platformFeeAmount.toString()
        });
    }

    // Log contest completion
    /**
     * Logs the completion of a contest
     * @param {Object} contest - The contest object
     * @param {Array} prizeDistributionResults - The results of the prize distribution
     * @param {Decimal} platformFeeAmount - The platform fee amount
     * @returns {Promise<boolean>} - True if successful
     */
    async logContestCompletion(contest, prizeDistributionResults, platformFeeAmount) {
        await AdminLogger.logAction(
            'SYSTEM',
            AdminLogger.Actions.CONTEST.END,
            {
                contest_id: contest.id,
                prize_distributions: prizeDistributionResults,
                platform_fee: platformFeeAmount.toString(),
                status: prizeDistributionResults.some(r => r.status === 'failed') 
                    ? 'completed_with_failures'
                    : 'completed_successfully'
            }
        );

        logApi.info(`${serviceSpecificColors.contestEvaluation.tag}[contestEvaluationService]${fancyColors.RESET} Contest ${contest.id} evaluated successfully`, {
            prizeDistributions: prizeDistributionResults,
            platformFee: platformFeeAmount.toString()
        });
    }

    // Helper function to process refunds
    /**
     * Process refunds for a cancelled contest
     * @param {Object} participant - The participant object
     * @param {Object} contest - The contest object
     * @param {Object} contestWallet - The contest wallet object
     * @returns {Promise<Object>} - The result of the refund process
     */
    async processRefund(participant, contest, contestWallet) {
        try {
            // Use contest.entry_fee as refund amount since entry_amount doesn't exist on participants
            const refundAmount = contest.entry_fee || new Decimal(0);
            
            // Explicitly reject zero-value refunds
            if (refundAmount.equals(0)) {
                logApi.error(`${serviceSpecificColors.contestEvaluation.tag}[contestEvaluationService]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} ERROR ${fancyColors.RESET} ${fancyColors.RED}Cannot process zero-value refund:${fancyColors.RESET}`, {
                    contest_id: contest.id,
                    wallet_address: participant.wallet_address,
                    contest_code: contest.contest_code
                });
                
                // Log to admin logger
                await AdminLogger.logAction(
                    'SYSTEM',
                    AdminLogger.Actions.CONTEST.CANCEL,
                    {
                        contest_id: contest.id,
                        error: "Zero-value refund attempted",
                        wallet: participant.wallet_address,
                        status: "failed"
                    }
                );
                
                throw new Error('Zero-value refund rejected: contest.entry_fee is missing or zero');
            }
            
            // First create a pending refund transaction record
            const transaction = await prisma.transactions.create({
                data: {
                    wallet_address: participant.wallet_address,
                    type: config.transaction_types.CONTEST_REFUND,
                    amount: refundAmount,
                    balance_before: participant.initial_dxd_points, // TODO: **THE NAME 'balance_before' IS DANGEROUSLY CONFUSING!**  POINTS AT START OF CONTEST HAS NO RELATIONSHIP TO REFUND AMOUNT OR BALANCE!
                    balance_after: participant.current_dxd_points, // TODO: **THE NAME 'balance_after' IS DANGEROUSLY CONFUSING!**  POINTS AT END OF CONTEST HAS NO RELATIONSHIP TO REFUND AMOUNT OR BALANCE!
                    contest_id: contest.id,
                    description: `Refund for cancelled contest ${contest.contest_code}`,
                    status: config.transaction_statuses.PENDING,
                    created_at: new Date(),
                    user_id: participant.user_id
                }
            });

            // Perform the blockchain transaction
            const signature = await this.performBlockchainTransfer(
                contestWallet,
                participant.wallet_address,
                refundAmount
            );

            // Update transaction with success status
            await prisma.transactions.update({
                where: { id: transaction.id },
                data: {
                    status: config.transaction_statuses.COMPLETED,
                    blockchain_signature: signature,
                    completed_at: new Date()
                }
            });

            // Update participant record
            await prisma.contest_participants.update({
                where: {
                    contest_id_wallet_address: {
                        contest_id: contest.id,
                        wallet_address: participant.wallet_address
                    }
                },
                data: {
                    refunded_at: new Date(),
                    refund_amount: refundAmount,
                    refund_transaction_id: transaction.id
                }
            });

            return { success: true, signature };
        } catch (error) {
            logApi.error(`${serviceSpecificColors.contestEvaluation.tag}[contestEvaluationService]${fancyColors.RESET} ${fancyColors.RED}Refund failed:${fancyColors.RESET}`, {
                error: error.message,
                participant: participant.wallet_address,
                contest: contest.id,
                amount: participant.entry_amount.toString()
            });
            throw error;
        }
    }

    // Process refunds for a cancelled contest
    /**
     * Process refunds for a cancelled contest
     * @param {Object} contest - The contest object
     * @param {string} adminAddress - The address of the admin performing the refund
     * @param {Object} context - Additional context for the refund
     * @returns {Promise<Object>} - The result of the refund process
     */
    async processContestRefunds(contest, adminAddress = null, context = {}) {
        try {
            // Admin is processing a refund
            if (adminAddress) {
                // Log the admin action and context
                await AdminLogger.logAction(
                    adminAddress,
                    AdminLogger.Actions.CONTEST.CANCEL,
                    {
                        contest_id: contest.id,
                        participant_count: contest.participants.length
                    },
                    context
                );
            }

            // Get a contest wallet
            const contestWallet = await prisma.contest_wallets.findUnique({
                where: { contest_id: contest.id }
            });

            // If no wallet is found, throw an error
            if (!contestWallet) {
                throw new Error(`No wallet found for contest ${contest.id}`);
            }

            // Get all contest participants who have not been refunded
            const participants = await prisma.contest_participants.findMany({
                where: {
                    contest_id: contest.id,
                    refunded_at: null // Only those not yet refunded
                }
            });

            // If there are no contest participants to refund, return
            if (participants.length === 0) {
                logApi.info(`No participants to refund for contest ${contest.id}`);
                return { status: 'completed', refunded: 0 };
            }

            // Validate contest wallet has sufficient balance to refund all participants
            // Use contest.entry_fee since entry_amount doesn't exist on participants
            const entryFeePerParticipant = contest.entry_fee || new Decimal(0);
            const totalRefundAmount = participants.reduce(
                (sum, p) => sum.add(entryFeePerParticipant),
                new Decimal(0)
            );
            await this.validateContestWalletBalance(contestWallet, totalRefundAmount.toNumber());

            // Log the contest refund validation
            logApi.info(`${serviceSpecificColors.contestEvaluation.tag}[contestEvaluationService]${fancyColors.RESET} ${fancyColors.BOLD}Contest wallet balance validated as sufficient to issue ${fancyColors.BOLD}${participants.length}${fancyColors.RESET} refunds`, {
                contest_id: contest.id,
                wallet: contestWallet.wallet_address,
                total_refund_amount: totalRefundAmount.toString()
            });

            // Process refunds with retries
            const results = [];
            for (const participant of participants) {
                let retries = 0;
                while (retries < this.config.refunds.maxRetries) {
                    try {
                        const result = await this.processRefund(participant, contest, contestWallet);
                        results.push({
                            wallet: participant.wallet_address,
                            amount: participant.entry_amount.toString(),
                            status: 'success',
                            signature: result.signature
                        });
                        break;
                    } catch (error) {
                        retries++;
                        if (retries === this.config.refunds.maxRetries) {
                            results.push({
                                wallet: participant.wallet_address,
                                amount: participant.entry_amount.toString(),
                                status: 'failed',
                                error: error.message
                            });
                        } else {
                            await new Promise(resolve => setTimeout(resolve, this.config.refunds.retryDelayMs));
                        }
                    }
                }
            }

            this.evaluationStats.refunds.total += results.filter(r => r.status === 'success').length;
            this.evaluationStats.refunds.total_amount += results.filter(r => r.status === 'success').reduce((sum, r) => sum + r.amount, 0);
            return {
                status: 'completed',
                refunded: results.filter(r => r.status === 'success').length,
                failed: results.filter(r => r.status === 'failed').length,
                results
            };
        } catch (error) {
            logApi.error(`${serviceSpecificColors.contestEvaluation.tag}[contestEvaluationService]${fancyColors.RESET} ${fancyColors.RED}Failed to process contest refunds:${fancyColors.RESET}`, {
                error: error.message
            });
            throw error;
        }
    }

    // Main operation implementation
    /**
     * Main operation implementation
     * @returns {Promise<Object>} - The result of the operation
     */
    async performOperationImpl() {
        const startTime = Date.now();
        
        const now = new Date();
        const results = {
            contestsStarted: 0,
            contestsEnded: 0,
            contestsCancelled: 0,
            failures: 0
        };

        // Increment the total operations count
        this.evaluationStats.operations.total++;

        // Find and process contests that should start
        const contestsToStart = await this.findContestsToStart(now);
        if (contestsToStart.length > 0) {
            logApi.info(`${serviceSpecificColors.contestEvaluation.tag}[contestEvaluationService]${fancyColors.RESET} Found ${fancyColors.BOLD}${contestsToStart.length}${fancyColors.RESET} pending contests`);
        } else {
            logApi.info(`${serviceSpecificColors.contestEvaluation.tag}[contestEvaluationService]${fancyColors.RESET} No pending contests to ${fancyColors.BOLD}start${fancyColors.RESET}`);
        }
        
        // Process each contest that should start
        for (const contest of contestsToStart) {
            try {
                // Process the contest start
                await this.processContestStart(contest);
                
                // Update result counters based on outcome
                if (contest.contest_participants.length >= (contest.settings?.minimum_participants || 1)) {
                    // Contest started successfully
                    results.contestsStarted++;
                } else if (contest.start_time < new Date(Date.now() - this.config.autoCancelWindow)) {
                    // Contest was auto-cancelled due to insufficient participants after waiting period
                    results.contestsCancelled++;
                }
            } catch (error) {
                // Log the error
                logApi.error(`${serviceSpecificColors.contestEvaluation.tag}[contestEvaluationService]${fancyColors.RESET} ${fancyColors.RED}Failed to process contest ${contest.id} start:${fancyColors.RESET}`, error);
                // Increment the failures count
                results.failures++;
                // Increment the failed operations count
                this.evaluationStats.operations.failed++;
            }
        }

        // Find and process contests that should end
        const contestsToEnd = await this.findContestsToEnd(now);
        if (contestsToEnd.length > 0) {
            // Log the number of active contests due to end
            logApi.info(`${serviceSpecificColors.contestEvaluation.tag}[contestEvaluationService]${fancyColors.RESET} Found ${fancyColors.BOLD}${contestsToEnd.length}${fancyColors.RESET} active contests due to end`);
        } else {
            // No active contests due to end
            logApi.info(`${serviceSpecificColors.contestEvaluation.tag}[contestEvaluationService]${fancyColors.RESET} No active contests to ${fancyColors.BOLD}end${fancyColors.RESET}`);
        }
        
        for (const contest of contestsToEnd) {
            try {
                // Evaluate the contest
                await this.evaluateContest(contest);
                // Increment the successful operations count
                results.contestsEnded++;
            } catch (error) {
                // Log the error
                logApi.error(`${serviceSpecificColors.contestEvaluation.tag}[contestEvaluationService]${fancyColors.RESET} ${fancyColors.RED}Failed to evaluate contest ${contest.id}:${fancyColors.RESET}`, error);
                // Increment the failures count
                results.failures++;
                // Increment the failed operations count
                this.evaluationStats.operations.failed++;
            }
        }

        // Update successful operations count
        this.evaluationStats.operations.successful++;

        // Update performance metrics
        const operationTime = Date.now() - startTime;
        this.evaluationStats.performance.last_operation_time_ms = operationTime;
        
        // Calculate average operation time
        const totalOps = this.evaluationStats.operations.total;
        if (totalOps > 0) {
            // Update the average operation time
            this.evaluationStats.performance.average_operation_time_ms = 
                ((this.evaluationStats.performance.average_operation_time_ms * (totalOps - 1)) + 
                operationTime) / totalOps;
        }

        // Get updated contest counts for stats
        const [activeContests, completedContests, cancelledContests] = await Promise.all([
            prisma.contests.count({ where: { status: this.config.states.ACTIVE } }),
            prisma.contests.count({ where: { status: this.config.states.COMPLETED } }),
            prisma.contests.count({ where: { status: this.config.states.CANCELLED } })
        ]);

        // Update the contest counts
        this.evaluationStats.contests.active = activeContests;
        this.evaluationStats.contests.completed = completedContests;
        this.evaluationStats.contests.cancelled = cancelledContests;

        // Update ServiceManager state
        await serviceManager.updateServiceHeartbeat(
            this.name,
            this.config,
            {
                ...this.stats,
                evaluationStats: this.evaluationStats
            }
        );

        // Return the operation results
        return {
            duration: operationTime,
            ...results
        };
    }

    // This is just a helper method for logging
    logCompletionMessage() {
        return `${serviceSpecificColors.contestEvaluation.tag}[contestEvaluationService]${fancyColors.RESET} Contest Evaluation Service completed task`;
    }

    // Helper methods for performOperation
    /**
     * Finds contests that should start
     * @param {Date} now - The current date and time
     * @returns {Promise<Array>} - An array of contests that should start
     */
    async findContestsToStart(now) {
        // Find contests that should start
        return await prisma.contests.findMany({
            where: {
                status: this.config.states.PENDING,
                start_time: {
                    lte: now
                }
            },
            include: {
                contest_participants: true
            }
        });
    }

    // Helper method to find contests that should end
    /**
     * Finds contests that should end
     * @param {Date} now - The current date and time
     * @returns {Promise<Array>} - An array of contests that should end
     */
    async findContestsToEnd(now) {
        // Find contests that should end ('active' status despite an end time in the past)
        return await prisma.contests.findMany({
            where: {
                status: this.config.states.ACTIVE,
                end_time: {
                    lte: now
                }
            },
            include: {
                contest_wallets: true,
                contest_participants: true
            }
        });
    }

    // Starts a contest by updating its status to active
    /**
     * Starts a contest by updating its status to active
     * @param {Object} contest - The contest object to start
     * @returns {Promise<boolean>} - True if successful
     */
    async startContest(contest) {
        try {
            // Get the previous status
            const previousStatus = contest.status;
            
            // Update contest status to active
            await prisma.contests.update({
                where: { id: contest.id },
                data: { 
                    status: this.config.states.ACTIVE,
                    start_time: new Date() 
                }
            });

            // Log contest status change (start)
            logApi.info(`${serviceSpecificColors.contestEvaluation.tag}[contestEvaluationService]${fancyColors.RESET} Contest Status Change: ${fancyColors.BOLD}${contest.contest_name || `Contest #${contest.id}`}${fancyColors.RESET}`, {
                contest_id: contest.id,
                previous_status: `\x1b[33m${previousStatus}\x1b[0m`, // yellow for previous
                new_status: `\x1b[32mactive\x1b[0m`, // green for active
                participant_count: contest.contest_participants.length,
                message: `Contest started with ${contest.contest_participants.length} participants`
            });

            // Log the system/admin action
            await AdminLogger.logAction(
                'SYSTEM',
                AdminLogger.Actions.CONTEST.START,
                {
                    contest_id: contest.id,
                    contest_name: contest.contest_name,
                    previous_status: previousStatus,
                    new_status: 'active',
                    participant_count: contest.contest_participants.length
                }
            );

            // Update service stats
            this.evaluationStats.contests.active++;

            // Return true if successful in starting the contest
            return true;
        } catch (error) {
            // Log the error
            logApi.error(`${serviceSpecificColors.contestEvaluation.tag}[contestEvaluationService]${fancyColors.RESET} ${fancyColors.RED}Failed to start contest ${contest.id}:${fancyColors.RESET}`, error);
            throw error;
        }
    }

    // Cancel a contest that has no participants
    /**
     * Cancels a contest that has no participants
     * @param {Object} contest - The contest object to cancel
     * @returns {Promise<boolean>} - True if successful
     */
    async cancelContestNoParticipants(contest) {
        // No need to process refunds for contests with no participants
        return this.cancelContest(
            contest,
            this.config.states.CANCELLED,
            `Contest cancelled due to no participants`,
            AdminLogger.Actions.CONTEST.CANCEL,
            {
                required_participants: contest.settings?.minimum_participants || 1,
                actual_participants: 0,
                auto_cancelled: true
            }
        );
    }

    // Cancel a contest that has insufficient participants after waiting period
    /**
     * Cancels a contest that has insufficient participants after waiting period
     * @param {Object} contest - The contest object to cancel
     * @returns {Promise<boolean>} - True if successful
     */
    async cancelContestInsufficientParticipants(contest) {
        // Get the minimum participants required
        const minParticipants = contest.settings?.minimum_participants || 1;
        // Get the actual participants in the contest
        const actualParticipants = contest.contest_participants.length;
        
        // Cancel the contest
        const cancellationResult = await this.cancelContest(
            contest,
            this.config.states.CANCELLED,
            `Contest auto-cancelled due to insufficient participants after wait period (${actualParticipants}/${minParticipants})`,
            AdminLogger.Actions.CONTEST.CANCEL,
            {
                required_participants: minParticipants,
                actual_participants: actualParticipants,
                auto_cancelled: true,
                waited_for: this.config.autoCancelWindow
            }
        );
        
        // Process refunds if there were participants
        if (cancellationResult && contest.contest_participants && contest.contest_participants.length > 0) {
            // Log the refund initiation
            logApi.info(`${serviceSpecificColors.contestEvaluation.tag}[contestEvaluationService]${fancyColors.RESET} Initiating refund process for auto-cancelled insufficient-participants contest ${contest.id}`);
            // Process the refunds
            this.processContestRefunds(contest)
                .catch(error => {
                    // Log the error
                    logApi.error(`Failed to process refunds for auto-cancelled insufficient-participants contest ${contest.id}:`, {
                        error: error.message,
                        contest_id: contest.id
                    });
                });
        }

        // Return the cancellation result
        return cancellationResult;
    }
    
    // Cancel a contest that has only one participant
    /**
     * Cancels a contest that has only one participant
     * @param {Object} contest - The contest object to cancel
     * @returns {Promise<boolean>} - True if successful
     */
    async cancelContestSingleParticipant(contest) {
        // Get the cancellation result
        const cancellationResult = await this.cancelContest(
            contest,
            this.config.states.CANCELLED,
            `Contest auto-cancelled due to having only one participant (based on REFUND_SINGLE_PARTICIPANT_CONTESTS setting)`,
            AdminLogger.Actions.CONTEST.CANCEL,
            {
                required_participants: 2, // At least 2 participants needed for competition
                actual_participants: 1,
                auto_cancelled: true,
                single_participant_policy: true
            }
        );

        // Process refunds if there are participants
        if (cancellationResult && contest.contest_participants && contest.contest_participants.length > 0) {
            // Log the refund initiation
            logApi.info(`${serviceSpecificColors.contestEvaluation.tag}[contestEvaluationService]${fancyColors.RESET} Initiating refund process for auto-cancelled single-participant contest ${contest.id}`);
            // Process the refunds
            this.processContestRefunds(contest)
                .catch(error => {
                    logApi.error(`Failed to process refunds for auto-cancelled single-participant contest ${contest.id}:`, {
                        error: error.message,
                        contest_id: contest.id
                    });
                });
        }

        // Return the cancellation result
        return cancellationResult;
    }

    // Process contest start by checking participant requirements
    /**
     * Process contest start by checking participant requirements
     * @param {Object} contest - The contest to process
     * @returns {Promise<void>}
     */
    async processContestStart(contest) {
        // Get the minimum participants required
        const minParticipants = contest.settings?.minimum_participants || 1;
        
        // Handle cases where there's exactly one participant
        if (contest.contest_participants.length === 1 && REFUND_SINGLE_PARTICIPANT_CONTESTS) {
            // Cancel contest with single participant based on the config flag
            await this.cancelContestSingleParticipant(contest);
            return;
        }
        
        // Handle cases where there are enough participants
        if (contest.contest_participants.length >= minParticipants) {
            // Enough participants, start the contest
            await this.startContest(contest);
        } else if (contest.contest_participants.length === 0) {
            // No participants, cancel immediately
            await this.cancelContestNoParticipants(contest);
        } else if (contest.start_time < new Date(Date.now() - this.config.autoCancelWindow)) {
            // Insufficient participants after grace period, cancel
            await this.cancelContestInsufficientParticipants(contest);
        } else {
            // Not enough participants yet, but still within grace period
            logApi.info(`Contest ${contest.id} waiting for more participants: currently ${contest.contest_participants.length}/${minParticipants}`);
        }
    }

    // Admin operations
    /**
     * Manually evaluate a contest
     * @param {string} contestId - The ID of the contest to evaluate
     * @param {string} adminAddress - The address of the admin performing the evaluation
     * @param {Object} context - Additional context for the evaluation
     * @returns {Promise<Object>} - The result of the evaluation
     */
    async manuallyEvaluateContest(contestId, adminAddress, context = {}) {
        try {
            // Get the contest
            const contest = await prisma.contests.findUnique({
                where: { id: contestId },
                include: { participants: true }
            });

            // If the contest is not found, throw an error
            if (!contest) {
                throw ServiceError.validation('Contest not found');
            }

            // Log the admin action
            await AdminLogger.logAction(
                adminAddress,
                AdminLogger.Actions.CONTEST.FORCE_EVALUATE,
                {
                    contest_id: contestId,
                    contest_status: contest.status,
                    participant_count: contest.participants.length
                },
                context
            );

            // Perform evaluation
            await this.evaluateContest(contest);

            // Return success
            return {
                success: true,
                message: 'Contest evaluated successfully'
            };
        } catch (error) {
            // Log the error
            logApi.error(`${serviceSpecificColors.contestEvaluation.tag}[contestEvaluationService]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} EVALUATION FAILED ${fancyColors.RESET} ${fancyColors.RED}${error.message}${fancyColors.RESET}`, error);
            throw error;
        }
    }

    // Justify tiebreak details for a contest
    /**
     * Records tiebreak details for a contest
     * @param {Object} contest - The contest object
     * @param {Array} resolvedParticipants - The resolved participants from the tiebreak
     * @returns {Promise<boolean>} - True if successful
     */
    async recordTieBreakDetails(contest, resolvedParticipants) {
        try {
            // For each participant, log their tiebreak metrics
            for (const participant of resolvedParticipants) {
                const tiebreakStats = await this.getParticipantTiebreakStats(participant, contest);
                
                // Log the tiebreak details
                logApi.info(`${serviceSpecificColors.contestEvaluation.tag}[contestEvaluationService]${fancyColors.RESET} ${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE} TIEBREAK ${fancyColors.RESET} ${fancyColors.LIGHT_CYAN}Details for participant in contest ${contest.id}${fancyColors.RESET}`, {
                    contest_id: contest.id,
                    wallet_address: participant.wallet_address,
                    tiebreak_metrics: {
                        profitable_trades: tiebreakStats.profitable_trades,
                        total_trades: tiebreakStats.total_trades,
                        win_rate: tiebreakStats.win_rate,
                        biggest_win: tiebreakStats.biggest_win.toString(),
                        avg_profit_per_trade: tiebreakStats.avg_profit_per_trade.toString(),
                        time_in_profitable_positions: tiebreakStats.time_in_profitable_positions,
                        earliest_profit_time: tiebreakStats.earliest_profit_time?.toISOString(),
                        total_profit: tiebreakStats.total_profit.toString()
                    },
                    timestamp: new Date().toISOString()
                });
            }

            // Log completion of tiebreak details logging
            logApi.info(`Completed logging tiebreak details for contest ${contest.id}`, {
                contest_id: contest.id,
                participant_count: resolvedParticipants.length
            });

            return true;
        } catch (error) {
            // Log the error
            logApi.error(`Failed to log tiebreak details for contest ${contest.id}:`, error);
            throw error;
        }
    }
}

// Create and export an instance of the service
const contestEvaluationService = new ContestEvaluationService();
export default contestEvaluationService;