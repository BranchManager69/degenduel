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
 * @version 2.3.0
 * @created $(date +%Y-%m-%d)
 * @updated $(date +%Y-%m-%d)
 */

import { logApi } from '../../../utils/logger-suite/logger.js';
import { fancyColors } from '../../../utils/colors.js';
import crypto from 'crypto';
import { ServiceError } from '../../../utils/service-suite/service-error.js';
import { createKeypairFromPrivateKey as createKeypairViaCompatLayer } from '../utils/solana-compat.js';
import { createKeyPairSignerFromBytes } from '@solana/signers';
import { Buffer } from 'node:buffer';

/* Functions */

/**
 * Encrypts a 32-byte seed buffer directly for v2 storage.
 * Returns JSON with a version marker.
 */
export function encryptV2SeedBuffer(seedBuffer_32_bytes, config, encryptionKey) {
    if (!(seedBuffer_32_bytes instanceof Buffer && seedBuffer_32_bytes.length === 32)) {
        throw ServiceError.validation('encryptV2SeedBuffer expects a 32-byte Buffer.');
    }
    try {
        const iv = crypto.randomBytes(config.wallet.encryption.ivLength);
        // Optional: const aad = crypto.randomBytes(16); // For additional authenticated data
        const cipher = crypto.createCipheriv(
            config.wallet.encryption.algorithm,
            Buffer.from(encryptionKey, 'hex'),
            iv
        );
        // if (aad) cipher.setAAD(aad);
        
        const encryptedSeed = Buffer.concat([cipher.update(seedBuffer_32_bytes), cipher.final()]);
        const tag = cipher.getAuthTag();

        return JSON.stringify({
            version: 'v2_seed_admin_raw', // New distinct version for encrypted raw seed
            encrypted_payload: encryptedSeed.toString('hex'), // Store hex of encrypted RAW seed
            iv: iv.toString('hex'),
            tag: tag.toString('hex'),
            // aad: aad ? aad.toString('hex') : undefined
        });
    } catch (error) {
        throw ServiceError.operation('Failed to encrypt v2 seed buffer', {
            error: error.message,
            type: 'ENCRYPTION_ERROR_V2_SEED'
        });
    }
}

/* --- Legacy Encryption (Kept for compatibility if anything still calls it expecting to encrypt a string) --- */
// This function is problematic if the string isn't handled well by crypto layer encoding.
// Ideally, callers should provide bytes to an encryptBuffer type function.
export function encryptLegacyPrivateKeyString(privateKeyString, config, encryptionKey) {
    logApi.warn("[wallet-crypto] encryptLegacyPrivateKeyString called. This method is for legacy purposes and assumes input string is crypto-safe.")
    try {
        const iv = crypto.randomBytes(config.wallet.encryption.ivLength);
        const cipher = crypto.createCipheriv(
            config.wallet.encryption.algorithm,
            Buffer.from(encryptionKey, 'hex'),
            iv
        );
        // cipher.update by default treats string as utf8. This might be the issue if string had non-utf8 bytes represented.
        const encrypted = Buffer.concat([cipher.update(privateKeyString), cipher.final()]);
        const tag = cipher.getAuthTag();
        return JSON.stringify({
            // NO version marker here for legacy
            encrypted: encrypted.toString('hex'),
            iv: iv.toString('hex'),
            tag: tag.toString('hex')
        });
    } catch (error) {
        throw ServiceError.operation('Failed to encrypt legacy private key string', {
            error: error.message,
            type: 'ENCRYPTION_ERROR_LEGACY_STRING'
        });
    }
}

// Aliasing old encryptWallet to the legacy string version for now.
// Migration script will call the new encryptV2SeedBuffer directly.
// Other parts of the codebase if they call `encryptWallet` need to be assessed.
export const encryptWallet = encryptLegacyPrivateKeyString;

/**
 * Decrypts a wallet private key.
 * If version is 'v2_seed_admin_raw', returns the raw 32-byte Buffer (seed).
 * If version is 'v2_seed_admin' (older string-encoded seed), attempts bs58/hex decode to get 32-byte Buffer.
 * For legacy (no version), returns the raw 64-byte (expected) decrypted Buffer.
 */
export function decryptWallet(encryptedDataJsonString, encryptionKey) {
    try {
        if (typeof encryptedDataJsonString !== 'string' || !encryptedDataJsonString.startsWith('{')) {
            logApi.debug(`${fancyColors.CYAN}[wallet-crypto]${fancyColors.RESET} Key treated as plaintext: ${encryptedDataJsonString.substring(0,20)}...`);
            return encryptedDataJsonString;
        }
        
        const parsedData = JSON.parse(encryptedDataJsonString);
        const { encrypted_payload, encrypted, iv, tag, version, aad } = parsedData; // Look for encrypted_payload first

        const payloadToDecrypt = encrypted_payload || encrypted; // Use new field if present
        if (!payloadToDecrypt || !iv || !tag) {
            throw new Error('Encrypted data JSON is missing required fields (encrypted_payload/encrypted, iv, tag).');
        }

        const decipher = crypto.createDecipheriv(
            'aes-256-gcm',
            Buffer.from(encryptionKey, 'hex'),
            Buffer.from(iv, 'hex')
        );
        decipher.setAuthTag(Buffer.from(tag, 'hex'));
        if (aad) decipher.setAAD(Buffer.from(aad, 'hex'));
        
        const decryptedBuffer = Buffer.concat([
            decipher.update(Buffer.from(payloadToDecrypt, 'hex')),
            decipher.final()
        ]);

        if (version === 'v2_seed_admin_raw') { // New path for raw encrypted seed
            if (decryptedBuffer.length !== 32) {
                logApi.error('[wallet-crypto] v2_seed_admin_raw: Decrypted payload is not 32 bytes.', { length: decryptedBuffer.length });
                throw ServiceError.operation('Decrypted v2_seed_admin_raw payload is not 32 bytes', { type: 'DECRYPTION_ERROR_V2_RAW_SEED_LENGTH' });
            }
            logApi.debug('[wallet-crypto] Decrypted v2_seed_admin_raw directly to 32-byte seed Buffer.');
            return decryptedBuffer; // Return 32-byte raw seed Buffer directly

        } else if (version === 'v2_seed_admin') { // Old path for string-encoded encrypted seed
            const decryptedSeedString = decryptedBuffer.toString(); 
            let seedBytes_32;
            try { seedBytes_32 = bs58.decode(decryptedSeedString); }
            catch (e) {
                try { seedBytes_32 = Buffer.from(decryptedSeedString, 'hex'); }
                catch (hexErr) {
                    logApi.error('[wallet-crypto] v2_seed_admin (string): Failed to decode seed string.', {decryptedSeedString});
                    throw ServiceError.operation('Failed to decode v2_seed_admin (string) after decryption', { type: 'DECRYPTION_ERROR_SEED_DECODE' });
                }
            }
            if (seedBytes_32.length !== 32) {
                logApi.error('[wallet-crypto] v2_seed_admin (string): Decoded seed is not 32 bytes.', { length: seedBytes_32.length });
                throw ServiceError.operation('Decrypted v2_seed_admin (string) seed is not 32 bytes', { type: 'DECRYPTION_ERROR_SEED_LENGTH' });
            }
            logApi.debug('[wallet-crypto] Decrypted v2_seed_admin (string) to 32-byte seed Buffer.');
            return Buffer.from(seedBytes_32);
        } else {
            // Legacy path: return the raw decrypted buffer (expected to be 64-byte v1 secret key)
            logApi.debug(`[wallet-crypto] Decrypted legacy key format to raw Buffer (length: ${decryptedBuffer.length}).`);
            return decryptedBuffer;
        }
    } catch (error) {
        logApi.error(`${fancyColors.RED}[wallet-crypto] Decryption error:${fancyColors.RESET} ${error.message}`);
        throw ServiceError.operation('Failed to decrypt wallet key', { type: 'DECRYPTION_ERROR_GENERAL' });
    }
}

/**
 * Creates a Solana keypair from a decrypted private key (Buffer).
 * If input is a 32-byte seed (Buffer), uses v2 direct creation.
 * If input is a 64-byte v1 key (Buffer), uses legacy path via compat layer.
 */
export async function createKeypairFromPrivateKeyCompat(decryptedKeyBuffer) {
    try {
        if (!(decryptedKeyBuffer instanceof Buffer)) {
            // This case might occur if decryptWallet returned a plaintext string that wasn't JSON
            logApi.warn('[wallet-crypto] createKeypairFromPrivateKeyCompat received non-Buffer input. Assuming plaintext string for legacy processing.', { inputType: typeof decryptedKeyBuffer});
            // Attempt to process it via the legacy string decoder if it makes sense, or throw
            // For now, if it's not a buffer, it means an unencrypted key was passed directly. This should go to legacy.
            // The old createKeypairFromPrivateKeyLegacy was designed for strings.
            // To maintain this path, we'd re-introduce createKeypairFromPrivateKeyLegacy and call it here.
            // However, the goal is to simplify. If decryptWallet handles unencrypted strings by returning them as strings,
            // then this function should probably error if it doesn't get a Buffer from decryptWallet's JSON path.
            // Let's assume for now that if it's not a Buffer, it's an error from this point on, 
            // as `decryptWallet` for encrypted keys should always yield a Buffer now.
            // The only way it would be a string is if an *unencrypted* key was passed to `decryptWallet`.
            // If unencrypted keys are expected, then `createKeypairFromPrivateKeyLegacy` needs to be retained and called here.
            // Given the error logs, unencrypted keys were not the issue; it was the format of decrypted *encrypted* keys.
            throw new Error ('createKeypairFromPrivateKeyCompat expects a Buffer (decrypted key or seed).');
        }

        if (decryptedKeyBuffer.length === 32) {
            logApi.debug('[wallet-crypto] Creating v2 KeyPairSigner directly from 32-byte seed Buffer.');
            return await createKeyPairSignerFromBytes(decryptedKeyBuffer);
        } else if (decryptedKeyBuffer.length === 64) {
            logApi.debug('[wallet-crypto] Input is 64-byte Buffer (legacy v1 key), using compat layer.');
            return await createKeypairViaCompatLayer(decryptedKeyBuffer);
        } else {
            logApi.error('[wallet-crypto] Invalid Buffer length for createKeypairFromPrivateKeyCompat:', { length: decryptedKeyBuffer.length });
            throw new Error('Invalid Buffer length for keypair creation. Expected 32 or 64 bytes.');
        }
    } catch (error) {
        logApi.error('[wallet-crypto] Error in createKeypairFromPrivateKeyCompat:', error);
        throw ServiceError.operation('Failed to create keypair from private key input', {
            error: error.message,
            type: 'KEYPAIR_CREATION_ERROR'
        });
    }
}

/* Exports */

export default {
    encryptV2SeedBuffer,
    encryptLegacyPrivateKeyString,
    encryptWallet: encryptLegacyPrivateKeyString,
    decryptWallet,
    createKeypairFromPrivateKeyCompat,
}; 