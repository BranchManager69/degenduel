// services/walletGenerationService.js

/*
 * This file is responsible for generating and managing wallets.
 * It allows the admin to generate new wallets, deactivate wallets, and import existing wallets.
 * 
 */

// Services
import { logApi } from '../logger-suite/logger.js';
import prisma from '../../config/prisma.js';
// Solana
import { Keypair } from '@solana/web3.js';
import crypto from 'crypto';
import bs58 from 'bs58';
// Other
import LRUCache from 'lru-cache';
import { BaseService } from '../service-suite/base-service.js';
import { ServiceError } from '../service-suite/service-error.js';
import { SERVICE_NAMES, getServiceMetadata } from '../service-suite/service-constants.js';

const WALLET_SERVICE_CONFIG = {
    name: SERVICE_NAMES.WALLET_GENERATOR,
    description: getServiceMetadata(SERVICE_NAMES.WALLET_GENERATOR).description,
    checkIntervalMs: 5 * 60 * 1000, // Check every 5 minutes
    maxRetries: 3,
    retryDelayMs: 5000,
    circuitBreaker: {
        failureThreshold: 5,
        resetTimeoutMs: 60000,
        minHealthyPeriodMs: 120000
    },
    cache: {
        maxSize: 1000,
        ttl: 15 * 60 * 1000 // 15 minutes
    }
};

class WalletService extends BaseService {
    constructor() {
        super(WALLET_SERVICE_CONFIG.name, WALLET_SERVICE_CONFIG);
        
        this.walletCache = new LRUCache({
            max: this.config.cache.maxSize,
            ttl: this.config.cache.ttl
        });

        this.stats = {
            operations: {
                total: 0,
                successful: 0,
                failed: 0
            },
            wallets: {
                generated: 0,
                imported: 0,
                deactivated: 0,
                cached: 0
            },
            encryption: {
                successful: 0,
                failed: 0
            },
            circuitBreaker: {
                isOpen: false,
                failures: 0,
                lastFailure: null,
                lastSuccess: null,
                recoveryAttempts: 0
            }
        };
    }

    async initialize() {
        try {
            await super.initialize();

            // Load existing wallets from database into cache
            const existingWallets = await prisma.seed_wallets.findMany({
                where: { is_active: true },
                select: {
                    purpose: true,
                    wallet_address: true,
                    private_key: true
                }
            });
            
            for (const wallet of existingWallets) {
                const identifier = wallet.purpose.replace('Seed wallet for ', '');
                this.walletCache.set(identifier, {
                    publicKey: wallet.wallet_address,
                    secretKey: wallet.private_key,
                    timestamp: Date.now()
                });
                this.stats.wallets.cached++;
            }

            logApi.info(`Initialized wallet cache with ${existingWallets.length} wallets`);
            return true;
        } catch (error) {
            logApi.error('Failed to initialize Wallet Service:', error);
            throw error;
        }
    }

    async performOperation() {
        try {
            // Perform cache cleanup
            this.cleanupCache();
            
            // Verify wallet integrity for cached wallets
            const verificationResults = await this.verifyAllWallets();
            
            // Update stats
            this.stats.wallets.cached = this.walletCache.size;
            
            return verificationResults;
        } catch (error) {
            await this.handleError(error);
            return false;
        }
    }

    // Encrypt a private key using the wallet encryption key from env
    encryptPrivateKey(privateKey) {
        if (!process.env.WALLET_ENCRYPTION_KEY) {
            throw new ServiceError(
                'WALLET_ENCRYPTION_KEY environment variable is not set',
                'MISSING_ENCRYPTION_KEY'
            );
        }
        try {
            const iv = crypto.randomBytes(16);
            const cipher = crypto.createCipheriv(
                'aes-256-gcm',
                Buffer.from(process.env.WALLET_ENCRYPTION_KEY, 'hex'),
                iv
            );
            const encrypted = Buffer.concat([
                cipher.update(Buffer.from(privateKey)),
                cipher.final()
            ]);
            const tag = cipher.getAuthTag();
            return JSON.stringify({
                encrypted: encrypted.toString('hex'),
                iv: iv.toString('hex'),
                tag: tag.toString('hex')
            });
        } catch (error) {
            throw new ServiceError(
                'Failed to encrypt private key',
                'ENCRYPTION_FAILED',
                { originalError: error.message }
            );
        }
    }

    // Decrypt a private key
    decryptPrivateKey(encryptedData) {
        try {
            const { encrypted, iv, tag } = JSON.parse(encryptedData);
            const decipher = crypto.createDecipheriv(
                'aes-256-gcm',
                Buffer.from(process.env.WALLET_ENCRYPTION_KEY, 'hex'),
                Buffer.from(iv, 'hex')
            );
            decipher.setAuthTag(Buffer.from(tag, 'hex'));
            let decrypted = decipher.update(encrypted, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
        } catch (error) {
            throw new ServiceError(
                'Failed to decrypt private key',
                'DECRYPTION_FAILED',
                { originalError: error.message }
            );
        }
    }

    async generateWallet(identifier, options = {}) {
        try {
            // Check if wallet already exists in cache
            const existingWallet = this.walletCache.get(identifier);
            if (existingWallet && !options.forceNew) {
                return existingWallet;
            }

            // Check if wallet exists in database but not in cache
            const existingDbWallet = await prisma.seed_wallets.findFirst({
                where: { 
                    purpose: `Seed wallet for ${identifier}`,
                    is_active: true
                },
                select: {
                    wallet_address: true,
                    private_key: true
                }
            });

            if (existingDbWallet && !options.forceNew) {
                const walletInfo = {
                    publicKey: existingDbWallet.wallet_address,
                    secretKey: existingDbWallet.private_key,
                    timestamp: Date.now()
                };
                this.walletCache.set(identifier, walletInfo);
                return walletInfo;
            }

            // Generate new wallet
            const keypair = options.fromPrivateKey ? 
                Keypair.fromSecretKey(Buffer.from(options.fromPrivateKey, 'base64')) :
                Keypair.generate();

            const walletInfo = {
                publicKey: keypair.publicKey.toString(),
                secretKey: Buffer.from(keypair.secretKey).toString('base64'),
                timestamp: Date.now()
            };

            // Save to database with encrypted private key
            await prisma.seed_wallets.create({
                data: {
                    wallet_address: walletInfo.publicKey,
                    private_key: this.encryptPrivateKey(walletInfo.secretKey),
                    purpose: `Seed wallet for ${identifier}`,
                    is_active: true,
                    metadata: options.metadata || {}
                }
            });

            // Save to cache
            this.walletCache.set(identifier, walletInfo);
            return walletInfo;
        } catch (error) {
            throw new ServiceError(
                'Failed to generate wallet',
                'GENERATION_FAILED',
                { identifier, originalError: error.message }
            );
        }
    }

    async getWallet(identifier) {
        try {
            // Check cache first
            const cachedWallet = this.walletCache.get(identifier);
            if (cachedWallet) {
                return cachedWallet;
            }

            // Check database
            const dbWallet = await prisma.seed_wallets.findFirst({
                where: { 
                    purpose: `Seed wallet for ${identifier}`,
                    is_active: true
                },
                select: {
                    wallet_address: true,
                    private_key: true,
                    metadata: true
                }
            });

            if (dbWallet) {
                const walletInfo = {
                    publicKey: dbWallet.wallet_address,
                    secretKey: dbWallet.private_key,
                    timestamp: Date.now(),
                    metadata: dbWallet.metadata
                };
                this.walletCache.set(identifier, walletInfo);
                return walletInfo;
            }

            return undefined;
        } catch (error) {
            throw new ServiceError(
                'Failed to retrieve wallet',
                'RETRIEVAL_FAILED',
                { identifier, originalError: error.message }
            );
        }
    }

    // Get keypair from wallet
    async getKeypair(identifier) {
        const wallet = await this.getWallet(identifier);
        if (!wallet) {
            throw new ServiceError(
                'Wallet not found',
                'WALLET_NOT_FOUND',
                { identifier }
            );
        }

        try {
            const decryptedKey = this.decryptPrivateKey(wallet.secretKey);
            return Keypair.fromSecretKey(
                Buffer.from(decryptedKey, 'base64')
            );
        } catch (error) {
            throw new ServiceError(
                'Failed to create keypair',
                'KEYPAIR_CREATION_FAILED',
                { identifier, originalError: error.message }
            );
        }
    }

    // Deactivate a wallet
    async deactivateWallet(identifier) {
        try {
            await prisma.seed_wallets.updateMany({
                where: { 
                    purpose: `Seed wallet for ${identifier}`,
                    is_active: true
                },
                data: { is_active: false }
            });

            this.walletCache.delete(identifier);
            return true;
        } catch (error) {
            throw new ServiceError(
                'Failed to deactivate wallet',
                'DEACTIVATION_FAILED',
                { identifier, originalError: error.message }
            );
        }
    }

    // Update wallet metadata
    async updateWalletMetadata(identifier, metadata) {
        try {
            await prisma.seed_wallets.updateMany({
                where: { 
                    purpose: `Seed wallet for ${identifier}`,
                    is_active: true
                },
                data: { metadata }
            });

            const wallet = await this.getWallet(identifier);
            if (wallet) {
                wallet.metadata = metadata;
                this.walletCache.set(identifier, wallet);
            }

            return true;
        } catch (error) {
            throw new ServiceError(
                'Failed to update wallet metadata',
                'METADATA_UPDATE_FAILED',
                { identifier, originalError: error.message }
            );
        }
    }

    // Import existing wallet
    async importWallet(identifier, privateKey, options = {}) {
        return this.generateWallet(identifier, {
            ...options,
            fromPrivateKey: privateKey
        });
    }

    // List all active wallets
    async listWallets(filter = {}) {
        try {
            const wallets = await prisma.seed_wallets.findMany({
                where: { 
                    is_active: true,
                    ...filter
                },
                select: {
                    purpose: true,
                    wallet_address: true,
                    metadata: true
                }
            });

            return wallets.map(wallet => ({
                identifier: wallet.purpose.replace('Seed wallet for ', ''),
                publicKey: wallet.wallet_address,
                metadata: wallet.metadata
            }));
        } catch (error) {
            throw new ServiceError(
                'Failed to list wallets',
                'LIST_FAILED',
                { originalError: error.message }
            );
        }
    }

    // Verify a wallet's integrity
    async verifyWallet(identifier) {
        try {
            const wallet = await this.getWallet(identifier);
            if (!wallet) {
                return {
                    exists: false,
                    valid: false,
                    error: 'Wallet not found'
                };
            }

            // Try to create a keypair to verify the private key
            const keypair = await this.getKeypair(identifier);
            const publicKeyMatches = keypair.publicKey.toString() === wallet.publicKey;

            return {
                exists: true,
                valid: publicKeyMatches,
                error: publicKeyMatches ? null : 'Public key mismatch'
            };
        } catch (error) {
            return {
                exists: true,
                valid: false,
                error: error.message
            };
        }
    }

    // Enhanced cleanup with proper error handling and state reset
    async cleanupCache() {
        try {
            logApi.info('Starting wallet generator cleanup...');
            
            // Clear the cache
            this.walletCache.clear();
            
            // Update database to mark all wallets as inactive
            await prisma.seed_wallets.updateMany({
                where: { is_active: true },
                data: { 
                    is_active: false,
                    updated_at: new Date(),
                    metadata: {
                        cleanup_reason: 'service_shutdown',
                        cleanup_time: new Date().toISOString()
                    }
                }
            });

            logApi.info('Wallet generator cleanup completed successfully');
        } catch (error) {
            logApi.error('Error during wallet generator cleanup:', error);
            throw new ServiceError(
                'Cleanup failed',
                'CLEANUP_FAILED',
                { originalError: error.message }
            );
        }
    }

    // Helper method to verify all cached wallets
    async verifyAllWallets() {
        const results = {
            total: this.walletCache.size,
            verified: 0,
            failed: 0,
            errors: []
        };

        for (const [identifier, wallet] of this.walletCache.entries()) {
            try {
                const verification = await this.verifyWallet(identifier);
                if (verification.valid) {
                    results.verified++;
                } else {
                    results.failed++;
                    results.errors.push({
                        identifier,
                        error: verification.error
                    });
                }
            } catch (error) {
                results.failed++;
                results.errors.push({
                    identifier,
                    error: error.message
                });
            }
        }

        return results;
    }

    async stop() {
        try {
            await super.stop();
            await this.cleanupCache();
            logApi.info('Wallet Service stopped successfully');
        } catch (error) {
            logApi.error('Error stopping Wallet Service:', error);
            throw error;
        }
    }

    // Get cache statistics
    getCacheStats() {
        return {
            size: this.walletCache.size,
            maxSize: this.walletCache.max,
            ttl: this.walletCache.ttl,
            keys: Array.from(this.walletCache.keys())
        };
    }
}

// Create and export singleton instance
const walletService = new WalletService();
export default walletService;