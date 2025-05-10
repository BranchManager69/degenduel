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
import { fancyColors } from '../utils/colors.js';
// ** Service Manager **
import serviceManager from '../utils/service-suite/service-manager.js';
import { SERVICE_NAMES, getServiceMetadata } from '../utils/service-suite/service-constants.js';
// Solana
import crypto from 'crypto';
import bs58 from 'bs58';
// Other
import LRUCache from 'lru-cache';
import { generateKeyPair as generateKeyPairV2, createKeyPairSignerFromBytes } from '@solana/keys';
import { getAddressFromPublicKey } from '@solana/addresses';
import { Keypair as KeypairV1 } from '@solana/web3.js';

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
    },
    encryption: {
        algorithm: 'aes-256-gcm',
        ivLength: 16
    }
};

// Wallet Generation Service
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
            },
            performance: {
                last_operation_time_ms: 0,
                average_generation_time_ms: 0,
                cache_hit_rate: 0
            }
        };

        // Initialize cache
        this.cache = new Map();
        this.cacheOrder = [];
    }

    // Initialize the service
    async initialize() {
        try {
            // Check if wallet generator service is disabled via service profile
            if (!config.services.wallet_generator_service) {
                logApi.warn(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} SERVICE DISABLED ${fancyColors.RESET} Wallet Generator Service is disabled in the '${config.services.active_profile}' service profile`);
                return false;
            }
            
            // Call parent initialize first
            const success = await super.initialize();
            if (!success) {
                return false;
            }
            
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

            // Mark the service as started
            await serviceManager.markServiceStarted(
                this.name,
                JSON.parse(JSON.stringify(this.config)),
                serializableStats
            );

            // Log the service initialization
            logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET}${fancyColors.BOLD}${fancyColors.DARK_MAGENTA} ✅ ${fancyColors.BG_LIGHT_GREEN} Wallet Generator Service initialized ${fancyColors.RESET}`);
            return true;
        } catch (error) {
            logApi.error('Wallet Generator Service initialization error:', error);
            await this.handleError(error);
            throw error;
        }
    }

    /**
     * Implements the onPerformOperation method required by BaseService
     * This gets called regularly by the BaseService to perform the service's main operation
     * and is used for circuit breaker recovery
     * @returns {Promise<boolean>} Success status
     */
    async onPerformOperation() {
        try {
            // Skip operation if service is not properly initialized or started
            if (!this.isOperational) {
                logApi.debug(`${fancyColors.CYAN}[walletService]${fancyColors.RESET} Service not operational, skipping operation`);
                return true;
            }
            
            // Call the original performOperation implementation
            await this.performOperation();
            
            return true;
        } catch (error) {
            logApi.error(`${fancyColors.CYAN}[walletService]${fancyColors.RESET} ${fancyColors.RED}Perform operation error:${fancyColors.RESET} ${error.message}`);
            throw error; // Important: re-throw to trigger circuit breaker
        }
    }

    // Perform operation
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

    /**
     * Encrypts a 32-byte private key seed.
     * @param {Uint8Array} privateKeySeed_32Bytes - The 32-byte private key seed.
     * @returns {string} - Encrypted JSON string { version, encrypted, iv, tag, aad }.
     */
    encryptPrivateKey(privateKeySeed_32Bytes) {
        if (!(privateKeySeed_32Bytes instanceof Uint8Array) || privateKeySeed_32Bytes.length !== 32) {
            this.walletStats.encryption.failed++;
            throw ServiceError.validation('encryptPrivateKey expects a 32-byte Uint8Array seed.');
        }
        try {
            const iv = crypto.randomBytes(this.config.encryption.ivLength || 12);
            const aad = crypto.randomBytes(16); // Add AAD for context
            const algorithm = this.config.encryption.algorithm || 'aes-256-gcm';

            const cipher = crypto.createCipheriv(
                algorithm,
                Buffer.from(process.env.WALLET_ENCRYPTION_KEY, 'hex'),
                iv
            );
            cipher.setAAD(aad);
            let encrypted = cipher.update(privateKeySeed_32Bytes);
            encrypted = Buffer.concat([encrypted, cipher.final()]);
            const tag = cipher.getAuthTag();

            this.walletStats.encryption.successful++;
            return JSON.stringify({
                version: 'v2_seed_wgs', // Wallet Generation Service seed
                encrypted: encrypted.toString('hex'),
                iv: iv.toString('hex'),
                tag: tag.toString('hex'),
                aad: aad.toString('hex')
            });
        } catch (error) {
            this.walletStats.encryption.failed++;
            logApi.error("Encryption failed in WalletService:", { error: error.message, stack: error.stack });
            throw ServiceError.operation('Failed to encrypt private key seed', {
                originalError: error.message,
                type: 'ENCRYPTION_ERROR_WGS'
            });
        }
    }

    /**
     * Decrypts a private key.
     * Handles new 'v2_seed_wgs' format and attempts to handle old format.
     * @param {string} encryptedDataJson - The encrypted private key data (JSON string).
     * @returns {Buffer} - The decrypted 32-byte private key seed as a Buffer.
     */
    decryptPrivateKey(encryptedDataJson) {
        let parsedData;
        try {
            parsedData = JSON.parse(encryptedDataJson);
        } catch (e) {
            logApi.error("Failed to parse encryptedDataJson in decryptPrivateKey", { data: encryptedDataJson, error: e.message });
            throw ServiceError.operation('Failed to decrypt private key: Invalid JSON format.', { type: 'DECRYPTION_ERROR_JSON_PARSE' });
        }

        if (parsedData.version === 'v2_seed_wgs') {
            try {
                const { encrypted, iv, tag, aad } = parsedData;
                if (!encrypted || !iv || !tag || !aad) {
                    throw new Error('Encrypted v2_seed_wgs data is missing required fields.');
                }
                const decipher = crypto.createDecipheriv(
                    this.config.encryption.algorithm || 'aes-256-gcm',
                    Buffer.from(process.env.WALLET_ENCRYPTION_KEY, 'hex'),
                    Buffer.from(iv, 'hex')
                );
                decipher.setAuthTag(Buffer.from(tag, 'hex'));
                decipher.setAAD(Buffer.from(aad, 'hex'));
                let decryptedSeed = decipher.update(Buffer.from(encrypted, 'hex'));
                decryptedSeed = Buffer.concat([decryptedSeed, decipher.final()]);
                if (decryptedSeed.length !== 32) {
                    throw new Error(`Decrypted v2_seed_wgs is not 32 bytes, got ${decryptedSeed.length} bytes.`);
                }
                return decryptedSeed; // Return 32-byte seed Buffer
            } catch (error) {
                logApi.error("Failed to decrypt v2_seed_wgs private key:", { error: error.message });
                throw ServiceError.operation('Failed to decrypt v2_seed_wgs private key', {
                    originalError: error.message, type: 'DECRYPTION_ERROR_V2_WGS'
                });
            }
        } else if (parsedData.encrypted && parsedData.iv && parsedData.tag && !parsedData.version) {
            // Attempt to handle old format: { encrypted, iv, tag } (no aad, no version)
            logApi.warn("Attempting to decrypt legacy private key format (no version, no AAD).");
            try {
                const { encrypted, iv, tag } = parsedData;
                const decipher = crypto.createDecipheriv(
                    this.config.encryption.algorithm || 'aes-256-gcm',
                    Buffer.from(process.env.WALLET_ENCRYPTION_KEY, 'hex'),
                    Buffer.from(iv, 'hex')
                );
                decipher.setAuthTag(Buffer.from(tag, 'hex'));
                let decryptedOldFormat = decipher.update(Buffer.from(encrypted, 'hex'));
                decryptedOldFormat = Buffer.concat([decryptedOldFormat, decipher.final()]);
                
                // Old format stored a base64 string of the 64-byte v1 secret key.
                // So, decryptedOldFormat should be that base64 string if toString() was used before.
                // Or, if Buffer.from(privateKey) was used in encrypt, it's the raw 64-byte buffer.
                // The old decryptPrivateKey did: return decrypted.toString();
                // This implies the content of `decryptedOldFormat` is the base64 string.
                const base64Encoded64ByteKey = decryptedOldFormat.toString(); // Assume it was stored as base64 string before encryption
                const full64ByteKey = Buffer.from(base64Encoded64ByteKey, 'base64');
                
                if (full64ByteKey.length === 64) {
                    logApi.info("Successfully decrypted legacy key (base64 encoded 64-byte) and extracted 32-byte seed.");
                    return full64ByteKey.slice(0, 32); // Return the first 32 bytes (seed)
                } else {
                    throw new Error(`Legacy key decryption did not result in 64 bytes after base64 decode. Length: ${full64ByteKey.length}`);
                }
            } catch (error) {
                logApi.error("Failed to decrypt legacy private key format:", { error: error.message });
                throw ServiceError.operation('Failed to decrypt legacy private key format', {
                    originalError: error.message, type: 'DECRYPTION_ERROR_LEGACY'
                });
            }
        } else {
            throw ServiceError.operation('Unrecognized encrypted private key format or version.', { 
                version: parsedData.version, 
                type: 'DECRYPTION_ERROR_UNRECOGNIZED' 
            });
        }
    }

    // Generate wallet
    async generateWallet(identifier, options = {}) {
        const startTime = Date.now();
        this.logApi.info(`generateWallet called for identifier: ${identifier}`, { options });

        try {
            // Cache and existing DB wallet check (as before, but note that 'secretKey' in cache/DB will be encrypted v2_seed_wgs JSON)
            if (!options.forceNew) {
                const cachedWallet = this.cache.get(identifier);
                if (cachedWallet) {
                    this.logApi.info(`Cache hit for wallet: ${identifier}`);
                    this.walletStats.performance.cache_hit_rate = 
                        (this.walletStats.performance.cache_hit_rate * this.walletStats.operations.total + 1) /
                        (this.walletStats.operations.total + 1);
                    return cachedWallet;
                }
                const existingDbWallet = await prisma.seed_wallets.findFirst({
                    where: { 
                        purpose: `Seed wallet for ${identifier}`,
                        is_active: true
                    }
                });
                if (existingDbWallet) {
                    const walletInfoToCache = {
                        publicKey: existingDbWallet.wallet_address,
                        secretKey: existingDbWallet.private_key, 
                        timestamp: Date.now(),
                        metadata: existingDbWallet.metadata
                    };
                    this.cache.set(identifier, walletInfoToCache);
                    this.walletStats.wallets.cached++;
                    return walletInfoToCache;
                }
            }

            let seed_32_bytes_uint8array;
            let walletAddress_v2_string;
            let walletInfoToStoreAndCache;

            if (options.fromPrivateKey_v1_bs58_64byte) {
                // THIS PART IS UNCHANGED IN THIS EDIT - WILL BE REFACTORED NEXT
                this.logApi.info(`Importing wallet from provided v1 private key for identifier: ${identifier}`);
                const keypair_v1_for_import = KeypairV1.fromSecretKey(Buffer.from(options.fromPrivateKey_v1_bs58_64byte, 'base64'));
                walletAddress_v2_string = keypair_v1_for_import.publicKey.toString();
                // IMPORTANT: This still passes the base64 of the 64-byte v1 secret key to old encryptPrivateKey logic.
                // This will need to be updated to extract seed and call the new encryptPrivateKey.
                // For now, to make a focused edit, we let this path be (it will likely call the old encrypt if not careful).
                // However, our new encryptPrivateKey now expects 32-byte seed.
                // TEMPORARY: Extract seed here too for now, assuming options.fromPrivateKey is base64 of 64-byte key
                const full64ByteKey_buffer_from_import = Buffer.from(options.fromPrivateKey_v1_bs58_64byte, 'base64');
                if (full64ByteKey_buffer_from_import.length !== 64) {
                    throw new Error('Provided v1 private key (options.fromPrivateKey_v1_bs58_64byte) is not 64 bytes after base64 decode.');
                }
                seed_32_bytes_uint8array = Uint8Array.from(full64ByteKey_buffer_from_import.slice(0, 32));
                // Verify derived address from this seed matches the one from KeypairV1.fromSecretKey
                const tempSignerForImportVerification = await createKeyPairSignerFromBytes(seed_32_bytes_uint8array);
                if (tempSignerForImportVerification.address !== walletAddress_v2_string) {
                    logApi.error("CRITICAL MISMATCH during import: Address from seed does not match address from v1 Keypair.fromSecretKey", {
                        fromSeed: tempSignerForImportVerification.address,
                        fromV1: walletAddress_v2_string
                    });
                    throw new Error("Imported key address mismatch during verification.");
                }
                 this.logApi.info(`Imported v1 key. Seed extracted. Address: ${walletAddress_v2_string}`);

            } else {
                // V2 New Key Generation Path
                this.logApi.info(`Generating new v2 keypair for identifier: ${identifier}`);
                const newV2KeyPair = await generateKeyPairV2(); // { secretKey: Uint8Array (32b seed), publicKey: CryptoKey }
                seed_32_bytes_uint8array = newV2KeyPair.secretKey;
                walletAddress_v2_string = await getAddressFromPublicKey(newV2KeyPair.publicKey);
                this.logApi.info(`Generated new v2 wallet. Address: ${walletAddress_v2_string}`);
            }

            // Encrypt the 32-byte seed
            const encryptedSeedJson = this.encryptPrivateKey(seed_32_bytes_uint8array);

            walletInfoToStoreAndCache = {
                publicKey: walletAddress_v2_string,
                secretKey: encryptedSeedJson, // This is the encrypted v2_seed_wgs JSON
                timestamp: Date.now(),
                metadata: options.metadata || {}
            };

            await prisma.seed_wallets.create({
                data: {
                    wallet_address: walletAddress_v2_string,
                    private_key: encryptedSeedJson,
                    purpose: `Seed wallet for ${identifier}`,
                    is_active: true,
                    metadata: options.metadata || {}
                }
            });

            // Update stats
            this.walletStats.operations.total++;
            this.walletStats.operations.successful++;
            this.walletStats.wallets.generated++;
            if (options.fromPrivateKey_v1_bs58_64byte) this.walletStats.wallets.imported++;
            this.walletStats.performance.last_operation_time_ms = Date.now() - startTime;
            this.walletStats.performance.average_generation_time_ms = 
                (this.walletStats.performance.average_generation_time_ms * 
                (this.walletStats.operations.total - 1) + (Date.now() - startTime)) / 
                this.walletStats.operations.total;

            // Save to cache
            this.cache.set(identifier, walletInfoToStoreAndCache);
            this.walletStats.wallets.cached++;

            return walletInfoToStoreAndCache;
        } catch (error) {
            this.walletStats.operations.total++;
            this.walletStats.operations.failed++;
            throw ServiceError.operation('Failed to generate wallet', {
                identifier,
                error: error.message
            });
        }
    }

    // Get wallet
    async getWallet(identifier) {
        try {
            const cachedWallet = this.cache.get(identifier);
            if (cachedWallet) {
                this.walletStats.performance.cache_hit_rate = 
                    (this.walletStats.performance.cache_hit_rate * this.walletStats.operations.total + 1) /
                    (this.walletStats.operations.total + 1);
                return cachedWallet;
            }
            const dbWallet = await prisma.seed_wallets.findFirst({
                where: { purpose: `Seed wallet for ${identifier}`, is_active: true }
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

    /**
     * Verifies a wallet by decrypting its seed, deriving a public key, and comparing.
     * @param {string} identifier - The wallet identifier.
     * @returns {Promise<Object>} - { exists: boolean, valid: boolean, error?: string }
     */
    async verifyWallet(identifier) {
        let walletToVerify;
        try {
            walletToVerify = await this.getWallet(identifier);
            if (!walletToVerify || !walletToVerify.secretKey) {
                return { exists: false, valid: false, error: 'Wallet not found or has no secret key.' };
            }

            // decryptPrivateKey now returns a 32-byte seed Buffer
            const decryptedSeed_32Bytes_buffer = this.decryptPrivateKey(walletToVerify.secretKey);

            if (!(decryptedSeed_32Bytes_buffer instanceof Buffer) || decryptedSeed_32Bytes_buffer.length !== 32) {
                throw new Error('Decryption did not yield a 32-byte Buffer seed.');
            }

            // Create a v2 signer from the seed to get the derived address
            const signer = await createKeyPairSignerFromBytes(decryptedSeed_32Bytes_buffer);
            
            const derivedAddress = signer.address;
            const storedAddress = walletToVerify.publicKey; // This is wallet_address from DB

            const publicKeyMatches = derivedAddress === storedAddress;

            if (!publicKeyMatches) {
                logApi.warn(`Wallet verification failed for ${identifier}: Address mismatch.`, {
                    derived: derivedAddress,
                    stored: storedAddress
                });
            }

            return {
                exists: true,
                valid: publicKeyMatches,
                error: publicKeyMatches ? null : 'Public key mismatch after seed decryption and address derivation.'
            };
        } catch (error) {
            logApi.error(`Error during wallet verification for ${identifier}: ${error.message}`, { stack: error.stack?.substring(0,200) });
            return {
                exists: !!walletToVerify, // It exists if we got this far before an error in decryption/derivation
                valid: false,
                error: error.message
            };
        }
    }

    // Verify all wallets
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

    // Cleanup cache
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

    // Stop the service
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

    // Cleanup
    async cleanup() {
        try {
            // Clear the cache
            this.cache.clear();
            this.walletStats.wallets.cached = 0;
            
            // Update database to mark wallets as inactive, EXCEPT for liquidity wallets
            // This ensures our liquidity wallet stays active between restarts
            await prisma.seed_wallets.updateMany({
                where: { 
                    is_active: true,
                    purpose: { not: 'liquidity' } // Exclude liquidity wallets
                },
                data: { 
                    is_active: false,
                    updated_at: new Date(),
                    metadata: {
                        cleanup_reason: 'service_shutdown',
                        cleanup_time: new Date().toISOString()
                    }
                }
            });
            
            // Log how many liquidity wallets are still active
            const activeCount = await prisma.seed_wallets.count({
                where: { 
                    is_active: true,
                    purpose: 'liquidity'
                }
            });
            
            logApi.info(`Preserved ${activeCount} active liquidity wallet(s) during cleanup`);

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