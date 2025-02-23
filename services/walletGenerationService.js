// services/walletGenerationService.js

/*
 * This service is responsible for generating and managing wallets.
 * It provides secure wallet generation, encryption, and management capabilities
 * for all DegenDuel services.
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
import serviceManager from '../utils/service-suite/service-manager.js';
import { SERVICE_NAMES, getServiceMetadata } from '../utils/service-suite/service-constants.js';
// Solana
import { Keypair } from '@solana/web3.js';
import crypto from 'crypto';
import bs58 from 'bs58';
// Other
import LRUCache from 'lru-cache';

const WALLET_SERVICE_CONFIG = {
    name: SERVICE_NAMES.WALLET_GENERATOR,
    checkIntervalMs: 5 * 60 * 1000,  // 5-minute checks
    maxRetries: 3,
    retryDelayMs: 5000,
    circuitBreaker: {
        failureThreshold: 5,
        resetTimeoutMs: 60000,
        minHealthyPeriodMs: 120000
    },
    cache: {
        maxSize: 1000,
        ttl: 15 * 60 * 1000  // 15 minutes
    }
};

class WalletService extends BaseService {
    constructor() {
        super(WALLET_SERVICE_CONFIG);
        
        // Service-specific state
        this.walletStats = {
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
            }
        };

        // Initialize cache
        this.cache = new Map();
        this.cacheOrder = [];
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

            // Load existing wallets into cache
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
                this.cache.set(identifier, {
                    publicKey: wallet.wallet_address,
                    secretKey: wallet.private_key,
                    timestamp: Date.now()
                });
                this.walletStats.wallets.cached++;
            }

            // Ensure stats are JSON-serializable for ServiceManager
            const serializableStats = JSON.parse(JSON.stringify({
                ...this.stats,
                walletStats: this.walletStats
            }));

            await serviceManager.markServiceStarted(
                this.name,
                JSON.parse(JSON.stringify(this.config)),
                serializableStats
            );

            logApi.info('Wallet Generator Service initialized');
            return true;
        } catch (error) {
            logApi.error('Wallet Generator Service initialization error:', error);
            await this.handleError(error);
            throw error;
        }
    }

    async performOperation() {
        const startTime = Date.now();
        
        try {
            // Perform cache cleanup
            this.cleanupCache();
            
            // Verify wallet integrity for cached wallets
            const verificationResults = await this.verifyAllWallets();
            
            // Update stats
            this.walletStats.wallets.cached = this.cache.size;
            this.walletStats.performance.last_operation_time_ms = Date.now() - startTime;
            this.walletStats.performance.average_generation_time_ms = 
                (this.walletStats.performance.average_generation_time_ms * this.walletStats.operations.total + 
                (Date.now() - startTime)) / (this.walletStats.operations.total + 1);

            // Update ServiceManager state
            await serviceManager.updateServiceHeartbeat(
                this.name,
                this.config,
                {
                    ...this.stats,
                    walletStats: this.walletStats
                }
            );
            
            return verificationResults;
        } catch (error) {
            await this.handleError(error);
            return false;
        }
    }

    // Encrypt a private key
    encryptPrivateKey(privateKey) {
        try {
            const iv = crypto.randomBytes(this.config.encryption.ivLength);
            const cipher = crypto.createCipheriv(
                this.config.encryption.algorithm,
                Buffer.from(process.env.WALLET_ENCRYPTION_KEY, 'hex'),
                iv
            );

            const encrypted = Buffer.concat([
                cipher.update(Buffer.from(privateKey)),
                cipher.final()
            ]);

            const tag = cipher.getAuthTag();

            this.walletStats.encryption.successful++;
            
            return JSON.stringify({
                encrypted: encrypted.toString('hex'),
                iv: iv.toString('hex'),
                tag: tag.toString('hex')
            });
        } catch (error) {
            this.walletStats.encryption.failed++;
            throw ServiceError.operation('Failed to encrypt private key', {
                error: error.message,
                type: 'ENCRYPTION_ERROR'
            });
        }
    }

    // Decrypt a private key
    decryptPrivateKey(encryptedData) {
        try {
            const { encrypted, iv, tag } = JSON.parse(encryptedData);
            const decipher = crypto.createDecipheriv(
                this.config.encryption.algorithm,
                Buffer.from(process.env.WALLET_ENCRYPTION_KEY, 'hex'),
                Buffer.from(iv, 'hex')
            );

            decipher.setAuthTag(Buffer.from(tag, 'hex'));
            
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

    async generateWallet(identifier, options = {}) {
        const startTime = Date.now();
        
        try {
            // Check if wallet already exists in cache
            const existingWallet = this.cache.get(identifier);
            if (existingWallet && !options.forceNew) {
                this.walletStats.performance.cache_hit_rate = 
                    (this.walletStats.performance.cache_hit_rate * this.walletStats.operations.total + 1) /
                    (this.walletStats.operations.total + 1);
                return existingWallet;
            }

            // Check if wallet exists in database but not in cache
            const existingDbWallet = await prisma.seed_wallets.findFirst({
                where: { 
                    purpose: `Seed wallet for ${identifier}`,
                    is_active: true
                }
            });

            if (existingDbWallet && !options.forceNew) {
                const walletInfo = {
                    publicKey: existingDbWallet.wallet_address,
                    secretKey: existingDbWallet.private_key,
                    timestamp: Date.now()
                };
                this.cache.set(identifier, walletInfo);
                this.walletStats.wallets.cached++;
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

            // Update stats
            this.walletStats.operations.total++;
            this.walletStats.operations.successful++;
            this.walletStats.wallets.generated++;
            this.walletStats.performance.last_operation_time_ms = Date.now() - startTime;
            this.walletStats.performance.average_generation_time_ms = 
                (this.walletStats.performance.average_generation_time_ms * 
                (this.walletStats.operations.total - 1) + (Date.now() - startTime)) / 
                this.walletStats.operations.total;

            // Save to cache
            this.cache.set(identifier, walletInfo);
            this.walletStats.wallets.cached++;

            return walletInfo;
        } catch (error) {
            this.walletStats.operations.total++;
            this.walletStats.operations.failed++;
            throw ServiceError.operation('Failed to generate wallet', {
                identifier,
                error: error.message
            });
        }
    }

    async getWallet(identifier) {
        try {
            // Check cache first
            const cachedWallet = this.cache.get(identifier);
            if (cachedWallet) {
                this.walletStats.performance.cache_hit_rate = 
                    (this.walletStats.performance.cache_hit_rate * this.walletStats.operations.total + 1) /
                    (this.walletStats.operations.total + 1);
                return cachedWallet;
            }

            // Check database
            const dbWallet = await prisma.seed_wallets.findFirst({
                where: { 
                    purpose: `Seed wallet for ${identifier}`,
                    is_active: true
                }
            });

            if (dbWallet) {
                const walletInfo = {
                    publicKey: dbWallet.wallet_address,
                    secretKey: dbWallet.private_key,
                    timestamp: Date.now(),
                    metadata: dbWallet.metadata
                };
                this.cache.set(identifier, walletInfo);
                this.walletStats.wallets.cached++;
                return walletInfo;
            }

            return undefined;
        } catch (error) {
            throw ServiceError.operation('Failed to retrieve wallet', {
                identifier,
                error: error.message
            });
        }
    }

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
            const decryptedKey = this.decryptPrivateKey(wallet.secretKey);
            const keypair = Keypair.fromSecretKey(
                Buffer.from(decryptedKey, 'base64')
            );
            
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

    async verifyAllWallets() {
        const results = {
            total: this.cache.size,
            verified: 0,
            failed: 0,
            errors: []
        };

        for (const [identifier] of this.cache.entries()) {
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

    cleanupCache() {
        const now = Date.now();
        let cleaned = 0;
        
        for (const [key, value] of this.cache.entries()) {
            if (now - value.timestamp > this.config.cache.ttl) {
                this.cache.delete(key);
                cleaned++;
            }
        }
        
        if (cleaned > 0) {
            this.walletStats.wallets.cached -= cleaned;
            logApi.info(`Cleaned ${cleaned} expired wallet(s) from cache`);
        }
    }

    async stop() {
        try {
            await super.stop();
            await this.cleanup();
            logApi.info('Wallet Generator Service stopped successfully');
        } catch (error) {
            logApi.error('Error stopping Wallet Generator Service:', error);
            throw error;
        }
    }

    async cleanup() {
        try {
            // Clear the cache
            this.cache.clear();
            this.walletStats.wallets.cached = 0;
            
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
            throw ServiceError.operation('Cleanup failed', {
                error: error.message
            });
        }
    }

    // Get cache statistics
    getCacheStats() {
        return {
            size: this.cache.size,
            maxSize: this.cache.max,
            ttl: this.cache.ttl,
            keys: Array.from(this.cache.keys())
        };
    }
}

// Create and export singleton instance
const walletService = new WalletService();
export default walletService;