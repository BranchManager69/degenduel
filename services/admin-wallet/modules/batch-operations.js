import { ServiceError } from '../../../utils/service-suite/service-error.js';
import { transferSOL, transferToken } from './wallet-transactions.js';

/**
 * Performs a mass transfer of SOL to multiple recipients
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
    
    try {
        if (transfers.length > config.wallet.operations.maxBatchSize) {
            throw ServiceError.validation('Batch size exceeds maximum allowed');
        }

        const results = {
            total: transfers.length,
            successful: 0,
            failed: 0,
            transfers: []
        };

        // Process transfers in parallel with limit
        const chunks = [];
        for (let i = 0; i < transfers.length; i += config.wallet.operations.maxParallelTransfers) {
            const chunk = transfers.slice(i, i + config.wallet.operations.maxParallelTransfers);
            chunks.push(chunk);
        }

        for (const chunk of chunks) {
            const chunkResults = await Promise.allSettled(
                chunk.map(transfer => 
                    transferSOL(
                        fromWalletEncrypted,
                        transfer.toAddress,
                        transfer.amount,
                        transfer.description || '',
                        solanaEngine,
                        config,
                        encryptionKey
                    )
                )
            );

            chunkResults.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    results.successful++;
                    results.transfers.push({
                        ...chunk[index],
                        status: 'success',
                        signature: result.value.signature
                    });
                } else {
                    results.failed++;
                    results.transfers.push({
                        ...chunk[index],
                        status: 'failed',
                        error: result.reason.message
                    });
                }
            });
        }

        // Update batch stats
        if (walletStats) {
            walletStats.batches.total++;
            walletStats.batches.successful += results.successful;
            walletStats.batches.failed += results.failed;
            walletStats.batches.items_processed += transfers.length;
            walletStats.performance.average_batch_time_ms = 
                (walletStats.performance.average_batch_time_ms * walletStats.batches.total + 
                (Date.now() - startTime)) / (walletStats.batches.total + 1);
        }

        return results;
    } catch (error) {
        throw ServiceError.operation('Mass SOL transfer failed', {
            error: error.message,
            transfer_count: transfers.length
        });
    }
}

/**
 * Performs a mass transfer of tokens to multiple recipients
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
    
    try {
        if (transfers.length > config.wallet.operations.maxBatchSize) {
            throw ServiceError.validation('Batch size exceeds maximum allowed');
        }

        const results = {
            total: transfers.length,
            successful: 0,
            failed: 0,
            transfers: []
        };

        // Process transfers in parallel with limit
        const chunks = [];
        for (let i = 0; i < transfers.length; i += config.wallet.operations.maxParallelTransfers) {
            const chunk = transfers.slice(i, i + config.wallet.operations.maxParallelTransfers);
            chunks.push(chunk);
        }

        for (const chunk of chunks) {
            const chunkResults = await Promise.allSettled(
                chunk.map(transfer => 
                    transferToken(
                        fromWalletEncrypted,
                        transfer.toAddress,
                        mint,
                        transfer.amount,
                        transfer.description || '',
                        solanaEngine,
                        config,
                        encryptionKey
                    )
                )
            );

            chunkResults.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    results.successful++;
                    results.transfers.push({
                        ...chunk[index],
                        status: 'success',
                        signature: result.value.signature
                    });
                } else {
                    results.failed++;
                    results.transfers.push({
                        ...chunk[index],
                        status: 'failed',
                        error: result.reason.message
                    });
                }
            });
        }

        // Update batch stats
        if (walletStats) {
            walletStats.batches.total++;
            walletStats.batches.successful += results.successful;
            walletStats.batches.failed += results.failed;
            walletStats.batches.items_processed += transfers.length;
            walletStats.performance.average_batch_time_ms = 
                (walletStats.performance.average_batch_time_ms * walletStats.batches.total + 
                (Date.now() - startTime)) / (walletStats.batches.total + 1);
        }

        return results;
    } catch (error) {
        throw ServiceError.operation('Mass token transfer failed', {
            error: error.message,
            mint,
            transfer_count: transfers.length
        });
    }
}

export default {
    massTransferSOL,
    massTransferTokens
}; 