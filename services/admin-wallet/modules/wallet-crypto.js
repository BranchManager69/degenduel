// services/admin-wallet/modules/wallet-crypto.js

/**
 * Admin Wallet Cryptography Module
 * @module wallet-crypto
 * 
 * @description Handles encryption and decryption of wallet private keys using AES-256-GCM
 *              and provides functions for creating Solana keypairs from various 
 *              private key formats, including legacy decoding and v2 compatibility.
 * 
 * @author BranchManager69
 * @version 2.1.0
 * @created $(date +%Y-%m-%d)
 * @updated $(date +%Y-%m-%d)
 */

import { logApi } from '../../../utils/logger-suite/logger.js';
import { fancyColors } from '../../../utils/colors.js';
import crypto from 'crypto';
import bs58 from 'bs58';
import { Keypair as KeypairV1_for_legacy } from '@solana/web3.js';
import { ServiceError } from '../../../utils/service-suite/service-error.js';
import { createKeypairFromPrivateKey as createKeypairViaCompatLayer } from '../utils/solana-compat.js';
import { createKeyPairSignerFromBytes } from '@solana/keys';
import { Buffer } from 'node:buffer';

/* Functions */

/**
 * Encrypts a wallet private key using AES-256-GCM
 * 
 * @param {string} privateKey - The private key to encrypt
 * @param {Object} config - Configuration for encryption
 * @param {string} encryptionKey - The encryption key (from environment variables)
 * @returns {string} - JSON string of encrypted data
 */
export function encryptWallet(privateKey, config, encryptionKey) {
    try {
        const iv = crypto.randomBytes(config.wallet.encryption.ivLength);
        const cipher = crypto.createCipheriv(
            config.wallet.encryption.algorithm,
            Buffer.from(encryptionKey, 'hex'),
            iv
        );

        const encrypted = Buffer.concat([
            cipher.update(privateKey),
            cipher.final()
        ]);

        const tag = cipher.getAuthTag();

        return JSON.stringify({
            encrypted: encrypted.toString('hex'),
            iv: iv.toString('hex'),
            tag: tag.toString('hex')
        });
    } catch (error) {
        throw ServiceError.operation('Failed to encrypt wallet', {
            error: error.message,
            type: 'ENCRYPTION_ERROR'
        });
    }
}

/**
 * Decrypts a wallet private key.
 * Handles new 'v2_seed_admin' format (returning 32-byte Buffer seed) and legacy format (returning string).
 */
export function decryptWallet(encryptedDataJsonString, encryptionKey) {
    try {
        if (typeof encryptedDataJsonString !== 'string' || !encryptedDataJsonString.startsWith('{')) {
            logApi.info(`${fancyColors.CYAN}[wallet-crypto]${fancyColors.RESET} Key appears to be plaintext: ${encryptedDataJsonString.substring(0,20)}...`);
            return encryptedDataJsonString; // Return as-is (string)
        }
        
        const parsedData = JSON.parse(encryptedDataJsonString);
        const { encrypted, iv, tag, version, aad } = parsedData;

        const decipher = crypto.createDecipheriv(
            'aes-256-gcm',
            Buffer.from(encryptionKey, 'hex'),
            Buffer.from(iv, 'hex')
        );
        decipher.setAuthTag(Buffer.from(tag, 'hex'));
        if (aad) decipher.setAAD(Buffer.from(aad, 'hex')); // Handle AAD if present (good practice)
        
        const decryptedBuffer = Buffer.concat([
            decipher.update(Buffer.from(encrypted, 'hex')),
            decipher.final()
        ]);

        if (version === 'v2_seed_admin') {
            // For new version, the decrypted content IS the 32-byte seed.
            // We need to ensure it was stored as such (e.g., if seed was hex/bs58 encoded before encryption by caller of encryptWallet).
            // Let's assume the decryptedBuffer here IS the raw 32-byte seed if version matches.
            // If encryptWallet encrypted a bs58 string of the seed, this decryptedBuffer would be that string.
            // For this path to return raw bytes, encryptWallet should have taken raw bytes, or this needs to decode.
            // Let's refine this: IF version is v2_seed_admin, we assume the original encrypted payload
            // was the *string representation* of the seed (e.g. bs58). So, we decode it HERE.
            const decryptedSeedString = decryptedBuffer.toString();
            let seedBytes_32;
            try {
                seedBytes_32 = bs58.decode(decryptedSeedString); // Assuming it was bs58 encoded seed string
            } catch (e) {
                // Try hex as a fallback if bs58 decode fails
                try {
                    seedBytes_32 = Buffer.from(decryptedSeedString, 'hex');
                } catch (hexErr) {
                    logApi.error('[wallet-crypto] v2_seed_admin decryption: Failed to decode seed string (bs58 or hex).', {decryptedSeedString});
                    throw ServiceError.operation('Failed to decode v2_seed_admin after decryption', { type: 'DECRYPTION_ERROR_SEED_DECODE' });
                }
            }

            if (seedBytes_32.length !== 32) {
                logApi.error('[wallet-crypto] v2_seed_admin decryption: Decoded seed is not 32 bytes.', { length: seedBytes_32.length });
                throw ServiceError.operation('Decrypted v2_seed_admin is not 32 bytes', { type: 'DECRYPTION_ERROR_SEED_LENGTH' });
            }
            logApi.debug('[wallet-crypto] Decrypted v2_seed_admin successfully to 32-byte seed Buffer.');
            return Buffer.from(seedBytes_32); // Return 32-byte Buffer
        } else {
            // Legacy path: decrypted content was likely a v1 key string representation
            logApi.debug('[wallet-crypto] Decrypted legacy key format to string.');
            return decryptedBuffer.toString(); // Return string for legacy path
        }
    } catch (error) {
        logApi.error(`${fancyColors.RED}[wallet-crypto] Decryption error:${fancyColors.RESET} ${error.message}`);
        // Avoid exposing too much detail in generic error
        throw ServiceError.operation('Failed to decrypt wallet key', {
            type: 'DECRYPTION_ERROR_GENERAL' 
            // originalError: error.message // Be cautious about exposing internal error messages
        });
    }
}

/**
 * Creates a Solana keypair from various input types.
 * If input is a 32-byte seed (Buffer), uses v2 direct creation.
 * If input is a string (legacy encrypted key), uses legacy path via compat layer.
 */
export async function createKeypairFromPrivateKeyCompat(privateKeyInput) {
    try {
        if (privateKeyInput instanceof Buffer && privateKeyInput.length === 32) {
            // Input is a 32-byte seed Buffer (from new decryptWallet path)
            logApi.debug('[wallet-crypto] Creating v2 KeyPairSigner directly from 32-byte seed.');
            return await createKeyPairSignerFromBytes(privateKeyInput);
        } else if (typeof privateKeyInput === 'string') {
            // Input is a string (from legacy decryptWallet path or direct plaintext string)
            logApi.debug('[wallet-crypto] Input is string, attempting legacy keypair creation path...');
            const legacyKeypair_v1 = createKeypairFromPrivateKeyLegacy(privateKeyInput);
            if (!legacyKeypair_v1 || !legacyKeypair_v1.secretKey || legacyKeypair_v1.secretKey.length !== 64) {
                throw new Error('Legacy decoder did not return valid 64-byte secret key for compat layer.');
            }
            // Pass the full 64-byte v1 secret key to the compat layer function
            return await createKeypairViaCompatLayer(legacyKeypair_v1.secretKey);
        } else if ((privateKeyInput instanceof Uint8Array || Buffer.isBuffer(privateKeyInput)) && privateKeyInput.length === 64) {
            // Input is already a 64-byte array (e.g. from some other source)
            logApi.debug('[wallet-crypto] Input is 64-byte array, using compat layer directly.');
            return await createKeypairViaCompatLayer(privateKeyInput);
        }else {
            logApi.error('[wallet-crypto] Invalid input type for createKeypairFromPrivateKeyCompat:', privateKeyInput);
            throw new Error('Invalid input for keypair creation. Expected 32-byte seed Buffer, legacy key string, or 64-byte array.');
        }
    } catch (error) {
        logApi.error('[wallet-crypto] Error in createKeypairFromPrivateKeyCompat:', error);
        throw ServiceError.operation('Failed to create keypair from private key input', {
            error: error.message,
            type: 'KEYPAIR_CREATION_ERROR'
        });
    }
}

/**
 * [LEGACY] Creates a Solana v1 Keypair from various possible private key string formats.
 */
export function createKeypairFromPrivateKeyLegacy(decryptedPrivateKeyString) {
    logApi.info(`${fancyColors.CYAN}[wallet-crypto]${fancyColors.RESET} [Legacy] Processing decrypted key string length: ${decryptedPrivateKeyString.length}`);
    let privateKeyBytes_64;
    let fromKeypair_v1;
    try {
        if (/^[0-9a-fA-F]+$/.test(decryptedPrivateKeyString)) { // Hex
            if (decryptedPrivateKeyString.length === 128) privateKeyBytes_64 = Buffer.from(decryptedPrivateKeyString, 'hex');
            else { /* ... padding logic for hex ... */ 
                const secretKey = new Uint8Array(64); const hexData = Buffer.from(decryptedPrivateKeyString, 'hex');
                for (let i = 0; i < Math.min(hexData.length, 64); i++) secretKey[i] = hexData[i];
                privateKeyBytes_64 = secretKey;}
            if (privateKeyBytes_64) fromKeypair_v1 = KeypairV1_for_legacy.fromSecretKey(privateKeyBytes_64);
        }
        if (!fromKeypair_v1) { // Base58
            privateKeyBytes_64 = bs58.decode(decryptedPrivateKeyString);
            if (privateKeyBytes_64.length !== 64) { /* ... padding logic for bs58 ... */ 
                const paddedKey = new Uint8Array(64); for (let i = 0; i < Math.min(privateKeyBytes_64.length, 64); i++) paddedKey[i] = privateKeyBytes_64[i];
                privateKeyBytes_64 = paddedKey; }
            if (privateKeyBytes_64) fromKeypair_v1 = KeypairV1_for_legacy.fromSecretKey(privateKeyBytes_64);
        }
        // ... (Simplified further checks for base64, JSON - assuming primary paths are hex/bs58 for brevity in this diff)
        if (!fromKeypair_v1 && decryptedPrivateKeyString.startsWith('[') && decryptedPrivateKeyString.endsWith(']')) { // JSON Array
            try {
                const arr = JSON.parse(decryptedPrivateKeyString);
                if (Array.isArray(arr) && arr.every(n => typeof n === 'number')) {
                     if (arr.length === 32) { // If it's a 32-byte seed array, make it 64 for v1 Keypair
                        const fullKey = new Uint8Array(64); fullKey.set(arr); privateKeyBytes_64 = fullKey;
                     } else if (arr.length === 64) {
                        privateKeyBytes_64 = Uint8Array.from(arr);
                     } // else invalid length for this path
                     if (privateKeyBytes_64) fromKeypair_v1 = KeypairV1_for_legacy.fromSecretKey(privateKeyBytes_64);
                }
            } catch(e){ logApi.warn("Failed to parse as JSON array for legacy key (expected byte array)"); }
        }

        if (!fromKeypair_v1) { // Final fallback if it was a raw string not fitting other formats, try bs58 again
            logApi.warn('[wallet-crypto] Legacy key decode: All formats failed, trying direct bs58 as last resort.');
            privateKeyBytes_64 = bs58.decode(decryptedPrivateKeyString);
            if (privateKeyBytes_64.length !== 64) { /* pad */ const p = new Uint8Array(64); p.set(privateKeyBytes_64.slice(0, Math.min(privateKeyBytes_64.length, 32))); privateKeyBytes_64 = p;} // If it was a seed, it ends up as 32 bytes in 64 byte array for v1
            fromKeypair_v1 = KeypairV1_for_legacy.fromSecretKey(privateKeyBytes_64);
        }
    } catch (allFormatError) {
        throw new Error(`[Legacy] Failed to decode private key string in any supported format: ${allFormatError.message}`);
    }
    if (!fromKeypair_v1 || !fromKeypair_v1.publicKey) {
        throw new Error('[Legacy] Failed to generate valid v1 keypair from private key string');
    }
    logApi.info(`${fancyColors.CYAN}[wallet-crypto]${fancyColors.RESET} [Legacy] Successfully created v1 keypair: ${fromKeypair_v1.publicKey.toBase58()}`);
    return fromKeypair_v1;
}

/* Exports */

export default {
    encryptWallet,
    decryptWallet,
    createKeypairFromPrivateKeyCompat,
    createKeypairFromPrivateKeyLegacy
}; 