// services/admin-wallet/modules/wallet-transactions.js

/**
 * Admin wallet transaction module for handling SOL and token transfers
 * with proper encryption, validation, and error handling
 * 
 * @module wallet-transactions
 */

import prisma from '../../../config/prisma.js';
import { logApi } from '../../../utils/logger-suite/logger.js';
import { ServiceError } from '../../../utils/service-suite/service-error.js';
import { decryptWallet, createKeypairFromPrivateKey } from './wallet-crypto.js';
import { PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
// Import SPL Token as CommonJS module (fix for ESM compatibility)
// THIS "METHOD" OF IMPORTING SPL TOKEN IS **BROKEN** AND NONSENSICAL!!!
import pkg from '@solana/spl-token';
const { 
  getAssociatedTokenAddress, 
  createAssociatedTokenAccountInstruction, 
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID
} = pkg;

// SolanaEngine for transaction processing
import { solanaEngine } from '../../solana-engine/index.js'; // why is this unused?

// Config
import { config } from '../../../config/config.js'; // why is this unused?

/**
 * Transfers SOL from one wallet to another with validation and balance checks
 * 
 * @param {string} fromWalletEncrypted - Encrypted private key of the sending wallet
 * @param {string} toAddress - Recipient wallet address
 * @param {number} amount - Amount of SOL to transfer
 * @param {string} description - Description of the transfer
 * @param {Object} solanaEngine - SolanaEngine instance for transaction processing
 * @param {Object} config - Service configuration
 * @param {string} encryptionKey - The encryption key (from environment variables)
 * @returns {Object} - Transaction result with signature and confirmation
 * @throws {ServiceError} - If validation fails or transaction fails
 */
export async function transferSOL(fromWalletEncrypted, toAddress, amount, description, solanaEngine, config, encryptionKey) {
    try {
        // Input validation
        if (!fromWalletEncrypted || typeof fromWalletEncrypted !== 'string') {
            throw ServiceError.validation('Invalid from wallet', { fromWalletEncrypted });
        }
        
        if (!toAddress || typeof toAddress !== 'string') {
            throw ServiceError.validation('Invalid recipient address', { toAddress });
        }
        
        if (!amount || amount <= 0 || isNaN(amount)) {
            throw ServiceError.validation('Invalid amount', { amount });
        }
        
        // Convert to PublicKey and validate addresses
        let toPublicKey;
        try {
            toPublicKey = new PublicKey(toAddress);
        } catch (error) {
            throw ServiceError.validation('Invalid recipient SOL address', { toAddress, error: error.message });
        }
        
        // Decrypt and prepare sender wallet
        const decryptedPrivateKey = decryptWallet(fromWalletEncrypted, encryptionKey);
        const fromKeypair = createKeypairFromPrivateKey(decryptedPrivateKey);
        
        // Check sender's SOL balance
        const senderBalance = await solanaEngine.executeConnectionMethod(
            'getBalance', 
            fromKeypair.publicKey
        );
        
        const transferAmountLamports = amount * LAMPORTS_PER_SOL;
        
        // Accurately estimate transaction fees
        let estimatedFee = 5000; // Default fallback fee (0.000005 SOL)
        try {
            // Create the transaction just for fee estimation
            const estimationTx = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: fromKeypair.publicKey,
                    toPubkey: toPublicKey,
                    lamports: transferAmountLamports
                })
            );
            
            // Get blockhash and estimate fee
            const { blockhash } = await solanaEngine.executeConnectionMethod('getLatestBlockhash');
            estimationTx.recentBlockhash = blockhash;
            
            const feeCalculator = await solanaEngine.executeConnectionMethod(
                'getFeeForMessage', 
                estimationTx.compileMessage(),
                blockhash
            );
            
            if (feeCalculator && feeCalculator.value) {
                estimatedFee = feeCalculator.value;
                logApi.debug(`Estimated fee for SOL transfer: ${estimatedFee} lamports`);
            }
        } catch (error) {
            logApi.warn(`Fee estimation failed, using default: ${error.message}`);
        }
        
        if (senderBalance < (transferAmountLamports + estimatedFee)) {
            throw ServiceError.validation('Insufficient SOL balance', { 
                balance: senderBalance / LAMPORTS_PER_SOL, 
                requested: amount,
                minimum: (transferAmountLamports + estimatedFee) / LAMPORTS_PER_SOL
            });
        }
        
        // Log transaction attempt
        logApi.info(`Transferring ${amount} SOL from ${fromKeypair.publicKey.toString()} to ${toAddress}`);
        
        // Create transaction
        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: fromKeypair.publicKey,
                toPubkey: toPublicKey,
                lamports: transferAmountLamports
            })
        );

        // Get a recent blockhash and set it on the transaction
        const { blockhash } = await solanaEngine.executeConnectionMethod('getLatestBlockhash');
        transaction.recentBlockhash = blockhash;

        // Use SolanaEngine for transaction sending
        // Specify the preferred endpoint for critical transfers if configured
        const signature = await solanaEngine.sendTransaction(
            transaction, 
            [fromKeypair], 
            {
                endpointId: config.wallet.preferredEndpoints.transfers,
                commitment: 'confirmed',
                skipPreflight: false
            }
        );

        // Log the successful transaction
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
        // Determine if this is already a ServiceError or needs conversion
        if (error.name === 'ServiceError') {
            throw error;
        }
        
        throw ServiceError.operation('SOL transfer failed', {
            error: error.message,
            from: fromWalletEncrypted ? fromWalletEncrypted.substring(0, 10) + '...' : 'undefined',
            to: toAddress,
            amount
        });
    }
}

/**
 * Transfers tokens from one wallet to another with validation, balance checks,
 * and automatic token account creation if needed
 * 
 * @param {string} fromWalletEncrypted - Encrypted private key of the sending wallet
 * @param {string} toAddress - Recipient wallet address
 * @param {string} mint - Token mint address
 * @param {number} amount - Amount of tokens to transfer (in token units, will be adjusted for decimals)
 * @param {string} description - Description of the transfer
 * @param {Object} solanaEngine - SolanaEngine instance for transaction processing
 * @param {Object} config - Service configuration
 * @param {string} encryptionKey - The encryption key (from environment variables)
 * @returns {Object} - Transaction result with signature and confirmation
 * @throws {ServiceError} - If validation fails or transaction fails
 */
export async function transferToken(fromWalletEncrypted, toAddress, mint, amount, description, solanaEngine, config, encryptionKey) {
    try {
        // Input validation
        if (!fromWalletEncrypted || typeof fromWalletEncrypted !== 'string') {
            throw ServiceError.validation('Invalid from wallet', { fromWalletEncrypted });
        }
        
        if (!toAddress || typeof toAddress !== 'string') {
            throw ServiceError.validation('Invalid recipient address', { toAddress });
        }
        
        if (!mint || typeof mint !== 'string') {
            throw ServiceError.validation('Invalid token mint address', { mint });
        }
        
        if (!amount || amount <= 0 || isNaN(amount)) {
            throw ServiceError.validation('Invalid amount', { amount });
        }
        
        // Convert to PublicKey and validate addresses
        let mintPublicKey, toPublicKey;
        try {
            mintPublicKey = new PublicKey(mint);
        } catch (error) {
            throw ServiceError.validation('Invalid token mint address', { mint, error: error.message });
        }
        
        try {
            toPublicKey = new PublicKey(toAddress);
        } catch (error) {
            throw ServiceError.validation('Invalid recipient address', { toAddress, error: error.message });
        }
        
        // Decrypt and prepare sender wallet
        const decryptedPrivateKey = decryptWallet(fromWalletEncrypted, encryptionKey);
        const fromKeypair = createKeypairFromPrivateKey(decryptedPrivateKey);
        
        // Check sender's SOL balance for paying transaction fees
        const senderSOLBalance = await solanaEngine.executeConnectionMethod(
            'getBalance', 
            fromKeypair.publicKey
        );
        
        // Accurately estimate transaction fees for token transfers
        let estimatedFee = 10000; // Default fallback fee (0.00001 SOL) - higher for token txs
        try {
            // We need to prepare a sample transaction to estimate fees
            // This requires knowing if we'll need to create a token account
            const testTx = new Transaction();
            
            // Add a sample transfer instruction to estimate fees
            // The actual transfer will be built later
            testTx.add(
                createTransferInstruction(
                    fromKeypair.publicKey, // Just a placeholder for fee estimation
                    toPublicKey,           // Just a placeholder for fee estimation
                    fromKeypair.publicKey,
                    BigInt(1)              // Dummy amount for estimation
                )
            );
            
            // Get blockhash and estimate fee
            const { blockhash } = await solanaEngine.executeConnectionMethod('getLatestBlockhash');
            testTx.recentBlockhash = blockhash;
            
            const feeCalculator = await solanaEngine.executeConnectionMethod(
                'getFeeForMessage', 
                testTx.compileMessage(),
                blockhash
            );
            
            if (feeCalculator && feeCalculator.value) {
                // For token transfers, especially with account creation, add a safety margin
                estimatedFee = feeCalculator.value * 1.5;
                logApi.debug(`Estimated fee for token transfer: ${estimatedFee} lamports`);
            }
        } catch (error) {
            logApi.warn(`Token fee estimation failed, using default: ${error.message}`);
        }
        
        if (senderSOLBalance < estimatedFee) {
            throw ServiceError.validation('Insufficient SOL balance for transaction fee', { 
                balance: senderSOLBalance / LAMPORTS_PER_SOL,
                required: estimatedFee / LAMPORTS_PER_SOL
            });
        }
        
        // Get token metadata to handle correct decimals
        const tokenInfo = await solanaEngine.executeConnectionMethod(
            'getTokenSupply',
            mintPublicKey
        );
        
        // Extract token decimals without defaulting - we need to be certain
        const tokenDecimals = tokenInfo?.value?.decimals;
        if (tokenDecimals === undefined) {
            throw ServiceError.validation('Cannot determine token decimals for safe transfer', { 
                token: mint,
                mintAddress: mintPublicKey.toString()
            });
        }
        
        logApi.info(`Token ${mint} has ${tokenDecimals} decimals`);
        
        // Adjust amount based on token decimals
        const adjustedAmount = Math.floor(amount * Math.pow(10, tokenDecimals));
        
        // Get sender's token accounts for this mint
        const fromTokenAccount = await solanaEngine.executeConnectionMethod(
            'getTokenAccountsByOwner',
            fromKeypair.publicKey,
            {
                mint: mintPublicKey
            },
            {
                encoding: 'jsonParsed'
            }
        );

        // Validate sender has a token account
        if (!fromTokenAccount.value.length) {
            throw ServiceError.validation(`Source wallet doesn't have a token account for ${mint}`);
        }
        
        const fromTokenAccountAddress = fromTokenAccount.value[0].pubkey;
        
        // Check token balance
        const accountInfo = await solanaEngine.executeConnectionMethod(
            'getTokenAccountBalance',
            fromTokenAccountAddress
        );
        
        const currentBalance = accountInfo?.value?.uiAmount || 0;
        if (currentBalance < amount) {
            throw ServiceError.validation('Insufficient token balance', {
                token: mint,
                balance: currentBalance,
                requested: amount
            });
        }
        
        // Check if destination token account exists
        let toTokenAccount;
        try {
            toTokenAccount = await solanaEngine.executeConnectionMethod(
                'getTokenAccountsByOwner',
                toPublicKey,
                {
                    mint: mintPublicKey
                },
                {
                    encoding: 'jsonParsed'
                }
            );
        } catch (error) {
            // If we can't find it, we'll need to create it
            toTokenAccount = { value: [] };
            logApi.info(`Destination token account not found, will create one: ${error.message}`);
        }

        // Prepare transaction
        const transaction = new Transaction();

        // If destination doesn't have a token account, create it
        let toTokenAccountAddress;
        if (!toTokenAccount.value.length) {
            // Get associated token address
            const associatedTokenAddress = await getAssociatedTokenAddress(
                mintPublicKey,
                toPublicKey
            );
            
            // Create the associated token account for the recipient
            // Using constants imported directly from the package
            
            // Create instruction to make the associated token account
            const createATAInstruction = createAssociatedTokenAccountInstruction(
                fromKeypair.publicKey,    // Payer
                associatedTokenAddress,   // Associated token account address
                toPublicKey,              // Owner
                mintPublicKey,            // Mint
                TOKEN_PROGRAM_ID,         // Token program ID
                ASSOCIATED_TOKEN_PROGRAM_ID  // Associated token program ID
            );
            
            // Add the create instruction to the transaction
            transaction.add(createATAInstruction);
            
            // Set the destination token account address for the transfer
            toTokenAccountAddress = associatedTokenAddress;
            
            logApi.info(`Creating token account ${associatedTokenAddress.toString()} for recipient ${toAddress}`);
        } else {
            toTokenAccountAddress = toTokenAccount.value[0].pubkey;
        }

        // Log transaction attempt with token details
        logApi.info(`Transferring ${amount} tokens (mint: ${mint}) from ${fromKeypair.publicKey.toString()} to ${toAddress}`);
        
        // Add transfer instruction with proper amount (adjusted for decimals)
        transaction.add(
            createTransferInstruction(
                fromTokenAccountAddress,
                toTokenAccountAddress,
                fromKeypair.publicKey,
                BigInt(adjustedAmount)
            )
        );

        // Get a recent blockhash and set it on the transaction
        const { blockhash } = await solanaEngine.executeConnectionMethod('getLatestBlockhash');
        transaction.recentBlockhash = blockhash;

        // Use SolanaEngine for transaction sending
        const signature = await solanaEngine.sendTransaction(
            transaction, 
            [fromKeypair], 
            {
                endpointId: config.wallet.preferredEndpoints.transfers,
                commitment: 'confirmed',
                skipPreflight: false
            }
        );

        // Log the successful transaction to database
        await prisma.transactions.create({
            data: {
                wallet_address: fromKeypair.publicKey.toString(),
                type: 'ADMIN_TOKEN_TRANSFER',
                amount,
                token_mint: mint,
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
        // Determine if this is already a ServiceError or needs conversion
        if (error.name === 'ServiceError') {
            throw error;
        }
        
        throw ServiceError.operation('Token transfer failed', {
            error: error.message,
            from: fromWalletEncrypted ? fromWalletEncrypted.substring(0, 10) + '...' : 'undefined',
            to: toAddress,
            mint,
            amount
        });
    }
}

export default {
    transferSOL,
    transferToken
}; 