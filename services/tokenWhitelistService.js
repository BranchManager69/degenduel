// services/tokenWhitelistService.js

/*
 * This service is responsible for managing the token whitelist.
 * It allows the admin to add and remove tokens from the whitelist.
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
////import { CircuitBreaker } from '../utils/circuit-breaker.js';
// ** Service Manager (?) **
import { ServiceManager } from '../utils/service-suite/service-manager.js';
// Solana
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { fetchDigitalAsset, mplTokenMetadata } from "@metaplex-foundation/mpl-token-metadata";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { publicKey } from "@metaplex-foundation/umi";
// Other
import { Decimal } from 'decimal.js';
import { SERVICE_NAMES, getServiceMetadata } from '../utils/service-suite/service-constants.js';

const TOKEN_WHITELIST_CONFIG = {
    name: SERVICE_NAMES.TOKEN_WHITELIST,
    description: getServiceMetadata(SERVICE_NAMES.TOKEN_WHITELIST).description,
    checkIntervalMs: 5 * 60 * 1000, // Check every 5 minutes
    maxRetries: 3,
    retryDelayMs: 5000,
    circuitBreaker: {
        failureThreshold: 5,
        resetTimeoutMs: 60000, // 1 minute timeout when circuit is open
        minHealthyPeriodMs: 120000 // 2 minutes of health before fully resetting
    }
};
// extra config
const SOLANA_RPC_ENDPOINT = config.rpc_urls.primary;
const DEGENDUAL_TREASURY_WALLET = config.degendual_treasury_wallet;
const TOKEN_SUBMISSION_COST = config.token_submission_cost;
const TOKEN_SUBMISSION_DISCOUNT_PERCENTAGE_PER_LEVEL = config.token_submission_discount_percentage_per_level;

// Token Whitelist Service
class TokenWhitelistService extends BaseService {
    constructor() {
        super(TOKEN_WHITELIST_CONFIG.name, TOKEN_WHITELIST_CONFIG);
        this.connection = new Connection(SOLANA_RPC_ENDPOINT);
        this.treasuryWallet = new PublicKey(DEGENDUAL_TREASURY_WALLET);
        this.submissionCost = parseFloat(TOKEN_SUBMISSION_COST) * LAMPORTS_PER_SOL;
        this.umi = createUmi(SOLANA_RPC_ENDPOINT).use(mplTokenMetadata());
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

            // Discount percentage per level (default: 1% per level)
            return userStats.level * TOKEN_SUBMISSION_DISCOUNT_PERCENTAGE_PER_LEVEL;
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

// Export service singleton
const tokenWhitelistService = new TokenWhitelistService();
export default tokenWhitelistService;