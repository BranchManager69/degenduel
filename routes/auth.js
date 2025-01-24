// src/routes/auth.js
import { PublicKey } from '@solana/web3.js';
import express from 'express';
import jwt from 'jsonwebtoken';
import nacl from 'tweetnacl';
import { config } from '../config/config.js';
import { pool } from '../config/pg-database.js';
import { logApi } from '../utils/logger-suite/logger.js';
import { clearNonce, generateNonce, getNonceRecord } from './dbNonceStore.js';

const router = express.Router();
const { sign } = jwt;

// ------------------ GET /challenge ------------------
// Example: GET /api/auth/challenge?wallet=<WALLET_ADDR>
router.get('/challenge', async (req, res) => {
  try {
    const { wallet } = req.query;
    if (!wallet) {
      return res.status(400).json({ error: 'Missing wallet address' });
    }

    // Generate nonce & store in DB
    const nonce = await generateNonce(wallet);
    return res.json({ nonce });
  } catch (error) {
    logApi.error('Failed to generate nonce', { error });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ------------------ POST /verify-wallet ------------------
// The front-end will send: { wallet, signature: Array(64), message: "...theNonceHere..." }
router.post('/verify-wallet', async (req, res) => {
  try {
    const { wallet, signature, message } = req.body;
    if (!wallet || !signature || !message) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!Array.isArray(signature) || signature.length !== 64) {
      return res.status(400).json({ error: 'Signature must be a 64-byte array' });
    }

    // 1) Get the nonce from DB
    const record = await getNonceRecord(wallet);
    if (!record) {
      return res.status(401).json({ error: 'Nonce not found or expired' });
    }

    // Check if it's expired
    const now = Date.now();
    const expiresAtMs = new Date(record.expires_at).getTime();
    if (expiresAtMs < now) {
      // It's expired, remove it
      await clearNonce(wallet);
      return res.status(401).json({ error: 'Nonce expired' });
    }

    // 2) Check that the message from the front end actually includes the nonce
    // For instance, the message might be:
    // "DegenDuel Authentication\nWallet: <wallet>\nNonce: <theNonce>\nTimestamp: <someTimestamp>"
    const lines = message.split('\n').map((l) => l.trim());
    // lines[2] might be "Nonce: abc123..."
    // We'll parse out the line that starts with "Nonce:"
    const nonceLine = lines.find((l) => l.startsWith('Nonce:'));
    if (!nonceLine) {
      return res.status(400).json({ error: 'Message missing nonce line' });
    }
    const messageNonce = nonceLine.split('Nonce:')[1].trim();

    if (messageNonce !== record.nonce) {
      return res.status(401).json({ error: 'Nonce mismatch in message' });
    }

    // 3) Real signature check
    const signatureUint8 = new Uint8Array(signature);
    const messageBytes = new TextEncoder().encode(message);

    let pubKey;
    try {
      pubKey = new PublicKey(wallet);
    } catch (err) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    const isVerified = nacl.sign.detached.verify(messageBytes, signatureUint8, pubKey.toBytes());
    if (!isVerified) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // 4) Clear the nonce from DB so it can't be reused
    await clearNonce(wallet);

    // 5) Upsert user in DB
    const nowIso = new Date().toISOString();
    const upsertQuery = `
      INSERT INTO users (wallet_address, created_at, last_login, role)
      VALUES ($1, $2, $2, 'user')
      ON CONFLICT (wallet_address)
      DO UPDATE SET last_login = EXCLUDED.last_login
      RETURNING wallet_address, nickname, role
    `;
    const result = await pool.query(upsertQuery, [wallet, nowIso]);
    const row = result.rows[0];

    // 6) Create JWT
    const token = sign(
      {
        wallet: row.wallet_address,
        role: row.role
      },
      config.jwt.secret,
      { expiresIn: '24h' }
    );

    // 7) Set cookie
    res.cookie('session', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000,
      domain: '.degenduel.me'
    });

    logApi.info(`Wallet verified successfully: ${wallet}`, { wallet, role: row.role });
    return res.json({
      verified: true,
      token,
      user: {
        wallet_address: row.wallet_address,
        role: row.role,
        nickname: row.nickname
      }
    });
  } catch (error) {
    logApi.error('Wallet verification failed', { error });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ------------------ POST /disconnect ------------------
router.post('/disconnect', async (req, res) => {
  try {
    const { wallet } = req.body;
    if (!wallet) {
      return res.status(400).json({ error: 'Missing wallet' });
    }

    await pool.query(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE wallet_address = $1',
      [wallet]
    );

    // Clear the cookie
    res.clearCookie('session', { domain: '.degenduel.me' });

    logApi.info(`Wallet ${wallet} disconnected`);
    res.json({ success: true });
  } catch (error) {
    logApi.error('Wallet disconnect failed', { error });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
