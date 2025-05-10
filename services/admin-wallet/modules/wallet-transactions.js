// services/admin-wallet/modules/wallet-transactions.js

/**
 * Admin Wallet Transactions Module
 * @module wallet-transactions
 * 
 * @description Handles SOL and token transfers with proper encryption, validation, and error handling.
 *              Uses Helius Kite for simplified v2 operations, obtained via SolanaEngine.
 * 
 * @author BranchManager69
 * @version 2.2.0 
 * @created 2025-05-05 
 * @updated $(date +%Y-%m-%d)
 */

import prisma from '../../../config/prisma.js';
import { logApi } from '../../../utils/logger-suite/logger.js';
import { fancyColors } from '../../../utils/colors.js';
import { ServiceError } from '../../../utils/service-suite/service-error.js';
import { decryptWallet, createKeypairFromPrivateKeyCompat } from './wallet-crypto.js'; 
import { 
  LAMPORTS_PER_SOL, 
  toAddress, 
  executeRpcMethod, 
  getLamportsFromRpcResult
} from '../utils/solana-compat.js';
import { createTransactionMessage } from '@solana/transaction-messages';
import { createSystemTransferInstruction } from '@solana/pay';

/* Functions */

/**
 * Transfers SOL from one wallet to another.
 * Attempts to use Helius Kite via SolanaEngine, falls back to direct SolanaEngine call.
 * 
 * @param {string} fromWalletEncrypted - Encrypted private key of the sending wallet
 * @param {string} toAddressString - Recipient wallet address (string)
 * @param {number} amount - Amount of SOL to transfer
 * @param {string} description - Description of the transfer
 * @param {Object} solanaEngine - SolanaEngine instance (used for fallback or supplementary calls if needed)
 * @param {Object} config - Service configuration (local admin wallet service config)
 * @param {string} encryptionKey - The encryption key (from environment variables)
 * @returns {Object} - Transaction result with signature and confirmation
 * @throws {ServiceError} - If validation fails or transaction fails
 */
export async function transferSOL(fromWalletEncrypted, toAddressString, amount, description, solanaEngine, config, encryptionKey) {
    let kiteConnection = null;
    try {
        kiteConnection = solanaEngine.getKiteConnection();
    } catch (e) {
        logApi.warn("[wallet-transactions] Could not get Kite connection from SolanaEngine for SOL transfer. Will use SolanaEngine directly.", { error: e.message });
    }

    try {
        // Input validation
        if (!fromWalletEncrypted || typeof fromWalletEncrypted !== 'string') {
            throw ServiceError.validation('Invalid from wallet', { fromWalletEncrypted });
        }
        if (!toAddressString || typeof toAddressString !== 'string') {
            throw ServiceError.validation('Invalid recipient address', { toAddressString });
        }
        if (!amount || amount <= 0 || isNaN(amount)) {
            throw ServiceError.validation('Invalid amount', { amount });
        }
        
        let toAddr_v2String; // Store v2 string address
        try {
            const v2AddrObj = toAddress(toAddressString); // Use compat to validate/convert
            toAddr_v2String = v2AddrObj.toString(); // Ensure it's a string for Kite/v2
        } catch (error) {
            throw ServiceError.validation('Invalid recipient SOL address format', { toAddress: toAddressString, error: error.message });
        }
        
        const decryptedPrivateKey = decryptWallet(fromWalletEncrypted, encryptionKey);
        const fromSigner_v2 = await createKeypairFromPrivateKeyCompat(decryptedPrivateKey);
        const feePayerAddress_v2_string = fromSigner_v2.address;

        const balanceResult = await executeRpcMethod(solanaEngine, 'getBalance', fromSigner_v2.address);
        const senderBalance = getLamportsFromRpcResult(balanceResult, 'getBalance', fromSigner_v2.address);
        
        const transferAmountLamports = BigInt(Math.floor(amount * LAMPORTS_PER_SOL)); // Use BigInt for lamports
        
        let estimatedFee = 5000n; // Default fallback as BigInt
        try {
            const { blockhash } = await executeRpcMethod(solanaEngine, 'getLatestBlockhash');
            const v2InstructionForFeeEst = createSystemTransferInstruction({
                fromAddress: feePayerAddress_v2_string,
                toAddress: toAddr_v2String, // Use v2 string address
                lamports: transferAmountLamports 
            });
            const v2MessageForFeeEst = createTransactionMessage({
                version: 0,
                payerKey: feePayerAddress_v2_string,
                recentBlockhash: blockhash,
                instructions: [v2InstructionForFeeEst]
            });
            const feeResult = await executeRpcMethod(solanaEngine, 'getFeeForMessage', v2MessageForFeeEst, 'confirmed');
            if (feeResult && feeResult.value !== null && feeResult.value !== undefined) {
                estimatedFee = BigInt(feeResult.value);
                logApi.debug(`Estimated SOL transfer fee (v2 message): ${estimatedFee} lamports`);
            } else {
                 logApi.warn(`Could not parse v2 SOL fee estimation result, using default ${estimatedFee}. Result:`, feeResult);
            }
        } catch (error) {
            logApi.warn(`V2 SOL Fee estimation failed, using default fallback ${estimatedFee}: ${error.message}`);
        }
        
        if (BigInt(senderBalance) < (transferAmountLamports + estimatedFee)) {
            throw ServiceError.validation('Insufficient SOL balance', { 
                balance: senderBalance / LAMPORTS_PER_SOL, 
                requested: amount,
                minimum_required_lamports: (transferAmountLamports + estimatedFee).toString(),
                estimated_fee_lamports: estimatedFee.toString()
            });
        }
        
        logApi.info(`Transferring ${amount} SOL from ${feePayerAddress_v2_string} to ${toAddr_v2String}`);
        
        if (kiteConnection && kiteConnection.transferLamports) {
            logApi.info(`${fancyColors.CYAN}[wallet-transactions]${fancyColors.RESET} Attempting SOL transfer via Helius Kite...`);
            const signature = await kiteConnection.transferLamports({
                source: fromSigner_v2,
                destination: toAddr_v2String,
                amount: transferAmountLamports,
                skipPreflight: config.wallet?.operations?.skipPreflight || false,
            });
            logApi.info(`Kite SOL transfer initiated. Signature: ${signature}`);
            
            await prisma.transactions.create({
                data: {
                    wallet_address: feePayerAddress_v2_string,
                    type: 'ADMIN_TRANSFER',
                    amount,
                    description,
                    status: 'completed',
                    blockchain_signature: signature,
                    completed_at: new Date(),
                    created_at: new Date()
                }
            });
            logApi.info(`Kite SOL transfer complete and logged: ${signature}`);
            return { signature, success: true };
        } else {
            logApi.warn(`${fancyColors.CYAN}[wallet-transactions]${fancyColors.RESET} Helius Kite not available for SOL transfer, using SolanaEngine directly...`);
            const instructions_v2 = [
                createSystemTransferInstruction({
                    fromAddress: feePayerAddress_v2_string,
                    toAddress: toAddr_v2String,
                    lamports: transferAmountLamports
                })
            ];
            const result = await solanaEngine.sendTransaction(
                instructions_v2,
                feePayerAddress_v2_string,
                [fromSigner_v2],
                {
                    commitment: 'confirmed',
                    skipPreflight: config.wallet?.operations?.skipPreflight || false,
                }
            );
            await prisma.transactions.create({
                data: {
                    wallet_address: feePayerAddress_v2_string,
                    type: 'ADMIN_TRANSFER',
                    amount,
                    description,
                    status: 'completed',
                    blockchain_signature: result.signature,
                    completed_at: new Date(),
                    created_at: new Date()
                }
            });
            logApi.info(`solanaEngine SOL transfer complete and logged: ${result.signature}`);
            return { signature: result.signature, success: true };
        }
    } catch (error) {
        logApi.error(`${fancyColors.RED}[wallet-transactions] SOL Transfer Error:${fancyColors.RESET}`, error);
        if (error instanceof ServiceError) {
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
 * Transfers tokens using Helius Kite via SolanaEngine.
 * 
 * @param {string} fromWalletEncrypted - Encrypted private key of the sending wallet
 * @param {string} toAddressString - Recipient wallet address (string)
 * @param {string} mintString - Token mint address (string)
 * @param {number} amount - Amount of tokens to transfer (in token UI units, e.g., 10.5 for 10.5 tokens)
 * @param {string} description - Description of the transfer
 * @param {Object} solanaEngine - SolanaEngine instance (used for fallback or supplementary calls if needed)
 * @param {Object} config - Service configuration (local admin wallet service config)
 * @param {string} encryptionKey - The encryption key (from environment variables)
 * @returns {Object} - Transaction result with signature
 * @throws {ServiceError} - If validation fails or transaction fails
 */
export async function transferToken(fromWalletEncrypted, toAddressString, mintString, amount, description, solanaEngine, config, encryptionKey) {
    let kiteConnection = null;
    try {
        kiteConnection = solanaEngine.getKiteConnection();
    } catch (e) {
        logApi.error(`${fancyColors.RED}[wallet-transactions] Critical: Could not get Kite connection from SolanaEngine for token transfer. Error: ${e.message}`);
        throw ServiceError.configuration('Helius Kite (via SolanaEngine) is not available for token transfers.', { detail: e.message });
    }
    if (!kiteConnection || !kiteConnection.transferTokens) { // Double check, though getKiteConnection should throw
        logApi.error(`${fancyColors.RED}[wallet-transactions] Helius Kite connection retrieved, but transferTokens method is missing.`);
        throw ServiceError.configuration('Helius Kite connection invalid for token transfers.');
    }

    try {
        // Input validation
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
        
        const decryptedPrivateKey = decryptWallet(fromWalletEncrypted, encryptionKey);
        const fromSigner_v2 = await createKeypairFromPrivateKeyCompat(decryptedPrivateKey);
        const feePayerAddress_v2_string = fromSigner_v2.address;
        const v2MintString = toAddress(mintString).toString();
        const v2ToAddressString = toAddress(toAddressString).toString();

        // Check sender's SOL balance for fees via solanaEngine (Kite doesn't expose pre-flight fee checks easily)
        const balanceResultSOL = await executeRpcMethod(solanaEngine, 'getBalance', feePayerAddress_v2_string);
        const senderSOLBalance = getLamportsFromRpcResult(balanceResultSOL, 'getBalance', feePayerAddress_v2_string);
        
        // Simplified Fee Estimation for tokens with Kite (Kite handles actual fees)
        // We just need to ensure sender has *some* SOL.
        const estimatedFeeForKiteTokenTransfer = 15000n; // A slightly higher buffer for ATAs etc.
        
        if (BigInt(senderSOLBalance) < estimatedFeeForKiteTokenTransfer) {
            throw ServiceError.validation('Insufficient SOL balance for token transaction fee (Kite)', { 
                balance: senderSOLBalance / LAMPORTS_PER_SOL,
                required_lamports_for_fee: estimatedFeeForKiteTokenTransfer.toString(),
            });
        }

        // Get token decimals to convert UI amount to raw amount for Kite
        let tokenDecimals;
        try {
            // Directly use Kite's getMint function
            const mintInfo = await kiteConnection.getMint(v2MintString);
            if (!mintInfo || mintInfo.data === undefined || mintInfo.data.decimals === undefined || mintInfo.data.decimals === null) {
                logApi.error(`${fancyColors.RED}[wallet-transactions] Failed to get valid mint info or decimals from Kite for ${v2MintString}. MintInfo:`, mintInfo);
                throw new Error('Could not determine token decimals via Kite.getMint.');
            }
            tokenDecimals = mintInfo.data.decimals;
            logApi.debug(`Fetched token decimals via Kite.getMint for ${v2MintString}: ${tokenDecimals}`);

        } catch (decimalError) {
            logApi.error(`${fancyColors.RED}[wallet-transactions] Error fetching token decimals for Kite transfer (via kite.getMint): ${decimalError.message}`);
            throw ServiceError.operation('Failed to fetch token decimals for transfer', { mint: v2MintString, error: decimalError.message });
        }
        
        const rawAmountBigInt = BigInt(Math.floor(amount * Math.pow(10, tokenDecimals)));

        logApi.info(`Transferring ${amount} of token ${v2MintString} from ${feePayerAddress_v2_string} to ${v2ToAddressString} via Kite`);
        
        const signature = await kiteConnection.transferTokens({
            sender: fromSigner_v2,                
            destination: v2ToAddressString,       
            mintAddress: v2MintString,            
            amount: rawAmountBigInt,              
            skipPreflight: config.wallet?.operations?.skipPreflight || false,
        });
        
        logApi.info(`Kite token transfer initiated. Signature: ${signature}`);

        await prisma.transactions.create({
            data: {
                wallet_address: feePayerAddress_v2_string,
                type: 'ADMIN_TOKEN_TRANSFER',
                amount, 
                token_mint: v2MintString,
                description,
                status: 'completed', 
                blockchain_signature: signature,
                completed_at: new Date(),
                created_at: new Date()
            }
        });

        logApi.info(`Kite token transfer complete and logged: ${signature}`);
        return { signature, success: true };

    } catch (error) {
        logApi.error(`${fancyColors.RED}[wallet-transactions] Token Transfer Error (Kite):${fancyColors.RESET}`, error);
        if (error instanceof ServiceError) {
            throw error;
        }
        throw ServiceError.operation('Token transfer failed (Kite)', {
            error: error.message,
            from: fromWalletEncrypted ? fromWalletEncrypted.substring(0, 10) + '...' : 'undefined',
            to: toAddressString,
            mint: mintString,
            amount
        });
    }
}

/* Exports */
export default {
    transferSOL,
    transferToken
}; 