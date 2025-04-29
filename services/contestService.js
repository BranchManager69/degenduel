// services/contestService.js

/*
 * NOTE:

 *   THIS IS *NOT* A SERVICE !!!!!!!
 *
 *     AS CURRENTLY DESIGNED, IT IS A MODULE THAT EXPORTS FUNCTIONS.
 *     SOMEDAY, IT SHOULD BE CONVERTED INTO A SERVICE!
 * 
 *     AS A TEMPORARY SOLUTION, ITS FUNCTIONS ARE USED IN LIEU OF THE DESIRED SERVICE.
 * 
 *     THIS IS A HACK!
 */

/**
 * Contest Service (beta)
 *  
 * This handles the creation and management of contests.
 * 
 * @author @BranchManager69
 * @version 1.9.0
 * @created 2025-04-28
 * @updated 2025-04-28
 */

import prisma from '../config/prisma.js';
import { verifyTransaction } from '../utils/solana-suite/web3-v2/solana-connection-v2.js';

/**
 * Error thrown when joinContest fails due to business logic or validation.
 */
export class JoinContestError extends Error {
  /**
   * @param {string} message - Human-readable error message
   * @param {number} status - HTTP status code
   * @param {string} code - Machine-readable error code
   */
  constructor(message, status = 400, code = 'join_contest_error') {
    super(message);
    this.name = 'JoinContestError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Join a contest by verifying the on-chain entry transaction and creating a participant record.
 * @param {number} contestId - ID of the contest to join
 * @param {string} walletAddress - User's wallet address
 * @param {string} transactionSignature - Solana transaction signature for the entry fee
 * @param {number|string} userId - (Optional) ID of the authenticated user
 * @returns {Promise<Object>} - { participant, verification }
 * @throws {JoinContestError} on validation or business rule failure
 */
export async function joinContest(contestId, walletAddress, transactionSignature, userId) {
  // Validate inputs
  if (!contestId || isNaN(contestId)) {
    throw new JoinContestError('Invalid contestId', 400, 'invalid_contest_id');
  }
  if (!walletAddress) {
    throw new JoinContestError('Missing wallet_address', 400, 'missing_wallet_address');
  }
  if (!transactionSignature) {
    throw new JoinContestError('Missing transaction_signature', 400, 'missing_transaction_signature');
  }

  // Fetch contest with wallet and participant count
  const contest = await prisma.contests.findUnique({
    where: { id: contestId },
    include: {
      contest_wallets: true,
      _count: { select: { contest_participants: true } }
    }
  });
  if (!contest) {
    throw new JoinContestError('Contest not found', 404, 'contest_not_found');
  }
  // Only allow joining active contests
  if (contest.status !== 'active') {
    throw new JoinContestError('Contest is not active', 400, 'contest_not_active');
  }
  // Enforce max participants if set
  if (contest.max_participants != null && contest._count.contest_participants >= contest.max_participants) {
    throw new JoinContestError('Contest is full', 400, 'contest_full');
  }

  // Prevent duplicate participation
  const existing = await prisma.contest_participants.findUnique({
    where: {
      contest_id_wallet_address: { contest_id: contestId, wallet_address: walletAddress }
    }
  });
  if (existing) {
    throw new JoinContestError('Already participating in this contest', 400, 'already_participating');
  }

  // Ensure fee-collection wallet is configured
  const feeWallet = contest.contest_wallets;
  if (!feeWallet) {
    throw new JoinContestError('Contest entry wallet not configured', 500, 'contest_wallet_missing');
  }

  // Verify the on-chain entry transaction
  const entryFee = contest.entry_fee?.toNumber() || 0;
  const verification = await verifyTransaction(
    transactionSignature,
    {
      expectedAmount: entryFee,
      expectedSender: walletAddress,
      expectedReceiver: feeWallet.wallet_address
    }
  );
  if (!verification.verified) {
    throw new JoinContestError('Transaction verification failed', 400, 'verification_failed');
  }

  // Create participant record
  const participant = await prisma.contest_participants.create({
    data: {
      contest_id: contestId,
      wallet_address: walletAddress
      // additional fields (entry_transaction_id, initial_balance) can be added here
    }
  });

  return { participant, verification };
}

/**
 * Create a new contest with optional credit verification for regular users
 * @param {Object} contestData - Contest data to create
 * @param {Object} userData - User data including wallet address and role
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} - Created contest with wallet info
 */
export async function createContest(contestData, userData, options = {}) {
  // Import the credit verifier utility
  const { verifyUserHasCredit, consumeCredit } = await import('../utils/contest-credit-verifier.js');
  
  // Import wallet service
  const contestWalletService = await import('./contest-wallet/contestWalletService.js');
  
  // Validate inputs
  if (!contestData || !userData) {
    throw new Error('Missing contestData or userData');
  }
  
  const { 
    name, 
    contest_code, 
    description, 
    entry_fee, 
    start_time, 
    end_time, 
    min_participants,
    max_participants,
    allowed_buckets = [],
    visibility = 'public'
  } = contestData;
  
  const { wallet_address: userId, role } = userData;
  const isAdmin = role === 'admin' || role === 'superadmin';
  
  // Required fields validation
  const requiredFields = ['name', 'contest_code', 'entry_fee', 'start_time', 'end_time'];
  const missingFields = requiredFields.filter(field => !contestData[field]);
  if (missingFields.length > 0) {
    throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
  }
  
  // Date validation
  const startDate = new Date(start_time);
  const endDate = new Date(end_time);
  const now = new Date();
  
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    throw new Error('Invalid date format for start_time or end_time');
  }
  
  if (startDate <= now) {
    throw new Error('start_time must be in the future');
  }
  
  if (endDate <= startDate) {
    throw new Error('end_time must be after start_time');
  }
  
  // For non-admin users, verify they have a credit
  let creditResult = { hasCredit: true, credit: null };
  if (!isAdmin) {
    creditResult = await verifyUserHasCredit(userId);
    if (!creditResult.hasCredit) {
      throw new Error(creditResult.error || 'No available contest creation credits');
    }
  }
  
  // Create contest with transaction to ensure atomicity
  return await prisma.$transaction(async (tx) => {
    // Create the contest
    const contest = await tx.contests.create({
      data: {
        name,
        contest_code,
        description: description || '',
        entry_fee,
        start_time: startDate,
        end_time: endDate,
        min_participants: min_participants || 2,
        max_participants: max_participants || 50,
        allowed_buckets,
        status: 'pending',
        visibility,
        created_by_user: userId
      }
    });
    
    // Create contest wallet
    let contestWallet;
    try {
      contestWallet = await contestWalletService.default.createContestWallet(contest.id, tx);
      
      // Log success if it's a vanity wallet
      if (contestWallet.is_vanity) {
        logApi.info(`Assigned vanity wallet to contest #${contest.id}`);
      }
    } catch (walletError) {
      throw new Error(`Failed to create contest wallet: ${walletError.message}`);
    }
    
    // For non-admin users, consume a credit
    if (!isAdmin && creditResult.credit) {
      const creditUsed = await consumeCredit(creditResult.credit.id, contest.id, tx);
      
      if (!creditUsed.success) {
        throw new Error(creditUsed.error || 'Failed to consume contest creation credit');
      }
      
      // Update the contest with the credit used
      await tx.contests.update({
        where: { id: contest.id },
        data: {
          creator_credit_used: creditResult.credit.id
        }
      });
    }
    
    // Generate contest image asynchronously (if function exists)
    if (options.generateImage !== false) {
      try {
        // Use dynamic import to avoid circular dependencies
        const contestImageService = await import('./contestImageService.js');
        
        // Start image generation in the background (non-blocking)
        contestImageService.default.generateContestImage(contest)
          .then(imageUrl => {
            // Update contest with image URL
            return prisma.contests.update({
              where: { id: contest.id },
              data: { image_url: imageUrl }
            });
          })
          .catch(error => {
            console.error('Failed to generate contest image:', error);
          });
      } catch (error) {
        // Continue even if image generation setup fails
        console.error('Failed to set up contest image generation:', error);
      }
    }
    
    // Return the created contest with additional info
    return {
      ...contest,
      wallet_address: contestWallet.wallet_address,
      is_vanity: contestWallet.is_vanity || false,
      vanity_type: contestWallet.vanity_type || null,
      credit_used: !isAdmin && creditResult.credit ? creditResult.credit.id : null
    };
  });
}

/**
 * Get a contest by ID
 * @param {number} contestId - ID of the contest to get
 * @returns {Promise<Object>} - Contest object
 */
export async function getContestById(contestId) {
  // Validate inputs
  if (!contestId || isNaN(contestId)) {
    throw new Error('Invalid contestId');
  }

  // Fetch contest with wallet and participant count
  const contest = await prisma.contests.findUnique({
    where: { id: contestId },
    include: {
      contest_wallets: true,
      _count: { select: { contest_participants: true } }
    }
  });

  if (!contest) {
    throw new Error('Contest not found');
  }

  return contest;
}

/**
 * Get all contests
 * @returns {Promise<Object>} - Contest object
 */ 
export async function getAllContests() {
  // Fetch all contests
  const contests = await prisma.contests.findMany();
  return contests;
}

/**
 * Get all contests by user
 * @param {string} userId - ID of the user to get contests for
 * @returns {Promise<Object>} - Contest object
 */
export async function getAllContestsByUser(userId) {
  // Fetch all contests by user
  const contests = await prisma.contests.findMany({
    where: { created_by_user: userId }
  });
  return contests;
} 

/**
 * Get all contests by user
 * @param {string} userId - ID of the user to get contests for
 * @returns {Promise<Object>} - Contest object
 */ 
export async function getContestSchedules() {
  // Fetch all contest schedules
  const schedules = await prisma.contest_schedules.findMany();
  return schedules;
}

// Export all functions
export { joinContest, createContest, getContestById, getAllContests, getAllContestsByUser, getContestSchedules };
