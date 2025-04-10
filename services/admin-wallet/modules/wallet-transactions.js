import { PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddress, createTransferInstruction } from '@solana/spl-token';
import { ServiceError } from '../../../utils/service-suite/service-error.js';
import { logApi } from '../../../utils/logger-suite/logger.js';
import prisma from '../../../config/prisma.js';
import { fancyColors } from '../../../utils/colors.js';
import { decryptWallet, createKeypairFromPrivateKey } from './wallet-crypto.js';

/**
 * Transfers SOL from one wallet to another
 * 
 * @param {string} fromWalletEncrypted - Encrypted private key of the sending wallet
 * @param {string} toAddress - Recipient wallet address
 * @param {number} amount - Amount of SOL to transfer
 * @param {string} description - Description of the transfer
 * @param {Object} solanaEngine - SolanaEngine instance for transaction processing
 * @param {Object} config - Service configuration
 * @param {string} encryptionKey - The encryption key (from environment variables)
 * @returns {Object} - Transaction result with signature
 */
export async function transferSOL(fromWalletEncrypted, toAddress, amount, description, solanaEngine, config, encryptionKey) {
    try {
        const decryptedPrivateKey = decryptWallet(fromWalletEncrypted, encryptionKey);
        const fromKeypair = createKeypairFromPrivateKey(decryptedPrivateKey);
        
        // Create transaction
        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: fromKeypair.publicKey,
                toPubkey: new PublicKey(toAddress),
                lamports: amount * LAMPORTS_PER_SOL
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

        // Log the transaction
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

        return { signature };
    } catch (error) {
        throw ServiceError.operation('SOL transfer failed', {
            error: error.message,
            from: fromWalletEncrypted,
            to: toAddress,
            amount
        });
    }
}

/**
 * Transfers tokens from one wallet to another
 * 
 * @param {string} fromWalletEncrypted - Encrypted private key of the sending wallet
 * @param {string} toAddress - Recipient wallet address
 * @param {string} mint - Token mint address
 * @param {number} amount - Amount of tokens to transfer
 * @param {string} description - Description of the transfer
 * @param {Object} solanaEngine - SolanaEngine instance for transaction processing
 * @param {Object} config - Service configuration
 * @param {string} encryptionKey - The encryption key (from environment variables)
 * @returns {Object} - Transaction result with signature
 */
export async function transferToken(fromWalletEncrypted, toAddress, mint, amount, description, solanaEngine, config, encryptionKey) {
    try {
        const decryptedPrivateKey = decryptWallet(fromWalletEncrypted, encryptionKey);
        const fromKeypair = createKeypairFromPrivateKey(decryptedPrivateKey);

        const mintPublicKey = new PublicKey(mint);
        const toPublicKey = new PublicKey(toAddress);

        // Get token accounts
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

        const fromTokenAccountAddress = fromTokenAccount.value[0]?.pubkey;
        if (!fromTokenAccountAddress) {
            throw new Error(`Source token account not found for mint ${mint}`);
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
        }

        // Prepare transaction
        const transaction = new Transaction();

        // If destination doesn't have a token account, create it
        let toTokenAccountAddress;
        if (toTokenAccount.value.length === 0) {
            // Get associated token address
            const associatedTokenAddress = await getAssociatedTokenAddress(
                mintPublicKey,
                toPublicKey
            );
            
            // Create token account instruction would go here
            // For now, we'll throw an error since we need the token account to exist
            throw new Error(`Destination doesn't have a token account for mint ${mint}`);
        } else {
            toTokenAccountAddress = toTokenAccount.value[0].pubkey;
        }

        // Add transfer instruction
        transaction.add(
            createTransferInstruction(
                fromTokenAccountAddress,
                toTokenAccountAddress,
                fromKeypair.publicKey,
                amount
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

        // Log the transaction
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

        return { signature };
    } catch (error) {
        throw ServiceError.operation('Token transfer failed', {
            error: error.message,
            from: fromWalletEncrypted,
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