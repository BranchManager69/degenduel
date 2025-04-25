import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import prisma from '../../../config/prisma.js';
import { logApi } from '../../../utils/logger-suite/logger.js';
import { fancyColors } from '../../../utils/colors.js';

/**
 * Fetch and update Solana balance for a managed wallet
 * 
 * @param {Object} wallet - Wallet object from the database
 * @param {Object} solanaEngine - SolanaEngine instance
 * @param {Object} config - Service configuration
 * @param {Object} walletStats - Stats tracking object for the service
 * @returns {Object} - Result of the balance update operation
 */
export async function updateWalletBalance(wallet, solanaEngine, config, walletStats) {
    try {
        const startTime = Date.now();
        
        // Skip if no wallet address
        if (!wallet.public_key) {
            return {
                success: false,
                error: 'No wallet address provided'
            };
        }
        
        // Get current Solana balance via SolanaEngine
        const publicKey = new PublicKey(wallet.public_key);
        const lamports = await solanaEngine.executeConnectionMethod(
            'getBalance',
            publicKey,
            { endpointId: config.wallet.preferredEndpoints.balanceChecks }
        );
        
        const solBalance = lamports / LAMPORTS_PER_SOL;
        
        // Update wallet metadata with balance info in database
        const currentMetadata = wallet.metadata || {};
        const updatedMetadata = {
            ...currentMetadata,
            balance: {
                sol: solBalance,
                last_updated: new Date().toISOString()
            }
        };
        
        await prisma.managed_wallets.update({
            where: { id: wallet.id },
            data: {
                metadata: updatedMetadata,
                updated_at: new Date()
            }
        });
        
        // Update stats
        if (walletStats) {
            walletStats.balance_updates.total++;
            walletStats.balance_updates.successful++;
            walletStats.balance_updates.last_update = new Date().toISOString();
            walletStats.wallets.updated++;
            
            // Update performance metrics
            const duration = Date.now() - startTime;
            walletStats.performance.average_balance_update_time_ms = 
                (walletStats.performance.average_balance_update_time_ms * 
                    (walletStats.balance_updates.total - 1) + duration) / 
                walletStats.balance_updates.total;
        }
        
        // Get previous balance for comparison
        const previousBalance = currentMetadata?.balance?.sol || 0;
        
        return {
            success: true,
            wallet_id: wallet.id,
            public_key: wallet.public_key,
            label: wallet.label,
            previous_balance: previousBalance,
            current_balance: solBalance,
            difference: solBalance - previousBalance
        };
    } catch (error) {
        // Update error stats
        if (walletStats) {
            walletStats.balance_updates.failed++;
        }
        
        logApi.error('Failed to update admin wallet balance', {
            wallet_id: wallet.id,
            public_key: wallet.public_key,
            error: error.message,
            stack: error.stack
        });
        
        return {
            success: false,
            wallet_id: wallet.id,
            public_key: wallet.public_key,
            error: error.message
        };
    }
}

/**
 * Update balances for all managed wallets
 * 
 * @param {Object} solanaEngine - SolanaEngine instance
 * @param {Object} config - Service configuration
 * @param {Object} walletStats - Stats tracking object for the service
 * @returns {Object} - Results of the bulk balance update operation
 */
export async function updateAllWalletBalances(solanaEngine, config, walletStats) {
    const startTime = Date.now();
    try {
        // Get all managed wallets
        const managedWallets = await prisma.managed_wallets.findMany({
            where: {
                status: 'active'
            }
        });
        
        const results = {
            total: managedWallets.length,
            updated: 0,
            failed: 0,
            updates: []
        };
        
        // Update each wallet's balance
        for (const wallet of managedWallets) {
            try {
                // Update balance
                const updateResult = await updateWalletBalance(wallet, solanaEngine, config, walletStats);
                
                if (updateResult.success) {
                    results.updated++;
                    
                    // Only add significant balance changes to the results
                    if (Math.abs(updateResult.difference) > 0.001) {
                        results.updates.push(updateResult);
                    }
                } else {
                    results.failed++;
                }
            } catch (error) {
                results.failed++;
                logApi.error('Error updating individual admin wallet balance', {
                    wallet_id: wallet.id,
                    public_key: wallet.public_key,
                    error: error.message
                });
            }
        }
        
        // Update overall performance stats
        if (walletStats) {
            walletStats.performance.last_operation_time_ms = Date.now() - startTime;
        }
        
        return {
            duration: Date.now() - startTime,
            ...results
        };
    } catch (error) {
        logApi.error('Failed to update admin wallet balances', {
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
}

/**
 * Check the health status of managed wallets
 * 
 * @param {Object} solanaEngine - SolanaEngine instance
 * @param {Object} config - Service configuration
 * @returns {Object} - Results of the wallet health check
 */
export async function checkWalletStates(solanaEngine, config) {
    try {
        // Get active wallets
        const wallets = await prisma.managed_wallets.findMany({
            where: { status: 'active' }
        });

        const results = {
            checked: 0,
            healthy: 0,
            issues: []
        };

        // Check each wallet's state using SolanaEngine
        for (const wallet of wallets) {
            try {
                // Use SolanaEngine for balance checks
                const balance = await solanaEngine.executeConnectionMethod(
                    'getBalance',
                    new PublicKey(wallet.wallet_address),
                    { endpointId: config.wallet.preferredEndpoints.balanceChecks }
                );
                
                results.checked++;

                if (balance < config.wallet.operations.minSOLBalance * LAMPORTS_PER_SOL) {
                    results.issues.push({
                        wallet: wallet.wallet_address,
                        type: 'low_balance',
                        balance: balance / LAMPORTS_PER_SOL
                    });
                } else {
                    results.healthy++;
                }
            } catch (error) {
                results.issues.push({
                    wallet: wallet.wallet_address,
                    type: 'check_failed',
                    error: error.message
                });
            }
        }

        return results;
    } catch (error) {
        logApi.error('Failed to check wallet states', {
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
}

export default {
    updateWalletBalance,
    updateAllWalletBalances,
    checkWalletStates
}; 