#!/usr/bin/env node
import crypto from 'node:crypto';
import { Keypair, PublicKey } from '@solana/web3.js'; // Use v1 for verification simplicity
import bs58 from 'bs58'; // Import bs58 for encoding

// --- Configuration (Mimics ADMIN_WALLET_CONFIG) ---
const ENCRYPTION_CONFIG = {
    algorithm: 'aes-256-gcm',
    // keyLength: 32, // Not needed for decrypt
    ivLength: 16, // bytes
    tagLength: 16 // bytes
};

// --- Known Values for Verification ---
const ORIGINAL_PUBLIC_KEY_B58 = '5CboiZDNfmTFuhRpJEUncFV6Rv5XhWLpaUmEKwrBURiu';
const ENCRYPTED_PRIVATE_KEY_JSON = '{"encrypted":"90dbabee93b6f172b4f366d6529565a16e56917c6440d201af9123390e5c4167ed6b4b46a9c03325f7692db1e6eaa667275c04daf325a1a5df334b10db4ecf1f","iv":"9507a0c44b0d3ec9276f5515e730539f","tag":"eb30efdadf56e0d2aeed4183809d0cd1"}';

// --- Simplified Decryption Function (from wallet-crypto.js logic) ---
function decryptPrivateKeyBytes(encryptedJsonString, encryptionKeyHex) {
    if (!encryptionKeyHex || encryptionKeyHex.length !== 64) {
        throw new Error('Invalid or missing encryption key hex (must be 64 hex chars).');
    }
    try {
        const encryptionKeyBuffer = Buffer.from(encryptionKeyHex, 'hex');
        const { encrypted, iv, tag } = JSON.parse(encryptedJsonString);

        const decipher = crypto.createDecipheriv(
            ENCRYPTION_CONFIG.algorithm,
            encryptionKeyBuffer,
            Buffer.from(iv, 'hex')
        );

        decipher.setAuthTag(Buffer.from(tag, 'hex'));

        const decrypted = Buffer.concat([
            decipher.update(Buffer.from(encrypted, 'hex')),
            decipher.final()
        ]);

        // Return the raw bytes
        return Buffer.from(decrypted);
    } catch (error) {
        console.error("Decryption failed:", error);
        throw new Error(`Failed to decrypt wallet: ${error.message}`);
    }
}

// --- Main Verification Logic ---
async function verifyDecryption() {
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

    console.log(`\n--- Verifying Decryption ---`);
    console.log(`Target Public Key: ${ORIGINAL_PUBLIC_KEY_B58}`);
    console.log(`Encrypted Input (showing start): ${ENCRYPTED_PRIVATE_KEY_JSON.substring(0, 50)}...`);
    console.log(`Using Key ending in: ...${encryptionKeyHex.slice(-6)}`);

    try {
        // 1. Decrypt
        const decryptedBytes = decryptPrivateKeyBytes(ENCRYPTED_PRIVATE_KEY_JSON, encryptionKeyHex);
        if (decryptedBytes.length !== 64) {
             throw new Error(`Decryption resulted in unexpected key length: ${decryptedBytes.length}`);
        }
        console.log(`\nDecryption successful. Reconstructing keypair...`);

        // 2. Reconstruct Keypair (using v1 for simplicity, only pubkey matters here)
        const reconstructedKeypair = Keypair.fromSecretKey(decryptedBytes);
        const reconstructedPublicKeyB58 = reconstructedKeypair.publicKey.toBase58();
        console.log(`Reconstructed Public Key: ${reconstructedPublicKeyB58}`);

        // 3. Compare Public Keys
        if (reconstructedPublicKeyB58 === ORIGINAL_PUBLIC_KEY_B58) {
            console.log('\n✅ SUCCESS: Reconstructed public key matches the original.');
            console.log('Encryption/Decryption appears to be working correctly with this key.');
            
            // --- ADDED: Output Private Key Formats ---
            console.log('\n--- Decrypted Private Key --- \n');
            
            // Format 1: Base58 String (Most common for import)
            const privateKeyBase58 = bs58.encode(decryptedBytes);
            console.log('BASE58 ENCODED STRING (Copy this for most wallets):');
            console.log(privateKeyBase58);
            console.log('\n');
            
            // Format 2: Byte Array (Numbers in brackets)
            const privateKeyArray = Array.from(decryptedBytes);
            console.log('BYTE ARRAY (Less common for import):');
            console.log(`[${privateKeyArray.join(', ')}]`);
            // --- END ADDED ---
            
        } else {
            console.error('\n❌ FAILURE: Reconstructed public key DOES NOT MATCH the original!');
            console.error('Check your encryption key or the encrypted string.');
            process.exit(1);
        }

    } catch (error) {
        console.error('\n--- Verification Error Occurred ---');
        console.error(error.message);
        process.exit(1);
    }
}

verifyDecryption(); 