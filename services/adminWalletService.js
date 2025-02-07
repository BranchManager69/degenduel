// services/adminWalletService.js

import { PrismaClient } from '@prisma/client';
import { Connection, PublicKey, Transaction, SystemProgram, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, createAssociatedTokenAccountInstruction, getAssociatedTokenAddress, getAccount, createTransferInstruction } from '@solana/spl-token';
import { logApi } from '../utils/logger-suite/logger.js';
import { config } from '../config/config.js';
import crypto from 'crypto';
import bs58 from 'bs58';
import ServiceManager, { SERVICE_NAMES } from '../utils/service-manager.js';

const prisma = new PrismaClient();
const connection = new Connection(config.rpc_urls.primary, 'confirmed');

// Configuration
const ADMIN_WALLET_CONFIG = {
    max_retries: 3,
    retry_delay_ms: 5000,
    min_balance_sol: 0.05,
    transaction_timeout_ms: 30000
};

// Statistics tracking
let adminWalletStats = {
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

class AdminWalletService {
    static async initialize() {
        try {
            await ServiceManager.markServiceStarted(
                SERVICE_NAMES.ADMIN_WALLET,
                ADMIN_WALLET_CONFIG,
                adminWalletStats
            );
            logApi.info('Admin Wallet Service initialized');
        } catch (error) {
            logApi.error('Failed to initialize Admin Wallet Service:', error);
            throw error;
        }
    }

    static async shutdown() {
        try {
            await ServiceManager.markServiceStopped(
                SERVICE_NAMES.ADMIN_WALLET,
                ADMIN_WALLET_CONFIG,
                adminWalletStats
            );
            logApi.info('Admin Wallet Service shut down');
        } catch (error) {
            logApi.error('Failed to shut down Admin Wallet Service:', error);
            throw error;
        }
    }

    // Decrypt a wallet's private key
    static decryptWallet(encryptedData) {
        try {
            logApi.info('Decrypting wallet...');
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
            logApi.info('Decrypted wallet:', decrypted.toString());
            return decrypted.toString();
        } catch (error) {
            logApi.error('Failed to decrypt wallet:', error);
            throw error;
        }
    }

    // Get wallet details including balances of SOL and specified tokens
    static async getWalletDetails(walletAddress, tokenMints = []) {
        try {
            const pubkey = new PublicKey(walletAddress);
            const solBalance = await connection.getBalance(pubkey);
            // Log wallet holdings
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
            logApi.error('Failed to get wallet details:', error);
            throw error;
        }
    }

    // Set admin context for database triggers
    static async setAdminContext(adminId) {
        await prisma.$executeRaw`SELECT set_admin_context(${adminId})`;
    }

    // Log admin action directly
    static async logAdminAction(adminId, actionType, details, options = {}) {
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

    // Update transfer methods to track statistics
    static async transferSOL(fromWalletEncrypted, toAddress, amount, description = '', adminId, ip = null) {
        const startTime = Date.now();
        try {
            // Set admin context for triggers
            await this.setAdminContext(adminId);

            const result = await this._transferSOL(fromWalletEncrypted, toAddress, amount, description);
            
            // Log the action directly
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
            adminWalletStats.operations.total++;
            adminWalletStats.operations.successful++;
            adminWalletStats.transfers.sol.count++;
            adminWalletStats.transfers.sol.total_amount += amount;
            adminWalletStats.performance.average_operation_time_ms = 
                (adminWalletStats.performance.average_operation_time_ms * (adminWalletStats.operations.total - 1) + 
                (Date.now() - startTime)) / adminWalletStats.operations.total;

            // Update service state
            await ServiceManager.updateServiceHeartbeat(
                SERVICE_NAMES.ADMIN_WALLET,
                ADMIN_WALLET_CONFIG,
                adminWalletStats
            );

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
            adminWalletStats.operations.total++;
            adminWalletStats.operations.failed++;

            // Update service state with error
            await ServiceManager.markServiceError(
                SERVICE_NAMES.ADMIN_WALLET,
                error,
                ADMIN_WALLET_CONFIG,
                adminWalletStats
            );

            throw error;
        }
    }

    // Similar updates for other transfer methods...
    static async transferToken(fromWalletEncrypted, toAddress, mint, amount, description = '', adminId, ip = null) {
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
            adminWalletStats.operations.total++;
            adminWalletStats.operations.successful++;
            adminWalletStats.transfers.tokens.count++;
            adminWalletStats.transfers.tokens.by_mint[mint] = 
                (adminWalletStats.transfers.tokens.by_mint[mint] || 0) + amount;
            adminWalletStats.performance.average_operation_time_ms = 
                (adminWalletStats.performance.average_operation_time_ms * (adminWalletStats.operations.total - 1) + 
                (Date.now() - startTime)) / adminWalletStats.operations.total;

            // Update service state
            await ServiceManager.updateServiceHeartbeat(
                SERVICE_NAMES.ADMIN_WALLET,
                ADMIN_WALLET_CONFIG,
                adminWalletStats
            );

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
            adminWalletStats.operations.total++;
            adminWalletStats.operations.failed++;

            // Update service state with error
            await ServiceManager.markServiceError(
                SERVICE_NAMES.ADMIN_WALLET,
                error,
                ADMIN_WALLET_CONFIG,
                adminWalletStats
            );

            throw error;
        }
    }

    // Mass transfer SOL to multiple addresses
    static async massTransferSOL(fromWalletEncrypted, transfers) {
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

    // Mass transfer tokens to multiple addresses
    static async massTransferTokens(fromWalletEncrypted, mint, transfers) {
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

    // Get all contest wallets with their balances
    static async getAllContestWallets() {
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

    // Export wallet private key (requires superadmin)
    static async exportWalletPrivateKey(walletAddress) {
        try {
            const wallet = await prisma.contest_wallets.findFirst({
                where: { wallet_address: walletAddress }
            });

            if (!wallet) {
                throw new Error('Wallet not found');
            }

            const decryptedKey = this.decryptWallet(wallet.private_key);
            return {
                address: walletAddress,
                privateKey: decryptedKey
            };
        } catch (error) {
            logApi.error('Failed to export wallet:', error);
            throw error;
        }
    }

    // Get total SOL balance across all contest wallets
    static async getTotalSOLBalance() {
        try {
            // Get all contest wallets
            const wallets = await prisma.contest_wallets.findMany({
                select: {
                    wallet_address: true
                }
            });

            // Get balances for all wallets in parallel
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

            // Sum all balances and convert to SOL
            const totalLamports = balances.reduce((sum, balance) => sum + balance, 0);
            const totalSOL = totalLamports / LAMPORTS_PER_SOL;

            return {
                totalSOL,
                totalLamports,
                walletCount: wallets.length
            };
        } catch (error) {
            logApi.error('Failed to get total SOL balance:', error);
            throw error;
        }
    }

    // Get contest wallets overview with additional metrics
    static async getContestWalletsOverview() {
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

            // Get SOL balances for all wallets
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

            // Calculate statistics
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
            logApi.error('Failed to get contest wallets overview:', error);
            throw error;
        }
    }

    // Rename existing transfer methods to be internal
    static async _transferSOL(fromWalletEncrypted, toAddress, amount, description = '') {
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
            logApi.error('SOL transfer failed:', error);
            throw error;
        }
    }

    static async _transferToken(fromWalletEncrypted, toAddress, mint, amount, description = '') {
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
            logApi.error('Token transfer failed:', error);
            throw error;
        }
    }
}

// Initialize service when module is loaded
AdminWalletService.initialize().catch(error => {
    logApi.error('Failed to initialize Admin Wallet Service:', error);
});

export default AdminWalletService; 