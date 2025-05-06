#!/usr/bin/env node
import crypto from 'node:crypto';
import { Keypair } from '@solana/web3.js'; // Use v1 for simple keypair generation

// --- Configuration (Mimics ADMIN_WALLET_CONFIG) ---
const ENCRYPTION_CONFIG = {
    algorithm: 'aes-256-gcm',
    keyLength: 32, // bytes
    ivLength: 16, // bytes
    tagLength: 16 // bytes
};

// --- Simplified Encryption Function (from wallet-crypto.js logic) ---
function encryptPrivateKeyBytes(privateKeyBuffer, encryptionKeyHex) {
    if (!encryptionKeyHex || encryptionKeyHex.length !== 64) {
        throw new Error('Invalid or missing encryption key hex (must be 64 hex chars).');
    }
    try {
        const encryptionKeyBuffer = Buffer.from(encryptionKeyHex, 'hex');
        const iv = crypto.randomBytes(ENCRYPTION_CONFIG.ivLength);
        const cipher = crypto.createCipheriv(
            ENCRYPTION_CONFIG.algorithm,
            encryptionKeyBuffer,
            iv
        );

        // Encrypt the private key buffer directly
        const encrypted = Buffer.concat([
            cipher.update(privateKeyBuffer),
            cipher.final()
        ]);

        const tag = cipher.getAuthTag();

        return JSON.stringify({
            encrypted: encrypted.toString('hex'),
            iv: iv.toString('hex'),
            tag: tag.toString('hex')
        });
    } catch (error) {
        console.error("Encryption failed:", error);
        throw new Error(`Failed to encrypt wallet: ${error.message}`);
    }
}

// --- Main Script Logic ---
async function createAndEncryptWallet() {
    const encryptionKeyHex = process.env.TEMP_WALLET_ENCRYPTION_KEY;

    if (!encryptionKeyHex) {
        console.error('\nError: TEMP_WALLET_ENCRYPTION_KEY environment variable is not set.');
        console.error('Please set it before running the script:');
        console.error("  export TEMP_WALLET_ENCRYPTION_KEY='YOUR_64_CHAR_HEX_KEY'");
        process.exit(1);
    }
     if (encryptionKeyHex.length !== 64) {
         console.error('\nError: TEMP_WALLET_ENCRYPTION_KEY must be 64 hexadecimal characters long.');
         process.exit(1);
     }


    try {
        // 1. Generate Keypair
        const keypair = Keypair.generate();
        const publicKey = keypair.publicKey.toBase58();
        const privateKeyBytes = Buffer.from(keypair.secretKey); // Use the raw bytes

        console.log(`\n--- Generated Keypair ---`);
        console.log(`Public Key (Base58):   ${publicKey}`);
        // console.log(`Private Key Bytes (Hex): ${privateKeyBytes.toString('hex')}`); // Optional: For debugging

        // 2. Encrypt Private Key
        console.log(`\nEncrypting using key ending in: ...${encryptionKeyHex.slice(-6)}`);
        const encryptedPrivateKeyJson = encryptPrivateKeyBytes(privateKeyBytes, encryptionKeyHex);

        console.log(`\n--- Encrypted Private Key (JSON String) ---`);
        console.log(encryptedPrivateKeyJson);

        console.log('\n--- Ready for Database ---');
        console.log('Use the Public Key and the Encrypted Private Key JSON String above for the INSERT command.');

    } catch (error) {
        console.error('\n--- An Error Occurred ---');
        console.error(error.message);
        process.exit(1);
    }
}

createAndEncryptWallet(); 