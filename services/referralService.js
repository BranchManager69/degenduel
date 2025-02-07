// /services/referralService.js

import { PrismaClient } from '@prisma/client';
import { logApi } from '../utils/logger-suite/logger.js';

const prisma = new PrismaClient();

class ReferralService {
    // Reward amounts in DUEL tokens (placeholders; adjust as needed)
    static SIGNUP_BONUS = 100;
    static CONTEST_BONUS = 50;
    static MIN_CONTESTS_FOR_QUALIFICATION = 1;

    /**
     * Check and update referral qualification status when a user joins a contest
     */
    static async checkContestQualification(wallet_address) {
        try {
            // Find pending referral for this user
            const referral = await prisma.referrals.findFirst({
                where: {
                    referred_id: wallet_address,
                    status: 'pending'
                }
            });

            if (!referral) return;

            // Count user's contests
            const contestCount = await prisma.contest_participants.count({
                where: {
                    wallet_address: wallet_address
                }
            });

            // If user has joined enough contests, qualify the referral
            if (contestCount >= this.MIN_CONTESTS_FOR_QUALIFICATION) {
                await this.qualifyReferral(referral.id);
            }
        } catch (error) {
            logApi.error('Error in checkContestQualification:', error);
        }
    }

    /**
     * Update referral status to qualified and issue signup bonus
     */
    static async qualifyReferral(referralId) {
        try {
            const referral = await prisma.referrals.findUnique({
                where: { id: referralId }
            });

            if (!referral || referral.status !== 'pending') return;

            // Start a transaction to ensure all updates happen together
            await prisma.$transaction(async (tx) => {
                // Update referral status
                await tx.referrals.update({
                    where: { id: referralId },
                    data: {
                        status: 'qualified',
                        qualified_at: new Date()
                    }
                });

                // Create signup bonus transaction
                const transaction = await tx.transactions.create({
                    data: {
                        wallet_address: referral.referrer_id,
                        type: 'REFERRAL_BONUS',
                        amount: this.SIGNUP_BONUS,
                        description: 'Referral signup bonus',
                        status: 'completed'
                    }
                });

                // Record the reward
                await tx.referral_rewards.create({
                    data: {
                        wallet_address: referral.referrer_id,
                        reward_type: 'signup_bonus',
                        amount: this.SIGNUP_BONUS,
                        description: 'Signup bonus for qualified referral',
                        transaction_id: transaction.id,
                        paid_at: new Date()
                    }
                });

                // Update referral with reward info
                await tx.referrals.update({
                    where: { id: referralId },
                    data: {
                        status: 'rewarded',
                        reward_paid_at: new Date(),
                        reward_amount: this.SIGNUP_BONUS
                    }
                });
            });

            logApi.info('Referral qualified and rewarded:', {
                referralId,
                amount: this.SIGNUP_BONUS
            });
        } catch (error) {
            logApi.error('Error in qualifyReferral:', error);
        }
    }

    /**
     * Award contest bonus when referred user performs well
     */
    static async awardContestBonus(wallet_address, contest_id) {
        try {
            // Find active referral for this user
            const referral = await prisma.referrals.findFirst({
                where: {
                    referred_id: wallet_address,
                    status: 'rewarded'
                }
            });

            if (!referral) return;

            // Check if user placed in top 3
            const participant = await prisma.contest_participants.findFirst({
                where: {
                    wallet_address,
                    contest_id,
                    final_rank: {
                        lte: 3
                    }
                }
            });

            if (!participant) return;

            // Award contest bonus to referrer
            await prisma.$transaction(async (tx) => {
                // Create bonus transaction
                const transaction = await tx.transactions.create({
                    data: {
                        wallet_address: referral.referrer_id,
                        type: 'REFERRAL_BONUS',
                        amount: this.CONTEST_BONUS,
                        description: 'Referral contest bonus',
                        status: 'completed'
                    }
                });

                // Record the reward
                await tx.referral_rewards.create({
                    data: {
                        wallet_address: referral.referrer_id,
                        reward_type: 'contest_bonus',
                        amount: this.CONTEST_BONUS,
                        description: `Contest bonus for referred user placing ${participant.final_rank}${participant.final_rank === 1 ? 'st' : participant.final_rank === 2 ? 'nd' : 'rd'}`,
                        transaction_id: transaction.id,
                        paid_at: new Date()
                    }
                });
            });

            logApi.info('Contest bonus awarded:', {
                referralId: referral.id,
                contestId: contest_id,
                amount: this.CONTEST_BONUS
            });
        } catch (error) {
            logApi.error('Error in awardContestBonus:', error);
        }
    }

    /**
     * Check for expired referrals and update their status
     */
    static async checkExpiredReferrals() {
        try {
            const expirationDays = 30; // Referrals expire after 30 days if not qualified
            const expirationDate = new Date();
            expirationDate.setDate(expirationDate.getDate() - expirationDays);

            await prisma.referrals.updateMany({
                where: {
                    status: 'pending',
                    created_at: {
                        lt: expirationDate
                    }
                },
                data: {
                    status: 'expired'
                }
            });
        } catch (error) {
            logApi.error('Error in checkExpiredReferrals:', error);
        }
    }
}

export default ReferralService; 