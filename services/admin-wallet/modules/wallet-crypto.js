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
 * @version 2.0.0
 * @created 2025-05-05
 * @updated 2025-05-05
 */

import { logApi } from '../../../utils/logger-suite/logger.js';
import { fancyColors } from '../../../utils/colors.js';
import crypto from 'crypto';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';
import { ServiceError } from '../../../utils/service-suite/service-error.js';
import { createKeypairFromPrivateKey as createKeypairV2Compat } from '../utils/solana-compat.js';

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
 * Decrypts a wallet private key
 * 
 * @param {string} encryptedData - The encrypted private key data
 * @param {string} encryptionKey - The encryption key (from environment variables)
 * @returns {string} - Decrypted private key
 */
export function decryptWallet(encryptedData, encryptionKey) {
    try {
        // Check if the data might already be in plaintext format (not JSON)
        if (typeof encryptedData === 'string' && !encryptedData.startsWith('{')) {
            logApi.info(`${fancyColors.CYAN}[adminWalletService]${fancyColors.RESET} ${fancyColors.GREEN}Key appears to be in plaintext format already${fancyColors.RESET}`);
            return encryptedData; // Return as-is if not in JSON format
        }
        
        // Parse the encrypted data
        const { encrypted, iv, tag } = JSON.parse(encryptedData);
        
        // Create decipher with AES-256-GCM algorithm and our secret key
        const decipher = crypto.createDecipheriv(
            'aes-256-gcm', // Explicitly use AES-256-GCM for clarity
            Buffer.from(encryptionKey, 'hex'),
            Buffer.from(iv, 'hex')
        );
        
        // Set authentication tag for GCM mode
        decipher.setAuthTag(Buffer.from(tag, 'hex'));
        
        // Decrypt the data
        const decrypted = Buffer.concat([
            decipher.update(Buffer.from(encrypted, 'hex')),
            decipher.final()
        ]);
        
        return decrypted.toString();
    } catch (error) {
        logApi.error(`${fancyColors.CYAN}[adminWalletService]${fancyColors.RESET} ${fancyColors.RED}Decryption error: ${error.message}, length: ${encryptedData?.length}, preview: ${typeof encryptedData === 'string' ? encryptedData.substring(0, 20) + '...' : 'not a string'}${fancyColors.RESET}`);
        throw ServiceError.operation('Failed to decrypt wallet', {
            error: error.message,
            type: 'DECRYPTION_ERROR'
        });
    }
}

/**
 * Creates a Solana keypair using the v2 compatibility layer.
 * Assumes the input is the raw private key bytes or a format 
 * the compatibility layer can handle.
 * 
 * @param {Uint8Array | Buffer | number[] | string} privateKeyInput - The private key bytes or a string format.
 * @returns {object} - The Solana keypair (v1 or v2 compatible).
 */
export function createKeypairFromPrivateKeyCompat(privateKeyInput) {
    // This function is now async because the compat function it calls is async
    return (async () => { 
        try {
            let privateKeyBytes;

            // If input is a string, try decoding using the legacy method first
            if (typeof privateKeyInput === 'string') {
                logApi.debug('Input to createKeypairCompat is string, attempting legacy decode...');
                try {
                    // Use legacy function to get v1 keypair, then extract bytes
                    const legacyKeypair = createKeypairFromPrivateKeyLegacy(privateKeyInput);
                    // secretKey is the 64-byte Uint8Array in v1 Keypair
                    privateKeyBytes = legacyKeypair.secretKey; 
                     if (!privateKeyBytes || privateKeyBytes.length !== 64) {
                        throw new Error('Legacy decoder did not return valid 64-byte secret key.');
                    }
                    logApi.debug('Successfully decoded string input using legacy method.');
                } catch (legacyError) {
                    logApi.error('Failed to decode string input using legacy method:', legacyError);
                    // If legacy decoding fails, we might still try the compat layer directly
                    // if the string happens to be a format it supports (e.g., bs58 handled by v2)
                    // For now, re-throw as it indicates an unexpected string format
                    throw new Error(`Could not decode private key string format via legacy method: ${legacyError.message}`);
                }
            } else if (privateKeyInput instanceof Uint8Array || Buffer.isBuffer(privateKeyInput)) {
                 // Input is already bytes
                privateKeyBytes = privateKeyInput;
            } else {
                throw new Error('Invalid input type for createKeypairFromPrivateKeyCompat. Expected Uint8Array, Buffer, or string.');
            }

            // Now use the compatibility layer function with the definite bytes
            // Await the result as the underlying function is now async
            const keypair = await createKeypairV2Compat(privateKeyBytes);
            if (!keypair || !keypair.publicKey) {
                throw new Error('Compatibility layer failed to create valid keypair from derived bytes');
            }
            logApi.debug('Created keypair using v2 compatibility layer from processed input.');
            return keypair;
        } catch (error) {
            logApi.error('Error creating keypair via compatibility layer:', error);
            throw ServiceError.operation('Failed to create keypair using compatibility layer', {
                error: error.message,
                type: 'KEYPAIR_CREATION_ERROR'
            });
        }
    })(); // Immediately invoke the async IIFE
}

/**
 * [LEGACY] Creates a Solana keypair from various possible private key formats.
 * Attempts to decode hex, base58, base64, and JSON formats.
 * Uses v1 Keypair.fromSecretKey.
 * 
 * @param {string} decryptedPrivateKey - The decrypted private key string in various formats.
 * @returns {Keypair} - The v1 Solana keypair.
 */
export function createKeypairFromPrivateKeyLegacy(decryptedPrivateKey) {
    // Debug info for key troubleshooting
    logApi.info(`${fancyColors.CYAN}[adminWalletService]${fancyColors.RESET} [Legacy] Working with decrypted key length: ${decryptedPrivateKey.length}, format: ${typeof decryptedPrivateKey}`);
    
    let privateKeyBytes;
    let fromKeypair;
    
    // Try different formats in order of likelihood
    try {
        // Method 1: First check if it might be a hex string
        if (/^[0-9a-fA-F]+$/.test(decryptedPrivateKey)) {
            try {
                // For hex format, make sure we have the correct length (64 bytes = 128 hex chars)
                if (decryptedPrivateKey.length === 128) {
                    privateKeyBytes = Buffer.from(decryptedPrivateKey, 'hex');
                    fromKeypair = Keypair.fromSecretKey(privateKeyBytes);
                    logApi.info(`${fancyColors.CYAN}[adminWalletService]${fancyColors.RESET} ${fancyColors.GREEN}Key decoded as standard hex (128 chars)${fancyColors.RESET}`);
                } else {
                    // Try creating a Uint8Array of the correct size
                    const secretKey = new Uint8Array(64); // 64 bytes for ed25519 keys
                    const hexData = Buffer.from(decryptedPrivateKey, 'hex');
                    
                    // Copy available bytes (may be smaller than 64)
                    for (let i = 0; i < Math.min(hexData.length, 64); i++) {
                        secretKey[i] = hexData[i];
                    }
                    
                    fromKeypair = Keypair.fromSecretKey(secretKey);
                    logApi.info(`${fancyColors.CYAN}[adminWalletService]${fancyColors.RESET} ${fancyColors.GREEN}Key decoded as padded hex (${decryptedPrivateKey.length} chars)${fancyColors.RESET}`);
                }
            } catch (hexError) {
                // Continue to next format
                logApi.warn(`${fancyColors.CYAN}[adminWalletService]${fancyColors.RESET} ${fancyColors.YELLOW}Hex key decoding failed: ${hexError.message}${fancyColors.RESET}`);
                // Don't throw, try next format
            }
        }
        
        // Method 2: Try as base58 (common format for Solana)
        if (!fromKeypair) {
            try {
                privateKeyBytes = bs58.decode(decryptedPrivateKey);
                
                // Validate length for BS58 too - Solana keypair needs 64 bytes
                if (privateKeyBytes.length !== 64) {
                    const paddedKey = new Uint8Array(64);
                    for (let i = 0; i < Math.min(privateKeyBytes.length, 64); i++) {
                        paddedKey[i] = privateKeyBytes[i];
                    }
                    privateKeyBytes = paddedKey;
                    logApi.info(`${fancyColors.CYAN}[adminWalletService]${fancyColors.RESET} ${fancyColors.GREEN}Key decoded as base58 (padded to 64 bytes)${fancyColors.RESET}`);
                } else {
                    logApi.info(`${fancyColors.CYAN}[adminWalletService]${fancyColors.RESET} ${fancyColors.GREEN}Key decoded as base58 (correct 64 byte length)${fancyColors.RESET}`);
                }
                
                fromKeypair = Keypair.fromSecretKey(privateKeyBytes);
            } catch (bs58Error) {
                logApi.warn(`${fancyColors.CYAN}[adminWalletService]${fancyColors.RESET} ${fancyColors.YELLOW}Base58 key decoding failed: ${bs58Error.message}${fancyColors.RESET}`);
                // Continue to next format
            }
        }
        
        // Method 3: Try as base64
        if (!fromKeypair) {
            try {
                privateKeyBytes = Buffer.from(decryptedPrivateKey, 'base64');
                
                // Validate length
                if (privateKeyBytes.length !== 64) {
                    const paddedKey = new Uint8Array(64);
                    for (let i = 0; i < Math.min(privateKeyBytes.length, 64); i++) {
                        paddedKey[i] = privateKeyBytes[i];
                    }
                    privateKeyBytes = paddedKey;
                    logApi.info(`${fancyColors.CYAN}[adminWalletService]${fancyColors.RESET} ${fancyColors.GREEN}Key decoded as base64 (padded to 64 bytes)${fancyColors.RESET}`);
                } else {
                    logApi.info(`${fancyColors.CYAN}[adminWalletService]${fancyColors.RESET} ${fancyColors.GREEN}Key decoded as base64 (correct 64 byte length)${fancyColors.RESET}`);
                }
                
                fromKeypair = Keypair.fromSecretKey(privateKeyBytes);
            } catch (base64Error) {
                logApi.warn(`${fancyColors.CYAN}[adminWalletService]${fancyColors.RESET} ${fancyColors.YELLOW}Base64 key decoding failed: ${base64Error.message}${fancyColors.RESET}`);
                // Continue to next format
            }
        }
        
        // Method 4: Check if it's a JSON string with secretKey
        if (!fromKeypair && decryptedPrivateKey.startsWith('{') && decryptedPrivateKey.includes('secretKey')) {
            try {
                const keyObject = JSON.parse(decryptedPrivateKey);
                if (keyObject.secretKey) {
                    // Handle array format
                    if (Array.isArray(keyObject.secretKey)) {
                        // Check if we need to pad to 64 bytes
                        if (keyObject.secretKey.length !== 64) {
                            const paddedKey = new Uint8Array(64);
                            for (let i = 0; i < Math.min(keyObject.secretKey.length, 64); i++) {
                                paddedKey[i] = keyObject.secretKey[i];
                            }
                            privateKeyBytes = paddedKey;
                            logApi.info(`${fancyColors.CYAN}[adminWalletService]${fancyColors.RESET} ${fancyColors.GREEN}Key decoded from JSON array (padded to 64 bytes)${fancyColors.RESET}`);
                        } else {
                            privateKeyBytes = Uint8Array.from(keyObject.secretKey);
                            logApi.info(`${fancyColors.CYAN}[adminWalletService]${fancyColors.RESET} ${fancyColors.GREEN}Key decoded from JSON array (correct 64 byte length)${fancyColors.RESET}`);
                        }
                        
                        fromKeypair = Keypair.fromSecretKey(privateKeyBytes);
                    } 
                    // Handle string format
                    else if (typeof keyObject.secretKey === 'string') {
                        // Try decoding as base58 or base64
                        try {
                            privateKeyBytes = bs58.decode(keyObject.secretKey);
                            logApi.info(`${fancyColors.CYAN}[adminWalletService]${fancyColors.RESET} ${fancyColors.GREEN}Key decoded from JSON.secretKey as base58 string${fancyColors.RESET}`);
                        } catch (err) {
                            // Try base64
                            privateKeyBytes = Buffer.from(keyObject.secretKey, 'base64');
                            logApi.info(`${fancyColors.CYAN}[adminWalletService]${fancyColors.RESET} ${fancyColors.GREEN}Key decoded from JSON.secretKey as base64 string${fancyColors.RESET}`);
                        }
                        
                        // Ensure correct length
                        if (privateKeyBytes.length !== 64) {
                            const paddedKey = new Uint8Array(64);
                            for (let i = 0; i < Math.min(privateKeyBytes.length, 64); i++) {
                                paddedKey[i] = privateKeyBytes[i];
                            }
                            privateKeyBytes = paddedKey;
                            logApi.info(`${fancyColors.CYAN}[adminWalletService]${fancyColors.RESET} ${fancyColors.GREEN}JSON string key padded to 64 bytes${fancyColors.RESET}`);
                        }
                        
                        fromKeypair = Keypair.fromSecretKey(privateKeyBytes);
                    }
                }
            } catch (jsonError) {
                logApi.warn(`${fancyColors.CYAN}[adminWalletService]${fancyColors.RESET} ${fancyColors.YELLOW}JSON key decoding failed: ${jsonError.message}${fancyColors.RESET}`);
            }
        }
        
        // If we still don't have a keypair, try legacy method as last resort
        if (!fromKeypair) {
            logApi.warn(`${fancyColors.CYAN}[adminWalletService]${fancyColors.RESET} ${fancyColors.YELLOW}Falling back to legacy bs58 method${fancyColors.RESET}`);
            privateKeyBytes = bs58.decode(decryptedPrivateKey);
            fromKeypair = Keypair.fromSecretKey(privateKeyBytes);
        }
    } catch (allFormatError) {
        // If all attempts failed, throw a detailed error
        throw new Error(`Failed to decode private key in any supported format: ${allFormatError.message}`);
    }
    
    // Verify we got a valid keypair
    if (!fromKeypair || !fromKeypair.publicKey) {
        throw new Error('[Legacy] Failed to generate valid keypair from private key');
    }
    
    logApi.info(`${fancyColors.CYAN}[adminWalletService]${fancyColors.RESET} [Legacy] Successfully created keypair: ${fromKeypair.publicKey.toBase58()}`);
    return fromKeypair;
}

/* Exports */

export default {
    encryptWallet,
    decryptWallet,
    createKeypairFromPrivateKeyCompat,
    createKeypairFromPrivateKeyLegacy
}; 