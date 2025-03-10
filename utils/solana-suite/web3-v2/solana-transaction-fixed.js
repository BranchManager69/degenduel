// utils/solana-suite/web3-v2/solana-transaction-fixed.js

/*
 * This is a modified version of the original file that avoids namespace conflicts
 * with other @solana imports in the codebase.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  VersionedTransaction,
  TransactionMessage,
} from '@solana/web3.js';

// Import functions from @solana/kit v2.1.0
import { 
  sendAndConfirmTransactionFactory as createSendAndConfirmTx,
  getComputeUnitEstimateForTransactionMessageFactory as createComputeEstimator
} from '@solana/kit';

import { logApi } from '../../logger-suite/logger.js';

/**
 * Creates and sends a SOL transfer transaction using web3.js v2.x
 * 
 * @param {Connection} connection - Solana connection object
 * @param {Keypair} fromKeypair - Sender's keypair
 * @param {string|PublicKey} toAddress - Recipient's address
 * @param {number} amount - Amount in SOL
 * @returns {Promise<string>} Transaction signature
 */
export async function transferSOL(connection, fromKeypair, toAddress, amount) {
  try {
    // Convert string address to PublicKey if needed
    const toPubkey = typeof toAddress === 'string' 
      ? new PublicKey(toAddress) 
      : toAddress;
    
    // Create the transfer instruction
    const transferInstruction = SystemProgram.transfer({
      fromPubkey: fromKeypair.publicKey,
      toPubkey,
      lamports: Math.floor(amount * LAMPORTS_PER_SOL),
    });

    // Get the latest blockhash
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

    // Create a transaction message
    const message = new TransactionMessage({
      payerKey: fromKeypair.publicKey,
      recentBlockhash: blockhash,
      instructions: [transferInstruction],
    }).compileToV0Message();

    // Create a versioned transaction
    const transaction = new VersionedTransaction(message);
    
    // Add signer to the transaction
    transaction.sign([fromKeypair]);

    // Create transaction sender function 
    const txSender = createSendAndConfirmTx({
      rpc: connection,
      rpcSubscriptions: connection
    });
    
    // Send and confirm the transaction
    const signature = transaction.signatures[0];
    await txSender(transaction, {});
    
    logApi.info('SOL transfer successful', {
      from: fromKeypair.publicKey.toString(),
      to: toPubkey.toString(),
      amount,
      signature: signature.toString(),
    });

    // Return an object with the signature to match Web3.js v2 style
    return { signature: signature.toString() };
  } catch (error) {
    logApi.error('SOL transfer failed', {
      error: error.message,
      from: fromKeypair.publicKey.toString(),
      to: typeof toAddress === 'string' ? toAddress : toAddress.toString(),
      amount,
    });
    throw error;
  }
}

/**
 * Creates and sends a token transfer transaction using web3.js v2.x
 * 
 * @param {Connection} connection - Solana connection object
 * @param {Keypair} fromKeypair - Sender's keypair
 * @param {string|PublicKey} fromTokenAccount - Sender's token account
 * @param {string|PublicKey} toTokenAccount - Recipient's token account
 * @param {number} amount - Token amount (in smallest units)
 * @param {string|PublicKey} mint - Token mint address
 * @returns {Promise<string>} Transaction signature
 */
export async function transferToken(
  connection, 
  fromKeypair, 
  fromTokenAccount, 
  toTokenAccount, 
  amount,
  mint
) {
  try {
    // Convert string addresses to PublicKey if needed
    const fromTokenPubkey = typeof fromTokenAccount === 'string' 
      ? new PublicKey(fromTokenAccount) 
      : fromTokenAccount;
    
    const toTokenPubkey = typeof toTokenAccount === 'string' 
      ? new PublicKey(toTokenAccount) 
      : toTokenAccount;
    
    const mintPubkey = typeof mint === 'string'
      ? new PublicKey(mint)
      : mint;

    // Import createTransferInstruction dynamically to avoid circular dependencies
    const { createTransferInstruction } = await import('@solana/spl-token');
    
    // Create the transfer instruction
    const transferInstruction = createTransferInstruction(
      fromTokenPubkey,
      toTokenPubkey,
      fromKeypair.publicKey,
      amount
    );

    // Get the latest blockhash
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

    // Create a transaction message
    const message = new TransactionMessage({
      payerKey: fromKeypair.publicKey,
      recentBlockhash: blockhash,
      instructions: [transferInstruction],
    }).compileToV0Message();

    // Create a versioned transaction
    const transaction = new VersionedTransaction(message);
    
    // Add signer to the transaction
    transaction.sign([fromKeypair]);

    // Create transaction sender function
    const txSender = createSendAndConfirmTx({
      rpc: connection,
      rpcSubscriptions: connection
    });
    
    // Send and confirm the transaction
    const signature = transaction.signatures[0];
    await txSender(transaction, {});
    
    logApi.info('Token transfer successful', {
      from: fromKeypair.publicKey.toString(),
      fromToken: fromTokenPubkey.toString(),
      toToken: toTokenPubkey.toString(),
      mint: mintPubkey.toString(),
      amount,
      signature: signature.toString(),
    });

    // Return an object with the signature to match Web3.js v2 style
    return { signature: signature.toString() };
  } catch (error) {
    logApi.error('Token transfer failed', {
      error: error.message,
      from: fromKeypair.publicKey.toString(),
      amount,
    });
    throw error;
  }
}

/**
 * Estimates the transaction fee for a SOL transfer
 * 
 * @param {Connection} connection - Solana connection object
 * @param {PublicKey} fromPubkey - Sender's public key
 * @param {PublicKey} toPubkey - Recipient's public key
 * @returns {Promise<number>} Estimated fee in SOL
 */
export async function estimateSOLTransferFee(connection, fromPubkey, toPubkey) {
  try {
    // Create the transfer instruction
    const transferInstruction = SystemProgram.transfer({
      fromPubkey,
      toPubkey,
      lamports: LAMPORTS_PER_SOL, // Use 1 SOL as a placeholder
    });

    // Get the latest blockhash
    const { blockhash } = await connection.getLatestBlockhash();

    // Create a transaction message
    const message = new TransactionMessage({
      payerKey: fromPubkey,
      recentBlockhash: blockhash,
      instructions: [transferInstruction],
    }).compileToV0Message();

    // Create a versioned transaction
    const transaction = new VersionedTransaction(message);
    
    // Use getComputeUnitEstimateForTransactionMessageFactory from @solana/kit to estimate fees
    const computeEstimator = createComputeEstimator({
      rpc: connection
    });
    
    // Get compute units estimate from the factory function
    const computeUnitsEstimate = await computeEstimator(message);
    
    // Default Solana fee is 5000 lamports per signature plus compute units cost
    const LAMPORTS_PER_SIGNATURE = 5000;
    const computeCost = computeUnitsEstimate * 0.0000005; // ~0.0000005 SOL per compute unit
    const estimatedFee = LAMPORTS_PER_SIGNATURE + Math.ceil(computeCost * LAMPORTS_PER_SOL);
    
    return estimatedFee / LAMPORTS_PER_SOL;
  } catch (error) {
    logApi.error('Failed to estimate transaction fee', {
      error: error.message,
    });
    // Return a default fee estimate if calculation fails
    return 0.000005; // 5000 lamports as a fallback
  }
}

export default {
  transferSOL,
  transferToken,
  estimateSOLTransferFee,
};