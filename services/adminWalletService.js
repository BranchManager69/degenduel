// services/adminWalletService.js

/*
 * This service is responsible for managing the admin's wallet.
 * It allows the admin to transfer SOL and tokens to other wallets.
 * 
 */

// ** Service Auth **
import { generateServiceAuthHeader } from '../config/service-auth.js';
// ** Service Class **
import VanityWalletService from './vanityWalletService.js'; // Service Subclass
import { BaseService } from '../utils/service-suite/base-service.js';
import { ServiceError, ServiceErrorTypes } from '../utils/service-suite/service-error.js';
import { config } from '../config/config.js';
import { logApi } from '../utils/logger-suite/logger.js';
import AdminLogger from '../utils/admin-logger.js';
import prisma from '../config/prisma.js';
// ** Service Manager **
import { ServiceManager } from '../utils/service-suite/service-manager.js';
// Solana
import crypto from 'crypto';
import bs58 from 'bs58';
import { Connection, PublicKey, Transaction, SystemProgram, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { createAssociatedTokenAccountInstruction, getAssociatedTokenAddress, getAccount, createTransferInstruction } from '@solana/spl-token';
import { SERVICE_NAMES, getServiceMetadata } from '../utils/service-suite/service-constants.js';

const connection = new Connection(config.rpc_urls.primary, 'confirmed');

const ADMIN_WALLET_CONFIG = {
    name: SERVICE_NAMES.ADMIN_WALLET,
    description: getServiceMetadata(SERVICE_NAMES.ADMIN_WALLET).description,
    checkIntervalMs: 60 * 1000, // Check every minute
    maxRetries: 3,
    retryDelayMs: 5000,
    circuitBreaker: {
        failureThreshold: 5,
        resetTimeoutMs: 60000, // 1 minute timeout when circuit is open
        minHealthyPeriodMs: 120000 // 2 minutes of health before fully resetting
    },
    backoff: {
        initialDelayMs: 1000,
        maxDelayMs: 30000,
        factor: 2
    },
    wallet: {
        min_balance_sol: 0.05,
        transaction_timeout_ms: 30000
    }
};

// Admin Wallet Service
class AdminWalletService extends BaseService {
    constructor() {
        super(ADMIN_WALLET_CONFIG.name, ADMIN_WALLET_CONFIG);
        
        // Service-specific state
        this.walletStats = {
    operations: {
        total: 0,
        successful: 0,
        failed: 0
    },
    transfers: {
        sol: {
            count: 0,
            total_amount: 0
        },
        tokens: {
            count: 0,
            by_mint: {}
        }
    },
    performance: {
        average_operation_time_ms: 0
    }
};
    }

    // Utility functions
    decryptWallet(encryptedData) {
        try {
            const { encrypted, iv, tag, aad } = JSON.parse(encryptedData);
            const decipher = crypto.createDecipheriv(
                'aes-256-gcm',
                Buffer.from(process.env.WALLET_ENCRYPTION_KEY, 'hex'),
                Buffer.from(iv, 'hex')
            );
            
            decipher.setAuthTag(Buffer.from(tag, 'hex'));
            if (aad) decipher.setAAD(Buffer.from(aad));
            
            const decrypted = Buffer.concat([
                decipher.update(Buffer.from(encrypted, 'hex')),
                decipher.final()
            ]);
            
            return decrypted.toString();
        } catch (error) {
            throw ServiceError.operation('Failed to decrypt wallet', {
                error: error.message,
                type: 'DECRYPTION_ERROR'
            });
        }
    }

    // Core wallet operations
    async getWalletDetails(walletAddress, tokenMints = []) {
        try {
            const pubkey = new PublicKey(walletAddress);
            const solBalance = await connection.getBalance(pubkey);
            
            logApi.info('Wallet',  walletAddress + ":");
            logApi.info('\tSOL balance: ' + (solBalance / LAMPORTS_PER_SOL).toFixed(3) + ' SOL');
            logApi.info('\tTokens held: ' + tokenMints.join(', '));
            
            const tokenBalances = await Promise.all(
                tokenMints.map(async (mint) => {
                    try {
                        const associatedTokenAddress = await getAssociatedTokenAddress(
                            new PublicKey(mint),
                            pubkey
                        );
                        const tokenAccount = await getAccount(connection, associatedTokenAddress);
                        return {
                            mint,
                            balance: tokenAccount.amount.toString(),
                            address: associatedTokenAddress.toString()
                        };
                    } catch (error) {
                        return {
                            mint,
                            balance: '0',
                            error: error.message
                        };
                    }
                })
            );

            return {
                address: walletAddress,
                solBalance: solBalance / LAMPORTS_PER_SOL,
                tokens: tokenBalances
            };
        } catch (error) {
            throw ServiceError.operation('Failed to get wallet details', {
                error: error.message,
                wallet: walletAddress
            });
        }
    }

    // Admin context management
    async setAdminContext(adminId) {
        await prisma.$executeRaw`SELECT set_admin_context(${adminId})`;
    }

    async logAdminAction(adminId, actionType, details, options = {}) {
        await prisma.admin_logs.create({
            data: {
                admin_id: adminId,
                action_type: actionType,
                details,
                ip_address: options.ip_address,
                wallet_address: options.wallet_address,
                transaction_id: options.transaction_id,
                contest_id: options.contest_id,
                status: options.status || 'success',
                error_details: options.error_details
            }
        });
    }

    // Transfer methods with statistics tracking
    async transferSOL(fromWalletEncrypted, toAddress, amount, description = '', adminId, ip = null) {
        const startTime = Date.now();
        try {
            await this.setAdminContext(adminId);

            const result = await this._transferSOL(fromWalletEncrypted, toAddress, amount, description);
            
            await this.logAdminAction(adminId, 'MANUAL_SOL_TRANSFER', {
                from: fromWalletEncrypted,
                to: toAddress,
                amount,
                description,
                signature: result.signature
            }, {
                ip_address: ip,
                wallet_address: fromWalletEncrypted
            });

            // Update statistics
            this.walletStats.operations.total++;
            this.walletStats.operations.successful++;
            this.walletStats.transfers.sol.count++;
            this.walletStats.transfers.sol.total_amount += amount;
            this.walletStats.performance.average_operation_time_ms = 
                (this.walletStats.performance.average_operation_time_ms * (this.walletStats.operations.total - 1) + 
                (Date.now() - startTime)) / this.walletStats.operations.total;

            return result;
        } catch (error) {
            // Log failed action
            await this.logAdminAction(adminId, 'MANUAL_SOL_TRANSFER', {
                from: fromWalletEncrypted,
                to: toAddress,
                amount,
                description
            }, {
                ip_address: ip,
                wallet_address: fromWalletEncrypted,
                status: 'failed',
                error_details: error.message
            });

            // Update error statistics
            this.walletStats.operations.total++;
            this.walletStats.operations.failed++;

            throw ServiceError.operation('SOL transfer failed', {
                error: error.message,
                from: fromWalletEncrypted,
                to: toAddress,
                amount
            });
        }
    }

    async transferToken(fromWalletEncrypted, toAddress, mint, amount, description = '', adminId, ip = null) {
        const startTime = Date.now();
        try {
            await this.setAdminContext(adminId);
            const result = await this._transferToken(fromWalletEncrypted, toAddress, mint, amount, description);
            
            await this.logAdminAction(adminId, 'MANUAL_TOKEN_TRANSFER', {
                from: fromWalletEncrypted,
                to: toAddress,
                mint,
                amount,
                description,
                signature: result.signature
            }, {
                ip_address: ip,
                wallet_address: fromWalletEncrypted
            });

            // Update statistics
            this.walletStats.operations.total++;
            this.walletStats.operations.successful++;
            this.walletStats.transfers.tokens.count++;
            this.walletStats.transfers.tokens.by_mint[mint] = 
                (this.walletStats.transfers.tokens.by_mint[mint] || 0) + amount;
            this.walletStats.performance.average_operation_time_ms = 
                (this.walletStats.performance.average_operation_time_ms * (this.walletStats.operations.total - 1) + 
                (Date.now() - startTime)) / this.walletStats.operations.total;

            return result;
        } catch (error) {
            await this.logAdminAction(adminId, 'MANUAL_TOKEN_TRANSFER', {
                from: fromWalletEncrypted,
                to: toAddress,
                mint,
                amount,
                description
            }, {
                ip_address: ip,
                wallet_address: fromWalletEncrypted,
                status: 'failed',
                error_details: error.message
            });

            // Update error statistics
            this.walletStats.operations.total++;
            this.walletStats.operations.failed++;

            throw ServiceError.operation('Token transfer failed', {
                error: error.message,
                from: fromWalletEncrypted,
                to: toAddress,
                    mint,
                amount
            });
        }
    }

    // Internal transfer implementations
    async _transferSOL(fromWalletEncrypted, toAddress, amount, description = '') {
        try {
            const decryptedKey = this.decryptWallet(fromWalletEncrypted);
            const fromKeypair = Keypair.fromSecretKey(bs58.decode(decryptedKey));
            
            const transaction = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: fromKeypair.publicKey,
                    toPubkey: new PublicKey(toAddress),
                    lamports: Math.floor(amount * LAMPORTS_PER_SOL),
                })
            );

            const signature = await connection.sendTransaction(transaction, [fromKeypair]);
            await connection.confirmTransaction(signature);

            // Log the transfer
            await prisma.transactions.create({
                data: {
                    wallet_address: fromKeypair.publicKey.toString(),
                    type: config.transaction_types.WITHDRAWAL,
                    amount,
                    description: description || `Admin SOL transfer to ${toAddress}`,
                    status: config.transaction_statuses.COMPLETED,
                    blockchain_signature: signature,
                    completed_at: new Date(),
                    created_at: new Date()
                }
            });

            return { signature, success: true };
        } catch (error) {
            throw ServiceError.blockchain('SOL transfer failed', {
                error: error.message,
                from: fromWalletEncrypted,
                to: toAddress,
                amount
            });
        }
    }

    async _transferToken(fromWalletEncrypted, toAddress, mint, amount, description = '') {
        try {
            const decryptedKey = this.decryptWallet(fromWalletEncrypted);
            const fromKeypair = Keypair.fromSecretKey(bs58.decode(decryptedKey));
            const toPubkey = new PublicKey(toAddress);

            // Get associated token accounts
            const fromATA = await getAssociatedTokenAddress(
                new PublicKey(mint),
                fromKeypair.publicKey
            );
            const toATA = await getAssociatedTokenAddress(
                new PublicKey(mint),
                toPubkey
            );

            // Create transaction
            const transaction = new Transaction();

            // Check if destination token account exists
            try {
                await getAccount(connection, toATA);
            } catch (error) {
                if (error.name === 'TokenAccountNotFoundError') {
                    transaction.add(
                        createAssociatedTokenAccountInstruction(
                            fromKeypair.publicKey,
                            toATA,
                            toPubkey,
                            new PublicKey(mint)
                        )
                    );
                }
            }

            // Add transfer instruction
            transaction.add(
                createTransferInstruction(
                    fromATA,
                    toATA,
                    fromKeypair.publicKey,
                    amount
                )
            );

            const signature = await connection.sendTransaction(transaction, [fromKeypair]);
            await connection.confirmTransaction(signature);

            // Log the transfer
            await prisma.transactions.create({
                data: {
                    wallet_address: fromKeypair.publicKey.toString(),
                    type: config.transaction_types.TOKEN_SALE,
                    amount,
                    description: description || `Admin token transfer to ${toAddress}`,
                    status: config.transaction_statuses.COMPLETED,
                    blockchain_signature: signature,
                    token_mint: mint,
                    completed_at: new Date(),
                    created_at: new Date()
                }
            });

            return { signature, success: true };
        } catch (error) {
            throw ServiceError.blockchain('Token transfer failed', {
                error: error.message,
                from: fromWalletEncrypted,
                to: toAddress,
                mint,
                amount
            });
        }
    }

    // Mass transfer methods
    async massTransferSOL(fromWalletEncrypted, transfers) {
        const results = [];
        for (const transfer of transfers) {
            try {
                const result = await this.transferSOL(
                    fromWalletEncrypted,
                    transfer.address,
                    transfer.amount,
                    transfer.description
                );
                results.push({
                    address: transfer.address,
                    amount: transfer.amount,
                    success: true,
                    signature: result.signature
                });
            } catch (error) {
                results.push({
                    address: transfer.address,
                    amount: transfer.amount,
                    success: false,
                    error: error.message
                });
            }
        }
        return results;
    }

    async massTransferTokens(fromWalletEncrypted, mint, transfers) {
        const results = [];
        for (const transfer of transfers) {
            try {
                const result = await this.transferToken(
                    fromWalletEncrypted,
                    transfer.address,
                    mint,
                    transfer.amount,
                    transfer.description
                );
                results.push({
                    address: transfer.address,
                    amount: transfer.amount,
                    success: true,
                    signature: result.signature
                });
            } catch (error) {
                results.push({
                    address: transfer.address,
                    amount: transfer.amount,
                    success: false,
                    error: error.message
                });
            }
        }
        return results;
    }

    // Wallet management methods
    async getAllContestWallets() {
        const contestWallets = await prisma.contest_wallets.findMany({
            include: {
                contests: {
                    select: {
                        id: true,
                        status: true,
                        contest_code: true,
                        token_mint: true
                    }
                }
            }
        });

        return Promise.all(contestWallets.map(async wallet => {
            const details = await this.getWalletDetails(
                wallet.wallet_address,
                wallet.contests.token_mint ? [wallet.contests.token_mint] : []
            );
            return {
                ...wallet,
                ...details
            };
        }));
    }

    async exportWalletPrivateKey(walletAddress) {
        try {
            const wallet = await prisma.contest_wallets.findFirst({
                where: { wallet_address: walletAddress }
            });

            if (!wallet) {
                throw ServiceError.validation('Wallet not found');
            }

            const decryptedKey = this.decryptWallet(wallet.private_key);
            return {
                address: walletAddress,
                privateKey: decryptedKey
            };
        } catch (error) {
            throw ServiceError.operation('Failed to export wallet', {
                error: error.message,
                wallet: walletAddress
            });
        }
    }

    async getTotalSOLBalance() {
        try {
            const wallets = await prisma.contest_wallets.findMany({
                select: {
                    wallet_address: true
                }
            });

            const balances = await Promise.all(
                wallets.map(async wallet => {
                    try {
                        const pubkey = new PublicKey(wallet.wallet_address);
                        return await connection.getBalance(pubkey);
                    } catch (error) {
                        logApi.error('Failed to get balance for wallet:', {
                            wallet: wallet.wallet_address,
                            error: error.message
                        });
                        return 0;
                    }
                })
            );

            const totalLamports = balances.reduce((sum, balance) => sum + balance, 0);
            const totalSOL = totalLamports / LAMPORTS_PER_SOL;

            return {
                totalSOL,
                totalLamports,
                walletCount: wallets.length
            };
        } catch (error) {
            throw ServiceError.operation('Failed to get total SOL balance', {
                error: error.message
            });
        }
    }

    async getContestWalletsOverview() {
        try {
            const wallets = await prisma.contest_wallets.findMany({
                include: {
                    contests: {
                        select: {
                            contest_code: true,
                            status: true,
                            start_time: true,
                            end_time: true
                        }
                    }
                }
            });

            const balances = await Promise.all(
                wallets.map(async (wallet) => {
                    try {
                        const balance = await connection.getBalance(new PublicKey(wallet.wallet_address));
                        return {
                            ...wallet,
                            current_balance: balance / LAMPORTS_PER_SOL,
                            balance_difference: (balance / LAMPORTS_PER_SOL) - Number(wallet.balance),
                            last_sync_age: wallet.last_sync ? Date.now() - wallet.last_sync.getTime() : null
                        };
                    } catch (error) {
                        logApi.error(`Failed to get balance for wallet ${wallet.wallet_address}:`, error);
                        return {
                            ...wallet,
                            current_balance: null,
                            balance_difference: null,
                            error: error.message
                        };
                    }
                })
            );

            const stats = {
                total_wallets: wallets.length,
                active_contests: wallets.filter(w => w.contests?.status === 'active').length,
                total_balance: balances.reduce((sum, w) => sum + (w.current_balance || 0), 0),
                needs_sync: balances.filter(w => Math.abs(w.balance_difference || 0) > 0.001).length,
                status_breakdown: {
                    active: wallets.filter(w => w.contests?.status === 'active').length,
                    pending: wallets.filter(w => w.contests?.status === 'pending').length,
                    completed: wallets.filter(w => w.contests?.status === 'completed').length,
                    cancelled: wallets.filter(w => w.contests?.status === 'cancelled').length
                }
            };

            return {
                wallets: balances,
                stats
            };
        } catch (error) {
            throw ServiceError.operation('Failed to get contest wallets overview', {
                error: error.message
            });
        }
    }

    // Main operation implementation
    async performOperation() {
        const startTime = Date.now();
        
        try {
            // This service is primarily event-driven (admin actions)
            // But we can use this to perform periodic health checks
            const overview = await this.getContestWalletsOverview();
            
            // Update service stats
            this.stats.lastCheck = new Date().toISOString();
            this.stats.performance.lastOperationTimeMs = Date.now() - startTime;
            this.stats.performance.averageOperationTimeMs = 
                (this.stats.performance.averageOperationTimeMs * this.stats.operations.total + 
                (Date.now() - startTime)) / (this.stats.operations.total + 1);

            return {
                duration: Date.now() - startTime,
                overview
            };
        } catch (error) {
            // Let the base class handle the error and circuit breaker
            throw error;
        }
    }
}

// Export service singleton
const adminWalletService = new AdminWalletService();
export default adminWalletService; 