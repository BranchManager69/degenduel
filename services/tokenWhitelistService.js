// services/tokenWhitelistService.js

/*
 * This service is responsible for managing the token whitelist.
 * It handles token verification, submission fee processing, and whitelist management.
 * The service ensures only valid tokens are added to the platform and manages
 * the submission process including payment verification and metadata validation.
 */

// ** Service Auth **
import { generateServiceAuthHeader } from '../config/service-auth.js';
// ** Service Class **
import { BaseService } from '../utils/service-suite/base-service.js';
import { ServiceError } from '../utils/service-suite/service-error.js';
import { config } from '../config/config.js';
import { logApi } from '../utils/logger-suite/logger.js';
import AdminLogger from '../utils/admin-logger.js';
import prisma from '../config/prisma.js';
// ** Service Manager **
import ServiceManager from '../utils/service-suite/service-manager.js';
import { SERVICE_NAMES, getServiceMetadata } from '../utils/service-suite/service-constants.js';
// Solana
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { fetchDigitalAsset, mplTokenMetadata } from "@metaplex-foundation/mpl-token-metadata";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { publicKey } from "@metaplex-foundation/umi";
// Other
import { Decimal } from 'decimal.js';

const TOKEN_WHITELIST_CONFIG = {
    name: SERVICE_NAMES.TOKEN_WHITELIST,
    description: getServiceMetadata(SERVICE_NAMES.TOKEN_WHITELIST).description,
    checkIntervalMs: 5 * 60 * 1000, // Check every 5 minutes
    maxRetries: 3,
    retryDelayMs: 5000,
    circuitBreaker: {
        failureThreshold: 5,
        resetTimeoutMs: 60000,
        minHealthyPeriodMs: 120000
    },
    backoff: {
        initialDelayMs: 1000,
        maxDelayMs: 30000,
        factor: 2
    },
    submission: {
        baseSubmissionCost: 1 * LAMPORTS_PER_SOL,
        superAdminCost: 0.01 * LAMPORTS_PER_SOL,
        discountPerLevel: 1, // 1% per level
        minConfirmations: 2,
        maxPendingSubmissions: 100,
        submissionTimeoutMs: 60000
    },
    validation: {
        requiredMetadataFields: ['name', 'symbol', 'uri'],
        maxSymbolLength: 10,
        maxNameLength: 50,
        allowedChains: ['solana']
    }
};

class TokenWhitelistService extends BaseService {
    constructor() {
        super(TOKEN_WHITELIST_CONFIG.name, TOKEN_WHITELIST_CONFIG);
        
        // Initialize Solana connection
        this.connection = new Connection(config.rpc_urls.primary, "confirmed");
        this.treasuryWallet = new PublicKey(config.degendual_treasury_wallet);
        this.umi = createUmi(config.rpc_urls.primary).use(mplTokenMetadata());

        // Service-specific state
        this.whitelistStats = {
            operations: {
                total: 0,
                successful: 0,
                failed: 0
            },
            tokens: {
                total: 0,
                active: 0,
                pending: 0,
                rejected: 0,
                by_chain: {}
            },
            submissions: {
                total: 0,
                approved: 0,
                rejected: 0,
                pending: 0,
                fees_collected: 0
            },
            validations: {
                total: 0,
                successful: 0,
                failed: 0,
                by_reason: {}
            },
            performance: {
                average_validation_time_ms: 0,
                last_operation_time_ms: 0,
                average_submission_time_ms: 0
            }
        };

        // Active processing tracking
        this.activeSubmissions = new Map();
        this.submissionTimeouts = new Set();
    }

    async initialize() {
        try {
            // Call parent initialize first
            await super.initialize();

            // Load configuration from database
            const settings = await prisma.system_settings.findUnique({
                where: { key: this.name }
            });

            if (settings?.value) {
                const dbConfig = typeof settings.value === 'string' 
                    ? JSON.parse(settings.value)
                    : settings.value;

                // Merge configs carefully preserving circuit breaker settings
                this.config = {
                    ...this.config,
                    ...dbConfig,
                    circuitBreaker: {
                        ...this.config.circuitBreaker,
                        ...(dbConfig.circuitBreaker || {})
                    }
                };
            }

            // Load initial whitelist state
            const [totalTokens, activeTokens] = await Promise.all([
                prisma.tokens.count(),
                prisma.tokens.count({ where: { is_active: true } })
            ]);

            // Initialize stats
            this.whitelistStats.tokens.total = totalTokens;
            this.whitelistStats.tokens.active = activeTokens;

            // Ensure stats are JSON-serializable for ServiceManager
            const serializableStats = JSON.parse(JSON.stringify({
                ...this.stats,
                whitelistStats: this.whitelistStats
            }));

            await ServiceManager.markServiceStarted(
                this.name,
                JSON.parse(JSON.stringify(this.config)),
                serializableStats
            );

            logApi.info('Token Whitelist Service initialized', {
                totalTokens,
                activeTokens
            });

            return true;
        } catch (error) {
            logApi.error('Token Whitelist Service initialization error:', error);
            await this.handleError(error);
            throw error;
        }
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

            return userStats.level * this.config.submission.discountPerLevel;
        } catch (error) {
            logApi.error('Failed to get user level:', {
                userId,
                error: error.message
            });
            return 0; // No discount on error
        }
    }

    async calculateSubmissionCost(user) {
        // Base cost depends on user role
        const baseCost = user.role === 'SUPER_ADMIN' ? 
            this.config.submission.superAdminCost : 
            this.config.submission.baseSubmissionCost;

        // Get level-based discount percentage
        const discountPercent = await this.getUserLevelDiscount(user.id);
        
        // Calculate final cost with discount
        const discount = (discountPercent / 100) * baseCost;
        const finalCost = baseCost - discount;

        return Math.max(finalCost, 0); // Ensure we don't go negative
    }

    async verifyToken(contractAddress) {
        const startTime = Date.now();
        
        try {
            // Validate address format
            const pubkey = new PublicKey(contractAddress);
            
            // Check if token already exists
            const existingToken = await prisma.tokens.findUnique({
                where: { address: contractAddress }
            });

            if (existingToken) {
                throw ServiceError.validation('Token already whitelisted');
            }

            // Fetch and validate token metadata
            const asset = await fetchDigitalAsset(this.umi, publicKey(contractAddress));
            
            if (!asset) {
                throw ServiceError.validation('Token metadata not found');
            }

            // Validate required fields
            for (const field of this.config.validation.requiredMetadataFields) {
                if (!asset.metadata[field]) {
                    this.whitelistStats.validations.by_reason[`missing_${field}`] = 
                        (this.whitelistStats.validations.by_reason[`missing_${field}`] || 0) + 1;
                    throw ServiceError.validation(`Missing required field: ${field}`);
                }
            }

            // Validate field lengths
            if (asset.metadata.symbol.length > this.config.validation.maxSymbolLength) {
                this.whitelistStats.validations.by_reason.symbol_too_long = 
                    (this.whitelistStats.validations.by_reason.symbol_too_long || 0) + 1;
                throw ServiceError.validation('Symbol too long');
            }

            if (asset.metadata.name.length > this.config.validation.maxNameLength) {
                this.whitelistStats.validations.by_reason.name_too_long = 
                    (this.whitelistStats.validations.by_reason.name_too_long || 0) + 1;
                throw ServiceError.validation('Name too long');
            }

            // Update validation stats
            this.whitelistStats.validations.total++;
            this.whitelistStats.validations.successful++;
            this.whitelistStats.performance.average_validation_time_ms = 
                (this.whitelistStats.performance.average_validation_time_ms * 
                (this.whitelistStats.validations.total - 1) + (Date.now() - startTime)) / 
                this.whitelistStats.validations.total;

            return {
                name: asset.metadata.name,
                symbol: asset.metadata.symbol,
                uri: asset.metadata.uri || null
            };
        } catch (error) {
            // Update validation stats
            this.whitelistStats.validations.total++;
            this.whitelistStats.validations.failed++;
            
            logApi.error('Token verification failed:', {
                contractAddress,
                error: error.message
            });
            
            if (error instanceof ServiceError) {
                throw error;
            }
            
            throw ServiceError.validation('Invalid token address');
        }
    }

    async verifyPayment(signature, walletAddress, user) {
        try {
            const tx = await this.connection.getTransaction(signature, {
                commitment: 'confirmed'
            });

            if (!tx) {
                throw ServiceError.validation('Transaction not found');
            }

            // Calculate required amount based on user role and level
            const requiredAmount = await this.calculateSubmissionCost(user);

            // Verify payment amount and recipient
            const transfer = tx.transaction.message.instructions.find(ix => 
                ix.program === 'system' && 
                ix.parsed.type === 'transfer'
            );

            if (!transfer) {
                throw ServiceError.validation('No transfer instruction found');
            }

            if (transfer.parsed.info.destination !== this.treasuryWallet.toString()) {
                throw ServiceError.validation('Invalid payment recipient');
            }

            if (transfer.parsed.info.lamports < requiredAmount) {
                const required = requiredAmount / LAMPORTS_PER_SOL;
                const provided = transfer.parsed.info.lamports / LAMPORTS_PER_SOL;
                throw ServiceError.validation(`Insufficient payment amount. Required: ${required} SOL, Provided: ${provided} SOL`);
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

            // Update submission stats
            this.whitelistStats.submissions.fees_collected += transfer.parsed.info.lamports / LAMPORTS_PER_SOL;

            return true;
        } catch (error) {
            logApi.error('Payment verification failed:', {
                signature,
                error: error.message
            });
            throw error;
        }
    }

    async addToWhitelist(contractAddress, metadata, adminContext = null) {
        const startTime = Date.now();
        
        try {
            // Add to active submissions
            this.activeSubmissions.set(contractAddress, {
                startTime,
                metadata
            });

            // Set timeout
            const timeout = setTimeout(() => {
                this.activeSubmissions.delete(contractAddress);
                this.whitelistStats.submissions.failed++;
                logApi.error('Submission timeout:', {
                    contractAddress,
                    metadata
                });
            }, this.config.submission.submissionTimeoutMs);
            
            this.submissionTimeouts.add(timeout);

            const token = await prisma.tokens.create({
                data: {
                    address: contractAddress,
                    name: metadata.name,
                    symbol: metadata.symbol,
                    chain: 'solana',
                    is_active: true,
                    created_at: new Date()
                }
            });

            // Clear timeout and active submission
            clearTimeout(timeout);
            this.submissionTimeouts.delete(timeout);
            this.activeSubmissions.delete(contractAddress);

            // Update stats
            this.whitelistStats.tokens.total++;
            this.whitelistStats.tokens.active++;
            this.whitelistStats.tokens.by_chain.solana = 
                (this.whitelistStats.tokens.by_chain.solana || 0) + 1;
            this.whitelistStats.submissions.total++;
            this.whitelistStats.submissions.approved++;

            // Log admin action if context provided
            if (adminContext) {
                await AdminLogger.logAction(
                    adminContext.admin_address,
                    'TOKEN_WHITELIST_ADD',
                    {
                        contractAddress,
                        tokenId: token.id,
                        metadata
                    },
                    adminContext
                );
            }

            logApi.info('Token added to whitelist:', {
                contractAddress,
                tokenId: token.id
            });

            return token;
        } catch (error) {
            this.whitelistStats.submissions.total++;
            this.whitelistStats.submissions.failed++;
            
            logApi.error('Failed to add token to whitelist:', {
                contractAddress,
                error: error.message
            });
            throw ServiceError.operation('Failed to add token to whitelist');
        } finally {
            // Update performance metrics
            const duration = Date.now() - startTime;
            this.whitelistStats.performance.last_operation_time_ms = duration;
            this.whitelistStats.performance.average_submission_time_ms = 
                (this.whitelistStats.performance.average_submission_time_ms * 
                (this.whitelistStats.submissions.total - 1) + duration) / 
                this.whitelistStats.submissions.total;
        }
    }

    async removeFromWhitelist(contractAddress, adminId, reason) {
        try {
            // Verify token exists
            const token = await prisma.tokens.findUnique({
                where: { address: contractAddress }
            });

            if (!token) {
                throw ServiceError.validation('Token not found in whitelist');
            }

            // Remove token
            await prisma.tokens.delete({
                where: { address: contractAddress }
            });

            // Update stats
            this.whitelistStats.tokens.total--;
            this.whitelistStats.tokens.active--;
            this.whitelistStats.tokens.by_chain[token.chain]--;

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
            throw ServiceError.operation('Failed to remove token from whitelist');
        }
    }

    async performOperation() {
        const startTime = Date.now();
        
        try {
            // Check for any stuck submissions
            const stuckSubmissions = Array.from(this.activeSubmissions.entries())
                .filter(([_, data]) => Date.now() - data.startTime > this.config.submission.submissionTimeoutMs);

            for (const [address] of stuckSubmissions) {
                this.activeSubmissions.delete(address);
                this.whitelistStats.submissions.failed++;
                logApi.warn('Cleaned up stuck submission:', { address });
            }

            // Verify all whitelisted tokens still exist
            const tokens = await prisma.tokens.findMany({
                where: { is_active: true }
            });

            const results = {
                total: tokens.length,
                verified: 0,
                failed: 0,
                removed: 0
            };

            for (const token of tokens) {
                try {
                    await this.verifyToken(token.address);
                    results.verified++;
                } catch (error) {
                    results.failed++;
                    logApi.error('Token verification failed during check:', {
                        address: token.address,
                        error: error.message
                    });

                    // If token doesn't exist anymore, remove it
                    if (error.message.includes('not found')) {
                        await this.removeFromWhitelist(
                            token.address,
                            'SYSTEM',
                            'Token no longer exists'
                        );
                        results.removed++;
                    }
                }
            }

            // Update ServiceManager state
            await ServiceManager.updateServiceHeartbeat(
                this.name,
                this.config,
                {
                    ...this.stats,
                    whitelistStats: this.whitelistStats
                }
            );

            return {
                duration: Date.now() - startTime,
                ...results
            };
        } catch (error) {
            // Let the base class handle the error and circuit breaker
            throw error;
        }
    }

    async stop() {
        try {
            await super.stop();
            
            // Clear all timeouts
            for (const timeout of this.submissionTimeouts) {
                clearTimeout(timeout);
            }
            this.submissionTimeouts.clear();
            
            // Clear active submissions
            this.activeSubmissions.clear();
            
            // Final stats update
            await ServiceManager.markServiceStopped(
                this.name,
                this.config,
                {
                    ...this.stats,
                    whitelistStats: this.whitelistStats
                }
            );
            
            logApi.info('Token Whitelist Service stopped successfully');
        } catch (error) {
            logApi.error('Error stopping Token Whitelist Service:', error);
            throw error;
        }
    }
}

// Export service singleton
const tokenWhitelistService = new TokenWhitelistService();
export default tokenWhitelistService;