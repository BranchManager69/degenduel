// services/tokenWhitelistService.js

/*
 * This service is responsible for managing the DegenDuel Token Whitelist.
 * It handles token verification, submission fee processing, and whitelist management.
 * 
 * This service ensures only valid tokens are added to the platform and manages
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
import { fancyColors } from '../utils/colors.js';
// ** Service Manager **
import serviceManager from '../utils/service-suite/service-manager.js';
import { SERVICE_NAMES, getServiceMetadata } from '../utils/service-suite/service-constants.js';
// Solana
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { verifyTransaction } from '../utils/solana-suite/web3-v2/solana-connection-v2.js';
import { fetchDigitalAsset, mplTokenMetadata } from "@metaplex-foundation/mpl-token-metadata";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { publicKey } from "@metaplex-foundation/umi";
// Other
import { Decimal } from 'decimal.js';

const TOKEN_WHITELIST_CONFIG = {
    name: SERVICE_NAMES.TOKEN_WHITELIST,
    description: getServiceMetadata(SERVICE_NAMES.TOKEN_WHITELIST).description,
    checkIntervalMs: 2 * 60 * 1000, // Check every 2 minutes
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

// ** Token Whitelist Service **
class TokenWhitelistService extends BaseService {
    constructor() {
        ////super(TOKEN_WHITELIST_CONFIG.name, TOKEN_WHITELIST_CONFIG);
        super(TOKEN_WHITELIST_CONFIG);
        
        // Use the connection from solana-connection-v2.js instead of creating our own
        this.treasuryWallet = new PublicKey(config.degenduel_treasury_wallet);
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

    // Initialize the service
    async initialize() {
        try {
            // Check if service is enabled via service profile
            if (!config.services.token_whitelist) {
                logApi.warn(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} SERVICE DISABLED ${fancyColors.RESET} Token Whitelist Service is disabled in the '${config.services.active_profile}' service profile`);
                return false; // Skip initialization
            }
            
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
                // TODO: should we be merging configs here?
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
            // TODO: does this work as intended?
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

            // Mark the service as started
            await serviceManager.markServiceStarted(
                this.name,
                JSON.parse(JSON.stringify(this.config)),
                serializableStats
            );

            // Log the service as started
            logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.DARK_MAGENTA}✅ ${fancyColors.BG_LIGHT_GREEN} Token Whitelist Service initialized ${fancyColors.RESET}`, {
            //    totalTokens,
            //    activeTokens
            });

            return true;
        } catch (error) {
            logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.DARK_MAGENTA}❌ ${fancyColors.BG_LIGHT_RED} Token Whitelist Service initialization error: ${error.message} ${fancyColors.RESET}`);
            await this.handleError(error);
            throw error;
        }
    }

    // Get the user level discount
    async getUserLevelDiscount(userId) {
        try {
            const userStats = await prisma.user_stats.findUnique({
                where: { user_id: userId },
                select: { level: true }
            });

            // No discount if no level found
            if (!userStats || !userStats.level) {
                return 0; 
            }

            // Calculate discount based on user level
            return userStats.level * this.config.submission.discountPerLevel;
        } catch (error) {
            logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.DARK_MAGENTA}❌ ${fancyColors.BG_LIGHT_RED} Failed to get user level: ${error.message} ${fancyColors.RESET}`);
            return 0; // No discount on error
        }
    }

    // Calculate submission cost
    async calculateSubmissionCost(user) {
        // Base cost depends on user role
        ////const baseCost = user.role === 'SUPER_ADMIN' ? 
        const baseCost = user.role === 'SUPER_ADMIN' || user.role === 'SUPERADMIN' || user.role === 'ADMIN' ? 
            this.config.submission.superAdminCost : 
            this.config.submission.baseSubmissionCost;

        // Get level-based discount percentage
        const discountPercent = await this.getUserLevelDiscount(user.id);
        
        // Calculate final cost with discount
        const discount = (discountPercent / 100) * baseCost;
        const finalCost = baseCost - discount;

        // Ensure we don't go negative
        return Math.max(finalCost, 0);
    }

    // Verify token
    async verifyToken(contractAddress) {
        const startTime = Date.now();
        
        try {
            // Validate address format
            const pubkey = new PublicKey(contractAddress);
            
            // Check if token already exists
            const existingToken = await prisma.tokens.findUnique({
                where: { address: contractAddress }
            });

            // Token already whitelisted
            if (existingToken) {
                throw ServiceError.validation('Token already whitelisted');
            }

            // Fetch and validate token metadata
            const asset = await fetchDigitalAsset(this.umi, publicKey(contractAddress));
            
            // Token metadata not found
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

            // Validate name length
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

            // Return token metadata
            return {
                name: asset.metadata.name,
                symbol: asset.metadata.symbol,
                uri: asset.metadata.uri || null
            };
        } catch (error) {
            // Update validation stats
            this.whitelistStats.validations.total++;
            this.whitelistStats.validations.failed++;
            
            // Log the error
            logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.DARK_MAGENTA}❌ ${fancyColors.BG_LIGHT_RED} Token verification failed: ${error.message} ${fancyColors.RESET}`);

            // Throw error if it's a ServiceError
            if (error instanceof ServiceError) {
                throw error;
            }

            // Throw error if it's not a ServiceError
            throw ServiceError.validation('Invalid token address');
        }
    }

    // Verify payment
    async verifyPayment(signature, walletAddress, user) {
        try {
            // Calculate required amount based on user role and level
            const requiredAmount = await this.calculateSubmissionCost(user);
            
            // Use the verifyTransaction function from solana-connection-v2
            const verificationResult = await verifyTransaction(signature, {
                expectedAmount: requiredAmount / LAMPORTS_PER_SOL, // Convert lamports to SOL
                expectedSender: walletAddress,
                expectedReceiver: this.treasuryWallet.toString()
            });
            
            // If verification failed, throw an error
            if (!verificationResult.verified) {
                throw ServiceError.validation(verificationResult.error || 'Transaction verification failed');
            }
            
            // Calculate amount in lamports for the database entry
            const amountInLamports = Math.round(verificationResult.amount * LAMPORTS_PER_SOL);
            
            // Log the transaction
            await prisma.transactions.create({
                data: {
                    wallet_address: walletAddress,
                    type: 'DEPOSIT',
                    amount: new Decimal(amountInLamports.toString()),
                    balance_before: new Decimal(verificationResult.receiverBalanceBefore || '0'), 
                    balance_after: new Decimal(verificationResult.receiverBalanceAfter || '0'),
                    description: 'Token whitelist submission fee',
                    status: 'completed',
                    metadata: {
                        signature,
                        token_submission: true,
                        lamports: amountInLamports,
                        treasury_wallet: this.treasuryWallet.toString(),
                        user_level_discount: await this.getUserLevelDiscount(user.id),
                        required_amount: requiredAmount,
                        user_role: user.role,
                        verification_details: {
                            slot: verificationResult.slot,
                            isFirstTransaction: verificationResult.isFirstTransaction
                        }
                    },
                    processed_at: new Date()
                }
            });

            // Update submission stats
            this.whitelistStats.submissions.fees_collected += amountInLamports / LAMPORTS_PER_SOL;

            // Return true if payment is verified
            return true;
        } catch (error) {
            // Log the error
            logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.DARK_MAGENTA}❌ ${fancyColors.BG_LIGHT_RED} Payment verification failed: ${error.message} ${fancyColors.RESET}`);
            throw error;
        }
    }

    // Add to whitelist
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
                logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.DARK_MAGENTA}❌ ${fancyColors.BG_LIGHT_RED} Submission timeout: ${contractAddress} ${fancyColors.RESET}`, {
                    contractAddress,
                    metadata
                });
            }, this.config.submission.submissionTimeoutMs);

            // Add timeout to submission timeouts
            this.submissionTimeouts.add(timeout);

            // Create the token
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

            // Log the token added to whitelist
            logApi.info('Token added to whitelist:', {
                contractAddress,
                tokenId: token.id
            });

            // Return the token
            return token;
        } catch (error) {
            // Update submission stats
            this.whitelistStats.submissions.total++;
            this.whitelistStats.submissions.failed++;

            // Log the error
            logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.DARK_MAGENTA}❌ ${fancyColors.BG_LIGHT_RED} Failed to add token to whitelist: ${error.message} ${fancyColors.RESET}`);

            // Throw error
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

    // Remove from whitelist
    async removeFromWhitelist(contractAddress, adminId, reason) {
        try {
            // Verify token exists
            const token = await prisma.tokens.findUnique({
                where: { address: contractAddress }
            });

            // Token not found
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

            // Return the token
            return token;   
        } catch (error) {
            // Log the error
            logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.DARK_MAGENTA}❌ ${fancyColors.BG_LIGHT_RED} Failed to remove token from whitelist: ${error.message} ${fancyColors.RESET}`);

            // Throw error
            throw ServiceError.operation('Failed to remove token from whitelist');
        }
    }

    // Perform operation
    async performOperation() {
        const startTime = Date.now();
        
        try {
            // Check for any stuck submissions
            const stuckSubmissions = Array.from(this.activeSubmissions.entries())
                .filter(([_, data]) => Date.now() - data.startTime > this.config.submission.submissionTimeoutMs);

            // Clean up stuck submissions
            for (const [address] of stuckSubmissions) {
                this.activeSubmissions.delete(address);
                this.whitelistStats.submissions.failed++;
                logApi.warn(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.DARK_MAGENTA}❌ ${fancyColors.BG_LIGHT_RED} Cleaned up stuck submission: ${address} ${fancyColors.RESET}`);
            }

            // Verify all whitelisted tokens still exist
            const tokens = await prisma.tokens.findMany({
                where: { is_active: true }
            });

            // Initialize results
            const results = {
                total: tokens.length,
                verified: 0,
                failed: 0,
                removed: 0
            };

            // Only log a summary if we find issues
            let foundIssues = false;

            // Verify each token exists but don't use verifyToken() which is for new tokens
    
            // Set of token addresses with known metadata issues to skip verification for
            // This can be populated from database or config in the future
            const knownNonStandardTokens = new Set([
                "HeLp6NuQkmYB4pYWo2zYs22mESHXPQYzXbB8n4V98jwC" // ai16z (AI16Z) - Meteora-based token with non-standard metadata
            ]);

            for (const token of tokens) {
                // Skip verification for tokens with known metadata issues
                if (knownNonStandardTokens.has(token.address)) {
                    logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.DARK_MAGENTA}⚠️ ${fancyColors.BG_BLUE} Skipping metadata verification ${fancyColors.RESET} \n\t${fancyColors.BOLD}${fancyColors.DARK_MAGENTA}Reason:${fancyColors.RESET} ${fancyColors.LIGHT_MAGENTA}Known non-standard token: ${fancyColors.BOLD}${fancyColors.PURPLE}${token.symbol}${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.LIGHT_MAGENTA}${token.address.substring(0, 10)}... ${fancyColors.RESET}`);
                    results.verified++;
                    continue;
                }
                try {
                    // Just check if the token's metadata exists on chain
                    // Try catch inside to add more context before throwing
                    try {
                        const asset = await fetchDigitalAsset(this.umi, publicKey(token.address));
                        
                        if (!asset) {
                            foundIssues = true;
                            throw new Error('Token metadata not found');
                        }
                        results.verified++;
                        
                        // Log successful verification with minimal information
                        logApi.debug(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.DARK_MAGENTA}✅ ${fancyColors.BG_LIGHT_GREEN} Token verified: ${token.symbol} (${token.address.substring(0, 8)}...) ${fancyColors.RESET}`);
                    } catch (metaplexError) {
                        // Add more context to the error
                        const enhancedError = new Error(`Metadata fetch failed: ${metaplexError.message}`);
                        enhancedError.originalError = metaplexError;
                        enhancedError.name = metaplexError.name;
                        enhancedError.source = 'Metaplex SDK';
                        throw enhancedError;
                    }
                } catch (error) {
                    foundIssues = true;
                    // Update results
                    results.failed++;
                    
                    // Only log actual failures, not "already whitelisted" errors
                    if (!error.message.includes('already whitelisted')) {
                        // Enhanced logging for troubleshooting metadata issues
                        logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.DARK_MAGENTA}❌ ${fancyColors.BG_LIGHT_RED} Token verification failed during check: ${token.symbol} (${token.address.substring(0, 8)}...) ${fancyColors.RESET}`, {
                            address: token.address,
                            token_name: token.name,
                            token_symbol: token.symbol,
                            error: error.message,
                            created_at: token.created_at,
                            metadata_error: error.name || 'Unknown error type'
                        });
                        
                        // Add debug log with more technical details if available
                        if (error.source || error.stack) {
                            logApi.debug(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.DARK_MAGENTA}❌ ${fancyColors.BG_LIGHT_RED} Token verification technical details: ${token.symbol} (${token.address.substring(0, 8)}...) ${fancyColors.RESET}`, {
                                address: token.address,
                                error_source: error.source || 'Not available',
                                stack_trace: error.stack || 'Not available'
                            });
                        }
                    }
                    
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
            
            // Only log a summary message if there were problems or tokens were removed
            if (foundIssues) {
                logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.DARK_MAGENTA}❌ ${fancyColors.BG_LIGHT_RED} Token whitelist periodic check completed: ${results} ${fancyColors.RESET}`);
            } else {
                // Silent operation - just increment operation count for stats 
                this.whitelistStats.operations.total++;
                this.whitelistStats.operations.successful++;
            }

            // Update ServiceManager state - always need to do this for service health monitoring
            await serviceManager.updateServiceHeartbeat(
                this.name,
                this.config,
                {
                    ...this.stats,
                    whitelistStats: this.whitelistStats
                }
            );

            // Return results
            return {
                duration: Date.now() - startTime,
                ...results
            };
        } catch (error) {
            // Let the base class handle the error and circuit breaker
            throw error;
        }
    }

    // Stop the service
    async stop() {
        try {
            // Call parent stop first
            await super.stop();
            
            // Clear all timeouts
            for (const timeout of this.submissionTimeouts) {
                clearTimeout(timeout);
            }
            this.submissionTimeouts.clear();
            
            // Clear active submissions
            this.activeSubmissions.clear();
            
            // Final stats update
            await serviceManager.markServiceStopped(
                this.name,
                this.config,
                {
                    ...this.stats,
                    whitelistStats: this.whitelistStats
                }
            );
            
            // Log the service stopped
            logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.DARK_MAGENTA} ✅ ${fancyColors.BG_LIGHT_GREEN}Token Whitelist Service stopped successfully ${fancyColors.RESET}`);
        } catch (error) {
            // Log the error
            logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BOLD}${fancyColors.DARK_MAGENTA} ❌ ${fancyColors.BG_LIGHT_RED}Error stopping Token Whitelist Service: ${error.message} ${fancyColors.RESET}`);
            throw error;
        }
    }
}

// Export service singleton
const tokenWhitelistService = new TokenWhitelistService();
export default tokenWhitelistService;