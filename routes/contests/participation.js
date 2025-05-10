/**
 * Contest Participation Routes
 * 
 * @description Routes for contest participation (enter, join, check participation)
 * 
 * @author BranchManager69
 * @version 1.0.0
 * @created 2025-05-08
 */

import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import prisma from '../../config/prisma.js';
import { Prisma } from '@prisma/client';
import ReferralService from '../../services/referralService.js';
import { 
  getAndValidateContest,
  canUserParticipate,
  getUserContestParticipations
} from '../../utils/contest-helpers.js';
import { solanaEngine } from '../../services/solana-engine/index.js';
import { ServiceError } from '../../utils/service-suite/service-error.js';
import { LAMPORTS_PER_SOL as LAMPORTS_PER_SOL_V1, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { Buffer } from 'node:buffer';

// Router
const router = express.Router();

// For Decimal type and error handling
const { Decimal } = Prisma;

// Create a dedicated logger for contest participation
const participationLogger = {
  ...logApi.forService('CONTESTS_PARTICIPATION'),
  analytics: logApi.analytics
};

const LAMPORTS_PER_SOL_V2 = 1_000_000_000;

/**
 * @route POST /api/contests/:id/enter
 * @description Enter a contest by paying the entry fee
 * @access Private (requires auth)
 */
router.post('/:id/enter', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { transaction_signature, referral_code } = req.body;
    const user = req.user;
    const userWallet = user.wallet_address;
    
    const parsedId = parseInt(id, 10);
    if (isNaN(parsedId)) {
      return res.status(400).json({ error: 'Invalid contest ID' });
    }
    
    // Get contest details
    const contest = await getAndValidateContest(parsedId);
    if (!contest) {
      return res.status(404).json({ error: 'Contest not found' });
    }
    
    // Check if contest can accept participants
    if (contest.status !== 'pending' && contest.status !== 'active') {
      return res.status(400).json({
        error: 'invalid_contest_status',
        message: `Cannot enter contest with status "${contest.status}"`,
        status: contest.status
      });
    }
    
    // Check if contest is full
    if (contest.max_participants && 
        contest._count.contest_participants >= contest.max_participants) {
      return res.status(400).json({
        error: 'contest_full',
        message: 'Contest has reached maximum participants',
        current: contest._count.contest_participants,
        max: contest.max_participants
      });
    }
    
    // Check if user is already participating
    const existingParticipation = await prisma.contest_participants.findFirst({
      where: {
        contest_id: parsedId,
        wallet_address: userWallet
      }
    });
    
    if (existingParticipation) {
      return res.status(400).json({
        error: 'already_participating',
        message: 'You are already participating in this contest',
        participation: existingParticipation
      });
    }
    
    // Validate transaction signature if provided
    if (transaction_signature) {
      const contestWalletAddress = contest.contest_wallets?.wallet_address;
      if (!contestWalletAddress) {
        return res.status(500).json({
          error: 'no_contest_wallet',
          message: 'Contest wallet not found'
        });
      }
      
      try {
        // --- NEW V2 Transaction Verification using solanaEngine ---
        const entryFeeDecimal = new Decimal(contest.entry_fee);
        const requiredAmountLamports = BigInt(Math.round(entryFeeDecimal.toNumber() * LAMPORTS_PER_SOL_V2));

        participationLogger.info('Verifying contest entry payment...', { 
            signature: transaction_signature, userWallet, contestWalletAddress, requiredAmountLamports: requiredAmountLamports.toString() 
        });

        if (requiredAmountLamports <= 0) {
            participationLogger.info('Contest entry fee is zero, skipping payment verification.', { contestId: parsedId });
        } else {
            const txDetails = await solanaEngine.executeConnectionMethod(
                'getTransaction',
                transaction_signature,
                { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }
            );

            if (!txDetails || !txDetails.transaction) {
                throw new ServiceError(400, `Entry payment transaction ${transaction_signature} not found or failed.`);
            }
            if (txDetails.meta?.err) {
                throw new ServiceError(400, `Entry payment transaction ${transaction_signature} failed on-chain: ${JSON.stringify(txDetails.meta.err)}`);
            }

            let paymentVerified = false;
            const systemProgramIdString = '11111111111111111111111111111111';
            // accountKeys from getTransaction are v1 PublicKey objects, so convert to string for comparison
            const accountKeyStrings = txDetails.transaction.message.accountKeys.map(pk => pk.toString());

            for (const instruction of txDetails.transaction.message.instructions) {
                const programId = accountKeyStrings[instruction.programIdIndex];
                if (programId === systemProgramIdString && instruction.data) {
                    const instructionDataBuffer = Buffer.from(bs58.decode(instruction.data));
                    if (instructionDataBuffer.length === 12) { // SystemProgram.transfer data length
                        const instructionDiscriminator = instructionDataBuffer.readUInt32LE(0);
                        if (instructionDiscriminator === 2) { // Transfer instruction
                            const transferredLamports = instructionDataBuffer.readBigUInt64LE(4);
                            const sourceAddressFromTx = accountKeyStrings[instruction.accounts[0]];
                            const destinationAddressFromTx = accountKeyStrings[instruction.accounts[1]];

                            if (sourceAddressFromTx === userWallet &&
                                destinationAddressFromTx === contestWalletAddress &&
                                transferredLamports === requiredAmountLamports) {
                                paymentVerified = true;
                                participationLogger.info('Contest entry payment verified successfully.', { signature: transaction_signature });
                                break;
                            }
                        }
                    }
                }
            }
            if (!paymentVerified) {
                throw new ServiceError(400, 'Contest entry payment verification failed: Transfer to contest wallet not confirmed or amount incorrect.');
            }
        }
        // --- End V2 Transaction Verification ---
      } catch (verifyError) {
        participationLogger.error('Transaction verification error:', {
          error: verifyError.message,
          stack: verifyError.stack,
          signature: transaction_signature,
          contestId: parsedId
        });
        const message = (verifyError instanceof ServiceError) ? verifyError.message : 'Failed to verify transaction';
        const statusCode = (verifyError instanceof ServiceError) ? verifyError.statusCode : 400;
        return res.status(statusCode).json({ error: 'transaction_verification_error', message, details: verifyError.message });
      }
    } else {
      // If no transaction signature, check if contest is free entry (entry_fee = 0)
      const entryFee = new Decimal(contest.entry_fee);
      if (entryFee.greaterThan(0)) {
        return res.status(400).json({
          error: 'transaction_required',
          message: 'Transaction signature required for paid contests',
          entry_fee: contest.entry_fee
        });
      }
    }
    
    // Process referral code if provided
    let referralRecord = null;
    if (referral_code) {
      try {
        referralRecord = await ReferralService.processReferral(
          referral_code,
          userWallet,
          contest.entry_fee
        );
      } catch (referralError) {
        participationLogger.error('Referral processing error:', {
          error: referralError.message,
          stack: referralError.stack,
          referralCode: referral_code,
          contestId: parsedId
        });
        // Continue with participation creation, just log the error
      }
    }
    
    // Create participant record
    const newParticipation = await prisma.contest_participants.create({
      data: {
        contest_id: parsedId,
        wallet_address: userWallet,
        initial_balance: "0", // Will be set by a separate process
        current_balance: "0", // Will be set by a separate process
        rank: 0, // Will be set by a separate process
        entry_transaction: transaction_signature,
        referral_code: referral_code,
        referral_id: referralRecord?.id || null,
        status: 'active'
      }
    });
    
    // Update contest prize pool
    const entryFee = new Decimal(contest.entry_fee);
    const prizeFee = entryFee.mul(0.9); // 90% goes to prize pool, 10% to platform
    const updatedPrizePool = new Decimal(contest.prize_pool || '0').plus(prizeFee);
    
    await prisma.contests.update({
      where: { id: parsedId },
      data: {
        prize_pool: updatedPrizePool.toString(),
        updated_at: new Date()
      }
    });
    
    // Track analytics
    participationLogger.analytics.trackEvent('contest_entry', {
      contestId: parsedId,
      contestName: contest.name,
      userWallet,
      entryFee: contest.entry_fee,
      transactionSignature: transaction_signature,
      referralCode: referral_code
    });
    
    participationLogger.info(`User ${userWallet} entered contest ${parsedId}`, {
      contestId: parsedId,
      userWallet,
      participationId: newParticipation.id
    });
    
    res.status(201).json({
      participation: newParticipation,
      message: 'Successfully entered contest'
    });
  } catch (error) {
    participationLogger.error('Failed to enter contest:', error);
    res.status(500).json({ error: 'Failed to enter contest', message: error.message });
  }
});

/**
 * @route POST /api/contests/:id/join
 * @description Join a contest (alternative to enter, mainly for free contests)
 * @access Private (requires auth)
 */
router.post('/:id/join', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { referral_code } = req.body;
    const userWallet = req.user.wallet_address;
    
    const parsedId = parseInt(id, 10);
    if (isNaN(parsedId)) {
      return res.status(400).json({ error: 'Invalid contest ID' });
    }
    
    // Check participation eligibility
    const participationCheck = await canUserParticipate(userWallet, parsedId);
    if (!participationCheck.canParticipate) {
      return res.status(400).json({
        error: participationCheck.reason,
        message: `Cannot join contest: ${participationCheck.reason}`,
        details: participationCheck
      });
    }
    
    // Get contest details to verify it's free
    const contest = await getAndValidateContest(parsedId);
    if (!contest) {
      return res.status(404).json({ error: 'Contest not found' });
    }
    
    // Check if contest is free
    const entryFee = new Decimal(contest.entry_fee);
    if (entryFee.greaterThan(0)) {
      return res.status(400).json({
        error: 'paid_contest',
        message: 'This contest requires an entry fee',
        entry_fee: contest.entry_fee,
        contest_wallet: contest.contest_wallets?.wallet_address
      });
    }
    
    // Process referral code if provided
    let referralRecord = null;
    if (referral_code) {
      try {
        referralRecord = await ReferralService.processReferral(
          referral_code,
          userWallet,
          "0" // Free contest
        );
      } catch (referralError) {
        participationLogger.error('Referral processing error:', {
          error: referralError.message,
          stack: referralError.stack,
          referralCode: referral_code,
          contestId: parsedId
        });
        // Continue with participation creation, just log the error
      }
    }
    
    // Create participant record
    const newParticipation = await prisma.contest_participants.create({
      data: {
        contest_id: parsedId,
        wallet_address: userWallet,
        initial_balance: "0", // Will be set by a separate process
        current_balance: "0", // Will be set by a separate process
        rank: 0, // Will be set by a separate process
        referral_code: referral_code,
        referral_id: referralRecord?.id || null,
        status: 'active'
      }
    });
    
    // Track analytics
    participationLogger.analytics.trackEvent('contest_join', {
      contestId: parsedId,
      contestName: contest.name,
      userWallet,
      referralCode: referral_code
    });
    
    participationLogger.info(`User ${userWallet} joined free contest ${parsedId}`, {
      contestId: parsedId,
      userWallet,
      participationId: newParticipation.id
    });
    
    res.status(201).json({
      participation: newParticipation,
      message: 'Successfully joined contest'
    });
  } catch (error) {
    participationLogger.error('Failed to join contest:', error);
    res.status(500).json({ error: 'Failed to join contest', message: error.message });
  }
});

/**
 * @route GET /api/contests/:id/check-participation
 * @description Check if a user is participating in a contest
 * @access Public
 */
router.get('/:id/check-participation', async (req, res) => {
  try {
    const { id } = req.params;
    const { wallet_address } = req.query;
    
    if (!wallet_address) {
      return res.status(400).json({ error: 'Missing wallet_address parameter' });
    }
    
    const parsedId = parseInt(id, 10);
    if (isNaN(parsedId)) {
      return res.status(400).json({ error: 'Invalid contest ID' });
    }
    
    // Check if contest exists
    const contest = await getAndValidateContest(parsedId);
    if (!contest) {
      return res.status(404).json({ error: 'Contest not found' });
    }
    
    // Check if user is participating
    const participation = await prisma.contest_participants.findFirst({
      where: {
        contest_id: parsedId,
        wallet_address
      }
    });
    
    if (participation) {
      res.json({
        participating: true,
        participation,
        message: 'User is participating in this contest'
      });
    } else {
      // Check if user can participate
      const canParticipate = await canUserParticipate(wallet_address, parsedId);
      
      res.json({
        participating: false,
        can_participate: canParticipate.canParticipate,
        message: canParticipate.canParticipate ? 
          'User can join this contest' : 
          `User cannot join this contest: ${canParticipate.reason}`,
        details: canParticipate
      });
    }
  } catch (error) {
    participationLogger.error('Failed to check participation:', error);
    res.status(500).json({ error: 'Failed to check participation', message: error.message });
  }
});

/**
 * @route GET /api/contests/user-participations
 * @description Get all contests a user is participating in
 * @access Public
 */
router.get('/user-participations', async (req, res) => {
  try {
    const { wallet_address, status } = req.query;
    
    if (!wallet_address) {
      return res.status(400).json({ error: 'Missing wallet_address parameter' });
    }
    
    const participations = await getUserContestParticipations(wallet_address, status);
    
    // Format the response
    const formattedParticipations = participations.map(p => ({
      contest_id: p.contest_id,
      wallet_address: p.wallet_address,
      initial_balance: p.initial_balance,
      current_balance: p.current_balance,
      rank: p.rank,
      final_rank: p.final_rank,
      prize_amount: p.prize_amount,
      status: p.status,
      created_at: p.created_at,
      contest: {
        id: p.contest.id,
        name: p.contest.name,
        description: p.contest.description,
        contest_code: p.contest.contest_code,
        start_time: p.contest.start_time,
        end_time: p.contest.end_time,
        status: p.contest.status,
        entry_fee: p.contest.entry_fee,
        prize_pool: p.contest.prize_pool,
        participant_count: p.contest._count.contest_participants
      }
    }));
    
    res.json({
      participations: formattedParticipations,
      total: formattedParticipations.length
    });
  } catch (error) {
    participationLogger.error('Failed to fetch user participations:', error);
    res.status(500).json({ error: 'Failed to fetch user participations', message: error.message });
  }
});

/**
 * @route GET /api/contests/participations/:wallet
 * @description Get all contest participations for a specific wallet
 * @access Public
 */
router.get('/participations/:wallet', async (req, res) => {
  try {
    const { wallet } = req.params;
    const { status } = req.query;
    
    const participations = await getUserContestParticipations(wallet, status);
    
    // Format the response (same as user-participations)
    const formattedParticipations = participations.map(p => ({
      contest_id: p.contest_id,
      wallet_address: p.wallet_address,
      initial_balance: p.initial_balance,
      current_balance: p.current_balance,
      rank: p.rank,
      final_rank: p.final_rank,
      prize_amount: p.prize_amount,
      status: p.status,
      created_at: p.created_at,
      contest: {
        id: p.contest.id,
        name: p.contest.name,
        description: p.contest.description,
        contest_code: p.contest.contest_code,
        start_time: p.contest.start_time,
        end_time: p.contest.end_time,
        status: p.contest.status,
        entry_fee: p.contest.entry_fee,
        prize_pool: p.contest.prize_pool,
        participant_count: p.contest._count.contest_participants
      }
    }));
    
    res.json({
      participations: formattedParticipations,
      total: formattedParticipations.length
    });
  } catch (error) {
    participationLogger.error('Failed to fetch wallet participations:', error);
    res.status(500).json({ error: 'Failed to fetch wallet participations', message: error.message });
  }
});

export default router;