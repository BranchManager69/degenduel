// services/admin-wallet/modules/wallet-transactions.js

/**
 * Admin Wallet Transactions Module
 * @module wallet-transactions
 * 
 * @description Handles SOL and token transfers with proper encryption, validation, and error handling.
 *              Uses the Solana Web3.js v2 compatibility layer.
 * 
 * @author BranchManager69
 * @version 2.0.0 
 * @created 2025-05-05 
 * @updated 2025-05-05 
 */

import prisma from '../../../config/prisma.js';
import { logApi } from '../../../utils/logger-suite/logger.js';
import { fancyColors } from '../../../utils/colors.js';
import { ServiceError } from '../../../utils/service-suite/service-error.js';
// Use createKeypairFromPrivateKey from the compatibility layer now (???)
import { decryptWallet, createKeypairFromPrivateKeyCompat } from './wallet-crypto.js'; 
// Import v1 structures still needed for building transactions sent via SolanaEngine
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js'; 
// Import compatibility layer functions
import { 
  LAMPORTS_PER_SOL, 
  toAddress, 
  executeRpcMethod, 
  sendTransaction, 
  getLamportsFromRpcResult
} from '../utils/solana-compat.js';

// Import SPL Token functions dynamically to handle different package versions
let getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, 
    createTransferInstruction, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID;

// Dynamically import the Solana Kit token program library.
// This allows handling potential import errors gracefully.
try {
  const splToken = await import('@solana-program/token'); 
  ({ 
    getAssociatedTokenAddress, 
    createAssociatedTokenAccountInstruction, 
    createTransferInstruction,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID 
  } = splToken);
  logApi.info('Using @solana-program/token package (assumed v2 compatible)');
} catch (importError) {
  logApi.error('Failed to import @solana-program/token package:', importError);
  // Consider fallback or throwing a critical error if SPL token is essential
  throw new Error('@solana-program/token package not available or import failed');
}

/* Functions */

/**
 * Transfers SOL from one wallet to another using the compatibility layer.
 * 
 * @param {string} fromWalletEncrypted - Encrypted private key of the sending wallet
 * @param {string} toAddressString - Recipient wallet address (string)
 * @param {number} amount - Amount of SOL to transfer
 * @param {string} description - Description of the transfer
 * @param {Object} solanaEngine - SolanaEngine instance (used via compatibility layer)
 * @param {Object} config - Service configuration
 * @param {string} encryptionKey - The encryption key (from environment variables)
 * @returns {Object} - Transaction result with signature and confirmation
 * @throws {ServiceError} - If validation fails or transaction fails
 */
export async function transferSOL(fromWalletEncrypted, toAddressString, amount, description, solanaEngine, config, encryptionKey) {
    try {
        // Input validation (remains largely the same)
        if (!fromWalletEncrypted || typeof fromWalletEncrypted !== 'string') {
            throw ServiceError.validation('Invalid from wallet', { fromWalletEncrypted });
        }
        
        if (!toAddressString || typeof toAddressString !== 'string') {
            throw ServiceError.validation('Invalid recipient address', { toAddressString });
        }
        
        if (!amount || amount <= 0 || isNaN(amount)) {
            throw ServiceError.validation('Invalid amount', { amount });
        }
        
        // Use compatibility layer for address validation/conversion
        let toAddr;
        try {
            // Use toAddress for conversion, still wrap in try/catch for robustness
            toAddr = toAddress(toAddressString); 
        } catch (error) {
            throw ServiceError.validation('Invalid recipient SOL address format', { toAddress: toAddressString, error: error.message });
        }
        
        // Decrypt and prepare sender wallet using the updated crypto function
        const decryptedPrivateKey = decryptWallet(fromWalletEncrypted, encryptionKey);
        // Use the compatibility function (which handles legacy formats and v2 creation)
        const fromKeypair = createKeypairFromPrivateKeyCompat(decryptedPrivateKey); 
        
        // Use compatibility layer for RPC calls via SolanaEngine
        const balanceResult = await executeRpcMethod(
            solanaEngine,
            'getBalance', 
            fromKeypair.publicKey // Pass the public key object directly
        );
        // Normalize the balance result
        const senderBalance = getLamportsFromRpcResult(balanceResult, 'getBalance', fromKeypair.publicKey.toString());
        
        const transferAmountLamports = amount * LAMPORTS_PER_SOL;
        
        // Attempt to estimate the transaction fee accurately.
        // Initialize with a default fallback fee in case estimation fails.
        let estimatedFee = 5000; // Default fallback fee in lamports (0.000005 SOL)
        try {
            // Create a dummy v1 transaction structure for fee estimation via SolanaEngine
            const estimationTx = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: fromKeypair.publicKey,
                    toPubkey: new PublicKey(toAddressString), // Need v1 PublicKey for v1 Tx structure
                    lamports: transferAmountLamports
                })
            );
            
            // Get blockhash and fee message via compatibility layer
            const { blockhash } = await executeRpcMethod(solanaEngine, 'getLatestBlockhash');
            estimationTx.recentBlockhash = blockhash;
            const message = estimationTx.compileMessage();
            const feeResult = await executeRpcMethod(
                solanaEngine,
                'getFeeForMessage', 
                message,
                'confirmed'
            );
            
            // Calculate fee, handling both potential v1 and v2 response formats from executeRpcMethod
            if (feeResult?.feeCalculator?.lamportsPerSignature) {
                 // v1 format: Use lamportsPerSignature (assuming 1 signer for this simple tx)
                estimatedFee = feeResult.feeCalculator.lamportsPerSignature * 1; 
                logApi.debug(`Estimated fee via SolanaEngine (v1 format): ${estimatedFee} lamports`);
            } else if (typeof feeResult?.value === 'bigint' || typeof feeResult?.value === 'number') { // Check type for robustness
                // v2 format: Use the returned value directly
                estimatedFee = Number(feeResult.value); 
                logApi.debug(`Estimated fee (v2 format): ${estimatedFee} lamports`);
            } else {
                 logApi.warn(`Could not parse fee estimation result, using default ${estimatedFee}. Result:`, feeResult);
            }
        } catch (error) {
            // Log the failure and proceed using the default fallback fee.
            logApi.warn(`Fee estimation failed, using default fallback ${estimatedFee}: ${error.message}`);
        }
        
        if (senderBalance < (transferAmountLamports + estimatedFee)) {
            throw ServiceError.validation('Insufficient SOL balance', { 
                balance: senderBalance / LAMPORTS_PER_SOL, 
                requested: amount,
                minimum: (transferAmountLamports + estimatedFee) / LAMPORTS_PER_SOL
            });
        }
        
        logApi.info(`Transferring ${amount} SOL from ${fromKeypair.publicKey.toString()} to ${toAddressString}`);
        
        // Create transaction using v1 structure (will be handled by compat layer/SolanaEngine)
        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: fromKeypair.publicKey,
                toPubkey: new PublicKey(toAddressString), // Still need v1 PublicKey here
                lamports: transferAmountLamports
            })
        );

        // Get recent blockhash via compatibility layer
        const { blockhash } = await executeRpcMethod(solanaEngine, 'getLatestBlockhash');
        transaction.recentBlockhash = blockhash;

        // Use compatibility layer for sending transaction via SolanaEngine
        const signature = await sendTransaction(
            solanaEngine, 
            transaction, 
            [fromKeypair], 
            {
                endpointId: config.wallet.preferredEndpoints.transfers,
                commitment: 'confirmed',
                skipPreflight: false 
                // Note: 'useV2' flag mentioned in migration plan might be needed
                // depending on SolanaEngine's implementation
            }
        );

        // Database logging remains the same
        await prisma.transactions.create({
            data: {
                wallet_address: fromKeypair.publicKey.toString(),
                type: 'ADMIN_TRANSFER',
                amount,
                description,
                status: 'completed',
                blockchain_signature: signature,
                completed_at: new Date(),
                created_at: new Date()
            }
        });

        logApi.info(`SOL transfer complete: ${signature}`);
        return { signature, success: true };
    } catch (error) {
        if (error.name === 'ServiceError') {
            throw error;
        }
        
        throw ServiceError.operation('SOL transfer failed', {
            error: error.message,
            from: fromWalletEncrypted ? fromWalletEncrypted.substring(0, 10) + '...' : 'undefined',
            to: toAddressString,
            amount
        });
    }
}

/**
 * Transfers tokens using the compatibility layer.
 * 
 * @param {string} fromWalletEncrypted - Encrypted private key of the sending wallet
 * @param {string} toAddressString - Recipient wallet address (string)
 * @param {string} mintString - Token mint address (string)
 * @param {number} amount - Amount of tokens to transfer (in token units)
 * @param {string} description - Description of the transfer
 * @param {Object} solanaEngine - SolanaEngine instance (used via compatibility layer)
 * @param {Object} config - Service configuration
 * @param {string} encryptionKey - The encryption key (from environment variables)
 * @returns {Object} - Transaction result with signature and confirmation
 * @throws {ServiceError} - If validation fails or transaction fails
 */
export async function transferToken(fromWalletEncrypted, toAddressString, mintString, amount, description, solanaEngine, config, encryptionKey) {
    try {
        // Input validation (remains largely the same)
        if (!fromWalletEncrypted || typeof fromWalletEncrypted !== 'string') {
             throw ServiceError.validation('Invalid from wallet', { fromWalletEncrypted });
         }
        
         if (!toAddressString || typeof toAddressString !== 'string') {
             throw ServiceError.validation('Invalid recipient address', { toAddressString });
         }
        
         if (!mintString || typeof mintString !== 'string') {
             throw ServiceError.validation('Invalid token mint address', { mintString });
         }
        
         if (!amount || amount <= 0 || isNaN(amount)) {
             throw ServiceError.validation('Invalid amount', { amount });
         }
        
        // Use compatibility layer for address validation/conversion
        let mintAddr, toAddr;
        try {
            mintAddr = toAddress(mintString);
        } catch (error) {
            throw ServiceError.validation('Invalid token mint address format', { mint: mintString, error: error.message });
        }
        
        try {
            toAddr = toAddress(toAddressString);
        } catch (error) {
            throw ServiceError.validation('Invalid recipient address format', { toAddress: toAddressString, error: error.message });
        }
        
        // Decrypt and prepare sender wallet
        const decryptedPrivateKey = decryptWallet(fromWalletEncrypted, encryptionKey);
        // Use the compatibility function
        const fromKeypair = createKeypairFromPrivateKeyCompat(decryptedPrivateKey);
        
        // Check sender's SOL balance for fees via compatibility layer
        const balanceResultSOL = await executeRpcMethod(
            solanaEngine,
            'getBalance', 
            fromKeypair.publicKey
        );
        // Normalize the balance result
        const senderSOLBalance = getLamportsFromRpcResult(balanceResultSOL, 'getBalance', fromKeypair.publicKey.toString());
        
        // Attempt to estimate transaction fee for token transfer (potentially includes ATA creation).
        // Initialize with a higher default fallback due to potential complexity.
        let estimatedFee = 10000; // Higher default fallback for token transfers
        try {
            // Create dummy v1 transaction for estimation
            const testTx = new Transaction();
            // Use placeholder v1 keys for a dummy transfer instruction
            const dummySourceAta = await getAssociatedTokenAddress(new PublicKey(mintString), fromKeypair.publicKey);
            const dummyDestAta = await getAssociatedTokenAddress(new PublicKey(mintString), new PublicKey(toAddressString));
            testTx.add(
                 createTransferInstruction(
                     dummySourceAta,
                     dummyDestAta,
                     fromKeypair.publicKey,
                     BigInt(1) // Dummy amount doesn't affect fee much
                 )
                 // Note: To be perfectly accurate, if ATA creation is likely, 
                 // add a createAssociatedTokenAccountInstruction here too.
                 // Using a higher default and multiplier is a simpler heuristic.
             );
            
            // Get blockhash and fee via compatibility layer
            const { blockhash } = await executeRpcMethod(solanaEngine, 'getLatestBlockhash');
            testTx.recentBlockhash = blockhash;
            const message = testTx.compileMessage();
            const feeResult = await executeRpcMethod(
                 solanaEngine,
                 'getFeeForMessage', 
                 message,
                 'confirmed'
             );
            
            // Calculate fee, handling both v1/v2 formats and adding buffer for token tx complexity
             const bufferMultiplier = 1.5; // Safety buffer for token transfers / potential ATA
             if (feeResult?.feeCalculator?.lamportsPerSignature) {
                // v1 format: Use lamportsPerSignature * buffer
                estimatedFee = Math.round(feeResult.feeCalculator.lamportsPerSignature * bufferMultiplier); 
                logApi.debug(`Estimated fee via SolanaEngine (v1 format, token): ${estimatedFee} lamports`);
            } else if (typeof feeResult?.value === 'bigint' || typeof feeResult?.value === 'number') {
                // v2 format: Use value * buffer
                estimatedFee = Math.round(Number(feeResult.value) * bufferMultiplier);
                logApi.debug(`Estimated fee (v2 format, token): ${estimatedFee} lamports`);
            } else {
                 logApi.warn(`Could not parse token fee estimation result, using default ${estimatedFee}. Result:`, feeResult);
            }
        } catch (error) {
            // Log the failure and proceed using the default fallback fee.
            logApi.warn(`Token fee estimation failed, using default fallback ${estimatedFee}: ${error.message}`);
        }
        
        if (senderSOLBalance < estimatedFee) {
            throw ServiceError.validation('Insufficient SOL balance for transaction fee', { 
                balance: senderSOLBalance / LAMPORTS_PER_SOL,
                required: estimatedFee / LAMPORTS_PER_SOL
            });
        }
        
        // Get token metadata via compatibility layer
        // Need to pass the mint address string or v2 Address object
        const tokenInfo = await executeRpcMethod(
            solanaEngine,
            'getTokenSupply',
            mintAddr // Pass the v2 Address object
        );
        
        // Adjust response parsing based on v2 format { value: { amount: string, decimals: number, uiAmount: number|null, uiAmountString: string } }
        const tokenDecimals = tokenInfo?.value?.decimals;
        if (tokenDecimals === undefined || tokenDecimals === null) {
            throw ServiceError.validation('Cannot determine token decimals', { 
                token: mintString,
                response: tokenInfo 
            });
        }
        
        logApi.info(`Token ${mintString} has ${tokenDecimals} decimals`);
        const adjustedAmount = BigInt(Math.floor(amount * Math.pow(10, tokenDecimals))); // Use BigInt for large amounts
        
        // Get sender's token account via compatibility layer
        // Need to pass owner public key and mint address
        const fromTokenAccountsResult = await executeRpcMethod(
            solanaEngine,
            'getTokenAccountsByOwner',
            fromKeypair.publicKey, // Pass owner public key
            { mint: mintAddr }, // Pass mint as v2 Address
            { encoding: 'jsonParsed' } // Options object
        );

        // Validate sender token account (v2 response format: { value: [...] })
        if (!fromTokenAccountsResult?.value?.length) {
            throw ServiceError.validation(`Source wallet doesn't have a token account for ${mintString}`);
        }
        // v2 response: value[0].pubkey is the account address string
        const fromTokenAccountAddressString = fromTokenAccountsResult.value[0].pubkey;
        const fromTokenAccountAddr = toAddress(fromTokenAccountAddressString); // Convert to v2 Address
        
        // Check token balance via compatibility layer
        const balanceResult = await executeRpcMethod(
            solanaEngine,
            'getTokenAccountBalance',
            fromTokenAccountAddr // Pass token account v2 Address
        );
        
        // v2 response format: { value: { amount: string, decimals: number, uiAmount: number|null, uiAmountString: string } }
        const currentBalanceUi = balanceResult?.value?.uiAmount; 
        if (currentBalanceUi === undefined || currentBalanceUi === null || currentBalanceUi < amount) {
            throw ServiceError.validation('Insufficient token balance', {
                token: mintString,
                balance: currentBalanceUi ?? 'N/A',
                requested: amount
            });
        }
        
        // Check destination token account via compatibility layer
        let toTokenAccountAddr;
        try {
            const toTokenAccountsResult = await executeRpcMethod(
                solanaEngine,
                'getTokenAccountsByOwner',
                toAddr, // Pass recipient v2 Address
                { mint: mintAddr }, // Pass mint v2 Address
                { encoding: 'jsonParsed' }
            );
            
            if (toTokenAccountsResult?.value?.length > 0) {
                toTokenAccountAddr = toAddress(toTokenAccountsResult.value[0].pubkey);
            }
        } catch (error) {
            logApi.info(`Destination token account check failed or not found, will create: ${error.message}`);
            // Proceed assuming account needs creation
        }

        // Prepare transaction (still using v1 structure for SolanaEngine)
        const transaction = new Transaction();
        const instructions = []; // Collect instructions

        // If destination token account doesn't exist, create it
        if (!toTokenAccountAddr) {
            // Use the dynamically imported SPL token functions
            // Need v1 PublicKey objects for these instructions
            const associatedTokenAddress = await getAssociatedTokenAddress(
                new PublicKey(mintString),
                new PublicKey(toAddressString)
            );
            
            const createATAInstruction = createAssociatedTokenAccountInstruction(
                fromKeypair.publicKey,        // Payer (v1 PublicKey)
                associatedTokenAddress,       // Associated token account address (v1 PublicKey)
                new PublicKey(toAddressString), // Owner (v1 PublicKey)
                new PublicKey(mintString),    // Mint (v1 PublicKey)
                TOKEN_PROGRAM_ID,             // Token program ID (v1 PublicKey)
                ASSOCIATED_TOKEN_PROGRAM_ID   // Associated token program ID (v1 PublicKey)
            );
            instructions.push(createATAInstruction);
            toTokenAccountAddr = associatedTokenAddress; // Use the newly derived address (v1 PublicKey for instruction)
            logApi.info(`Will create token account ${associatedTokenAddress.toString()} for recipient ${toAddressString}`);
        } else {
             logApi.info(`Using existing token account ${toTokenAccountAddr.toString()} for recipient ${toAddressString}`);
        }

        logApi.info(`Transferring ${amount} tokens (mint: ${mintString}) from ${fromKeypair.publicKey.toString()} to ${toAddressString}`);
        
        // Add transfer instruction (using v1 PublicKeys)
        instructions.push(
            createTransferInstruction(
                new PublicKey(fromTokenAccountAddressString), // Source ATA (v1)
                toTokenAccountAddr, // Destination ATA (v1) - could be existing or derived
                fromKeypair.publicKey, // Owner (v1)
                adjustedAmount // Use BigInt amount
            )
        );
        
        // Add all instructions to the transaction
        transaction.add(...instructions);

        // Get recent blockhash via compatibility layer
        const { blockhash } = await executeRpcMethod(solanaEngine, 'getLatestBlockhash');
        transaction.recentBlockhash = blockhash;

        // Use compatibility layer for sending transaction via SolanaEngine
        const signature = await sendTransaction(
            solanaEngine, 
            transaction, 
            [fromKeypair], 
            {
                endpointId: config.wallet.preferredEndpoints.transfers,
                commitment: 'confirmed',
                skipPreflight: false
            }
        );

        // Database logging remains the same
        await prisma.transactions.create({
            data: {
                wallet_address: fromKeypair.publicKey.toString(),
                type: 'ADMIN_TOKEN_TRANSFER',
                amount,
                token_mint: mintString,
                description,
                status: 'completed',
                blockchain_signature: signature,
                completed_at: new Date(),
                created_at: new Date()
            }
        });

        logApi.info(`Token transfer complete: ${signature}`);
        return { signature, success: true };
    } catch (error) {
        if (error.name === 'ServiceError') {
            throw error;
        }
        
        throw ServiceError.operation('Token transfer failed', {
            error: error.message,
            from: fromWalletEncrypted ? fromWalletEncrypted.substring(0, 10) + '...' : 'undefined',
            to: toAddressString,
            mint: mintString,
            amount
        });
    }
}

/* Exports */

// Export the module functions
export default {
    transferSOL,
    transferToken
}; 