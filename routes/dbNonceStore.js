// src/routes/dbNonceStore.js
import crypto from 'crypto';
import prisma from '../config/prisma.js';

// We'll expire nonces after 5 minutes
const NONCE_EXPIRY_MS = 5 * 60 * 1000;

export async function generateNonce(walletAddress) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + NONCE_EXPIRY_MS);

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

  return nonce;
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
