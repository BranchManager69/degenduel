// services/contestEvaluationService.js

/*
 *
 * The Contest Evaluation Service is responsible for starting, ending, and evaluating contests.
 * It also handles the logic for determining winners and distributing prizes to winners.
 * 
 */

import { PrismaClient } from '@prisma/client';
import { logApi } from '../utils/logger-suite/logger.js';
import { Connection, PublicKey, Transaction, SystemProgram, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { config } from '../config/config.js';
import crypto from 'crypto';
import bs58 from 'bs58';
import { Decimal } from '@prisma/client/runtime/library';
import { TOKEN_PROGRAM_ID, createAssociatedTokenAccountInstruction, getAssociatedTokenAddress, getAccount } from '@solana/spl-token';

const prisma = new PrismaClient();
const connection = new Connection(config.rpc_urls.primary, 'confirmed');

const MAX_PRIZE_DISTRIBUTION_RETRIES = 3;
const PRIZE_RETRY_DELAY = 5000; // 5 seconds

// Constants for contest state management
const CONTEST_STATES = {
    PENDING: 'pending',
    ACTIVE: 'active',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled'
};

const REFUND_RETRY_DELAY = 5000; // 5 seconds between refund attempts
const MAX_REFUND_RETRIES = 3;
const AUTO_CANCEL_WINDOW = 3 * 24 * 60 * 60 * 1000; // 3 days in milliseconds

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Decrypt contest wallet private key
function decryptPrivateKey(encryptedData) {
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
        logApi.error('Failed to decrypt private key:', error);
        throw error;
    }
}

// Perform blockchain transfer
async function performBlockchainTransfer(contestWallet, recipientAddress, amount) {
    try {
        // Decrypt private key and create keypair
        const decryptedPrivateKey = decryptPrivateKey(contestWallet.private_key);
        const privateKeyBytes = bs58.decode(decryptedPrivateKey);
        const fromKeypair = Keypair.fromSecretKey(privateKeyBytes);

        // Create and send transaction
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
        logApi.error('Blockchain transfer failed:', error);
        throw error;
    }
}

async function distributePrizeWithRetry(participant, place, prizeAmount, contest) {
    for (let attempt = 1; attempt <= MAX_PRIZE_DISTRIBUTION_RETRIES; attempt++) {
        let transaction;
        try {
            // Get contest wallet
            const contestWallet = await prisma.contest_wallets.findUnique({
                where: { contest_id: contest.id }
            });

            if (!contestWallet) {
                throw new Error(`No wallet found for contest ${contest.id}`);
            }

            // First create a pending transaction record
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
                    user_id: participant.user_id // Link to user if available
                }
            });

            // Perform the blockchain transaction
            const signature = await performBlockchainTransfer(
                contestWallet,
                participant.wallet_address,
                prizeAmount
            );
            
            // Update transaction with blockchain signature and completed status
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
                    final_rank: place,
                    prize_amount: prizeAmount,
                    prize_paid_at: new Date()
                }
            });

            logApi.info(`Successfully distributed prize for place ${place}`, {
                contest_id: contest.id,
                wallet: participant.wallet_address,
                amount: prizeAmount.toString(),
                signature,
                attempt
            });
            
            return true;
        } catch (error) {
            // Log failed transaction if it exists
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

            logApi.error(`Prize distribution failed (attempt ${attempt}/${MAX_PRIZE_DISTRIBUTION_RETRIES})`, {
                error: error.message,
                contest_id: contest.id,
                wallet: participant.wallet_address,
                place,
                amount: prizeAmount.toString()
            });

            if (attempt === MAX_PRIZE_DISTRIBUTION_RETRIES) {
                throw error;
            }

            await sleep(PRIZE_RETRY_DELAY);
        }
    }
    return false;
}

async function getParticipantTiebreakStats(participant, contest) {
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

async function resolveTies(tiedParticipants, contest) {
    // Get detailed stats for all tied participants
    const participantStats = await Promise.all(
        tiedParticipants.map(p => getParticipantTiebreakStats(p, contest))
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

async function groupParticipantsByBalance(participants) {
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
            const resolvedGroup = await resolveTies(group, group[0].contest_id);
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

async function validateContestWalletBalance(contestWallet, totalPrizePool) {
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

async function validateTokenBalance(wallet, mint, amount) {
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

async function evaluateContest(contest) {
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
                    status: 'completed',
                    notes: 'Contest completed with no participants'
                }
            });
            return {
                status: 'completed',
                message: 'Contest had no participants'
            };
        }

        // Check minimum participants requirement (if specified in contest settings)
        const minParticipants = contest.settings?.minimum_participants || 1;
        if (participants.length < minParticipants) {
            logApi.warn(`Insufficient participants for contest ${contest.id}. Required: ${minParticipants}, Got: ${participants.length}`);
            // Update contest status to indicate insufficient participants
            await prisma.contests.update({
                where: { id: contest.id },
                data: { 
                    status: 'cancelled',
                    notes: `Contest cancelled due to insufficient participants (${participants.length}/${minParticipants})`
                }
            });
            return {
                status: 'cancelled',
                message: `Insufficient participants (${participants.length}/${minParticipants})`
            };
        }

        // Resolve any ties and get final ordered list
        const resolvedParticipants = await groupParticipantsByBalance(participants);

        // Store tie-break details for transparency
        const tieBreakDetails = [];
        let lastBalance = null;
        
        // Use Promise.all for parallel processing of tie-break stats
        const tieBreakPromises = [];
        resolvedParticipants.forEach((participant, index) => {
            if (lastBalance && participant.current_balance.eq(lastBalance)) {
                tieBreakPromises.push(
                    getParticipantTiebreakStats(participant, contest)
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

        // Calculate actual prize pool after platform fee (10%)
        const platformFeePercentage = new Decimal('0.10'); // 10%
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
        const balanceValidation = await validateContestWalletBalance(
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
            await validateTokenBalance(
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
                    await distributePrizeWithRetry(participant, place, prizeAmount, contest);
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

        // After all prizes are distributed, attempt to transfer platform fee
        // If this fails, the rake service will collect it later
        try {
            const masterWallet = config.master_wallet.address;
            const platformFeeSignature = await performBlockchainTransfer(
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

            logApi.info(`Platform fee transferred successfully`, {
                contest_id: contest.id,
                amount: platformFeeAmount.toString(),
                signature: platformFeeSignature
            });
        } catch (error) {
            // Log the failed attempt but continue with contest completion
            // The rake service will collect this fee later
            logApi.warn(`Platform fee transfer deferred to rake service`, {
                contest_id: contest.id,
                amount: platformFeeAmount.toString(),
                error: error.message
            });

            await prisma.transactions.create({
                data: {
                    wallet_address: contestWallet.wallet_address,
                    type: config.transaction_types.PLATFORM_FEE,
                    amount: platformFeeAmount,
                    description: `Deferred platform fee for contest ${contest.contest_code}`,
                    status: config.transaction_statuses.PENDING,
                    error_details: JSON.stringify(error),
                    contest_id: contest.id,
                    created_at: new Date()
                }
            });
        }

        // Update the contest status - we complete it regardless of platform fee transfer
        await prisma.contests.update({
            where: { id: contest.id },
            data: { 
                status: 'completed',
                notes: prizeDistributionResults.some(r => r.status === 'failed') 
                    ? 'Completed with some prize distribution failures'
                    : 'Completed successfully',
                platform_fee_amount: platformFeeAmount
            }
        });

        logApi.info(`Contest ${contest.id} evaluated successfully`, {
            prizeDistributions: prizeDistributionResults,
            platformFee: platformFeeAmount.toString()
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

// Helper function to process refunds
async function processRefund(participant, contest, contestWallet) {
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
        const signature = await performBlockchainTransfer(
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
async function processContestRefunds(contest) {
    try {
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

        await validateContestWalletBalance(contestWallet, totalRefundAmount.toNumber());

        // Process refunds with retries
        const results = [];
        for (const participant of participants) {
            let retries = 0;
            while (retries < MAX_REFUND_RETRIES) {
                try {
                    const result = await processRefund(participant, contest, contestWallet);
                    results.push({
                        wallet: participant.wallet_address,
                        amount: participant.entry_amount.toString(),
                        status: 'success',
                        signature: result.signature
                    });
                    break;
                } catch (error) {
                    retries++;
                    if (retries === MAX_REFUND_RETRIES) {
                        results.push({
                            wallet: participant.wallet_address,
                            amount: participant.entry_amount.toString(),
                            status: 'failed',
                            error: error.message
                        });
                    } else {
                        await sleep(REFUND_RETRY_DELAY);
                    }
                }
            }
        }

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

// Check and update contest states
async function updateContestStates() {
    const now = new Date();

    try {
        // Find contests that should start
        const contestsToStart = await prisma.contests.findMany({
            where: {
                status: CONTEST_STATES.PENDING,
                start_time: {
                    lte: now
                }
            },
            include: {
                contest_participants: true
            }
        });

        // Start contests that meet criteria
        for (const contest of contestsToStart) {
            const minParticipants = contest.settings?.minimum_participants || 1;
            
            if (contest.contest_participants.length >= minParticipants) {
                await prisma.contests.update({
                    where: { id: contest.id },
                    data: { 
                        status: CONTEST_STATES.ACTIVE,
                        started_at: now,
                        notes: `Contest started automatically with ${contest.contest_participants.length} participants`
                    }
                });

                logApi.info(`Contest ${contest.id} started automatically`);
            } else if (contest.start_time < new Date(now.getTime() - AUTO_CANCEL_WINDOW)) {
                // Auto-cancel contests that didn't meet min participants after 3 days
                await prisma.contests.update({
                    where: { id: contest.id },
                    data: { 
                        status: CONTEST_STATES.CANCELLED,
                        notes: `Contest auto-cancelled due to insufficient participants (${contest.contest_participants.length}/${minParticipants}) after 3 days`
                    }
                });

                // Process refunds for cancelled contest
                await processContestRefunds(contest);
                
                logApi.info(`Contest ${contest.id} auto-cancelled and refunds processed`);
            }
        }

        // Find contests that should end
        const contestsToEnd = await prisma.contests.findMany({
            where: {
                status: CONTEST_STATES.ACTIVE,
                end_time: {
                    lte: now
                }
            },
            include: {
                contest_wallets: true,
                contest_participants: true
            }
        });

        // End and evaluate contests
        for (const contest of contestsToEnd) {
            await evaluateContest(contest);
        }

    } catch (error) {
        logApi.error('Failed to update contest states:', error);
        throw error;
    }
}

// Update startContestEvaluationService to include state management
async function startContestEvaluationService() {
    try {
        // Set system_settings table key 'contest_evaluation_service_running' to true
        await prisma.system_settings.upsert({
            where: { key: 'contest_evaluation_service_running' },
            update: {
                value: JSON.stringify(true),
                updated_at: new Date()
            },
            create: {
                key: 'contest_evaluation_service_running',
                value: JSON.stringify(true),
                description: 'Indicates if the contest evaluation service is running',
                updated_at: new Date()
            }
        });

        // Start periodic checks (every minute)
        setInterval(async () => {
            try {
                await updateContestStates();
            } catch (error) {
                logApi.error('Error in contest state update interval:', error);
            }
        }, 60 * 1000);

        logApi.info('Contest Evaluation Service started successfully');
    } catch (error) {
        logApi.error(`Contest Evaluation Service failed to start: ${error.message}`);
        throw error;
    }
}

async function stopContestEvaluationService() {
    try {
        const result = await prisma.system_settings.update({
            where: { key: 'contest_evaluation_service_running' },
            data: {
                value: JSON.stringify(false),
                updated_at: new Date()
            }
        });

        logApi.info('Contest Evaluation Service stopped');
        return result;
    } catch (error) {
        logApi.error(`Failed to stop Contest Evaluation Service: ${error.message}`);
        throw error;
    }
}

// Export additional functions
export default {
    startContestEvaluationService,
    stopContestEvaluationService,
    processContestRefunds // Export for manual admin use
};

