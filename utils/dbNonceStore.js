import crypto from 'crypto';
import prisma from '../config/prisma.js';
import { logApi } from './logger-suite/logger.js';

// We'll expire nonces after 5 minutes
const NONCE_EXPIRY_MS = 5 * 60 * 1000;

export async function generateNonce(walletAddress) {
  try {
    logApi.info('Starting nonce generation', { walletAddress });
    
    const nonce = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + NONCE_EXPIRY_MS);

    logApi.info('Attempting database upsert', { 
      walletAddress, 
      expiresAt: expiresAt.toISOString() 
    });

    await prisma.auth_challenges.upsert({
      where: {
        wallet_address: walletAddress
      },
      create: {
        wallet_address: walletAddress,
        nonce,
        expires_at: expiresAt
      },
      update: {
        nonce,
        expires_at: expiresAt
      }
    });

    logApi.info('Nonce stored successfully', { walletAddress });
    return nonce;
  } catch (error) {
    logApi.error('Database error in generateNonce', {
      error: error.message,
      stack: error.stack,
      walletAddress,
      details: error
    });
    throw error; // Re-throw to be caught by the route handler
  }
}

export async function getNonceRecord(walletAddress) {
  const record = await prisma.auth_challenges.findUnique({
    where: {
      wallet_address: walletAddress
    },
    select: {
      nonce: true,
      expires_at: true
    }
  });
  return record;
}

export async function clearNonce(walletAddress) {
  await prisma.auth_challenges.delete({
    where: {
      wallet_address: walletAddress
    }
  });
}

export default {
  generateNonce,
  getNonceRecord,
  clearNonce
}; 