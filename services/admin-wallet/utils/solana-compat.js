// services/admin-wallet/utils/solana-compat.js

/**
 * Solana Compatibility Layer - Streamlined
 *
 * @description Provides focused compatibility utilities for admin-wallet modules interacting with SolanaEngine.
 * @author BranchManager69
 * @version 2.1.0
 * @updated $(date +%Y-%m-%d)
 */

import { PublicKey as PublicKeyV1, Keypair as KeypairV1 } from '@solana/web3.js';
import { address, getAddressFromPublicKey } from '@solana/addresses';
// REMOVE: import { createSolanaRpc } from '@solana/rpc'; // No longer making direct RPC calls from here
import { fromLegacyKeypair } from '@solana/compat';

// Constants
export const LAMPORTS_PER_SOL = 1_000_000_000;

// --- Compatibility Functions ---

export function toAddress(publicKeyOrString) {
  if (typeof publicKeyOrString === 'string') {
    return address(publicKeyOrString);
  } else if (publicKeyOrString instanceof PublicKeyV1) {
    return getAddressFromPublicKey(publicKeyOrString);
  }
  return publicKeyOrString; 
}

export async function createKeypairFromPrivateKey(privateKeyBytes) {
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
  if (keyBytesUint8.length !== 64) {
      throw new Error(`Invalid private key length: ${keyBytesUint8.length}. Expected 64 bytes.`);
  }
  const tempV1Keypair = KeypairV1.fromSecretKey(keyBytesUint8);
  const cryptoKeyPair = await fromLegacyKeypair(tempV1Keypair);
  return cryptoKeyPair;
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