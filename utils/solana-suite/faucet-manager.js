// /utils/solana-suite/faucet-manager.js

import { PrismaClient } from '@prisma/client';
import { Connection, PublicKey, Keypair, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { WalletGenerator } from './wallet-generator.js';
import { decryptPrivateKey } from './solana-wallet.js';
import bs58 from 'bs58';
import { fileURLToPath } from 'url';
import LRUCache from 'lru-cache';

const prisma = new PrismaClient({
    datasources: {
        db: {
            url: process.env.DATABASE_URL_PROD
        }
    }
});

const connection = new Connection(
    process.env.QUICKNODE_MAINNET_HTTP || 'https://api.mainnet-beta.solana.com',
    {
        commitment: 'confirmed',
        confirmTransactionInitialTimeout: 120000, // 2 minutes
        wsEndpoint: process.env.QUICKNODE_MAINNET_WSS
    }
);

// Default configuration
const DEFAULT_CONFIG = {
    defaultAmount: 0.025,
    minFaucetBalance: 0.05,
    maxTestUsers: 10,
    maxRetries: 3,
    minConfirmations: 2
};

// Fee constants
const FEE_CONSTANTS = {
    BASE_FEE: 0.000005,  // Base transaction fee
    RENT_EXEMPTION: 0.00089088  // Minimum balance for rent exemption (~0.89088 SOL)
};

// Add more specific error types
class SolanaWalletError extends Error {
    constructor(message, code, details) {
        super(message);
        this.name = 'SolanaWalletError';
        this.code = code;
        this.details = details;
    }
}

export class FaucetManager {
    static config = DEFAULT_CONFIG;
    static walletCache = new LRUCache({
        max: 1000,
        ttl: 15 * 60 * 1000
    });

    static setConfig(newConfig) {
        FaucetManager.config = { ...DEFAULT_CONFIG, ...newConfig };
    }

    // Calculate total amount needed including fees
    static async calculateTotalAmount(toAddress, baseAmount) {
        try {
            // Check if destination account exists
            const accountInfo = await connection.getAccountInfo(new PublicKey(toAddress));
            const isNewAccount = !accountInfo || accountInfo.lamports === 0;

            // Calculate fees
            const baseFee = FEE_CONSTANTS.BASE_FEE;
            const rentExemption = isNewAccount ? FEE_CONSTANTS.RENT_EXEMPTION : 0;

            return {
                baseAmount,
                baseFee,
                rentExemption,
                totalAmount: baseAmount + baseFee + rentExemption,
                isNewAccount
            };
        } catch (error) {
            throw new SolanaWalletError(
                'Failed to calculate fees',
                'FEE_CALCULATION_FAILED',
                { originalError: error.message }
            );
        }
    }

    // Get detailed faucet status
    static async getFaucetStatus() {
        const faucetWallet = await this.getFaucetWallet();
        if (!faucetWallet) {
            throw new SolanaWalletError('Failed to get faucet wallet', 'WALLET_NOT_FOUND');
        }

        const balance = await connection.getBalance(new PublicKey(faucetWallet.publicKey));
        const balanceSOL = balance / LAMPORTS_PER_SOL;

        // Get recent transactions
        const transactions = await prisma.transactions.findMany({
            where: {
                wallet_address: faucetWallet.publicKey,
                processed_at: {
                    gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
                }
            },
            orderBy: {
                processed_at: 'desc'
            },
            take: 50
        });

        return {
            address: faucetWallet.publicKey,
            balance: balanceSOL,
            availableForDistribution: Math.max(0, balanceSOL - this.config.minFaucetBalance),
            canFundUsers: Math.floor((balanceSOL - this.config.minFaucetBalance) / this.config.defaultAmount),
            recentTransactions: transactions,
            config: this.config,
            fees: FEE_CONSTANTS
        };
    }

    // Enhanced transaction confirmation
    static async confirmTransaction(signature, commitment = 'confirmed') {
        let retries = 0;
        const maxRetries = this.config.maxRetries;
        
        while (retries < maxRetries) {
            try {
                const confirmation = await connection.confirmTransaction({
                    signature,
                    blockhash: await connection.getLatestBlockhash().blockhash,
                    lastValidBlockHeight: await connection.getBlockHeight()
                }, commitment);

                if (confirmation.value.err) {
                    throw new Error(`Transaction failed: ${confirmation.value.err}`);
                }

                // Get transaction details
                const tx = await connection.getTransaction(signature, {
                    maxSupportedTransactionVersion: 0
                });

                return {
                    confirmed: true,
                    signature,
                    slot: tx.slot,
                    confirmations: tx.confirmations,
                    fee: tx.meta.fee / LAMPORTS_PER_SOL,
                    timestamp: tx.blockTime
                };
            } catch (error) {
                retries++;
                if (retries === maxRetries) {
                    throw new SolanaWalletError(
                        'Transaction confirmation failed',
                        'CONFIRMATION_FAILED',
                        { signature, error: error.message }
                    );
                }
                await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds before retry
            }
        }
    }

    static async sendSOL(toAddress, amount) {
        const faucetWallet = await this.getFaucetWallet();
        if (!faucetWallet) {
            throw new SolanaWalletError('Failed to get faucet wallet', 'WALLET_NOT_FOUND');
        }

        try {
            // Calculate total amount needed including fees
            const { baseAmount, baseFee, rentExemption, totalAmount, isNewAccount } = 
                await this.calculateTotalAmount(toAddress, amount);

            // Verify faucet has enough balance
            const faucetBalance = await connection.getBalance(new PublicKey(faucetWallet.publicKey));
            const faucetBalanceSOL = faucetBalance / LAMPORTS_PER_SOL;

            if (faucetBalanceSOL < totalAmount + this.config.minFaucetBalance) {
                throw new SolanaWalletError(
                    'Insufficient faucet balance',
                    'INSUFFICIENT_BALANCE',
                    { required: totalAmount, available: faucetBalanceSOL }
                );
            }

            // Get current recipient balance
            const currentBalance = await connection.getBalance(new PublicKey(toAddress));
            const currentBalanceSOL = currentBalance / LAMPORTS_PER_SOL;

            // Setup transaction
            const decryptedPrivateKey = decryptPrivateKey(faucetWallet.secretKey);
            const privateKeyBytes = Buffer.from(decryptedPrivateKey, 'base64');
            const faucetKeypair = Keypair.fromSecretKey(privateKeyBytes);

            // Verify the public key matches
            if (faucetKeypair.publicKey.toString() !== faucetWallet.publicKey) {
                throw new SolanaWalletError('Public key mismatch', 'KEY_MISMATCH');
            }

            // Create and send transaction
            const transaction = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: faucetKeypair.publicKey,
                    toPubkey: new PublicKey(toAddress),
                    lamports: Math.floor(totalAmount * LAMPORTS_PER_SOL)
                })
            );

            const signature = await connection.sendTransaction(transaction, [faucetKeypair]);
            
            // Wait for confirmation with enhanced handling
            const confirmationResult = await this.confirmTransaction(signature);

            // Log the transaction
            const txLog = await prisma.transactions.create({
                data: {
                    wallet_address: toAddress,
                    type: 'DEPOSIT',
                    amount: totalAmount,
                    balance_before: currentBalanceSOL,
                    balance_after: currentBalanceSOL + totalAmount,
                    status: 'completed',
                    metadata: {
                        blockchain_signature: signature,
                        confirmation: confirmationResult,
                        fees: {
                            baseFee,
                            rentExemption,
                            isNewAccount
                        }
                    },
                    description: `Test user SOL funding${isNewAccount ? ' (new account)' : ''}`,
                    processed_at: new Date()
                }
            });

            return {
                success: true,
                transaction: txLog,
                confirmation: confirmationResult
            };

        } catch (error) {
            // Log failed transaction attempt
            await prisma.transactions.create({
                data: {
                    wallet_address: toAddress,
                    type: 'DEPOSIT',
                    amount: amount,
                    status: 'failed',
                    metadata: {
                        error: error.message,
                        code: error.code,
                        details: error.details
                    },
                    description: 'Failed test user SOL funding',
                    processed_at: new Date()
                }
            });

            throw error;
        }
    }

    static async getFaucetWallet() {
        const existingFaucet = await prisma.seed_wallets.findFirst({
            where: { purpose: 'Seed wallet for test-faucet' }
        });
        if (existingFaucet) {
            return WalletGenerator.getWallet('test-faucet');
        }
        console.log('\n=== IMPORTANT: Test Faucet Setup Required ===');
        console.log('Generating new test faucet wallet...');
        const faucetWallet = await WalletGenerator.generateWallet('test-faucet');
        console.log(`\nTest Faucet Address: ${faucetWallet.publicKey}`);
        console.log(`Please send at least ${this.config.defaultAmount * this.config.maxTestUsers} SOL to this address for test user funding.`);
        console.log('===============================================\n');
        return faucetWallet;
    }

    static async checkBalance() {
        const faucetWallet = await this.getFaucetWallet();
        if (!faucetWallet) {
            throw new Error('Failed to get test faucet wallet');
        }
        const balance = await connection.getBalance(new PublicKey(faucetWallet.publicKey));
        const balanceSOL = balance / LAMPORTS_PER_SOL;
        console.log('\n=== Test Faucet Balance ===');
        console.log(`Address: ${faucetWallet.publicKey}`);
        console.log(`Balance: ${balanceSOL} SOL`);
        console.log(`Available for distribution: ${Math.max(0, balanceSOL - this.config.minFaucetBalance)} SOL`);
        console.log(`Can fund approximately ${Math.floor((balanceSOL - this.config.minFaucetBalance) / this.config.defaultAmount)} new test users`);
        console.log('==========================\n');
        return balanceSOL;
    }

    static async recoverFromTestWallets() {
        console.log('Recovering SOL from test wallets...');
        // Get all test users (created in the last 24 hours)
        const testUsers = await prisma.users.findMany({
            where: {
                created_at: {
                    gte: new Date(Date.now() - 24 * 60 * 60 * 1000)
                },
                nickname: {
                    startsWith: 'Test User'
                }
            },
            select: {
                id: true,
                wallet_address: true
            }
        });
        const faucetWallet = await this.getFaucetWallet();
        if (!faucetWallet) {
            throw new Error('Failed to get test faucet wallet');
        }
        let totalRecovered = 0;
        for (const user of testUsers) {
            try {
                const balance = await connection.getBalance(new PublicKey(user.wallet_address));
                if (balance <= 0)
                    continue;
                const balanceSOL = balance / LAMPORTS_PER_SOL;
                const walletInfo = await WalletGenerator.getWallet(`test-user-${user.id}`);
                if (!walletInfo) {
                    console.log(`No private key found for ${user.wallet_address}, skipping...`);
                    continue;
                }
                const userKeypair = Keypair.fromSecretKey(bs58.decode(walletInfo.secretKey));
                // Leave enough for rent exemption
                const recoveryAmount = balance - (0.001 * LAMPORTS_PER_SOL);
                if (recoveryAmount <= 0)
                    continue;
                const recoveryAmountSOL = recoveryAmount / LAMPORTS_PER_SOL;
                const transaction = new Transaction().add(SystemProgram.transfer({
                    fromPubkey: userKeypair.publicKey,
                    toPubkey: new PublicKey(faucetWallet.publicKey),
                    lamports: recoveryAmount
                }));
                const signature = await connection.sendTransaction(transaction, [userKeypair]);
                await connection.confirmTransaction(signature);
                totalRecovered += recoveryAmountSOL;
                console.log(`Recovered ${recoveryAmountSOL} SOL from ${user.wallet_address}`);
                // Log the recovery transaction
                await prisma.transactions.create({
                    data: {
                        wallet_address: user.wallet_address,
                        type: 'WITHDRAWAL',
                        amount: recoveryAmountSOL,
                        balance_before: balanceSOL,
                        balance_after: balanceSOL - recoveryAmountSOL,
                        status: 'completed',
                        metadata: {
                            blockchain_signature: signature
                        },
                        description: 'Test wallet SOL recovery',
                        processed_at: new Date()
                    }
                });
            }
            catch (error) {
                console.error(`Failed to recover SOL from ${user.wallet_address}:`, error);
            }
        }
        console.log(`\nTotal SOL recovered: ${totalRecovered} SOL`);
        await this.checkBalance();
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
    
    // Core transfer functionality that both sendSOL and transferSOL will use
    static async executeTransfer(sourceWallet, toAddress, amount, options = {}) {
        try {
            // Calculate total amount needed including fees
            const { baseAmount, baseFee, rentExemption, totalAmount, isNewAccount } = 
                await this.calculateTotalAmount(toAddress, amount);

            // Get current balances
            const sourceBalance = await connection.getBalance(new PublicKey(sourceWallet.publicKey));
            const sourceBalanceSOL = sourceBalance / LAMPORTS_PER_SOL;
            const targetBalance = await connection.getBalance(new PublicKey(toAddress));
            const targetBalanceSOL = targetBalance / LAMPORTS_PER_SOL;

            // Setup transaction
            const decryptedPrivateKey = decryptPrivateKey(sourceWallet.secretKey);
            const privateKeyBytes = Buffer.from(decryptedPrivateKey, 'base64');
            const sourceKeypair = Keypair.fromSecretKey(privateKeyBytes);

            // Create and send transaction
            const transaction = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: sourceKeypair.publicKey,
                    toPubkey: new PublicKey(toAddress),
                    lamports: Math.floor(totalAmount * LAMPORTS_PER_SOL)
                })
            );

            const signature = await connection.sendTransaction(transaction, [sourceKeypair]);
            const confirmationResult = await this.confirmTransaction(signature);

            // Log the transaction
            const txLog = await prisma.transactions.create({
                data: {
                    wallet_address: toAddress,
                    type: options.type || 'TRANSFER',
                    amount: totalAmount,
                    balance_before: targetBalanceSOL,
                    balance_after: targetBalanceSOL + totalAmount,
                    status: 'completed',
                    metadata: {
                        blockchain_signature: signature,
                        confirmation: confirmationResult,
                        fees: {
                            baseFee,
                            rentExemption,
                            isNewAccount
                        },
                        source_wallet: sourceWallet.publicKey,
                        source_balance_before: sourceBalanceSOL,
                        source_balance_after: sourceBalanceSOL - totalAmount,
                        ...options.metadata
                    },
                    description: options.description || 'SOL transfer',
                    processed_at: new Date()
                }
            });

            return {
                success: true,
                transaction: txLog,
                confirmation: confirmationResult,
                balances: {
                    source: {
                        before: sourceBalanceSOL,
                        after: sourceBalanceSOL - totalAmount
                    },
                    target: {
                        before: targetBalanceSOL,
                        after: targetBalanceSOL + totalAmount
                    }
                },
                fees: {
                    base: baseFee,
                    rent: rentExemption,
                    total: baseFee + rentExemption
                }
            };
        } catch (error) {
            throw new SolanaWalletError(
                'Transfer failed',
                'TRANSFER_FAILED',
                {
                    source: sourceWallet.publicKey,
                    target: toAddress,
                    amount,
                    error: error.message,
                    options
                }
            );
        }
    }

    // Flexible wallet-to-wallet transfer
    static async transferSOL(fromWalletId, toAddress, amount, options = {}) {
        try {
            // Get source wallet
            const sourceWallet = await WalletGenerator.getWallet(fromWalletId);
            if (!sourceWallet) {
                throw new SolanaWalletError('Source wallet not found', 'WALLET_NOT_FOUND');
            }

            // Calculate fees and validate amount
            const { totalAmount, baseFee, rentExemption, isNewAccount } = 
                await this.calculateTotalAmount(toAddress, amount);

            // Check source balance
            const sourceBalance = await connection.getBalance(new PublicKey(sourceWallet.publicKey));
            const sourceBalanceSOL = sourceBalance / LAMPORTS_PER_SOL;

            if (sourceBalanceSOL < totalAmount) {
                throw new SolanaWalletError(
                    'Insufficient balance',
                    'INSUFFICIENT_BALANCE',
                    { 
                        required: totalAmount,
                        available: sourceBalanceSOL,
                        fees: { baseFee, rentExemption },
                        isNewAccount
                    }
                );
            }

            return await this.executeTransfer(
                sourceWallet,
                toAddress,
                amount,
                {
                    description: options.description || 'Admin-initiated transfer',
                    type: 'ADMIN_TRANSFER',
                    metadata: { ...options.metadata, isAdminTransfer: true }
                }
            );
        } catch (error) {
            // Log failed transfer attempt
            await this.logFailedTransfer(fromWalletId, toAddress, amount, error);
            throw error;
        }
    }

    // System health check
    static async systemCheck() {
        try {
            // 1. Check faucet wallet
            const faucetStatus = await this.getFaucetStatus();
            
            // 2. Test network connection
            const networkStatus = await connection.getVersion();
            
            // 3. Check database connection
            await prisma.$queryRaw`SELECT 1`;
            
            // 4. Test wallet generation
            const testWallet = await WalletGenerator.generateWallet('system-check-' + Date.now());
            
            // 5. Verify encryption/decryption
            const decrypted = decryptPrivateKey(testWallet.secretKey);
            
            return {
                status: 'healthy',
                timestamp: new Date(),
                faucet: {
                    balance: faucetStatus.balance,
                    canFundUsers: faucetStatus.canFundUsers,
                    address: faucetStatus.address
                },
                network: {
                    version: networkStatus,
                    endpoint: connection.rpcEndpoint,
                    commitment: connection.commitment
                },
                database: 'connected',
                walletGeneration: 'working',
                encryption: 'working'
            };
        } catch (error) {
            return {
                status: 'error',
                timestamp: new Date(),
                error: error.message,
                details: error.details || {},
                component: error.code || 'UNKNOWN'
            };
        }
    }

    // Get transaction statistics
    static async getTransactionStats(timeframe = '24h') {
        const timeframeMap = {
            '1h': 60 * 60 * 1000,
            '24h': 24 * 60 * 60 * 1000,
            '7d': 7 * 24 * 60 * 60 * 1000,
            '30d': 30 * 24 * 60 * 60 * 1000
        };

        const since = new Date(Date.now() - (timeframeMap[timeframe] || timeframeMap['24h']));

        const transactions = await prisma.transactions.findMany({
            where: {
                processed_at: {
                    gte: since
                }
            }
        });

        const stats = {
            total: transactions.length,
            successful: transactions.filter(tx => tx.status === 'completed').length,
            failed: transactions.filter(tx => tx.status === 'failed').length,
            totalAmount: transactions.reduce((sum, tx) => sum + (tx.status === 'completed' ? tx.amount : 0), 0),
            byType: {},
            timeframe
        };

        // Group by type
        transactions.forEach(tx => {
            if (!stats.byType[tx.type]) {
                stats.byType[tx.type] = {
                    count: 0,
                    amount: 0,
                    successful: 0,
                    failed: 0
                };
            }
            stats.byType[tx.type].count++;
            if (tx.status === 'completed') {
                stats.byType[tx.type].amount += tx.amount;
                stats.byType[tx.type].successful++;
            } else {
                stats.byType[tx.type].failed++;
            }
        });

        return stats;
    }

    // Get comprehensive admin dashboard data
    static async getAdminDashboardData() {
        const [
            faucetStatus,
            recentTransactions,
            systemHealth,
            stats24h,
            stats7d
        ] = await Promise.all([
            this.getFaucetStatus(),
            this.getRecentTransactions(100),
            this.systemCheck(),
            this.getTransactionStats('24h'),
            this.getTransactionStats('7d')
        ]);

        const warnings = [];
        
        // Check faucet balance
        if (faucetStatus.balance < faucetStatus.config.minFaucetBalance * 2) {
            warnings.push({
                level: 'critical',
                message: 'Faucet balance low',
                details: `Current balance: ${faucetStatus.balance} SOL`
            });
        }
        
        // Check funding capacity
        if (faucetStatus.canFundUsers < 5) {
            warnings.push({
                level: 'warning',
                message: 'Limited funding capacity',
                details: `Can only fund ${faucetStatus.canFundUsers} more users`
            });
        }

        // Check error rate
        const errorRate = stats24h.failed / (stats24h.total || 1);
        if (errorRate > 0.1) { // More than 10% error rate
            warnings.push({
                level: 'warning',
                message: 'High transaction failure rate',
                details: `${(errorRate * 100).toFixed(1)}% of transactions failed in last 24h`
            });
        }

        return {
            timestamp: new Date(),
            faucet: faucetStatus,
            system: systemHealth,
            transactions: {
                recent: recentTransactions,
                stats: {
                    '24h': stats24h,
                    '7d': stats7d
                }
            },
            warnings,
            fees: FEE_CONSTANTS
        };
    }

    // Batch transfer operations
    static async batchTransfer(transfers) {
        const results = {
            successful: [],
            failed: [],
            totalProcessed: 0,
            totalAmount: 0,
            startTime: new Date(),
            endTime: null
        };

        for (const transfer of transfers) {
            try {
                const result = await this.transferSOL(
                    transfer.from,
                    transfer.to,
                    transfer.amount,
                    transfer.options
                );
                results.successful.push(result);
                results.totalAmount += transfer.amount;
            } catch (error) {
                results.failed.push({
                    transfer,
                    error: error.message,
                    code: error.code,
                    details: error.details
                });
            }
            results.totalProcessed++;
        }

        results.endTime = new Date();
        results.duration = results.endTime - results.startTime;

        return results;
    }

    // Helper method to log failed transfers
    static async logFailedTransfer(fromWalletId, toAddress, amount, error) {
        await prisma.transactions.create({
            data: {
                wallet_address: toAddress,
                type: 'FAILED_TRANSFER',
                amount: amount,
                status: 'failed',
                metadata: {
                    error: error.message,
                    code: error.code,
                    details: error.details,
                    source_wallet_id: fromWalletId
                },
                description: 'Failed SOL transfer',
                processed_at: new Date()
            }
        });
    }

    // Get recent transactions with pagination
    static async getRecentTransactions(limit = 50, offset = 0, filters = {}) {
        return await prisma.transactions.findMany({
            where: filters,
            orderBy: {
                processed_at: 'desc'
            },
            take: limit,
            skip: offset
        });
    }

    // Get comprehensive dashboard data for faucet management
    static async getDashboardData() {
        try {
            const faucetStatus = await this.getFaucetStatus();
            
            // Get transaction statistics for the last 24 hours
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const recentTransactions = await prisma.transactions.findMany({
                where: {
                    wallet_address: faucetStatus.address,
                    processed_at: {
                        gte: oneDayAgo
                    }
                },
                orderBy: {
                    processed_at: 'desc'
                }
            });

            // Calculate transaction statistics
            const stats = {
                last_24h: {
                    total_transactions: recentTransactions.length,
                    total_volume: recentTransactions.reduce((sum, tx) => sum + Number(tx.amount), 0),
                    unique_recipients: new Set(recentTransactions.map(tx => tx.wallet_address)).size,
                    average_amount: recentTransactions.length > 0 
                        ? recentTransactions.reduce((sum, tx) => sum + Number(tx.amount), 0) / recentTransactions.length 
                        : 0
                },
                wallet_status: {
                    current_balance: faucetStatus.balance,
                    available_balance: faucetStatus.availableForDistribution,
                    can_fund_users: faucetStatus.canFundUsers,
                    needs_refill: faucetStatus.balance < (this.config.minFaucetBalance * 2)
                },
                system_health: {
                    is_operational: faucetStatus.balance > this.config.minFaucetBalance,
                    current_config: this.config,
                    fee_structure: FEE_CONSTANTS
                }
            };

            // Get hourly distribution for the last 24 hours
            const hourlyDistribution = Array(24).fill(0).map((_, i) => {
                const hourStart = new Date(Date.now() - (i + 1) * 60 * 60 * 1000);
                const hourEnd = new Date(Date.now() - i * 60 * 60 * 1000);
                const txsInHour = recentTransactions.filter(tx => 
                    tx.processed_at >= hourStart && tx.processed_at < hourEnd
                );
                return {
                    hour: hourEnd.getHours(),
                    transactions: txsInHour.length,
                    volume: txsInHour.reduce((sum, tx) => sum + Number(tx.amount), 0)
                };
            }).reverse();

            return {
                status: faucetStatus,
                statistics: stats,
                hourly_distribution: hourlyDistribution,
                recent_transactions: recentTransactions.slice(0, 10) // Last 10 transactions
            };
        } catch (error) {
            throw new SolanaWalletError(
                'Failed to get dashboard data',
                'DASHBOARD_DATA_FAILED',
                { originalError: error.message }
            );
        }
    }
}

// Command line interface
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const command = process.argv[2];
    switch (command) {
        case 'balance':
            FaucetManager.checkBalance()
                .then(() => process.exit(0))
                .catch(console.error);
            break;
        case 'recover':
            FaucetManager.recoverFromTestWallets()
                .then(() => process.exit(0))
                .catch(console.error);
            break;
        case 'config':
            const newConfig = {
                defaultAmount: parseFloat(process.argv[3]) || DEFAULT_CONFIG.defaultAmount,
                minFaucetBalance: parseFloat(process.argv[4]) || DEFAULT_CONFIG.minFaucetBalance,
                maxTestUsers: parseInt(process.argv[5]) || DEFAULT_CONFIG.maxTestUsers
            };
            FaucetManager.setConfig(newConfig);
            console.log('Faucet configuration updated:', newConfig);
            break;
        default:
            console.log(`
Usage:
  node faucet-manager.js balance              - Check faucet balance
  node faucet-manager.js recover              - Recover SOL from test wallets
  node faucet-manager.js config <amount> <min> <max>  - Update faucet configuration
      `);
    }
}
