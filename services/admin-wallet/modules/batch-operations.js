// services/admin-wallet/modules/batch-operations.js

/**
 * Admin Wallet Batch Operations Module
 * @module batch-operations
 * 
 * @description Handles mass transfers (SOL and tokens) by orchestrating 
 *              calls to individual transfer functions.
 * 
 * @author BranchManager69
 * @version 2.1.0
 * @created 2025-05-05
 * @updated 2025-05-06 // Updated for idempotency
 */

import crypto from 'crypto';
import prisma from '../../../config/prisma.js'; // Added for idempotency
import { ServiceError } from '../../../utils/service-suite/service-error.js';
// Dynamically import wallet-transactions to avoid circular dependency issues if any
// and to align with how it's used in the original code for upfront balance checks.
// import { transferSOL, transferToken } from './wallet-transactions.js'; 
// For fromPublicKeyString derivation
import { decryptWallet, createKeypairFromPrivateKeyCompat } from './wallet-crypto.js';
import { logApi } from '../../../utils/logger-suite/logger.js'; // For logging skips
import { fancyColors } from '../../../utils/colors.js'; // Added for fancy logging
import { config as globalConfigForCommitment } from '../../../config/config.js'; // For commitment constant

// Default commitment level for critical balance checks in this module
const UPFRONT_BALANCE_COMMITMENT = globalConfigForCommitment.solana?.commitments?.batch_balance_check || 'confirmed';

/**
 * Performs a mass transfer of SOL to multiple recipients with idempotency
 * 
 * @param {string} fromWalletEncrypted - Encrypted private key of the sending wallet
 * @param {Array} transfers - Array of transfer objects with toAddress, amount, description
 * @param {Object} solanaEngine - SolanaEngine instance
 * @param {Object} config - Service configuration
 * @param {Object} walletStats - Stats tracking object for the service
 * @param {string} encryptionKey - The encryption key (from environment variables)
 * @returns {Object} - Results of the batch operation
 */
export async function massTransferSOL(fromWalletEncrypted, transfers, solanaEngine, config, walletStats, encryptionKey) {
    const startTime = Date.now();
    const batchIdentifier = crypto.randomUUID(); // Unique ID for this batch execution

    // Dynamically import transferSOL for the actual transfer operation
    const { transferSOL } = await import('./wallet-transactions.js');
    const { executeRpcMethod, LAMPORTS_PER_SOL } = await import('../utils/solana-compat.js');
    
    // Get sender's public key for logging in BatchTransferItem
    let fromPublicKeyString;
    let fromKeypair; // To be used for balance check
    try {
        const decryptedSenderKey = decryptWallet(fromWalletEncrypted, encryptionKey);
        fromKeypair = createKeypairFromPrivateKeyCompat(decryptedSenderKey);
        fromPublicKeyString = fromKeypair.publicKey.toString();
    } catch (e) {
        logApi.error(`${fancyColors.RED}[Batch ${batchIdentifier}] Critical Error: Failed to decrypt sender wallet. Aborting batch.${fancyColors.RESET}`, e);
        throw ServiceError.authentication('Failed to decrypt sender wallet for batch operation', {
            batchIdentifier,
            error: e.message
        });
    }

    try {
        if (transfers.length > config.wallet.operations.maxBatchSize) {
            throw ServiceError.validation('Batch size exceeds maximum allowed');
        }

        // === UPFRONT BALANCE + FEE CHECK (existing, uses fromKeypair from above) ===
        const balanceResult = await executeRpcMethod(
            solanaEngine,
            'getBalance',
            fromKeypair.publicKey, // Use the already derived keypair
            UPFRONT_BALANCE_COMMITMENT // Explicitly pass commitment
        );
        const senderBalance = balanceResult.value ?? balanceResult; 
        const totalAmountLamports = transfers.reduce((sum, t) => sum + (t.amount * LAMPORTS_PER_SOL), 0);
        const estimatedFeePerTx = 5000; 
        const totalEstimatedFees = estimatedFeePerTx * transfers.length;
        if (senderBalance < (totalAmountLamports + totalEstimatedFees)) {
            throw ServiceError.validation('Insufficient SOL balance for batch', {
                balance: senderBalance / LAMPORTS_PER_SOL,
                requested: totalAmountLamports / LAMPORTS_PER_SOL,
                estimated_fees: totalEstimatedFees / LAMPORTS_PER_SOL,
                minimum: (totalAmountLamports + totalEstimatedFees) / LAMPORTS_PER_SOL
            });
        }
        // === END UPFRONT CHECK ===

        const results = {
            total: transfers.length,
            successful: 0,
            failed: 0,
            skipped_idempotent: 0, // Track skipped items
            transfers: []
        };

        const chunks = [];
        for (let i = 0; i < transfers.length; i += config.wallet.operations.maxParallelTransfers) {
            const chunk = transfers.slice(i, i + config.wallet.operations.maxParallelTransfers);
            chunks.push(chunk);
        }

        for (const chunk of chunks) {
            const chunkPromises = chunk.map(async (transfer, indexInChunk) => {
                // Create a unique identifier for this specific transfer item
                const itemIdentifierPayload = `${batchIdentifier}-${transfer.toAddress}-${transfer.amount}-${fromPublicKeyString}`;
                const itemIdentifier = crypto.createHash('sha256').update(itemIdentifierPayload).digest('hex');

                try {
                    // Check if this item has already been processed
                    const existingItem = await prisma.batchTransferItem.findUnique({
                        where: { itemIdentifier }
                    });

                    if (existingItem && (existingItem.status === "SUCCESS" || existingItem.status === "FAILED_PERMANENT")) {
                        logApi.info(`${fancyColors.YELLOW}[Batch ${batchIdentifier}] Item ${itemIdentifier} (to: ${transfer.toAddress}, amount: ${transfer.amount}) SKIPPED due to idempotency. Stored Status: ${existingItem.status}${fancyColors.RESET}`);
                        results.skipped_idempotent++;
                        // Return a structure compatible with Promise.allSettled
                        if (existingItem.status === "SUCCESS") {
                            return { 
                                status: 'fulfilled', 
                                value: { signature: existingItem.signature, success: true }, 
                                originalItemData: transfer, // Keep original item data for results array
                                dbStatus: existingItem.status 
                            };
                        } else { // FAILED_PERMANENT
                            return { 
                                status: 'rejected', 
                                reason: { message: existingItem.error || 'Previously failed permanently' },
                                originalItemData: transfer,
                                dbStatus: existingItem.status 
                            };
                        }
                    }

                    // If not skipped, proceed with the transfer
                    const transferResult = await transferSOL(
                        fromWalletEncrypted,
                        transfer.toAddress,
                        transfer.amount,
                        transfer.description || '',
                        solanaEngine,
                        config,
                        encryptionKey
                    );

                    // Record success in DB
                    await prisma.batchTransferItem.create({
                        data: {
                            batchIdentifier,
                            itemIdentifier,
                            status: "SUCCESS",
                            signature: transferResult.signature,
                            fromWalletAddress: fromPublicKeyString,
                            toAddress: transfer.toAddress,
                            amount: transfer.amount,
                            // mint is null for SOL transfers
                        }
                    });
                    return { status: 'fulfilled', value: transferResult, originalItemData: transfer, dbStatus: "SUCCESS" };

                } catch (error) {
                    const errorMessage = error instanceof ServiceError ? error.getFullMessage() : error.message;
                    logApi.warn(`${fancyColors.MAGENTA}[Batch ${batchIdentifier}] Transfer for item ${itemIdentifier} (to: ${transfer.toAddress}) FAILED. Error: ${errorMessage}${fancyColors.RESET}`);
                    
                    await prisma.batchTransferItem.create({
                        data: {
                            batchIdentifier,
                            itemIdentifier,
                            status: "FAILED_PERMANENT",
                            error: errorMessage,
                            fromWalletAddress: fromPublicKeyString,
                            toAddress: transfer.toAddress,
                            amount: transfer.amount,
                            // mint is null for SOL transfers
                        }
                    }).catch(dbError => {
                        logApi.error(`${fancyColors.RED}[Batch ${batchIdentifier}] DB Write Error: Failed to write FAILED_PERMANENT to BatchTransferItem for ${itemIdentifier}:${fancyColors.RESET}`, dbError);
                    });
                    // Return a structure compatible with Promise.allSettled
                    return { status: 'rejected', reason: error, originalItemData: transfer, dbStatus: "FAILED_PERMANENT" };
                }
            });

            const chunkProcessingResults = await Promise.allSettled(chunkPromises);

            chunkProcessingResults.forEach((result) => {
                const originalItem = result.value?.originalItemData || result.reason?.originalItemData || chunk.find(c => c.toAddress === result.value?.toAddress && c.amount === result.value?.amount); // Fallback find
                
                if (result.status === 'fulfilled') {
                    results.successful++;
                    results.transfers.push({
                        ...(originalItem || {toAddress: 'unknown', amount: 0}), // Fallback if originalItemData is missing
                        status: 'success',
                        signature: result.value.signature || result.value.value?.signature, // Handle direct value or nested value from idempotency skip
                        idempotencyStatus: result.value.dbStatus || 'PROCESSED_LIVE'
                    });
                } else { // 'rejected'
                    results.failed++;
                    results.transfers.push({
                        ...(originalItem || {toAddress: 'unknown', amount: 0}),
                        status: 'failed',
                        error: result.reason.message || 'Unknown error',
                        idempotencyStatus: result.reason.dbStatus || 'PROCESSED_LIVE_FAILED'
                    });
                }
            });
        }

        // Update batch stats
        if (walletStats) {
            walletStats.batches.total++;
            walletStats.batches.successful += results.successful; // Only count actual new successes
            walletStats.batches.failed += results.failed; // Only count actual new failures
            // items_processed should perhaps reflect only non-skipped, or total attempted.
            // For now, it reflects total input transfers.
            walletStats.batches.items_processed += transfers.length; 
            if (walletStats.batches.total > 0) { // Avoid division by zero if first batch
                 walletStats.performance.average_batch_time_ms = 
                    ((walletStats.performance.average_batch_time_ms * (walletStats.batches.total -1)) + 
                    (Date.now() - startTime)) / walletStats.batches.total;
            } else {
                 walletStats.performance.average_batch_time_ms = Date.now() - startTime;
            }
        }
        logApi.info(`${fancyColors.GREEN}[Batch ${batchIdentifier}] Mass SOL transfer attempt completed. Total: ${results.total}, Successful: ${results.successful}, Failed: ${results.failed}, Skipped (Idempotent): ${results.skipped_idempotent}${fancyColors.RESET}`);
        return results;
    } catch (error) {
        logApi.error(`${fancyColors.RED}[Batch ${batchIdentifier}] Mass SOL transfer critically failed:${fancyColors.RESET}`, error);
        // Ensure this top-level error is also a ServiceError for consistent API responses
        if (error instanceof ServiceError) {
            throw error;
        }
        throw ServiceError.operation('Mass SOL transfer failed critically', {
            error: error.message,
            transfer_count: transfers.length,
            batchIdentifier
        });
    }
}

/**
 * Performs a mass transfer of tokens to multiple recipients with idempotency
 * 
 * @param {string} fromWalletEncrypted - Encrypted private key of the sending wallet
 * @param {string} mint - Token mint address
 * @param {Array} transfers - Array of transfer objects with toAddress, amount, description
 * @param {Object} solanaEngine - SolanaEngine instance
 * @param {Object} config - Service configuration
 * @param {Object} walletStats - Stats tracking object for the service
 * @param {string} encryptionKey - The encryption key (from environment variables)
 * @returns {Object} - Results of the batch operation
 */
export async function massTransferTokens(fromWalletEncrypted, mint, transfers, solanaEngine, config, walletStats, encryptionKey) {
    const startTime = Date.now();
    const batchIdentifier = crypto.randomUUID(); // Unique ID for this batch execution

    // Dynamically import transferToken for the actual transfer operation
    const { transferToken } = await import('./wallet-transactions.js');
    const { executeRpcMethod, LAMPORTS_PER_SOL } = await import('../utils/solana-compat.js');

    // Get sender's public key for logging in BatchTransferItem
    let fromPublicKeyString;
    let fromKeypair; // To be used for balance check
    try {
        const decryptedSenderKey = decryptWallet(fromWalletEncrypted, encryptionKey);
        fromKeypair = createKeypairFromPrivateKeyCompat(decryptedSenderKey);
        fromPublicKeyString = fromKeypair.publicKey.toString();
    } catch (e) {
        logApi.error(`${fancyColors.RED}[Batch ${batchIdentifier}] (Token) Critical Error: Failed to decrypt sender wallet. Aborting batch.${fancyColors.RESET}`, e);
        throw ServiceError.authentication('Failed to decrypt sender wallet for batch token operation', {
            batchIdentifier,
            mint,
            error: e.message
        });
    }
    
    try {
        if (transfers.length > config.wallet.operations.maxBatchSize) {
            throw ServiceError.validation('Batch size exceeds maximum allowed');
        }

        // === UPFRONT SOL FEE CHECK (uses fromKeypair from above) ===
        const balanceResult = await executeRpcMethod(
            solanaEngine,
            'getBalance',
            fromKeypair.publicKey,
            UPFRONT_BALANCE_COMMITMENT // Explicitly pass commitment
        );
        const senderBalance = balanceResult.value ?? balanceResult;
        const estimatedFeePerTx = 10000; 
        const totalEstimatedFees = estimatedFeePerTx * transfers.length;
        if (senderBalance < totalEstimatedFees) {
            throw ServiceError.validation('Insufficient SOL balance for batch token transfer fees', {
                balance: senderBalance / LAMPORTS_PER_SOL,
                estimated_fees: totalEstimatedFees / LAMPORTS_PER_SOL,
                minimum: totalEstimatedFees / LAMPORTS_PER_SOL,
                batchIdentifier,
                mint
            });
        }
        // === END UPFRONT CHECK ===

        const results = {
            total: transfers.length,
            successful: 0,
            failed: 0,
            skipped_idempotent: 0, // Track skipped items
            transfers: []
        };

        const chunks = [];
        for (let i = 0; i < transfers.length; i += config.wallet.operations.maxParallelTransfers) {
            const chunk = transfers.slice(i, i + config.wallet.operations.maxParallelTransfers);
            chunks.push(chunk);
        }

        for (const chunk of chunks) {
            const chunkPromises = chunk.map(async (transfer) => {
                const itemIdentifierPayload = `${batchIdentifier}-${transfer.toAddress}-${transfer.amount}-${mint}-${fromPublicKeyString}`;
                const itemIdentifier = crypto.createHash('sha256').update(itemIdentifierPayload).digest('hex');

                try {
                    const existingItem = await prisma.batchTransferItem.findUnique({
                        where: { itemIdentifier }
                    });

                    if (existingItem && (existingItem.status === "SUCCESS" || existingItem.status === "FAILED_PERMANENT")) {
                        logApi.info(`${fancyColors.YELLOW}[Batch ${batchIdentifier}] (Token Mint: ${mint}) Item ${itemIdentifier} (to: ${transfer.toAddress}, amount: ${transfer.amount}) SKIPPED due to idempotency. Stored Status: ${existingItem.status}${fancyColors.RESET}`);
                        results.skipped_idempotent++;
                        if (existingItem.status === "SUCCESS") {
                            return { 
                                status: 'fulfilled', 
                                value: { signature: existingItem.signature, success: true }, 
                                originalItemData: transfer, 
                                dbStatus: existingItem.status 
                            };
                        } else { // FAILED_PERMANENT
                            return { 
                                status: 'rejected', 
                                reason: { message: existingItem.error || 'Previously failed permanently' }, 
                                originalItemData: transfer, 
                                dbStatus: existingItem.status 
                            };
                        }
                    }

                    const transferResult = await transferToken(
                        fromWalletEncrypted,
                        transfer.toAddress,
                        mint,
                        transfer.amount,
                        transfer.description || '',
                        solanaEngine,
                        config,
                        encryptionKey
                    );

                    await prisma.batchTransferItem.create({
                        data: {
                            batchIdentifier,
                            itemIdentifier,
                            status: "SUCCESS",
                            signature: transferResult.signature,
                            fromWalletAddress: fromPublicKeyString,
                            toAddress: transfer.toAddress,
                            amount: transfer.amount,
                            mint: mint 
                        }
                    });
                    return { status: 'fulfilled', value: transferResult, originalItemData: transfer, dbStatus: "SUCCESS" };

                } catch (error) {
                    const errorMessage = error instanceof ServiceError ? error.getFullMessage() : error.message;
                    logApi.warn(`${fancyColors.MAGENTA}[Batch ${batchIdentifier}] (Token Mint: ${mint}) Transfer for item ${itemIdentifier} (to: ${transfer.toAddress}) FAILED. Error: ${errorMessage}${fancyColors.RESET}`);
                    
                    await prisma.batchTransferItem.create({
                        data: {
                            batchIdentifier,
                            itemIdentifier,
                            status: "FAILED_PERMANENT",
                            error: errorMessage,
                            fromWalletAddress: fromPublicKeyString,
                            toAddress: transfer.toAddress,
                            amount: transfer.amount,
                            mint: mint
                        }
                    }).catch(dbError => {
                        logApi.error(`${fancyColors.RED}[Batch ${batchIdentifier}] (Token Mint: ${mint}) DB Write Error: Failed to write FAILED_PERMANENT to BatchTransferItem for ${itemIdentifier}:${fancyColors.RESET}`, dbError);
                    });
                    return { status: 'rejected', reason: error, originalItemData: transfer, dbStatus: "FAILED_PERMANENT" };
                }
            });

            const chunkProcessingResults = await Promise.allSettled(chunkPromises);

            chunkProcessingResults.forEach((result) => {
                const originalItem = result.value?.originalItemData || result.reason?.originalItemData || chunk.find(c => c.toAddress === result.value?.toAddress && c.amount === result.value?.amount); // Fallback find

                if (result.status === 'fulfilled') {
                    results.successful++;
                    results.transfers.push({
                        ...(originalItem || {toAddress: 'unknown', amount: 0}),
                        status: 'success',
                        signature: result.value.signature || result.value.value?.signature,
                        idempotencyStatus: result.value.dbStatus || 'PROCESSED_LIVE'
                    });
                } else { // 'rejected'
                    results.failed++;
                    results.transfers.push({
                        ...(originalItem || {toAddress: 'unknown', amount: 0}),
                        status: 'failed',
                        error: result.reason.message || 'Unknown error',
                        idempotencyStatus: result.reason.dbStatus || 'PROCESSED_LIVE_FAILED'
                    });
                }
            });
        }

        if (walletStats) {
            walletStats.batches.total++;
            walletStats.batches.successful += results.successful;
            walletStats.batches.failed += results.failed;
            walletStats.batches.items_processed += transfers.length;
            if (walletStats.batches.total > 0) {
                walletStats.performance.average_batch_time_ms = 
                    ((walletStats.performance.average_batch_time_ms * (walletStats.batches.total -1)) + 
                    (Date.now() - startTime)) / walletStats.batches.total;
            } else {
                walletStats.performance.average_batch_time_ms = Date.now() - startTime;
            }
        }
        logApi.info(`${fancyColors.GREEN}[Batch ${batchIdentifier}] (Token Mint: ${mint}) Mass token transfer attempt completed. Total: ${results.total}, Successful: ${results.successful}, Failed: ${results.failed}, Skipped (Idempotent): ${results.skipped_idempotent}${fancyColors.RESET}`);
        return results;
    } catch (error) {
        logApi.error(`${fancyColors.RED}[Batch ${batchIdentifier}] (Token Mint: ${mint}) Mass token transfer critically failed:${fancyColors.RESET}`, error);
        if (error instanceof ServiceError) {
            throw error;
        }
        throw ServiceError.operation('Mass token transfer failed critically', {
            error: error.message,
            mint,
            transfer_count: transfers.length,
            batchIdentifier
        });
    }
}

export default {
    massTransferSOL,
    massTransferTokens
}; 