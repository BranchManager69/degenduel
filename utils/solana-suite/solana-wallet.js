// /utils/solana-suite/solana-wallet.js

import { Keypair } from '@solana/web3.js';
import crypto from 'crypto';
import { logApi } from '../logger-suite/logger.js';

const ENCRYPTION_KEY = process.env.WALLET_ENCRYPTION_KEY;
if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 64) {
  throw new Error('Invalid or missing WALLET_ENCRYPTION_KEY. Must be a 64-character hex string.');
}

class WalletError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'WalletError';
    this.code = code;
    this.details = details;
  }
}

// Encrypt private key using AES-256-GCM with additional authenticated data (AAD)
const encryptPrivateKey = (privateKey, additionalData = '') => {
  try {
    // Generate a random IV for each encryption
    const iv = crypto.randomBytes(12);
    const key = Buffer.from(ENCRYPTION_KEY, 'hex');
    
    // Create cipher with IV
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    
    // Add additional authenticated data (e.g., wallet address)
    cipher.setAAD(Buffer.from(additionalData));
    
    // Encrypt the private key
    let encrypted = cipher.update(privateKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    // Get the auth tag
    const authTag = cipher.getAuthTag();
    
    // Return IV + Auth Tag + Encrypted Data
    return {
      encrypted: encrypted,
      iv: iv.toString('hex'),
      tag: authTag.toString('hex'),
      aad: additionalData
    };
  } catch (error) {
    logApi.error('Encryption failed:', {
      error: error.message,
      stack: error.stack
    });
    throw new WalletError('Failed to encrypt wallet', 'ENCRYPTION_FAILED');
  }
};

// Decrypt private key
const decryptPrivateKey = (encryptedData) => {
  try {
    const { encrypted, iv, tag, aad } = JSON.parse(encryptedData);
    
    const key = Buffer.from(ENCRYPTION_KEY, 'hex');
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(iv, 'hex')
    );
    
    // Set AAD and auth tag
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(Buffer.from(tag, 'hex'));
    
    // Decrypt
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    logApi.error('Decryption failed:', {
      error: error.message,
      stack: error.stack
    });
    throw new WalletError('Failed to decrypt wallet', 'DECRYPTION_FAILED');
  }
};

// Create a new Solana wallet with encryption
export const createContestWallet = async () => {
  try {
    // Generate new keypair
    const wallet = Keypair.generate();
    const publicKey = wallet.publicKey.toString();
    
    // Convert private key to string format
    const privateKeyString = Buffer.from(wallet.secretKey).toString('hex');
    
    // Encrypt private key with public key as AAD
    const encryptedData = encryptPrivateKey(privateKeyString, publicKey);
    
    // Return wallet info
    return {
      publicKey,
      encryptedPrivateKey: JSON.stringify(encryptedData)
    };
  } catch (error) {
    logApi.error('Failed to create contest wallet:', {
      error: error.message,
      stack: error.stack
    });
    throw new WalletError(
      'Failed to create contest wallet',
      'WALLET_CREATION_FAILED',
      { originalError: error.message }
    );
  }
};

// Get a contest wallet from encrypted private key and public key
export const getContestWallet = async (encryptedPrivateKey, publicKey) => {
  try {
      // Decrypt private key
      const privateKeyHex = decryptPrivateKey(encryptedPrivateKey);
      const privateKeyBytes = Buffer.from(privateKeyHex, 'hex');
      
      // Create keypair from private key
      const wallet = Keypair.fromSecretKey(privateKeyBytes);
      
      // Verify public key matches
      if (wallet.publicKey.toString() !== publicKey) {
          throw new WalletError('Public key mismatch', 'KEY_MISMATCH');
      }
      
      // Return unencrypted wallet
      return wallet;

  } catch (error) {
      // Wallet retrieval failed
      logApi.error('Failed to get contest wallet:', {
          error: error.message,
          publicKey,
          stack: error.stack
  });
  throw new WalletError(
      'Failed to get contest wallet',
      'WALLET_RETRIEVAL_FAILED',
      { originalError: error.message }
    );
  }

}; 
