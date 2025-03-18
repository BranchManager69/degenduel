// utils/solana-suite/web3-v2/solana-transaction-fixed.js

/*
 * This is an updated implementation using @solana/transaction-messages and @solana/transactions v2.1
 * in a more functional programming style, properly separating message creation from transaction
 * compilation and signing
 */

import {
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';

// Import functions from @solana/transaction-messages for building transaction messages
import {
  createTransactionMessage,
  setTransactionMessageFeePayer,
  appendTransactionMessageInstruction,
  setTransactionMessageLifetimeUsingBlockhash
} from '@solana/transaction-messages';

// Note: The following functions will be dynamically imported when needed:
// - compileTransaction from @solana/transactions
// - signTransaction from @solana/transactions
// - getBase64EncodedWireTransaction from @solana/transactions

// Still need RPC functions from @solana/kit
import { 
  createSolanaRpc
} from '@solana/kit';

import { logApi } from '../../logger-suite/logger.js';

/**
 * Creates and sends a SOL transfer transaction using @solana/transaction-messages
 * and @solana/transactions v2.1 with the correct separation of message creation,
 * transaction compilation, and transaction signing
 * 
 * @param {Connection} connection - Solana connection object
 * @param {Keypair} fromKeypair - Sender's keypair
 * @param {string|PublicKey} toAddress - Recipient's address
 * @param {number} amount - Amount in SOL
 * @returns {Promise<{signature: string}>} Transaction signature
 */
// Use a Map for tracking per-request rate limiting state
// This avoids race conditions with concurrent requests
const RPC_LIMITER = {
  // Concurrency control
  activeRequests: 0,
  maxConcurrentRequests: 5,
  requestQueue: [],
  processingQueue: false,
  
  // Global settings
  settings: {
    minOperationSpacing: 500, // Min 500ms between operations
    maxDelay: 8000, // Maximum backoff delay in ms
    baseDelayMs: 250, // Base delay for exponential backoff
    lastOperationTime: 0, // Track the last operation time globally
  },
  
  // Per-call state (key = callName)
  callStats: new Map(),
  
  // Add a request to the queue
  async scheduleRequest(rpcCall, callName) {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({ rpcCall, callName, resolve, reject });
      this.processQueue();
    });
  },
  
  // Process requests from the queue
  async processQueue() {
    // Prevent multiple concurrent queue processing
    if (this.processingQueue) return;
    this.processingQueue = true;
    
    while (this.requestQueue.length > 0 && this.activeRequests < this.maxConcurrentRequests) {
      const { rpcCall, callName, resolve, reject } = this.requestQueue.shift();
      this.activeRequests++;
      
      // Execute the request with rate limiting
      this.executeWithRateLimiting(rpcCall, callName)
        .then(result => {
          this.activeRequests--;
          resolve(result);
          this.processQueue(); // Continue processing queue
        })
        .catch(error => {
          this.activeRequests--;
          reject(error);
          this.processQueue(); // Continue processing queue
        });
    }
    
    this.processingQueue = false;
  },
  
  // Get call-specific state
  getCallState(callName) {
    if (!this.callStats.has(callName)) {
      this.callStats.set(callName, {
        lastHit: 0,
        consecutiveHits: 0,
        currentDelay: 0,
        lastOperationTime: 0
      });
    }
    return this.callStats.get(callName);
  },
  
  // RPC execution with rate limiting
  async executeWithRateLimiting(rpcCall, callName = 'RPC Call') {
    const callState = this.getCallState(callName);
    const now = Date.now();
    
    // 1. Ensure minimum time between operations globally
    const globalTimeSinceLastOp = now - this.settings.lastOperationTime;
    if (globalTimeSinceLastOp < this.settings.minOperationSpacing) {
      const waitTime = this.settings.minOperationSpacing - globalTimeSinceLastOp;
      if (waitTime > 50) {
        logApi.debug(`⏱️ Spacing Solana RPC operations globally by ${waitTime}ms`, {
          service: 'SOLANA',
          operation: callName,
          wait_ms: waitTime
        });
      }
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    // 2. Ensure minimum time between operations for this specific call type
    const callTimeSinceLastOp = now - callState.lastOperationTime;
    if (callTimeSinceLastOp < this.settings.minOperationSpacing * 2) {
      const waitTime = (this.settings.minOperationSpacing * 2) - callTimeSinceLastOp;
      if (waitTime > 50) {
        logApi.debug(`⏱️ Spacing ${callName} operations by ${waitTime}ms`, {
          service: 'SOLANA',
          operation: callName,
          wait_ms: waitTime
        });
      }
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    // Update operation timestamps
    this.settings.lastOperationTime = Date.now();
    callState.lastOperationTime = Date.now();
    
    // 3. Apply backoff from previous rate limits for this call type
    if (callState.currentDelay > 0) {
      logApi.debug(`⏱️ Applying rate limit backoff of ${callState.currentDelay}ms for ${callName}`, {
        service: 'SOLANA',
        operation: callName,
        backoff_ms: callState.currentDelay,
        consecutive_hits: callState.consecutiveHits
      });
      await new Promise(resolve => setTimeout(resolve, callState.currentDelay));
    }
    
    try {
      // Execute the RPC call
      const result = await rpcCall();
      
      // Decrease backoff on success (but don't go to zero immediately)
      if (callState.currentDelay > 0) {
        callState.currentDelay = Math.max(0, callState.currentDelay / 2);
      }
      callState.consecutiveHits = 0;
      
      return result;
    } catch (error) {
      // Check for rate limit error
      const isRateLimit = error.message && (
        error.message.includes('429') ||
        error.message.includes('rate') ||
        error.message.includes('limit') ||
        error.message.includes('requests per second') ||
        error.message.includes('too many requests')
      );
      
      if (isRateLimit) {
        // Update rate limit state for this call type
        callState.lastHit = Date.now();
        callState.consecutiveHits++;
        
        // Exponential backoff with jitter
        const baseDelay = Math.min(
          this.settings.maxDelay,
          Math.pow(2, callState.consecutiveHits) * this.settings.baseDelayMs
        );
        // Add jitter (±20% randomness)
        callState.currentDelay = baseDelay * (0.8 + Math.random() * 0.4);
        
        logApi.warn(`⚡ SOLANA RPC RATE LIMIT Retry in ${callState.currentDelay}ms`, {
          error_type: 'RATE_LIMIT',
          retry_ms: callState.currentDelay,
          rpc_provider: typeof connection === 'object' ? connection.rpcEndpoint : 'unknown',
          original_message: error.message,
          operation: callName,
          consecutive_hits: callState.consecutiveHits,
          severity: 'warning',
          alert_type: 'rate_limit'
        });
        
        // Wait according to backoff and retry once
        await new Promise(resolve => setTimeout(resolve, callState.currentDelay));
        // Retry with a recursive call to this method
        return this.executeWithRateLimiting(rpcCall, callName);
      }
      
      // Not a rate limit error, rethrow
      throw error;
    }
  }
};

/**
 * Execute an RPC call with rate limiting and automatic retry
 * @param {Function} rpcCall - Function that performs the RPC call
 * @param {string} callName - Name of the call for logging
 * @returns {Promise<any>} - Result of the RPC call
 */
async function executeWithRateLimiting(rpcCall, callName = 'RPC Call') {
  return RPC_LIMITER.scheduleRequest(rpcCall, callName);
}

export async function transferSOL(connection, fromKeypair, toAddress, amount) {
  try {
    // Convert string address to PublicKey if needed
    const toPubkey = typeof toAddress === 'string' 
      ? new PublicKey(toAddress) 
      : toAddress;
    
    // Create an RPC client
    const rpc = createSolanaRpc({ 
      url: connection.rpcEndpoint,
      commitment: connection.commitment
    });
    
    // Get a recent blockhash with rate limiting
    const { value: latestBlockhash } = await executeWithRateLimiting(
      () => rpc.getLatestBlockhash(),
      'getLatestBlockhash'
    );
    
    // System Program ID for System Transfer (all zeros in base58)
    const systemProgramId = '11111111111111111111111111111111';
    
    // Instruction data for a transfer (opcode 2 + amount as 64-bit LE)
    const data = new Uint8Array(9);
    data[0] = 2; // Transfer opcode
    
    // Convert amount to lamports
    const amountInLamports = Math.floor(amount * LAMPORTS_PER_SOL);
    
    // Write amount as little-endian 64-bit value
    const view = new DataView(data.buffer, 1);
    view.setBigUint64(0, BigInt(amountInLamports), true);
    
    // Create the transfer instruction using base58 strings for pubkeys
    const transferInstruction = {
      programId: systemProgramId,
      accounts: [
        { pubkey: fromKeypair.publicKey.toBase58(), isSigner: true, isWritable: true },
        { pubkey: toPubkey.toBase58(), isSigner: false, isWritable: true }
      ],
      data: data
    };
    
    // STEP 1: Build the transaction message
    // Create an empty transaction message with version 0
    let txMessage = createTransactionMessage({ version: 0 });
    
    // Set the fee payer using base58 string
    txMessage = setTransactionMessageFeePayer(fromKeypair.publicKey.toBase58(), txMessage);
    
    // Set transaction lifetime using blockhash
    txMessage = setTransactionMessageLifetimeUsingBlockhash(latestBlockhash.blockhash, txMessage);
    
    // Add the transfer instruction to the message
    txMessage = appendTransactionMessageInstruction(transferInstruction, txMessage);
    
    // STEP 2: Compile the message into an unsigned transaction
    // Import the compileTransaction function from @solana/transactions
    const { compileTransaction } = await import('@solana/transactions');
    const transaction = compileTransaction(txMessage);
    
    // STEP 3: Sign the transaction with the sender's keypair
    // Import the signTransaction and getBase64EncodedWireTransaction functions from @solana/transactions
    const { signTransaction, getBase64EncodedWireTransaction } = await import('@solana/transactions');
    
    // Sign the transaction
    const signedTransaction = await signTransaction([fromKeypair.secretKey], transaction);
    
    // STEP 4: Encode the signed transaction for sending
    const encodedTransaction = getBase64EncodedWireTransaction(signedTransaction);
    
    // STEP 5: Send the transaction with proper encoding specified and rate limiting
    const txSignature = await executeWithRateLimiting(
      () => rpc.sendTransaction(encodedTransaction, { 
        encoding: 'base64',
        skipPreflight: false,
        preflightCommitment: connection.commitment || 'confirmed'
      }).send(),
      'sendTransaction'
    );
    
    logApi.info('SOL transfer successful using @solana/transactions v2.1', {
      from: fromKeypair.publicKey.toString(),
      to: toPubkey.toString(),
      amount,
      signature: txSignature,
    });
    
    // Return signature
    return { signature: txSignature };
  } catch (error) {
    logApi.error('SOL transfer failed using @solana/transactions v2.1', {
      error: error.message,
      from: fromKeypair.publicKey.toString(),
      to: typeof toAddress === 'string' ? toAddress : toAddress.toString(),
      amount,
    });
    throw error;
  }
}

/**
 * Creates and sends a token transfer transaction using @solana/transaction-messages
 * and @solana/transactions v2.1 with the correct separation of message creation,
 * transaction compilation, and transaction signing
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
    
    // Get a recent blockhash with rate limiting
    const { value: latestBlockhash } = await executeWithRateLimiting(
      () => rpc.getLatestBlockhash(),
      'getLatestBlockhash'
    );
    
    // Token Program ID in base58 format
    const tokenProgramId = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
    
    // Instruction data for token transfer
    const data = new Uint8Array(9);
    data[0] = 3; // Transfer opcode for SPL Token Program
    
    // Set amount as a little-endian 64-bit value
    const view = new DataView(data.buffer, 1);
    view.setBigUint64(0, BigInt(amount), true);
    
    // Create the token transfer instruction using base58 strings for pubkeys
    const transferInstruction = {
      programId: tokenProgramId,
      accounts: [
        { pubkey: fromTokenPubkey.toBase58(), isSigner: false, isWritable: true },
        { pubkey: toTokenPubkey.toBase58(), isSigner: false, isWritable: true },
        { pubkey: fromKeypair.publicKey.toBase58(), isSigner: true, isWritable: false }
      ],
      data: data
    };
    
    // STEP 1: Build the transaction message
    // Create an empty transaction message with version 0
    let txMessage = createTransactionMessage({ version: 0 });
    
    // Set the fee payer using base58 string
    txMessage = setTransactionMessageFeePayer(fromKeypair.publicKey.toBase58(), txMessage);
    
    // Set transaction lifetime using blockhash
    txMessage = setTransactionMessageLifetimeUsingBlockhash(latestBlockhash.blockhash, txMessage);
    
    // Add the transfer instruction to the message
    txMessage = appendTransactionMessageInstruction(transferInstruction, txMessage);
    
    // STEP 2: Compile the message into an unsigned transaction
    // Import the compileTransaction function from @solana/transactions
    const { compileTransaction } = await import('@solana/transactions');
    const transaction = compileTransaction(txMessage);
    
    // STEP 3: Sign the transaction with the sender's keypair
    // Import the signTransaction and getBase64EncodedWireTransaction functions from @solana/transactions
    const { signTransaction, getBase64EncodedWireTransaction } = await import('@solana/transactions');
    
    // Sign the transaction
    const signedTransaction = await signTransaction([fromKeypair.secretKey], transaction);
    
    // STEP 4: Encode the signed transaction for sending
    const encodedTransaction = getBase64EncodedWireTransaction(signedTransaction);
    
    // STEP 5: Send the transaction with proper encoding specified and rate limiting
    const txSignature = await executeWithRateLimiting(
      () => rpc.sendTransaction(encodedTransaction, { 
        encoding: 'base64',
        skipPreflight: false,
        preflightCommitment: connection.commitment || 'confirmed'
      }).send(),
      'sendTransaction'
    );
    
    logApi.info('Token transfer successful using @solana/transactions v2.1', {
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
    logApi.error('Token transfer failed using @solana/transactions v2.1', {
      error: error.message,
      from: fromKeypair.publicKey.toString(),
      fromToken: typeof fromTokenAccount === 'string' ? fromTokenAccount : fromTokenAccount.toString(),
      toToken: typeof toTokenAccount === 'string' ? toTokenAccount : toTokenAccount.toString(),
      amount,
    });
    throw error;
  }
}

/**
 * Estimates the transaction fee for a SOL transfer using @solana/transaction-messages
 * and @solana/transactions v2.1 with the correct separation of message creation,
 * transaction compilation, and transaction signing
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
    
    // Get a recent blockhash with rate limiting
    const { value: latestBlockhash } = await executeWithRateLimiting(
      () => rpc.getLatestBlockhash(),
      'getLatestBlockhash'
    );
    
    // System Program ID (all zeros in base58)
    const systemProgramId = '11111111111111111111111111111111';
    
    // Instruction data for a transfer (opcode 2 + amount as 64-bit LE)
    const data = new Uint8Array(9);
    data[0] = 2; // Transfer opcode
    
    // Write placeholder amount as little-endian 64-bit value (1 SOL)
    const view = new DataView(data.buffer, 1);
    view.setBigUint64(0, BigInt(LAMPORTS_PER_SOL), true);
    
    // Create the transfer instruction using base58 strings for pubkeys
    const transferInstruction = {
      programId: systemProgramId,
      accounts: [
        { pubkey: fromPubkey.toBase58(), isSigner: true, isWritable: true },
        { pubkey: toPubkey.toBase58(), isSigner: false, isWritable: true }
      ],
      data: data
    };
    
    // STEP 1: Build the transaction message
    // Create an empty transaction message with version 0
    let txMessage = createTransactionMessage({ version: 0 });
    
    // Set the fee payer using base58 string
    txMessage = setTransactionMessageFeePayer(fromPubkey.toBase58(), txMessage);
    
    // Set transaction lifetime using blockhash
    txMessage = setTransactionMessageLifetimeUsingBlockhash(latestBlockhash.blockhash, txMessage);
    
    // Add the transfer instruction to the message
    txMessage = appendTransactionMessageInstruction(transferInstruction, txMessage);
    
    // STEP 2: Compile the message into an unsigned transaction
    // Import the compileTransaction function from @solana/transactions
    const { compileTransaction } = await import('@solana/transactions');
    const transaction = compileTransaction(txMessage);
    
    // STEP 3: For simulation, we need to sign the transaction
    // Create a temporary keypair for simulation
    const tempKeypair = Keypair.generate();
    
    // Import the signTransaction and getBase64EncodedWireTransaction functions
    const { signTransaction, getBase64EncodedWireTransaction } = await import('@solana/transactions');
    
    // Sign the transaction with the temporary keypair
    // This won't be a valid signature for the real fromPubkey, but works for simulation
    const signedTransaction = await signTransaction([tempKeypair.secretKey], transaction);
    
    // STEP 4: Encode the signed transaction for simulation
    const encodedTransaction = getBase64EncodedWireTransaction(signedTransaction);
    
    // STEP 5: Simulate the transaction to get the fee
    const simulationResult = await rpc.simulateTransaction(encodedTransaction, {
      commitment: 'confirmed',
      encoding: 'base64',
      replaceRecentBlockhash: true, // Important: this replaces our fake signature with a valid one for simulation
      sigVerify: false // Skip signature verification since we're using a fake signer
    });
    
    // Extract fee information from simulation result
    const fee = simulationResult.value?.fee || 5000; // Default to 5000 lamports if no fee info
    
    return fee / LAMPORTS_PER_SOL;
  } catch (error) {
    logApi.error('Failed to estimate transaction fee using @solana/transactions v2.1', {
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