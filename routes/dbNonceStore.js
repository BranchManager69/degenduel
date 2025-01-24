// src/routes/dbNonceStore.js
import crypto from 'crypto';
import { pool } from '../config/pg-database.js';

// We'll expire nonces after 5 minutes
const NONCE_EXPIRY_MS = 5 * 60 * 1000;

export async function generateNonce(walletAddress) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + NONCE_EXPIRY_MS).toISOString();

  await pool.query(`
    INSERT INTO auth_challenges (wallet_address, nonce, expires_at)
    VALUES ($1, $2, $3)
    ON CONFLICT (wallet_address)
    DO UPDATE SET nonce = EXCLUDED.nonce, expires_at = EXCLUDED.expires_at
  `, [walletAddress, nonce, expiresAt]);

  return nonce;
}

export async function getNonceRecord(walletAddress) {
  const result = await pool.query(`
    SELECT nonce, expires_at
    FROM auth_challenges
    WHERE wallet_address = $1
  `, [walletAddress]);
  if (result.rows.length === 0) return null;
  return result.rows[0]; // { nonce, expires_at }
}

export async function clearNonce(walletAddress) {
  await pool.query(`
    DELETE FROM auth_challenges
    WHERE wallet_address = $1
  `, [walletAddress]);
}
