// services/admin-wallet/utils/solana-compat.js

/**
 * Solana Compatibility Layer
 *
 * @description Provides a compatibility layer to facilitate the smooth migration 
 *              from Solana Web3.js v1.x to v2.x. Offers unified interfaces 
 *              that can work with both versions, especially bridging interactions 
 *              with SolanaEngine which might still be using v1.x initially.
 *
 * @author BranchManager69
 * @version 2.0.0
 * @created 2025-05-05
 * @updated 2025-05-05
 */

// Solana Web3.js v1 (for compatibility checks/fallbacks and keypair conversion)
import { PublicKey as PublicKeyV1, Keypair as KeypairV1 } from '@solana/web3.js';

// Solana Web3.js v2 Core Packages
import { address, getAddressFromPublicKey } from '@solana/addresses'; // Used in toAddress
import { createSolanaRpc } from '@solana/rpc'; // Used for direct v2 RPC calls
// Consolidate imports from @solana/transaction-messages
import { 
  appendTransactionMessageInstruction,
  setTransactionMessageLifetimeUsingBlockhash,
  createTransactionMessage,
  setTransactionMessageFeePayer
} from '@solana/transaction-messages'; 

// Import v1/v2 compatibility helpers
import { fromLegacyKeypair, fromLegacyTransactionInstruction } from '@solana/compat';

// Import remaining v2 transaction building blocks
import {
    compileTransaction,
    signTransaction
    // getBase64EncodedWireTransaction - Handled by rpc.sendTransaction
} from '@solana/transactions';
// Need TransactionInstruction type if converting - Removed TS type imports
// import type { TransactionInstruction as TransactionInstructionV1 } from '@solana/web3.js';
// import type { TransactionInstruction as TransactionInstructionV2 } from '@solana/transactions';

// Constants
export const LAMPORTS_PER_SOL = 1000000000;

// --- Compatibility Functions ---

/**
 * Converts various PublicKey representations (v1 PublicKey, string) to a v2 Address.
 * @param {PublicKeyV1 | string | import('@solana/addresses').Address} publicKeyOrString - Input address representation.
 * @returns {import('@solana/addresses').Address} - The v2 Address object.
 */
export function toAddress(publicKeyOrString) {
  if (typeof publicKeyOrString === 'string') {
    // Handle base58 string address - Use address() function
    return address(publicKeyOrString);
  } else if (publicKeyOrString instanceof PublicKeyV1) {
    // Handle v1 PublicKey object
    return getAddressFromPublicKey(publicKeyOrString);
  }
  // Assume it's already a v2 Address object or compatible
  return publicKeyOrString; 
}

/**
 * Creates a v2 `CryptoKeyPair` from raw private key bytes.
 * Uses v1 Keypair temporarily for conversion via @solana/compat.
 * 
 * @param {Uint8Array | Buffer | number[]} privateKeyBytes - The raw 64-byte private key.
 * @returns {Promise<CryptoKeyPair>} - The v2 CryptoKeyPair.
 */
export async function createKeypairFromPrivateKey(privateKeyBytes) {
  // Ensure input is Uint8Array
  let keyBytesUint8;
  if (privateKeyBytes instanceof Uint8Array) {
    keyBytesUint8 = privateKeyBytes;
  } else if (Buffer.isBuffer(privateKeyBytes)) {
    keyBytesUint8 = Uint8Array.from(privateKeyBytes);
  } else if (Array.isArray(privateKeyBytes)) {
    keyBytesUint8 = Uint8Array.from(privateKeyBytes);
  } else {
    throw new Error('Invalid private key input format. Expected Uint8Array, Buffer, or Array.');
  }

  // --- CORRECTED: Validate key length strictly --- 
  if (keyBytesUint8.length !== 64) {
      // Throw an error instead of padding/truncating
      throw new Error(`Invalid private key length: ${keyBytesUint8.length}. Expected 64 bytes.`);
  }
  
  // Create a temporary v1 Keypair
  const tempV1Keypair = KeypairV1.fromSecretKey(keyBytesUint8);
  
  // Convert v1 Keypair to v2 CryptoKeyPair using compat library
  const cryptoKeyPair = await fromLegacyKeypair(tempV1Keypair);
  
  return cryptoKeyPair;
}

/**
 * Executes an RPC method using either SolanaEngine's v1 style or direct v2 RPC calls.
 * Detects the connection object type to determine the appropriate method.
 * @param {object} connection - Either SolanaEngine instance or a v2 RPC endpoint URL/config.
 * @param {string} method - The RPC method name (e.g., 'getBalance').
 * @param {...any} args - Arguments for the RPC method.
 * @returns {Promise<any>} - The result of the RPC call.
 */
export function executeRpcMethod(connection, method, ...args) {
  // Check if the connection object has SolanaEngine's specific v1 method
  if (typeof connection.executeConnectionMethod === 'function') {
    // Use SolanaEngine's v1 compatibility method
    return connection.executeConnectionMethod(method, ...args);
  } else {
    // Assume direct v2 RPC call
    const rpc = createSolanaRpc(connection.url || connection);
    
    // Route to the appropriate v2 RPC API *method on the rpc object*
    switch (method) {
      case 'getBalance':
        // getBalance expects the Address object directly as the first arg.
        // Commitment is handled by the rpc client config (rpcConfigForCall).
        return rpc.getBalance(toAddress(args[0])).send(); 
      case 'getLatestBlockhash':
        // getLatestBlockhash can take an optional config with commitment.
        // If args[0] is that config, pass it; otherwise, rely on client default.
        return rpc.getLatestBlockhash(args[0]).send();
      case 'getFeeForMessage':
        // getFeeForMessage(message, config?) message is args[0], config is args[1]
        return rpc.getFeeForMessage(args[0], args[1]).send(); 
      case 'getTokenSupply':
        // getTokenSupply(mint, config?) mint is args[0], config is args[1]
        return rpc.getTokenSupply(toAddress(args[0]), args[1]).send();
      case 'getTokenAccountsByOwner': { 
        // getTokenAccountsByOwner(owner, filter, config?) owner is args[0], filter is args[1], config is args[2]
        const filterArg = args[1];
        let programIdFilter = {};
        if (typeof filterArg === 'string') {
          programIdFilter = { programId: toAddress(filterArg) };
        } else if (filterArg?.mint) {
          programIdFilter = { mint: toAddress(filterArg.mint) };
        }
        return rpc.getTokenAccountsByOwner(toAddress(args[0]), programIdFilter, args[2]).send();
      }
      case 'getTokenAccountBalance':
        // getTokenAccountBalance(account, config?) account is args[0], config is args[1]
        return rpc.getTokenAccountBalance(toAddress(args[0]), args[1]).send();
      case 'getMultipleAccountsInfo': {
        // Expects args[0] to be an array of public key strings
        // Optional args[1] can be the commitment or options object
        if (!Array.isArray(args[0])) {
          throw new Error('getMultipleAccountsInfo expects an array of public key strings as its first argument.');
        }
        const addresses = args[0].map(pkString => toAddress(pkString));
        // The getMultipleAccounts method might take an options object as its second argument for commitment, etc.
        // For simplicity, we assume any second arg is that options object.
        return rpc.getMultipleAccounts(addresses, args[1]).send(); 
      }
      // Add cases for other commonly used RPC methods as needed
      default:
        // Maybe try dynamic dispatch if method exists?
        if (typeof rpc[method] === 'function') {
             logApi.warn(`Attempting dynamic dispatch for unhandled v2 RPC method: ${method}`);
             // Need to figure out how args map to the dynamic method call
             // This is complex and risky without knowing the expected args structure.
             // For now, stick to throwing an error.
             // return rpc[method](...args).send(); 
        }
        throw new Error(`RPC Method '${method}' not explicitly handled in v2 compatibility layer`);
    }
  }
}

/**
 * Sends a transaction using either SolanaEngine's v1 style or direct v2 methods.
 * Detects the connection object type and handles transaction conversion/building for v2.
 * 
 * @param {object} connection - Either SolanaEngine instance or a v2 RPC endpoint URL/config.
 * @param {TransactionV1} transaction - The transaction object (currently assumes v1 input).
 * @param {Array<CryptoKeyPair>} signers - Array of signers (assumes v2 CryptoKeyPair from createKeypairFromPrivateKey).
 * @param {object} options - Options (e.g., commitment, skipPreflight - primarily for v1 path).
 * @returns {Promise<string>} - The transaction signature.
 */
export async function sendTransaction(connection, transaction, signers, options = {}) {
  // Check if the connection object has SolanaEngine's specific v1 method
  if (typeof connection.sendTransaction === 'function') {
    // Use SolanaEngine's v1 sendTransaction method
    // Note: SolanaEngine expects v1 Keypair signers. Our createKeypairFromPrivateKeyCompat
    // currently calls the compat layer which returns v2 CryptoKeyPair.
    // We need to ensure the signers passed here are compatible with SolanaEngine's expectation.
    // For now, assuming the calling code handles potential conversion if needed, 
    // OR that SolanaEngine itself is updated to handle v2 signers.
    // This highlights a potential friction point during phased migration.
    logApi.debug('Sending transaction via SolanaEngine (v1 path)');
    return connection.sendTransaction(transaction, signers, options);
  } else {
    // Assume direct v2 RPC call
    logApi.debug('Sending transaction via direct v2 path');
    const rpc = createSolanaRpc(connection.url || connection);
    
    // --- Build v2 Transaction from v1 Input --- 

    // 1. Get Blockhash (needed for message lifetime)
    // Note: Using executeRpcMethod to potentially leverage SolanaEngine caching if available
    const latestBlockhashResult = await executeRpcMethod(connection, 'getLatestBlockhash', options?.commitment || 'confirmed');
    // Handle potential v1/v2 blockhash result structures
    let blockhash;
    if (typeof latestBlockhashResult === 'object' && latestBlockhashResult !== null && latestBlockhashResult.blockhash) {
        blockhash = latestBlockhashResult.blockhash; // Likely v2 { blockhash, lastValidBlockHeight }
    } else if (typeof latestBlockhashResult === 'string') {
        blockhash = latestBlockhashResult; // Assuming direct v1 blockhash string
    } else {
         throw new Error('Failed to get valid blockhash from executeRpcMethod');
    }
    
    // 2. Convert v1 Instructions to v2 Format
    const v2Instructions = transaction.instructions.map((ixV1) => 
        fromLegacyTransactionInstruction(ixV1)
    );

    // 3. Ensure Signers are CryptoKeyPairs (as returned by our updated createKeypairFromPrivateKey)
    // We assume the `signers` array already contains CryptoKeyPair objects.
    if (!signers || signers.length === 0 || !signers[0].privateKey) {
        throw new Error('Invalid signers provided for v2 transaction path. Expected CryptoKeyPair array.');
    }
    // The first signer is typically the fee payer
    const feePayerKeyPair = signers[0];
    const feePayerAddress = address(await crypto.subtle.exportKey('raw', feePayerKeyPair.publicKey));

    // 4. Create the v2 Transaction Message
    let txMessage = createTransactionMessage({ version: 0 });
    txMessage = setTransactionMessageFeePayer(feePayerAddress, txMessage);
    txMessage = setTransactionMessageLifetimeUsingBlockhash({ blockhash, lastValidBlockHeight: latestBlockhashResult?.lastValidBlockHeight }, txMessage);
    txMessage = appendTransactionMessageInstruction(v2Instructions, txMessage);

    // 5. Compile the Message
    const compiledTx = compileTransaction(txMessage);

    // 6. Sign the Transaction
    // signTransaction expects an array of private keys (CryptoKeyPair.privateKey)
    const privateKeys = signers.map(kp => kp.privateKey);
    const signedTx = await signTransaction(privateKeys, compiledTx);

    // 7. Send the Transaction
    // rpc.sendTransaction expects the serialized, signed transaction bytes
    const txSignature = await rpc.sendTransaction(signedTx.serializedMessage, {
        encoding: 'base64', // Assuming sendTransaction handles base64 internally
        skipPreflight: options?.skipPreflight ?? false,
        preflightCommitment: options?.commitment || 'confirmed',
        maxRetries: options?.maxRetries
    }).send(); // Need to call .send() for the RPC method

    return txSignature;
  }
}

// --- Utility Helpers ---

/**
 * Normalizes the result of an RPC call that returns a value (like getBalance)
 * to ensure it's a standard JavaScript Number.
 * Handles direct numbers (v1/SolanaEngine pass-through) and v2 objects { value: bigint | null }.
 * 
 * @param {number | { value: bigint | null } | any} rpcResult - The raw result from an RPC call.
 * @param {string} methodName - [Optional] Name of the method for logging purposes.
 * @param {string} addressString - [Optional] Address associated with the call for logging.
 * @returns {number} - The value as a Number (e.g., lamports), defaults to 0 if null or invalid.
 */
export function getLamportsFromRpcResult(rpcResult, methodName = 'unknown', addressString = 'unknown') {
    if (typeof rpcResult === 'object' && rpcResult !== null && typeof rpcResult.value !== 'undefined') {
        // v2 structure: { value: bigint | null }
        return rpcResult.value !== null ? Number(rpcResult.value) : 0;
    } else if (typeof rpcResult === 'number') {
        // v1 structure or direct number pass-through
        return rpcResult;
    } else {
        // Unexpected result type
        logApi.warn(`Unexpected ${methodName} result type for ${addressString}:`, rpcResult);
        return 0; // Default to 0 if format is unknown/invalid
    }
} 