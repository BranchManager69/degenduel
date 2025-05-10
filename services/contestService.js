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
 * 
 *     TODO: check if above is true
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
import { Decimal } from '@prisma/client/runtime/library';
import marketDataService from './market-data/marketDataService.js';
import { logApi } from '../utils/logger-suite/logger.js';
import config from '../config/config.js';
import { solanaEngine } from './solana-engine/index.js';
import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { Buffer } from 'node:buffer';

const LAMPORTS_PER_SOL_V2 = 1_000_000_000;

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
 * Join a contest, create participant record, and initialize their portfolio.
 * @param {number} contestId - ID of the contest to join
 * @param {string} walletAddress - User's wallet address
 * @param {string} transactionSignature - Solana transaction signature for the entry fee
 * @param {Array<{token_id: number, weight: number}>} tokenSelections - User's initial token weight selections
 * @param {number|string} userId - (Optional) ID of the authenticated user
 * @returns {Promise<Object>} - { participant, verification, portfolioEntries }
 * @throws {JoinContestError} on validation or business rule failure
 */
export async function joinContest(contestId, walletAddress, transactionSignature, tokenSelections = [], userId) {
  // Validate inputs
  if (!contestId || isNaN(contestId)) {
    throw new JoinContestError('Invalid contestId', 400, 'invalid_contest_id');
  }
  if (!walletAddress) {
    throw new JoinContestError('Missing wallet_address', 400, 'missing_wallet_address');
  }
  if (!Array.isArray(tokenSelections)) {
      throw new JoinContestError('Invalid tokenSelections format, expected array', 400, 'invalid_token_selections');
  }
  // Basic validation of selections
  let totalWeight = 0;
  const selectedTokenIds = [];
  for (const selection of tokenSelections) {
    if (typeof selection.token_id !== 'number' || typeof selection.weight !== 'number' || selection.weight <= 0) {
      throw new JoinContestError('Invalid item in tokenSelections array', 400, 'invalid_token_selection_item');
    }
    totalWeight += selection.weight;
    selectedTokenIds.push(selection.token_id);
  }
  // Assuming weight is percentage
  if (tokenSelections.length > 0 && Math.abs(totalWeight - 100) > 0.1) { // Allow small tolerance for float issues if using decimals later
      logApi.warn(`[joinContest] User ${walletAddress} submitted weights totalling ${totalWeight} for contest ${contestId}`);
      // Don't throw error, but log? Or normalize weights later?
      // For now, proceed but log warning.
  }
  if (tokenSelections.length === 0) {
       logApi.warn(`[joinContest] User ${walletAddress} joined contest ${contestId} with empty token selections.`);
       // Allow joining with empty portfolio?
  }

  // Fetch contest with wallet, participant count, and settings
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

  let verificationResultForDb = null;

  const entryFeeDecimal = new Decimal(contest.entry_fee || 0);
  if (entryFeeDecimal.gt(0)) {
      if (!transactionSignature) {
          throw new JoinContestError('Missing transaction_signature for paid contest', 400, 'missing_transaction_signature');
      }
      const feeWalletAddress = contest.contest_wallets?.wallet_address;
      if (!feeWalletAddress) {
          throw new JoinContestError('Contest entry wallet not configured for this contest', 500, 'contest_wallet_missing');
      }
      
      // --- NEW V2 Transaction Verification --- 
      try {
        const requiredAmountLamports = BigInt(Math.round(entryFeeDecimal.toNumber() * LAMPORTS_PER_SOL_V2));
        logApi.info(`[joinContest] Verifying entry fee payment for contest ${contestId}`, {
            signature: transactionSignature, userWallet: walletAddress, contestFeeWallet: feeWalletAddress, requiredLamports: requiredAmountLamports.toString()
        });

        const txDetails = await solanaEngine.executeConnectionMethod(
            'getTransaction',
            transactionSignature,
            { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }
        );

        if (!txDetails || !txDetails.transaction) {
            throw new JoinContestError(`Entry payment transaction ${transactionSignature} not found or failed.`, 400, 'payment_tx_not_found');
        }
        if (txDetails.meta?.err) {
            throw new JoinContestError(`Entry payment transaction ${transactionSignature} failed on-chain: ${JSON.stringify(txDetails.meta.err)}`, 400, 'payment_tx_failed');
        }

        let paymentVerified = false;
        const systemProgramIdString = '11111111111111111111111111111111';
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

                        if (sourceAddressFromTx === walletAddress &&
                            destinationAddressFromTx === feeWalletAddress &&
                            transferredLamports === requiredAmountLamports) {
                            paymentVerified = true;
                            verificationResultForDb = transactionSignature; // Store signature for DB
                            logApi.info(`[joinContest] Entry fee payment verified for contest ${contestId}.`, { signature: transactionSignature });
                            break;
                        }
                    }
                }
            }
        }
        if (!paymentVerified) {
            throw new JoinContestError('Entry fee payment verification failed: Transfer to contest wallet not confirmed or amount incorrect.', 400, 'payment_verification_failed');
        }
      } catch (verifyError) {
          logApi.error('[joinContest] Transaction verification error:', { error: verifyError.message, stack: verifyError.stack, sig: transactionSignature });
          if (verifyError instanceof JoinContestError) throw verifyError;
          throw new JoinContestError(`Transaction verification processing error: ${verifyError.message}`, 400, 'tx_verify_processing_error');
      }
      // --- End V2 Transaction Verification ---
  }

  // --- Start Portfolio Calculation ---
  let initialBalance = new Decimal(0);
  let portfolioEntriesData = [];

  if (tokenSelections.length > 0) {
      // Get starting portfolio value from settings or use a default
      const startingValueStr = contest.settings?.startingPortfolioValue || config.service_thresholds?.contest_evaluation?.defaultStartingPortfolioValue || '10000';
      initialBalance = new Decimal(startingValueStr);

      // Fetch current prices for selected tokens
      let currentTokenPricesMap = new Map();
      try {
          currentTokenPricesMap = await marketDataService.getCurrentPricesMap(selectedTokenIds);
      } catch (priceError) {
          logApi.error(`[joinContest] Failed to get prices for contest ${contestId}, user ${walletAddress}: ${priceError.message}`);
          throw new JoinContestError('Failed to retrieve token prices for portfolio initialization', 500, 'price_fetch_failed');
      }

      // Calculate initial quantities
      for (const selection of tokenSelections) {
          const priceAtJoin = currentTokenPricesMap.get(selection.token_id);
          if (!priceAtJoin || priceAtJoin.isZero()) {
              logApi.warn(`[joinContest] Token ID ${selection.token_id} has zero or missing price at join for contest ${contestId}, user ${walletAddress}. Skipping.`);
              continue; // Skip tokens with no price
          }
          const weight = new Decimal(selection.weight);
          const valueAllocation = initialBalance.mul(weight.div(100)); // Assumes weight is %
          const quantity = valueAllocation.div(priceAtJoin); // quantity = value / price

          portfolioEntriesData.push({
              token_id: selection.token_id,
              weight: selection.weight, // Store the user's intended weight
              quantity: quantity // Store the calculated quantity
          });
      }
  } else {
      // If no selections, initial balance remains 0 (or could be set to starting value with 0 tokens)
       const startingValueStr = contest.settings?.startingPortfolioValue || config.service_thresholds?.contest_evaluation?.defaultStartingPortfolioValue || '10000';
       initialBalance = new Decimal(startingValueStr); // User starts with cash equivalent
  }

  // Use a transaction to create participant and their portfolio entries together
  try {
      const { participant, portfolioEntries } = await prisma.$transaction(async (tx) => {
          // Create participant record, including initial balance
          const newParticipant = await tx.contest_participants.create({
              data: {
                  contest_id: contestId,
                  wallet_address: walletAddress,
                  initial_balance: initialBalance, // Store the determined initial balance
                  portfolio_value: initialBalance, // Initial portfolio value matches initial balance
                  entry_transaction: verificationResultForDb, // Use the stored signature
              }
          });

          // Create portfolio entries if any were calculated
          let createdEntries = [];
          if (portfolioEntriesData.length > 0) {
              createdEntries = await tx.contest_portfolios.createManyAndReturn({ // Assuming Prisma extension or map if not
                  data: portfolioEntriesData.map(entry => ({
                      contest_id: contestId,
                      wallet_address: walletAddress,
                      token_id: entry.token_id,
                      weight: entry.weight,
                      quantity: entry.quantity
                  }))
              });
              // Note: createMany doesn't typically return records unless using extensions.
              // We might need to re-fetch or just return the input data for confirmation.
          }

          return { participant: newParticipant, portfolioEntries: portfolioEntriesData }; // Return input data for now
      });

      logApi.info(`[joinContest] User ${walletAddress} successfully joined contest ${contestId}. Initial Balance: ${initialBalance.toString()}`);
      return { participant, verification: verificationResultForDb, portfolioEntries };

  } catch (error) {
      logApi.error(`[joinContest] Transaction failed for user ${walletAddress}, contest ${contestId}:`, error);
      if (error instanceof JoinContestError) throw error; // Re-throw known errors
      throw new JoinContestError('Failed to save participation data', 500, 'participation_save_failed');
  }
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
