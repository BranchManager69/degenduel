import { PrismaClient } from '@prisma/client';
import { Keypair } from '@solana/web3.js';
import { logApi } from '../utils/logger-suite/logger.js';
import VanityWalletService from './vanityWalletService.js';
import crypto from 'crypto';

const prisma = new PrismaClient();

class ContestWalletService {
    // Encrypt wallet private key
    static encryptPrivateKey(privateKey) {
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
    }

    // Create a new contest wallet, trying vanity wallet first
    static async createContestWallet(contestId, preferredPattern = null) {
        try {
            // First, try to get a vanity wallet
            const vanityWallet = await VanityWalletService.getAvailableWallet(preferredPattern);
            
            if (vanityWallet) {
                // Create contest wallet using vanity wallet
                const contestWallet = await prisma.contest_wallets.create({
                    data: {
                        contest_id: contestId,
                        wallet_address: vanityWallet.wallet_address,
                        private_key: vanityWallet.private_key
                    }
                });

                // Mark vanity wallet as used
                await VanityWalletService.assignWalletToContest(vanityWallet.id, contestId);

                logApi.info('Created contest wallet using vanity wallet', {
                    contest_id: contestId,
                    pattern: vanityWallet.pattern
                });

                return contestWallet;
            }

            // If no vanity wallet available, generate a new one
            const keypair = Keypair.generate();
            const contestWallet = await prisma.contest_wallets.create({
                data: {
                    contest_id: contestId,
                    wallet_address: keypair.publicKey.toString(),
                    private_key: this.encryptPrivateKey(
                        Buffer.from(keypair.secretKey).toString('base64')
                    )
                }
            });

            logApi.info('Created contest wallet with generated keypair', {
                contest_id: contestId
            });

            return contestWallet;
        } catch (error) {
            logApi.error('Failed to create contest wallet:', error);
            throw error;
        }
    }
}

export default ContestWalletService; 