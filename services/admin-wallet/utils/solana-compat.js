// services/admin-wallet/utils/solana-compat.js

/**
 * Solana Compatibility Layer - Streamlined
 *
 * @description Provides focused compatibility utilities for admin-wallet modules interacting with SolanaEngine.
 * @author BranchManager69
 * @version 2.2.0
 * @updated $(date +%Y-%m-%d)
 */

import { address, getAddressFromPublicKey } from '@solana/addresses';
import { createKeyPairSignerFromBytes } from '@solana/signers';
import { Buffer } from 'node:buffer';

// Constants
export const LAMPORTS_PER_SOL = 1_000_000_000;

// --- Compatibility Functions ---

export function toAddress(publicKeyOrString) {
  if (typeof publicKeyOrString === 'string') {
    return address(publicKeyOrString);
  }
  return publicKeyOrString; 
}

/**
 * Creates a v2 `KeyPairSigner` from raw 64-byte v1 private key bytes by extracting the 32-byte seed.
 * 
 * @param {Uint8Array | Buffer | number[]} privateKeyBytes_64 - The raw 64-byte v1 private key.
 * @returns {Promise<import('@solana/signers').KeyPairSigner>} - The v2 KeyPairSigner.
 */
export async function createKeypairFromPrivateKey(privateKeyBytes_64) {
  let keyBytesUint8;
  if (privateKeyBytes_64 instanceof Uint8Array) {
    keyBytesUint8 = privateKeyBytes_64;
  } else if (Buffer.isBuffer(privateKeyBytes_64)) {
    keyBytesUint8 = Uint8Array.from(privateKeyBytes_64);
  } else if (Array.isArray(privateKeyBytes_64)) {
    keyBytesUint8 = Uint8Array.from(privateKeyBytes_64);
  } else {
    throw new Error('Invalid private key input format for createKeypairFromPrivateKey. Expected Uint8Array, Buffer, or Array.');
  }

  if (keyBytesUint8.length !== 64) {
      throw new Error(`Invalid private key length: ${keyBytesUint8.length}. Expected 64 bytes for v1 secret key format.`);
  }
  
  // Extract the first 32 bytes (the seed) from the 64-byte v1 secret key
  const seed_32_bytes = keyBytesUint8.slice(0, 32);
  
  // Create a v2 KeyPairSigner directly from the 32-byte seed
  return await createKeyPairSignerFromBytes(seed_32_bytes);
}

/**
 * Executes an RPC method by delegating to SolanaEngine's executeConnectionMethod.
 * @param {object} solanaEngineInstance - The SolanaEngine instance.
 * @param {string} method - The RPC method name (e.g., 'getBalance').
 * @param {...any} args - Arguments for the RPC method.
 * @returns {Promise<any>} - The result of the RPC call.
 */
export function executeRpcMethod(solanaEngineInstance, method, ...args) {
  if (!solanaEngineInstance || typeof solanaEngineInstance.executeConnectionMethod !== 'function') {
    // Log error or throw, as this is a critical misuse if solanaEngine is not passed.
    console.error("[solana-compat] executeRpcMethod called without a valid solanaEngineInstance!");
    throw new Error('executeRpcMethod requires a valid solanaEngineInstance with executeConnectionMethod.');
  }
  // Always delegate to SolanaEngine, which handles routing to ConnectionManager -> v2 RPC calls
  return solanaEngineInstance.executeConnectionMethod(method, ...args);
}

export function getLamportsFromRpcResult(rpcResult, methodName = 'unknown', addressString = 'unknown') {
    if (typeof rpcResult === 'object' && rpcResult !== null && typeof rpcResult.value !== 'undefined') {
        return rpcResult.value !== null ? Number(rpcResult.value) : 0;
    } else if (typeof rpcResult === 'number') {
        return rpcResult;
    } else {
        console.warn(`[solana-compat] Unexpected ${methodName} result type for ${addressString}:`, rpcResult);
        return 0;
    }
} 