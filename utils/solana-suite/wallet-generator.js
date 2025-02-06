// /utils/solana-suite/wallet-generator.js

import { Keypair } from '@solana/web3.js';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import LRUCache from 'lru-cache';

const prisma = new PrismaClient({
    datasources: {
        db: {
            url: process.env.DATABASE_URL_PROD
        }
    }
});

// Add more specific error types
class WalletGeneratorError extends Error {
    constructor(message, code, details) {
        super(message);
        this.name = 'WalletGeneratorError';
        this.code = code;
        this.details = details;
    }
}

export class WalletGenerator {
    // Add cache with size limits and TTL
    static walletCache = new LRUCache({
        max: 1000,
        ttl: 15 * 60 * 1000 // 15 minutes
    });

    // Encrypt a private key using the wallet encryption key from env
    static encryptPrivateKey(privateKey) {
        if (!process.env.WALLET_ENCRYPTION_KEY) {
            throw new WalletGeneratorError(
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
            throw new WalletGeneratorError(
                'Failed to encrypt private key',
                'ENCRYPTION_FAILED',
                { originalError: error.message }
            );
        }
    }

    static async initialize() {
        try {
            // Load existing wallets from database into cache
            const existingWallets = await prisma.seed_wallets.findMany({
                select: {
                    purpose: true,
                    wallet_address: true,
                    private_key: true
                }
            });
            
            existingWallets.forEach(wallet => {
                const identifier = wallet.purpose.replace('Seed wallet for ', '');
                this.walletCache.set(identifier, {
                    publicKey: wallet.wallet_address,
                    secretKey: wallet.private_key,
                    timestamp: Date.now()
                });
            });
            console.log(`Initialized wallet cache with ${existingWallets.length} wallets`);
        } catch (error) {
            console.error('Failed to initialize wallet cache:', error);
            throw new WalletGeneratorError(
                'Failed to initialize wallet cache',
                'INIT_FAILED',
                { originalError: error.message }
            );
        }
    }

    static async generateWallet(identifier) {
        try {
            // Check if wallet already exists in cache
            const existingWallet = this.walletCache.get(identifier);
            if (existingWallet) {
                return existingWallet;
            }

            // Check if wallet exists in database but not in cache
            const existingDbWallet = await prisma.seed_wallets.findFirst({
                where: { purpose: `Seed wallet for ${identifier}` },
                select: {
                    wallet_address: true,
                    private_key: true
                }
            });

            if (existingDbWallet) {
                const walletInfo = {
                    publicKey: existingDbWallet.wallet_address,
                    secretKey: existingDbWallet.private_key,
                    timestamp: Date.now()
                };
                this.walletCache.set(identifier, walletInfo);
                return walletInfo;
            }

            // Generate new wallet
            const keypair = Keypair.generate();
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
                    is_active: true
                }
            });

            // Save to cache
            this.walletCache.set(identifier, walletInfo);
            return walletInfo;
        } catch (error) {
            throw new WalletGeneratorError(
                'Failed to generate wallet',
                'GENERATION_FAILED',
                { identifier, originalError: error.message }
            );
        }
    }

    static async getWallet(identifier) {
        try {
            // Check cache first
            const cachedWallet = this.walletCache.get(identifier);
            if (cachedWallet) {
                return cachedWallet;
            }

            // Check database
            const dbWallet = await prisma.seed_wallets.findFirst({
                where: { purpose: `Seed wallet for ${identifier}` },
                select: {
                    wallet_address: true,
                    private_key: true
                }
            });

            if (dbWallet) {
                const walletInfo = {
                    publicKey: dbWallet.wallet_address,
                    secretKey: dbWallet.private_key,
                    timestamp: Date.now()
                };
                this.walletCache.set(identifier, walletInfo);
                return walletInfo;
            }

            return undefined;
        } catch (error) {
            throw new WalletGeneratorError(
                'Failed to retrieve wallet',
                'RETRIEVAL_FAILED',
                { identifier, originalError: error.message }
            );
        }
    }

    // Add cache cleanup
    static cleanupCache() {
        const maxCacheAge = 1000 * 60 * 60; // 1 hour
        const now = Date.now();
        for (const [key, value] of this.walletCache.entries()) {
            if (value.timestamp < now - maxCacheAge) {
                this.walletCache.delete(key);
            }
        }
    }
}

// Initialize wallet cache when module is loaded
WalletGenerator.initialize();
