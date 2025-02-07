import { PrismaClient } from '@prisma/client';
import { Keypair } from '@solana/web3.js';
import { logApi } from '../utils/logger-suite/logger.js';
import VanityWalletService from './vanityWalletService.js';
import ServiceManager, { SERVICE_NAMES } from '../utils/service-manager.js';
import crypto from 'crypto';

const prisma = new PrismaClient();

// Configuration
const CONTEST_WALLET_CONFIG = {
    encryption_algorithm: 'aes-256-gcm',
    min_balance_sol: 0.01,
    max_retries: 3,
    retry_delay_ms: 5000
};

// Statistics tracking
let walletStats = {
    wallets_created: 0,
    vanity_wallets_used: 0,
    generated_wallets: 0,
    errors: {
        creation_failures: 0,
        encryption_failures: 0,
        last_error: null
    },
    performance: {
        average_creation_time_ms: 0,
        total_operations: 0
    }
};

class ContestWalletService {
    static async initialize() {
        try {
            // Check if service should be enabled
            const setting = await prisma.system_settings.findUnique({
                where: { key: 'contest_wallet_service' }
            });
            
            const enabled = setting?.value?.enabled ?? true; // Default to true for this critical service

            await ServiceManager.markServiceStarted(
                SERVICE_NAMES.CONTEST_WALLET,
                {
                    ...CONTEST_WALLET_CONFIG,
                    enabled
                },
                walletStats
            );

            if (!enabled) {
                logApi.info('Contest Wallet Service is disabled');
                return;
            }

            if (enabled) {
                logApi.info('Contest Wallet Service initialized');
            }
        } catch (error) {
            logApi.error('Failed to initialize Contest Wallet Service:', error);
            throw error;
        }
    }

    static async shutdown() {
        try {
            await ServiceManager.markServiceStopped(
                SERVICE_NAMES.CONTEST_WALLET,
                CONTEST_WALLET_CONFIG,
                walletStats
            );
            logApi.info('Contest Wallet Service shut down');
        } catch (error) {
            logApi.error('Failed to shut down Contest Wallet Service:', error);
            throw error;
        }
    }

    // Encrypt wallet private key
    static encryptPrivateKey(privateKey) {
        try {
            const iv = crypto.randomBytes(16);
            const cipher = crypto.createCipheriv(
                'aes-256-gcm',
                Buffer.from(process.env.WALLET_ENCRYPTION_KEY, 'hex'),
                iv
            );

            const encrypted = Buffer.concat([
                cipher.update(privateKey, 'utf8'),
                cipher.final()
            ]);

            const tag = cipher.getAuthTag();

            return JSON.stringify({
                encrypted: encrypted.toString('hex'),
                iv: iv.toString('hex'),
                tag: tag.toString('hex')
            });
        } catch (error) {
            walletStats.errors.encryption_failures++;
            walletStats.errors.last_error = error.message;
            throw error;
        }
    }

    // Create a new contest wallet, trying vanity wallet first
    static async createContestWallet(contestId, preferredPattern = null) {
        const startTime = Date.now();
        try {
            // First, try to get a vanity wallet
            const vanityWallet = await VanityWalletService.getAvailableWallet(preferredPattern);
            
            let contestWallet;
            if (vanityWallet) {
                // Create contest wallet using vanity wallet
                contestWallet = await prisma.contest_wallets.create({
                    data: {
                        contest_id: contestId,
                        wallet_address: vanityWallet.wallet_address,
                        private_key: vanityWallet.private_key
                    }
                });

                // Mark vanity wallet as used
                await VanityWalletService.assignWalletToContest(vanityWallet.id, contestId);

                walletStats.vanity_wallets_used++;
                logApi.info('Created contest wallet using vanity wallet', {
                    contest_id: contestId,
                    pattern: vanityWallet.pattern
                });
            } else {
                // If no vanity wallet available, generate a new one
                const keypair = Keypair.generate();
                contestWallet = await prisma.contest_wallets.create({
                    data: {
                        contest_id: contestId,
                        wallet_address: keypair.publicKey.toString(),
                        private_key: this.encryptPrivateKey(
                            Buffer.from(keypair.secretKey).toString('base64')
                        )
                    }
                });

                walletStats.generated_wallets++;
                logApi.info('Created contest wallet with generated keypair', {
                    contest_id: contestId
                });
            }

            // Update statistics
            walletStats.wallets_created++;
            walletStats.total_operations++;
            walletStats.performance.average_creation_time_ms = 
                (walletStats.performance.average_creation_time_ms * (walletStats.total_operations - 1) + 
                (Date.now() - startTime)) / walletStats.total_operations;

            // Update service state
            await ServiceManager.updateServiceHeartbeat(
                SERVICE_NAMES.CONTEST_WALLET,
                CONTEST_WALLET_CONFIG,
                walletStats
            );

            return contestWallet;
        } catch (error) {
            // Update error statistics
            walletStats.errors.creation_failures++;
            walletStats.errors.last_error = error.message;

            // Update service state with error
            await ServiceManager.markServiceError(
                SERVICE_NAMES.CONTEST_WALLET,
                error,
                CONTEST_WALLET_CONFIG,
                walletStats
            );

            logApi.error('Failed to create contest wallet:', error);
            throw error;
        }
    }
}

// Initialize service when module is loaded
ContestWalletService.initialize().catch(error => {
    logApi.error('Failed to initialize Contest Wallet Service:', error);
});

export default ContestWalletService; 