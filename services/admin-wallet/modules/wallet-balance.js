// services/admin-wallet/modules/wallet-balance.js

/**
 * Admin Wallet Balance Module
 * @module wallet-balance
 * 
 * @description Handles fetching and updating SOL balances for managed administrative wallets.
 *              Uses the v2 compatibility layer for Solana RPC interactions.
 * 
 * @author BranchManager69
 * @version 2.0.0
 * @created 2025-05-05
 * @updated 2025-05-05
 */

import prisma from '../../../config/prisma.js';
import { logApi } from '../../../utils/logger-suite/logger.js';
import { fancyColors } from '../../../utils/colors.js';
// Import from compatibility layer
import { toAddress, executeRpcMethod, LAMPORTS_PER_SOL, getLamportsFromRpcResult } from '../utils/solana-compat.js';
// Removed all direct v1 imports
// import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';

/**
 * Fetch and update Solana balance for a single managed wallet using the compatibility layer.
 * 
 * @param {Object} wallet - Wallet object from the database (must have public_key)
 * @param {Object} solanaEngine - SolanaEngine instance (passed to compatibility layer)
 * @param {Object} config - Service configuration
 * @param {Object} walletStats - Stats tracking object for the service
 * @returns {Object} - Result of the balance update operation
 */
export async function updateWalletBalance(wallet, solanaEngine, config, walletStats) {
    const startTime = Date.now();
    let addressString = wallet.public_key;
    
    try {
        // Skip if no wallet address
        if (!addressString) {
            return {
                success: false,
                error: 'No wallet address provided'
            };
        }
        
        // Convert address using compatibility layer
        const addressObject = toAddress(addressString);
        
        // Get current Solana balance via compatibility layer executing through SolanaEngine
        const balanceResult = await executeRpcMethod(
            solanaEngine,
            'getBalance',
            addressObject, // Pass the v2 Address object
            // Pass options object if needed by compat layer or SolanaEngine
            { commitment: 'confirmed', endpointId: config.wallet.preferredEndpoints.balanceChecks } 
        );
        
        // Use utility function to normalize the result
        const lamports = getLamportsFromRpcResult(balanceResult, 'getBalance', addressString);
        
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
        
        // Update stats (logic remains the same)
        if (walletStats) {
            walletStats.balance_updates.total++;
            walletStats.balance_updates.successful++;
            walletStats.balance_updates.last_update = new Date().toISOString();
            walletStats.wallets.updated++;
            
            const duration = Date.now() - startTime;
            if (walletStats.balance_updates.total > 0) { // Avoid division by zero
                walletStats.performance.average_balance_update_time_ms = 
                    ((walletStats.performance.average_balance_update_time_ms || 0) * 
                        (walletStats.balance_updates.total - 1) + duration) / 
                    walletStats.balance_updates.total;
            }
        }
        
        const previousBalance = currentMetadata?.balance?.sol || 0;
        
        return {
            success: true,
            wallet_id: wallet.id,
            public_key: addressString,
            label: wallet.label,
            previous_balance: previousBalance,
            current_balance: solBalance,
            difference: solBalance - previousBalance
        };
    } catch (error) {
        if (walletStats) {
            walletStats.balance_updates.failed++;
        }
        
        logApi.error('Failed to update admin wallet balance', {
            wallet_id: wallet.id,
            public_key: addressString,
            error: error.message,
            stack: error.stack
        });
        
        return {
            success: false,
            wallet_id: wallet.id,
            public_key: addressString,
            error: error.message
        };
    }
}

/**
 * Update balances for all managed wallets using the compatibility layer.
 *
 * @param {Object} solanaEngine - SolanaEngine instance
 * @param {Object} config - Service configuration
 * @param {Object} walletStats - Stats tracking object for the service
 * @returns {Object} - Results of the bulk balance update operation
 */
export async function updateAllWalletBalances(solanaEngine, config, walletStats) {
    const startTime = Date.now();
    const BATCH_SIZE = 100; // Process 100 wallets per batch
    const DELAY_BETWEEN_BATCHES_MS = 8000; // Delay between batches to prevent rate limiting

    try {
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

        logApi.info(`[AdminWalletBalance] Starting balance update for ${managedWallets.length} admin wallets in batches of ${BATCH_SIZE} (Delay: ${DELAY_BETWEEN_BATCHES_MS}ms).`);

        // Process in parallel batches
        for (let i = 0; i < managedWallets.length; i += BATCH_SIZE) {
            const batch = managedWallets.slice(i, i + BATCH_SIZE);
            logApi.info(`[AdminWalletBalance] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(managedWallets.length / BATCH_SIZE)} (${batch.length} wallets in parallel)`);

            // Filter out wallets without public keys
            const validWallets = batch.filter(wallet => wallet.public_key);
            const skippedCount = batch.length - validWallets.length;

            if (skippedCount > 0) {
                logApi.warn(`[AdminWalletBalance] Skipping ${skippedCount} wallets due to missing public_key.`);
                results.failed += skippedCount;
            }

            // Process batch in parallel using Promise.all
            const batchPromises = validWallets.map(wallet => {
                return updateWalletBalance(wallet, solanaEngine, config, walletStats)
                    .then(updateResult => {
                        if (updateResult.success) {
                            if (Math.abs(updateResult.difference) > 0.001) {
                                results.updates.push(updateResult);
                            }
                            return { success: true };
                        } else {
                            return { success: false, error: updateResult.error };
                        }
                    })
                    .catch(error => {
                        logApi.error('[AdminWalletBalance] Error updating wallet balance', {
                            wallet_id: wallet.id,
                            public_key: wallet.public_key,
                            error: error.message
                        });
                        return { success: false, error: error.message };
                    });
            });

            // Wait for all promises to resolve
            const batchResults = await Promise.all(batchPromises);

            // Update counters
            const batchSuccessCount = batchResults.filter(r => r.success).length;
            results.updated += batchSuccessCount;
            results.failed += (validWallets.length - batchSuccessCount);

            logApi.info(`[AdminWalletBalance] Completed batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batchSuccessCount} updated, ${validWallets.length - batchSuccessCount} failed`);

            // Add delay between batches to avoid rate limiting
            if (i + BATCH_SIZE < managedWallets.length) {
                logApi.info(`[AdminWalletBalance] Batch complete. Waiting ${DELAY_BETWEEN_BATCHES_MS}ms before next batch.`);
                await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES_MS));
            }
        }
        
        if (walletStats) {
            walletStats.performance.last_operation_time_ms = Date.now() - startTime;
        }

        const totalDuration = Date.now() - startTime;
        logApi.info(`[AdminWalletBalance] Finished balance update for all admin wallets in ${totalDuration}ms. Updated: ${results.updated}, Failed: ${results.failed}.`);

        return {
            duration: totalDuration,
            ...results
        };
    } catch (error) {
        logApi.error('[AdminWalletBalance] Failed to update admin wallet balances', {
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
}

/**
 * Check the health status of managed wallets using the compatibility layer.
 * 
 * @param {Object} solanaEngine - SolanaEngine instance
 * @param {Object} config - Service configuration
 * @returns {Object} - Results of the wallet health check
 */
export async function checkWalletStates(solanaEngine, config) {
    const startTime = Date.now(); // Add timing for consistency
    try {
        const wallets = await prisma.managed_wallets.findMany({
            where: { status: 'active' }
        });

        const results = {
            checked: 0,
            healthy: 0,
            issues: []
        };

        for (const wallet of wallets) {
            let addressString = wallet.public_key || wallet.wallet_address; // Handle potential legacy field name
             if (!addressString) {
                logApi.warn(`Skipping wallet state check for ID ${wallet.id} due to missing address.`);
                continue;
            }
            
            try {
                 // Convert address using compatibility layer
                const addressObject = toAddress(addressString);
                
                // Use compatibility layer for balance check
                const balanceResult = await executeRpcMethod(
                    solanaEngine,
                    'getBalance',
                    addressObject,
                    { commitment: 'confirmed', endpointId: config.wallet.preferredEndpoints.balanceChecks }
                );
                
                // Use utility function to normalize the result
                const balanceLamports = getLamportsFromRpcResult(balanceResult, 'getBalance', addressString);
                
                results.checked++;
                
                // Use LAMPORTS_PER_SOL from compat layer
                const minBalanceLamports = config.wallet.operations.minSOLBalance * LAMPORTS_PER_SOL;

                if (balanceLamports < minBalanceLamports) {
                    results.issues.push({
                        wallet: addressString,
                        type: 'low_balance',
                        balance: balanceLamports / LAMPORTS_PER_SOL, // Use checked lamports value
                        min_required: config.wallet.operations.minSOLBalance
                    });
                } else {
                    results.healthy++;
                }
            } catch (error) {
                 results.checked++; // Still counts as checked even if failed
                 results.issues.push({
                    wallet: addressString,
                    type: 'check_failed',
                    error: error.message
                });
            }
        }
        
        logApi.info(`Wallet state check completed in ${Date.now() - startTime}ms. Checked: ${results.checked}, Healthy: ${results.healthy}, Issues: ${results.issues.length}`);
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