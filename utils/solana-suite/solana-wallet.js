// /utils/solana-suite/solana-wallet.js

/*
 * This file is responsible for encrypting and decrypting the private keys of the contest wallets.
 * It also allows the admin to create a new contest wallet and get all contest wallets.
 * 
 */

// Services
import prisma from '../../config/prisma.js';
import { logApi } from '../logger-suite/logger.js';
// Solana
import crypto from 'crypto';
import { Keypair } from '@solana/web3.js';

// Master Wallet Encryption/Decryption Key
const ENCRYPTION_KEY = process.env.WALLET_ENCRYPTION_KEY;
if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 64) {
  throw new Error('Invalid or missing WALLET_ENCRYPTION_KEY. Must be a 64-character hex string.');
}

// ...

// Wallet Error
class WalletError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'WalletError';
    this.code = code;
    this.details = details;
  }
}
// (create more specific error types)

// Encrypt private key using AES-256-GCM with additional authenticated data (AAD)
export const encryptPrivateKey = (privateKey, additionalData = '') => {
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

// Decrypt private key using AES-256-GCM with additional authenticated data (AAD)
export const decryptPrivateKey = (encryptedData) => {
  try {
    const { encrypted, iv, tag, aad } = JSON.parse(encryptedData);
    
    const key = Buffer.from(ENCRYPTION_KEY, 'hex');
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(iv, 'hex')
    );
    
    // Set AAD and auth tag
    decipher.setAAD(Buffer.from(aad || ''));
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

// Create a new contest wallet (encrypted private key)
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

// Unencrypt a contest wallet
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

// Unencrypt all contest wallets
export const getAllContestWallets = async () => {
  try {
    // Get all contest wallets from the database
    const contestWallets = await prisma.contestWallet.findMany();
  } catch (error) {
    logApi.error('Failed to get contest wallets:', {
      error: error.message,
      stack: error.stack
    });
    throw new WalletError('Failed to get contest wallets', 'WALLET_RETRIEVAL_FAILED');
  }

  // Unencrypt all contest wallets
  try {
    const unencryptedWallets = [];
    for (const wallet of contestWallets) {
      const unencryptedWallet = await getContestWallet(wallet.encryptedPrivateKey, wallet.publicKey);
      unencryptedWallets.push(unencryptedWallet);
    }

    // Log unencrypted contest wallet count, public keys, and private keys
    logApi.info('UNENCRYPTED CONTEST WALLETS:', {
      count: unencryptedWallets.length,
      publicKeys: unencryptedWallets.map(wallet => wallet.publicKey.toString()),
      privateKeys: unencryptedWallets.map(wallet => wallet.secretKey.toString('hex'))
    });

    // Return all unencrypted contest wallets
    return unencryptedWallets;

  } catch (error) {
    // Failed to get unencrypted contest wallets
    logApi.error('Failed to get unencrypted contest wallets:', {
      error: error.message,
      stack: error.stack
    });
    throw new WalletError('Failed to get unencrypted contest wallets', 'WALLET_RETRIEVAL_FAILED');
  }
};

//// Export all functions
////export { encryptPrivateKey, decryptPrivateKey, createContestWallet, getContestWallet, getAllContestWallets };
