// utils/solana-suite/web3-v2/solana-transaction-fixed.js

/*
 * This is an updated implementation using @solana/transactions v2.1 to create and send transactions
 * in a more functional programming style
 */

import {
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';

// Import functions from @solana/transactions v2.1.0
import { 
  createTransaction,
  setTransactionFeePayer,
  appendTransactionInstruction,
  setTransactionLifetimeUsingBlockhash,
  signTransaction,
  getBase64EncodedWireTransaction
} from '@solana/transactions';

// Still need RPC functions from @solana/kit
import { 
  createSolanaRpc,
  sendAndConfirmTransactionFactory 
} from '@solana/kit';

import bs58 from 'bs58';
import { logApi } from '../../logger-suite/logger.js';

/**
 * Creates and sends a SOL transfer transaction using @solana/kit v2.1
 * 
 * @param {Connection} connection - Solana connection object
 * @param {Keypair} fromKeypair - Sender's keypair
 * @param {string|PublicKey} toAddress - Recipient's address
 * @param {number} amount - Amount in SOL
 * @returns {Promise<{signature: string}>} Transaction signature
 */
export async function transferSOL(connection, fromKeypair, toAddress, amount) {
  try {
    // Convert to bytes for @solana/kit
    const fromPublicKeyBytes = fromKeypair.publicKey.toBytes();
    
    // Convert string address to PublicKey if needed, then to bytes
    const toPubkey = typeof toAddress === 'string' 
      ? new PublicKey(toAddress) 
      : toAddress;
    const toPublicKeyBytes = toPubkey.toBytes();
    
    // Create an RPC client
    const rpc = createSolanaRpc({ 
      url: connection.rpcEndpoint,
      commitment: connection.commitment
    });
    
    // Get a recent blockhash
    const { value: latestBlockhash } = await rpc.getLatestBlockhash();
    
    // Create an empty transaction with version 0
    let transaction = createTransaction({ version: 0 });
    
    // Set the fee payer - different param structure with transactions package
    transaction = setTransactionFeePayer(fromPublicKeyBytes, transaction);
    
    // Set transaction lifetime using blockhash - different param structure
    transaction = setTransactionLifetimeUsingBlockhash(latestBlockhash.blockhash, transaction);
    
    // System Program ID (all zeros)
    const systemProgramId = new Uint8Array(32).fill(0);
    
    // Instruction data for a transfer (opcode 2 + amount as 64-bit LE)
    const data = new Uint8Array(9);
    data[0] = 2; // Transfer opcode
    
    // Write amount as little-endian 64-bit value
    const view = new DataView(data.buffer, 1);
    view.setBigUint64(0, BigInt(Math.floor(amount * LAMPORTS_PER_SOL)), true);
    
    // Create the transfer instruction
    const transferInstruction = {
      programId: systemProgramId,
      accounts: [
        { pubkey: fromPublicKeyBytes, isSigner: true, isWritable: true },
        { pubkey: toPublicKeyBytes, isSigner: false, isWritable: true }
      ],
      data: data
    };
    
    // Add the instruction to the transaction - different param structure
    transaction = appendTransactionInstruction(transferInstruction, transaction);
    
    // Get private key for signing
    const privateKey = fromKeypair.secretKey ? 
      fromKeypair.secretKey : 
      fromKeypair._keypair.secretKey;
    
    // Sign the transaction using the signTransaction function
    const signedTransaction = await signTransaction([privateKey], transaction);
    
    // Encode the transaction for sending
    const encodedTransaction = getBase64EncodedWireTransaction(signedTransaction);
    
    // Create transaction sender function
    const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({
      rpc: rpc,
      rpcSubscriptions: connection
    });
    
    // Send and confirm the transaction
    const txSignature = await rpc.sendTransaction(encodedTransaction, { encoding: 'base64' }).send();
    
    logApi.info('SOL transfer successful using @solana/transactions', {
      from: fromKeypair.publicKey.toString(),
      to: toPubkey.toString(),
      amount,
      signature: txSignature,
    });
    
    // Return signature
    return { signature: txSignature };
  } catch (error) {
    logApi.error('SOL transfer failed using @solana/transactions', {
      error: error.message,
      from: fromKeypair.publicKey.toString(),
      to: typeof toAddress === 'string' ? toAddress : toAddress.toString(),
      amount,
    });
    throw error;
  }
}

/**
 * Creates and sends a token transfer transaction using @solana/kit v2.1
 * 
 * @param {Connection} connection - Solana connection object
 * @param {Keypair} fromKeypair - Sender's keypair
 * @param {string|PublicKey} fromTokenAccount - Sender's token account
 * @param {string|PublicKey} toTokenAccount - Recipient's token account
 * @param {number} amount - Token amount (in smallest units)
 * @param {string|PublicKey} mint - Token mint address
 * @returns {Promise<{signature: string}>} Transaction signature
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
    // Create an RPC client
    const rpc = createSolanaRpc({ 
      url: connection.rpcEndpoint,
      commitment: connection.commitment
    });
    
    // Convert keys to PublicKey objects if they're strings
    const fromTokenPubkey = typeof fromTokenAccount === 'string' 
      ? new PublicKey(fromTokenAccount) 
      : fromTokenAccount;
    
    const toTokenPubkey = typeof toTokenAccount === 'string' 
      ? new PublicKey(toTokenAccount) 
      : toTokenAccount;
    
    const mintPubkey = typeof mint === 'string'
      ? new PublicKey(mint)
      : mint;
      
    // Convert to bytes for @solana/kit
    const fromPublicKeyBytes = fromKeypair.publicKey.toBytes();
    const fromTokenBytes = fromTokenPubkey.toBytes();
    const toTokenBytes = toTokenPubkey.toBytes();
    
    // Get a recent blockhash
    const { value: latestBlockhash } = await rpc.getLatestBlockhash();
    
    // Create an empty transaction with version 0
    let transaction = createTransaction({ version: 0 });
    
    // Set the fee payer - different param structure with transactions package
    transaction = setTransactionFeePayer(fromPublicKeyBytes, transaction);
    
    // Set transaction lifetime using blockhash - different param structure
    transaction = setTransactionLifetimeUsingBlockhash(latestBlockhash.blockhash, transaction);
    
    // Token Program ID
    const tokenProgramId = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA').toBytes();
    
    // Instruction data for token transfer
    const data = new Uint8Array(9);
    data[0] = 3; // Transfer opcode for SPL Token Program
    
    // Set amount as a little-endian 64-bit value
    const view = new DataView(data.buffer, 1);
    view.setBigUint64(0, BigInt(amount), true);
    
    // Create the token transfer instruction
    const transferInstruction = {
      programId: tokenProgramId,
      accounts: [
        { pubkey: fromTokenBytes, isSigner: false, isWritable: true },
        { pubkey: toTokenBytes, isSigner: false, isWritable: true },
        { pubkey: fromPublicKeyBytes, isSigner: true, isWritable: false }
      ],
      data: data
    };
    
    // Add the instruction to the transaction - different param structure
    transaction = appendTransactionInstruction(transferInstruction, transaction);
    
    // Get private key for signing
    const privateKey = fromKeypair.secretKey ? 
      fromKeypair.secretKey : 
      fromKeypair._keypair.secretKey;
    
    // Sign the transaction using the signTransaction function
    const signedTransaction = await signTransaction([privateKey], transaction);
    
    // Encode the transaction for sending
    const encodedTransaction = getBase64EncodedWireTransaction(signedTransaction);
    
    // Create transaction sender function
    const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({
      rpc: rpc,
      rpcSubscriptions: connection
    });
    
    // Send and confirm the transaction
    const txSignature = await rpc.sendTransaction(encodedTransaction, { encoding: 'base64' }).send();
    
    logApi.info('Token transfer successful using @solana/transactions', {
      from: fromKeypair.publicKey.toString(),
      fromToken: fromTokenPubkey.toString(),
      toToken: toTokenPubkey.toString(),
      mint: mintPubkey.toString(),
      amount,
      signature: txSignature,
    });
    
    // Return signature
    return { signature: txSignature };
  } catch (error) {
    logApi.error('Token transfer failed using @solana/transactions', {
      error: error.message,
      from: fromKeypair.publicKey.toString(),
      amount,
    });
    throw error;
  }
}

/**
 * Estimates the transaction fee for a SOL transfer using @solana/kit v2.1
 * 
 * @param {Connection} connection - Solana connection object
 * @param {PublicKey} fromPubkey - Sender's public key
 * @param {PublicKey} toPubkey - Recipient's public key
 * @returns {Promise<number>} Estimated fee in SOL
 */
export async function estimateSOLTransferFee(connection, fromPubkey, toPubkey) {
  try {
    // Create an RPC client
    const rpc = createSolanaRpc({ 
      url: connection.rpcEndpoint,
      commitment: connection.commitment
    });
    
    // Convert to bytes for @solana/kit
    const fromPublicKeyBytes = fromPubkey.toBytes();
    const toPublicKeyBytes = toPubkey.toBytes();
    
    // Get a recent blockhash
    const { value: latestBlockhash } = await rpc.getLatestBlockhash();
    
    // Create an empty transaction with version 0
    let transaction = createTransaction({ version: 0 });
    
    // Set the fee payer - different param structure with transactions package
    transaction = setTransactionFeePayer(fromPublicKeyBytes, transaction);
    
    // Set transaction lifetime using blockhash - different param structure
    transaction = setTransactionLifetimeUsingBlockhash(latestBlockhash.blockhash, transaction);
    
    // System Program ID (all zeros)
    const systemProgramId = new Uint8Array(32).fill(0);
    
    // Instruction data for a transfer (opcode 2 + amount as 64-bit LE)
    const data = new Uint8Array(9);
    data[0] = 2; // Transfer opcode
    
    // Write placeholder amount as little-endian 64-bit value
    const view = new DataView(data.buffer, 1);
    view.setBigUint64(0, BigInt(LAMPORTS_PER_SOL), true); // 1 SOL as placeholder
    
    // Create the transfer instruction
    const transferInstruction = {
      programId: systemProgramId,
      accounts: [
        { pubkey: fromPublicKeyBytes, isSigner: true, isWritable: true },
        { pubkey: toPublicKeyBytes, isSigner: false, isWritable: true }
      ],
      data: data
    };
    
    // Add the instruction to the transaction - different param structure
    transaction = appendTransactionInstruction(transferInstruction, transaction);
    
    // We need to sign the transaction for simulation
    // Get private key for signing - use a temporary key for simulation
    const tempKeypair = Keypair.generate();
    
    // Sign the transaction using the signTransaction function
    const signedTransaction = await signTransaction([tempKeypair.secretKey], transaction);
    
    // Encode the transaction for sending
    const encodedTransaction = getBase64EncodedWireTransaction(signedTransaction);
    
    // Simulate the transaction to get the fee
    const simulationResult = await rpc.simulateTransaction(encodedTransaction, {
      commitment: 'confirmed',
      encoding: 'base64',
      replaceRecentBlockhash: true
    });
    
    // Extract fee information from simulation result
    const fee = simulationResult.value?.fee || 5000; // Default to 5000 lamports if no fee info
    
    return fee / LAMPORTS_PER_SOL;
  } catch (error) {
    logApi.error('Failed to estimate transaction fee using @solana/transactions', {
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