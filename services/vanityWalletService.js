import { PrismaClient } from '@prisma/client';
import { logApi } from '../utils/logger-suite/logger.js';
import crypto from 'crypto';

const prisma = new PrismaClient();

class VanityWalletService {
    // Get an available vanity wallet, prioritizing specific patterns if requested
    static async getAvailableWallet(preferredPattern = null) {
        try {
            const wallet = await prisma.vanity_wallet_pool.findFirst({
                where: {
                    is_used: false,
                    ...(preferredPattern ? { pattern: preferredPattern } : {})
                },
                orderBy: {
                    created_at: 'asc' // Use oldest wallets first
                }
            });

            return wallet;
        } catch (error) {
            logApi.error('Failed to get available vanity wallet:', error);
            return null;
        }
    }

    // Mark a wallet as used by a contest
    static async assignWalletToContest(walletId, contestId) {
        try {
            return await prisma.vanity_wallet_pool.update({
                where: { id: walletId },
                data: {
                    is_used: true,
                    used_at: new Date(),
                    used_by_contest: contestId
                }
            });
        } catch (error) {
            logApi.error('Failed to assign vanity wallet to contest:', error);
            throw error;
        }
    }

    // Add new wallets to the pool
    static async addToPool(wallets) {
        try {
            const results = await prisma.$transaction(
                wallets.map(wallet => 
                    prisma.vanity_wallet_pool.create({
                        data: {
                            wallet_address: wallet.address,
                            private_key: wallet.privateKey,
                            pattern: wallet.pattern
                        }
                    })
                )
            );

            logApi.info(`Added ${results.length} vanity wallets to pool`, {
                patterns: results.map(w => w.pattern)
            });

            return results;
        } catch (error) {
            logApi.error('Failed to add vanity wallets to pool:', error);
            throw error;
        }
    }

    // Get pool statistics
    static async getPoolStats() {
        try {
            const stats = await prisma.$transaction([
                // Total wallets
                prisma.vanity_wallet_pool.count(),
                // Available wallets
                prisma.vanity_wallet_pool.count({
                    where: { is_used: false }
                }),
                // Stats by pattern
                prisma.vanity_wallet_pool.groupBy({
                    by: ['pattern'],
                    _count: true,
                    where: { is_used: false }
                })
            ]);

            return {
                total_wallets: stats[0],
                available_wallets: stats[1],
                available_by_pattern: stats[2].reduce((acc, curr) => ({
                    ...acc,
                    [curr.pattern]: curr._count
                }), {})
            };
        } catch (error) {
            logApi.error('Failed to get vanity wallet pool stats:', error);
            throw error;
        }
    }
}

export default VanityWalletService; 