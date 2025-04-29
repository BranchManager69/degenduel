// routes/blinks/index.js

import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import { config } from '../../config/config.js';
import { prisma } from '../../config/prisma.js';

// Import Solana packages
import { PublicKey, Connection } from '@solana/web3.js';
import { createTransferInstruction } from '@solana/spl-token';
import { getMemoInstruction } from '@solana/spl-memo';

// Import SolanaEngine for transaction building
import SolanaEngine from '../../services/solana-engine/solana-engine.js';
import { solanaEngine } from '../../services/solana-engine/index.js';

const router = express.Router();

// CORS configuration for Actions protocol
const setupActionsCors = (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
};

router.use(setupActionsCors);

/**
 * GET /api/blinks/join-contest
 * 
 * Returns metadata about the join contest action
 */
router.get('/join-contest', async (req, res) => {
  try {
    // Return metadata for the action
    res.json({
      name: "DegenDuel Contest Entry",
      description: "Join a contest on DegenDuel",
      icon: "https://degenduel.me/images/logo192.png",
      label: "Join Contest",
      parameters: {
        contest_id: {
          type: "string",
          description: "Contest ID to join",
          required: true
        }
      }
    });
  } catch (error) {
    logApi.error('Error fetching join contest action metadata', { error });
    res.status(500).json({ error: 'Failed to fetch action metadata' });
  }
});

/**
 * POST /api/blinks/join-contest
 * 
 * Returns a signable transaction for joining a contest
 * 
 * Required body parameters:
 * - account: User's public key
 * - contest_id: ID of the contest to join
 */
router.post('/join-contest', async (req, res) => {
  try {
    const { account, contest_id } = req.body;
    
    if (!account || !contest_id) {
      return res.status(400).json({ 
        error: 'Missing required parameters',
        required: ['account', 'contest_id']
      });
    }
    
    // 1. Validate the account is a valid Solana public key
    let userPubkey;
    try {
      userPubkey = new PublicKey(account);
    } catch (err) {
      return res.status(400).json({ error: 'Invalid Solana address format' });
    }
    
    // 2. Validate contest exists and is joinable
    const contest = await prisma.contest.findUnique({
      where: { id: contest_id },
      include: { status: true }
    });
    
    if (!contest) {
      return res.status(404).json({ error: 'Contest not found' });
    }
    
    if (contest.status !== 'OPEN_FOR_ENTRY') {
      return res.status(400).json({ error: 'Contest is not open for entry' });
    }
    
    // 3. Get contest wallet information
    const contestConfig = await prisma.serviceConfiguration.findFirst({
      where: { name: 'contest_wallet_config' }
    });
    
    if (!contestConfig || !contestConfig.settings || !contestConfig.settings.wallet_address) {
      return res.status(500).json({ error: 'Contest wallet configuration not found' });
    }
    
    const contestWalletAddress = contestConfig.settings.wallet_address;
    const entryFee = contest.entry_fee || 0.05; // Default to 0.05 SOL if not specified
    
    // 4. Build transaction instructions
    try {
      // Create a memo instruction with contest metadata
      const memoInstruction = getMemoInstruction(JSON.stringify({
        action: "contest_entry",
        contest_id,
        user: account,
        timestamp: Date.now()
      }));
      
      // Get a recent blockhash
      const { blockhash, lastValidBlockHeight } = await solanaEngine.executeConnectionMethod('getLatestBlockhash');
      
      // Build the transaction
      const transaction = await solanaEngine.buildTransaction({
        feePayer: userPubkey,
        instructions: [
          // SOL transfer instruction to contest wallet
          {
            programId: '11111111111111111111111111111111', // System program
            keys: [
              { pubkey: userPubkey, isSigner: true, isWritable: true },
              { pubkey: new PublicKey(contestWalletAddress), isSigner: false, isWritable: true }
            ],
            data: Buffer.from([
              2, // Transfer instruction index
              ...new Uint8Array(new BigUint64Array([BigInt(entryFee * 1_000_000_000)]).buffer) // amount in lamports
            ])
          },
          // Memo instruction with contest data
          memoInstruction
        ],
        blockhash,
        lastValidBlockHeight
      });
      
      // Serialize transaction to base64
      const serializedTransaction = transaction.serialize({ requireAllSignatures: false }).toString('base64');
      
      // Return the transaction for signing
      return res.json({
        transaction: serializedTransaction,
        message: `Join contest ${contest.name}`,
        blockhash
      });
      
    } catch (error) {
      logApi.error('Error generating contest entry transaction', { error, contest_id, account });
      return res.status(500).json({ error: 'Failed to generate transaction' });
    }
  } catch (error) {
    logApi.error('Error processing join contest request', { error });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;