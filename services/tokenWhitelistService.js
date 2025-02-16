import { BaseService } from '../utils/service-suite/base-service.js';
import { ServiceError } from '../utils/service-suite/service-error.js';
import { logApi } from '../utils/logger-suite/logger.js';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { fetchDigitalAsset, mplTokenMetadata } from "@metaplex-foundation/mpl-token-metadata";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { publicKey } from "@metaplex-foundation/umi";
import prisma from '../config/prisma.js';
import { Decimal } from 'decimal.js';

const WHITELIST_SERVICE_CONFIG = {
    name: 'token_whitelist_service',
    checkIntervalMs: 1 * 30 * 1000,  // Check every 30 seconds
    maxRetries: 3,
    retryDelayMs: 30000,
    circuitBreaker: {
        failureThreshold: 5,
        resetTimeoutMs: 60000,
        minHealthyPeriodMs: 120000
    }
};

class TokenWhitelistService extends BaseService {
    constructor() {
        super(WHITELIST_SERVICE_CONFIG.name, WHITELIST_SERVICE_CONFIG);
        this.connection = new Connection(process.env.SOLANA_RPC_ENDPOINT);
        this.treasuryWallet = new PublicKey(process.env.TREASURY_WALLET);
        this.submissionCost = parseFloat(process.env.TOKEN_SUBMISSION_COST || "0.01") * LAMPORTS_PER_SOL;
        this.umi = createUmi(process.env.SOLANA_RPC_ENDPOINT).use(mplTokenMetadata());
    }

    async getUserLevelDiscount(userId) {
        try {
            const userStats = await prisma.user_stats.findUnique({
                where: { user_id: userId },
                select: { level: true }
            });

            if (!userStats || !userStats.level) {
                return 0; // No discount if no level found
            }

            // 1% discount per level
            return userStats.level;
        } catch (error) {
            logApi.error('Failed to get user level:', {
                userId,
                error: error.message
            });
            return 0; // No discount on error
        }
    }

    async calculateSubmissionCost(user) {
        // Base cost: 0.01 SOL for super admins, 1 SOL for others
        const baseCost = user.role === 'SUPER_ADMIN' ? 
            0.01 * LAMPORTS_PER_SOL : 
            1 * LAMPORTS_PER_SOL;

        // Get level-based discount percentage
        const discountPercent = await this.getUserLevelDiscount(user.id);
        
        // Calculate final cost with discount
        const discount = (discountPercent / 100) * baseCost;
        const finalCost = baseCost - discount;

        return Math.max(finalCost, 0); // Ensure we don't go negative
    }

    async verifyToken(contractAddress) {
        try {
            // Validate address format
            const pubkey = new PublicKey(contractAddress);
            
            // Check if token already exists
            const existingToken = await prisma.tokens.findUnique({
                where: { address: contractAddress }
            });

            if (existingToken) {
                throw new ServiceError('Token already whitelisted');
            }

            // Fetch and validate token metadata
            const asset = await fetchDigitalAsset(this.umi, publicKey(contractAddress));
            
            if (!asset) {
                throw new ServiceError('Token metadata not found');
            }

            // Basic validation of metadata
            if (!asset.metadata.name || !asset.metadata.symbol) {
                throw new ServiceError('Invalid token metadata');
            }

            return {
                name: asset.metadata.name,
                symbol: asset.metadata.symbol,
                // You can add more metadata fields as needed
                uri: asset.metadata.uri || null
            };
        } catch (error) {
            logApi.error('Token verification failed:', {
                contractAddress,
                error: error.message
            });
            
            if (error instanceof ServiceError) {
                throw error;
            }
            
            throw new ServiceError('Invalid token address');
        }
    }

    async verifyPayment(signature, walletAddress, user) {
        try {
            const tx = await this.connection.getTransaction(signature, {
                commitment: 'confirmed'
            });

            if (!tx) {
                throw new ServiceError('Transaction not found');
            }

            // Calculate required amount based on user role and level
            const requiredAmount = await this.calculateSubmissionCost(user);

            // Verify payment amount and recipient
            const transfer = tx.transaction.message.instructions.find(ix => 
                ix.program === 'system' && 
                ix.parsed.type === 'transfer'
            );

            if (!transfer) {
                throw new ServiceError('No transfer instruction found');
            }

            if (transfer.parsed.info.destination !== this.treasuryWallet.toString()) {
                throw new ServiceError('Invalid payment recipient');
            }

            if (transfer.parsed.info.lamports < requiredAmount) {
                const required = requiredAmount / LAMPORTS_PER_SOL;
                const provided = transfer.parsed.info.lamports / LAMPORTS_PER_SOL;
                throw new ServiceError(`Insufficient payment amount. Required: ${required} SOL, Provided: ${provided} SOL`);
            }

            // Log the transaction
            await prisma.transactions.create({
                data: {
                    wallet_address: walletAddress,
                    type: 'DEPOSIT',
                    amount: new Decimal(transfer.parsed.info.lamports.toString()),
                    balance_before: new Decimal(0), // We don't track SOL balance
                    balance_after: new Decimal(0),  // We don't track SOL balance
                    description: 'Token whitelist submission fee',
                    status: 'completed',
                    metadata: {
                        signature,
                        token_submission: true,
                        lamports: transfer.parsed.info.lamports,
                        treasury_wallet: this.treasuryWallet.toString(),
                        user_level_discount: await this.getUserLevelDiscount(user.id),
                        required_amount: requiredAmount,
                        user_role: user.role
                    },
                    processed_at: new Date()
                }
            });

            return true;
        } catch (error) {
            logApi.error('Payment verification failed:', {
                signature,
                error: error.message
            });
            throw error;
        }
    }

    async addToWhitelist(contractAddress, metadata) {
        try {
            const token = await prisma.tokens.create({
                data: {
                    address: contractAddress,
                    name: metadata.name,
                    symbol: metadata.symbol,
                    is_active: true,
                    created_at: new Date()
                }
            });

            logApi.info('Token added to whitelist:', {
                contractAddress,
                tokenId: token.id
            });

            return token;
        } catch (error) {
            logApi.error('Failed to add token to whitelist:', {
                contractAddress,
                error: error.message
            });
            throw new ServiceError('Failed to add token to whitelist');
        }
    }

    async removeFromWhitelist(contractAddress, adminId, reason) {
        try {
            // Verify token exists
            const token = await prisma.tokens.findUnique({
                where: { address: contractAddress }
            });

            if (!token) {
                throw new ServiceError('Token not found in whitelist');
            }

            // Remove token
            await prisma.tokens.delete({
                where: { address: contractAddress }
            });

            // Log admin action
            logApi.info('Token removed from whitelist:', {
                contractAddress,
                adminId,
                reason,
                tokenId: token.id,
                tokenName: token.name,
                tokenSymbol: token.symbol
            });

            return token;
        } catch (error) {
            logApi.error('Failed to remove token from whitelist:', {
                contractAddress,
                adminId,
                error: error.message
            });
            throw new ServiceError('Failed to remove token from whitelist');
        }
    }
}

export const tokenWhitelistService = new TokenWhitelistService(); 