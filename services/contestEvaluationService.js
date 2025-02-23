// services/contestEvaluationService.js

/*
 * The Contest Evaluation Service is responsible for starting, ending, and evaluating contests.
 * It also handles the logic for determining winners and distributing prizes to winners.
 * 
 */

// ** Service Auth **
import { generateServiceAuthHeader } from '../config/service-auth.js';
// ** Service Class **
import { BaseService } from '../utils/service-suite/base-service.js';
import { ServiceError, ServiceErrorTypes } from '../utils/service-suite/service-error.js';
import { config } from '../config/config.js';
import { logApi } from '../utils/logger-suite/logger.js';
import AdminLogger from '../utils/admin-logger.js';
import prisma from '../config/prisma.js';
// ** Service Manager **
import { ServiceManager } from '../utils/service-suite/service-manager.js';
// Solana
import crypto from 'crypto';
import bs58 from 'bs58';
import { Connection, PublicKey, Transaction, SystemProgram, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
// Other
import { Decimal } from '@prisma/client/runtime/library';
import { SERVICE_NAMES, getServiceMetadata } from '../utils/service-suite/service-constants.js';

const connection = new Connection(config.rpc_urls.primary, 'confirmed');

const CONTEST_EVALUATION_CONFIG = {
    name: SERVICE_NAMES.CONTEST_EVALUATION,
    description: getServiceMetadata(SERVICE_NAMES.CONTEST_EVALUATION).description,
    checkIntervalMs: 60 * 1000, // Check every minute
    maxRetries: 3,
    retryDelayMs: 5000,
    circuitBreaker: {
        failureThreshold: 5,
        resetTimeoutMs: 60000, // 1 minute timeout when circuit is open
        minHealthyPeriodMs: 120000 // 2 minutes of health before fully resetting
    },
    backoff: {
        initialDelayMs: 1000,
        maxDelayMs: 30000,
        factor: 2
    },
    prizeDistribution: {
        maxRetries: 3,
        retryDelayMs: 5000
    },
    refunds: {
        maxRetries: 3,
        retryDelayMs: 5000
    },
    autoCancelWindow: (0 * 24 * 60 * 60 * 1000) + (0 * 60 * 60 * 1000) + (1 * 60 * 1000) + (29 * 1000),  // 0 days, 0 hours, 1 minutes, and 29 seconds
    states: {
        PENDING: 'pending',
        ACTIVE: 'active',
        COMPLETED: 'completed',
        CANCELLED: 'cancelled'
    },
    platformFee: 0.10
};

// Contest Evaluation Service
class ContestEvaluationService extends BaseService {
    constructor() {
        super(CONTEST_EVALUATION_CONFIG.name, CONTEST_EVALUATION_CONFIG);
        
        // Service-specific state
        this.evaluationStats = {
            operations: {
                total: 0,
                successful: 0,
                failed: 0
            },
            performance: {
                average_operation_time_ms: 0,
                last_operation_time_ms: 0
            },
            contests: {
                total_evaluated: 0,
                successful_evaluations: 0,
                failed_evaluations: 0,
                prizes_distributed: 0,
                refunds_processed: 0
            },
            prizeDistribution: {
                total: 0,
                successful: 0,
                failed: 0,
                total_amount_distributed: new Decimal(0)
            },
            refunds: {
                total: 0,
                successful: 0,
                failed: 0,
                total_amount_refunded: new Decimal(0)
            },
            tieBreaks: {
                total: 0,
                resolved: 0,
                failed: 0
            }
        };
    }

    async initialize() {
        try {
            await super.initialize();
            
            // Load configuration from database
            const settings = await prisma.system_settings.findUnique({
                where: { key: this.name }
            });

            if (settings?.value) {
                const dbConfig = typeof settings.value === 'string' 
                    ? JSON.parse(settings.value)
                    : settings.value;

                this.config = {
                    ...this.config,
                    ...dbConfig,
                    circuitBreaker: {
                        ...this.config.circuitBreaker,
                        ...(dbConfig.circuitBreaker || {})
                    }
                };
            }

            // Ensure stats are JSON-serializable for ServiceManager
            const serializableStats = JSON.parse(JSON.stringify(this.stats));
            await ServiceManager.markServiceStarted(
                this.name,
                JSON.parse(JSON.stringify(this.config)),
                serializableStats
            );

            logApi.info('Contest Evaluation Service initialized');
            return true;
        } catch (error) {
            logApi.error('Contest Evaluation Service initialization error:', error);
            await this.handleError('initialize', error);
            throw error;
        }
    }

    // Utility functions
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

    async performBlockchainTransfer(contestWallet, recipientAddress, amount) {
        try {
            const decryptedPrivateKey = this.decryptPrivateKey(contestWallet.private_key);
            const privateKeyBytes = bs58.decode(decryptedPrivateKey);
            const fromKeypair = Keypair.fromSecretKey(privateKeyBytes);

            const transaction = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: fromKeypair.publicKey,
                    toPubkey: new PublicKey(recipientAddress),
                    lamports: Math.floor(amount * LAMPORTS_PER_SOL),
                })
            );

            const signature = await connection.sendTransaction(transaction, [fromKeypair]);
            await connection.confirmTransaction(signature);

            return signature;
        } catch (error) {
            throw ServiceError.blockchain('Blockchain transfer failed', {
                error: error.message,
                contestWallet: contestWallet.wallet_address,
                recipient: recipientAddress,
                amount
            });
        }
    }

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

                this.evaluationStats.prizeDistribution.successful++;
                this.evaluationStats.prizeDistribution.totalAmountDistributed = 
                    this.evaluationStats.prizeDistribution.totalAmountDistributed.add(prizeAmount);

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
                    this.evaluationStats.prizeDistribution.failed++;
                    throw error;
                }

                await new Promise(resolve => setTimeout(resolve, this.config.prizeDistribution.retryDelayMs));
            }
        }
        return false;
    }

    async getParticipantTiebreakStats(participant, contest) {
        const trades = await prisma.trades.findMany({
            where: {
                contest_id: contest.id,
                wallet_address: participant.wallet_address
            },
            orderBy: {
                created_at: 'asc'
            }
        });

        // Calculate various tie-breaking metrics
        let profitableTrades = 0;
        let totalTrades = trades.length;
        let biggestWin = new Decimal(0);
        let avgProfitPerTrade = new Decimal(0);
        let totalProfit = new Decimal(0);
        let timeInProfitablePositions = 0;
        let earliestProfitTime = null;

        for (let i = 0; i < trades.length; i++) {
            const trade = trades[i];
            const profit = trade.exit_value.sub(trade.entry_value);
            
            if (profit.gt(0)) {
                profitableTrades++;
                totalProfit = totalProfit.add(profit);
                biggestWin = profit.gt(biggestWin) ? profit : biggestWin;
                
                // Track time to first profit
                if (!earliestProfitTime && profit.gt(0)) {
                    earliestProfitTime = trade.created_at;
                }

                // Calculate time in profitable position
                if (trade.exit_time) {
                    timeInProfitablePositions += trade.exit_time.getTime() - trade.entry_time.getTime();
                }
            }
        }

        avgProfitPerTrade = totalTrades > 0 ? totalProfit.div(totalTrades) : new Decimal(0);

        return {
            wallet_address: participant.wallet_address,
            final_balance: participant.current_balance,
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

    async groupParticipantsByBalance(participants) {
        // Group participants by their current balance
        const balanceGroups = new Map();
        
        participants.forEach(participant => {
            const balanceKey = participant.current_balance.toString();
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

    async validateContestWalletBalance(contestWallet, totalPrizePool) {
        try {
            const balance = await connection.getBalance(new PublicKey(contestWallet.wallet_address));
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

    async validateTokenBalance(wallet, mint, amount) {
        try {
            const associatedTokenAddress = await getAssociatedTokenAddress(
                new PublicKey(mint),
                new PublicKey(wallet.wallet_address)
            );

            try {
                const tokenAccount = await getAccount(connection, associatedTokenAddress);
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

    async evaluateContest(contest) {
        try {
            // Get the contest's settings for payout structure
            const payout_structure = contest.settings?.payout_structure;

            if (!payout_structure) {
                throw new Error(`No payout structure found for contest ${contest.id}`);
            }

            // Get all participants ordered by performance
            const participants = await prisma.contest_participants.findMany({
                where: {
                    contest_id: contest.id
                },
                include: {
                    trades: {
                        orderBy: {
                            created_at: 'asc'
                        }
                    }
                }
            });

            if (participants.length === 0) {
                logApi.warn(`No participants found for contest ${contest.id}`);
                // Update contest status to indicate no participants
                await prisma.contests.update({
                    where: { id: contest.id },
                    data: { 
                        status: 'completed'
                    }
                });

                await AdminLogger.logAction(
                    'SYSTEM',
                    AdminLogger.Actions.CONTEST.END,
                    {
                        contest_id: contest.id,
                        reason: `${contest.contest_name} completed with no participants`
                    }
                );

                return {
                    status: 'completed',
                    message: 'Contest had no participants'
                };
            }

            // Check minimum participants requirement
            const minParticipants = contest.settings?.minimum_participants || 1;
            if (participants.length < minParticipants) {
                logApi.warn(`Insufficient participants for contest ${contest.id}. Required: ${minParticipants}, Got: ${participants.length}`);
                
                await prisma.contests.update({
                    where: { id: contest.id },
                    data: { 
                        status: 'cancelled',
                        cancellation_reason: `Contest cancelled due to insufficient participants (${participants.length}/${minParticipants})`
                    }
                });

                await AdminLogger.logAction(
                    'SYSTEM',
                    AdminLogger.Actions.CONTEST.CANCEL,
                    {
                        contest_id: contest.id,
                        required_participants: minParticipants,
                        actual_participants: participants.length,
                        reason: `Cancelled ${contest.contest_name} due to insufficient participants (${participants.length}/${minParticipants})`
                    }
                );

                return {
                    status: 'cancelled',
                    message: `Insufficient participants (${participants.length}/${minParticipants})`
                };
            }

            // Resolve any ties and get final ordered list
            const resolvedParticipants = await this.groupParticipantsByBalance(participants);

            // Store tie-break details for transparency
            const tieBreakDetails = [];
            let lastBalance = null;
            
            // Use Promise.all for parallel processing of tie-break stats
            const tieBreakPromises = [];
            resolvedParticipants.forEach((participant, index) => {
                if (lastBalance && participant.current_balance.eq(lastBalance)) {
                    tieBreakPromises.push(
                        this.getParticipantTiebreakStats(participant, contest)
                        .then(metrics => ({
                            wallet_address: participant.wallet_address,
                            rank: index + 1,
                            metrics
                        }))
                    );
                }
                lastBalance = participant.current_balance;
            });

            const tieBreakMetrics = await Promise.all(tieBreakPromises);
            tieBreakDetails.push(...tieBreakMetrics);

            if (tieBreakDetails.length > 0) {
                await prisma.contests.update({
                    where: { id: contest.id },
                    data: {
                        tie_break_details: tieBreakDetails
                    }
                });
            }

            // Get contest wallet and validate balance before proceeding
            const contestWallet = await prisma.contest_wallets.findUnique({
                where: { contest_id: contest.id }
            });

            if (!contestWallet) {
                throw new Error(`No wallet found for contest ${contest.id}`);
            }

            // Calculate actual prize pool after DegenDuel platform fee
            const platformFeePercentage = new Decimal(this.config.platformFee);
            const actualPrizePool = contest.prize_pool.mul(new Decimal('1').sub(platformFeePercentage));
            const platformFeeAmount = contest.prize_pool.mul(platformFeePercentage);

            // Calculate total prize pool needed
            let totalPrizeNeeded = new Decimal(0);
            for (let i = 1; i <= Math.min(3, participants.length); i++) {
                const placeKey = `place_${i}`;
                const prizePercentage = payout_structure[placeKey] || 0;
                totalPrizeNeeded = totalPrizeNeeded.add(actualPrizePool.mul(prizePercentage));
            }

            // Validate wallet has sufficient balance for prizes and platform fee
            const balanceValidation = await this.validateContestWalletBalance(
                contestWallet,
                totalPrizeNeeded.add(platformFeeAmount).toNumber()
            );

            logApi.info(`Contest wallet balance validated`, {
                contest_id: contest.id,
                wallet: contestWallet.wallet_address,
                actualPrizePool: actualPrizePool.toString(),
                platformFee: platformFeeAmount.toString(),
                ...balanceValidation
            });

            // If contest involves SPL tokens, validate those balances too
            if (contest.token_mint) {
                await this.validateTokenBalance(
                    contestWallet,
                    contest.token_mint,
                    totalPrizeNeeded.add(platformFeeAmount).toNumber()
                );
            }

            // Calculate and distribute prizes using resolved order
            const prizeDistributionResults = [];
            for (let i = 0; i < Math.min(3, resolvedParticipants.length); i++) {
                const participant = resolvedParticipants[i];
                const place = i + 1;
                const placeKey = `place_${place}`;
                const prizePercentage = payout_structure[placeKey] || 0;
                const prizeAmount = actualPrizePool.mul(prizePercentage);

                if (prizeAmount.gt(0)) {
                    try {
                        await this.distributePrizeWithRetry(participant, place, prizeAmount, contest);
                        prizeDistributionResults.push({
                            place,
                            wallet: participant.wallet_address,
                            amount: prizeAmount.toString(),
                            status: 'success'
                        });
                    } catch (error) {
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

            const autoTransfer = true;

            // After all prizes are distributed, attempt to transfer platform fee; if this fails, the rake service will collect it later
            if (autoTransfer) {
                try {
                    const masterWallet = config.master_wallet.address;
                    const platformFeeSignature = await this.performBlockchainTransfer(
                        contestWallet,
                        masterWallet,
                        platformFeeAmount.toNumber()
                    );

                    // Log the platform fee transaction
                    await prisma.transactions.create({
                        data: {
                            wallet_address: contestWallet.wallet_address,
                            type: config.transaction_types.PLATFORM_FEE,
                            amount: platformFeeAmount,
                            description: `Platform fee for contest ${contest.contest_code}`,
                            status: config.transaction_statuses.COMPLETED,
                            blockchain_signature: platformFeeSignature,
                            contest_id: contest.id,
                            completed_at: new Date(),
                            created_at: new Date()
                        }
                    });
                } catch (error) {
                    // Log the failed attempt to transfer platform fee, but continue with contest completion; the rake service will collect this fee later
                    logApi.warn(`Platform fee transfer failed! Hopefully the rake service will collect it later`, {
                        contest_id: contest.id,
                        amount: platformFeeAmount.toString(),
                        error: error.message
                    });
                }

                // Log the successful platform fee transfer
                logApi.info(`Platform fee transferred successfully`, {
                    contest_id: contest.id,
                    amount: platformFeeAmount.toString(),
                    signature: platformFeeSignature
                });

            } else {
                // Log the unattempted platform fee transfer, and continue with contest completion; the rake service will collect this fee later
                logApi.warn(`Deferring platform fee transfer to rake service`, {
                    contest_id: contest.id,
                    amount: platformFeeAmount.toString()
                });
            }

            // Update the contest status regardless of platform fee transfer
            await prisma.contests.update({
                where: { id: contest.id },
                data: { 
                    status: 'completed',
                    platform_fee_amount: platformFeeAmount
                }
            });

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

            // Log the successful contest evaluation
            logApi.info(`Contest ${contest.id} evaluated successfully`, {
                prizeDistributions: prizeDistributionResults,
                platformFee: platformFeeAmount.toString()
            });

            // Return the successful contest evaluation
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

    // Helper function to process refunds
    async processRefund(participant, contest, contestWallet) {
        try {
            // First create a pending refund transaction record
            const transaction = await prisma.transactions.create({
                data: {
                    wallet_address: participant.wallet_address,
                    type: config.transaction_types.CONTEST_REFUND,
                    amount: participant.entry_amount,
                    balance_before: participant.current_balance,
                    balance_after: participant.current_balance.add(participant.entry_amount),
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
                participant.entry_amount
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
                    refund_amount: participant.entry_amount,
                    refund_transaction_id: transaction.id
                }
            });

            return { success: true, signature };
        } catch (error) {
            logApi.error('Refund failed:', {
                error: error.message,
                participant: participant.wallet_address,
                contest: contest.id,
                amount: participant.entry_amount.toString()
            });
            throw error;
        }
    }

    // Process refunds for a cancelled contest
    async processContestRefunds(contest, adminAddress = null, context = {}) {
        try {
            if (adminAddress) {
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

            // Get contest wallet
            const contestWallet = await prisma.contest_wallets.findUnique({
                where: { contest_id: contest.id }
            });

            if (!contestWallet) {
                throw new Error(`No wallet found for contest ${contest.id}`);
            }

            // Get all participants
            const participants = await prisma.contest_participants.findMany({
                where: {
                    contest_id: contest.id,
                    refunded_at: null // Only those not yet refunded
                }
            });

            if (participants.length === 0) {
                logApi.info(`No participants to refund for contest ${contest.id}`);
                return { status: 'completed', refunded: 0 };
            }

            // Validate wallet has sufficient balance
            const totalRefundAmount = participants.reduce(
                (sum, p) => sum.add(p.entry_amount),
                new Decimal(0)
            );

            await this.validateContestWalletBalance(contestWallet, totalRefundAmount.toNumber());

            // Log the contest refund validation
            logApi.info(`Contest wallet balance validated as sufficient for refunds`, {
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

            this.evaluationStats.refundsProcessed++;
            return {
                status: 'completed',
                refunded: results.filter(r => r.status === 'success').length,
                failed: results.filter(r => r.status === 'failed').length,
                results
            };
        } catch (error) {
            logApi.error('Failed to process contest refunds:', error);
            throw error;
        }
    }

    // Main operation implementation
    async performOperation() {
        const startTime = Date.now();
        
        try {
            const now = new Date();

            // Find and process contests that should start
            const contestsToStart = await this.findContestsToStart(now);
            for (const contest of contestsToStart) {
                await this.processContestStart(contest);
            }

            // Find and process contests that should end
            const contestsToEnd = await this.findContestsToEnd(now);
            for (const contest of contestsToEnd) {
                await this.evaluateContest(contest);
            }

            // Update performance metrics
            this.evaluationStats.performance.last_operation_time_ms = Date.now() - startTime;
            this.evaluationStats.performance.average_operation_time_ms = 
                (this.evaluationStats.performance.average_operation_time_ms * this.evaluationStats.operations.total + 
                (Date.now() - startTime)) / (this.evaluationStats.operations.total + 1);

            // Update ServiceManager state
            await ServiceManager.updateServiceHeartbeat(
                this.name,
                this.config,
                {
                    ...this.stats,
                    evaluationStats: this.evaluationStats
                }
            );

            return {
                duration: Date.now() - startTime,
                contestsStarted: contestsToStart.length,
                contestsEnded: contestsToEnd.length
            };
        } catch (error) {
            // Let base class handle circuit breaker
            throw error;
        }
    }

    async stop() {
        try {
            await super.stop();
            logApi.info('Contest Evaluation Service stopped successfully');
        } catch (error) {
            logApi.error('Error stopping Contest Evaluation Service:', error);
            throw error;
        }
    }

    // Helper methods for performOperation
    async findContestsToStart(now) {
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

    async findContestsToEnd(now) {
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

    async processContestStart(contest) {
        const minParticipants = contest.settings?.minimum_participants || 1;
        
        if (contest.contest_participants.length >= minParticipants) {
            await this.startContest(contest);
        } else if (contest.contest_participants.length === 0) {
            await this.cancelContestNoParticipants(contest);
        } else if (contest.start_time < new Date(Date.now() - this.config.autoCancelWindow)) {
            await this.cancelContestInsufficientParticipants(contest);
        }
    }

    // Admin operations
    async manuallyEvaluateContest(contestId, adminAddress, context = {}) {
        try {
            const contest = await prisma.contests.findUnique({
                where: { id: contestId },
                include: { participants: true }
            });

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

            return {
                success: true,
                message: 'Contest evaluated successfully'
            };
        } catch (error) {
            logApi.error('Manual contest evaluation failed:', error);
            throw error;
        }
    }
}

// Create singleton instance
const contestEvaluationService = new ContestEvaluationService();

// Export the service instance and maintain backward compatibility
const exportedService = {
    startContestEvaluationService: async () => {
        await contestEvaluationService.initialize();
        await contestEvaluationService.start();
        return contestEvaluationService;
    },
    stopContestEvaluationService: async () => {
        await contestEvaluationService.stop();
    },
    processContestRefunds: async (contest) => {
        return contestEvaluationService.processContestRefunds(contest);
    },
    service: contestEvaluationService
};

export default exportedService;



//// -------------------------------------
//// Export service singleton
////export default contestEvaluationService;
