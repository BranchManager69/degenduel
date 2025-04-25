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