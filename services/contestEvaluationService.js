// services/contestEvaluationService.js

/*
 *
 * The Contest Evaluation Service is responsible for starting, ending, and evaluating contests.
 * It also handles the logic for determining winners and distributing prizes to winners.
 * 
 */

import { PrismaClient } from '@prisma/client';
import { logApi } from '../utils/logger-suite/logger.js';

const prisma = new PrismaClient();

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
            orderBy: {
                current_balance: 'desc'
            }
        });

        if (participants.length === 0) {
            throw new Error(`No participants found for contest ${contest.id}`);
        }

        // Calculate and distribute prizes
        for (let i = 0; i < Math.min(3, participants.length); i++) {
            const participant = participants[i];
            const place = i + 1;
            const placeKey = `place_${place}`;
            const prizePercentage = payout_structure[placeKey] || 0;
            const prizeAmount = contest.prize_pool.mul(prizePercentage);

            if (prizeAmount.gt(0)) {
                // Create prize transaction
                await prisma.transactions.create({
                    data: {
                        wallet_address: participant.wallet_address,
                        type: 'PRIZE_PAYOUT',
                        amount: prizeAmount,
                        balance_before: participant.current_balance,
                        balance_after: participant.current_balance.add(prizeAmount),
                        contest_id: contest.id,
                        description: `Prize payout for ${place}${place === 1 ? 'st' : place === 2 ? 'nd' : 'rd'} place in contest ${contest.contest_code}`,
                        status: 'completed'
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
            }
        }

        // Update the contest status
        await prisma.contests.update({
            where: { id: contest.id },
            data: { status: 'completed' }
        });

        logApi.info(`Contest ${contest.id} evaluated successfully`);

        return {
            status: 'success',
            message: `Contest ${contest.id} evaluated and prizes distributed`
        };
    } catch (error) {
        logApi.error(`Failed to evaluate contest ${contest.id}: ${error.message}`);
        throw error;
    }
}

async function startContestEvaluationService() {
    try {
        // Set system_settings table key 'contest_evaluation_service_running' to true
        const result = await prisma.system_settings.upsert({
            where: { key: 'contest_evaluation_service_running' },
            update: {
                value: true,
                updated_at: new Date()
            },
            create: {
                key: 'contest_evaluation_service_running',
                value: true,
                description: 'Indicates if the contest evaluation service is running',
                updated_at: new Date()
            }
        });

        // Check all contests that have ended
        const contests = await prisma.contests.findMany({
            where: {
                status: 'active',
                end_time: {
                    lte: new Date()
                }
            }
        });

        if (contests.length === 0) {
            logApi.info('No contests to evaluate');
            return;
        }

        // Evaluate each contest
        for (const contest of contests) {
            await evaluateContest(contest);
        }
        
        logApi.info('Contest Evaluation Service completed successfully');
    } catch (error) {
        logApi.error(`Contest Evaluation Service failed: ${error.message}`);
        throw error;
    }
}

async function stopContestEvaluationService() {
    try {
        const result = await prisma.system_settings.update({
            where: { key: 'contest_evaluation_service_running' },
            data: {
                value: false,
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

// Export both functions
export default {
    startContestEvaluationService,
    stopContestEvaluationService
};

