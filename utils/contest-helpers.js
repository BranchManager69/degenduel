/**
 * Contest Helper Functions
 * 
 * @description Centralized utility functions for contest operations
 * 
 * @author BranchManager69
 * @version 1.0.0
 * @created 2025-05-08
 */

import { logApi } from './logger-suite/logger.js';
import prisma from '../config/prisma.js';
import { Prisma } from '@prisma/client';

// Create a dedicated logger for contest operations
const contestLogger = {
  ...logApi.forService('CONTESTS'),
  analytics: logApi.analytics
};

/**
 * Get and validate a contest exists with optional status check
 * @param {number|string} contestId - Contest ID
 * @param {string|null} requiredStatus - Optional status the contest must have (pending, active, completed, cancelled)
 * @returns {Promise<Object|null>} Contest object if valid, null otherwise
 */
export async function getAndValidateContest(contestId, requiredStatus = null) {
  try {
    const parsedId = parseInt(contestId, 10);
    if (isNaN(parsedId)) {
      contestLogger.warn(`Invalid contest ID format: ${contestId}`);
      return null;
    }

    const contest = await prisma.contests.findUnique({
      where: { id: parsedId },
      include: {
        contest_wallets: true,
        _count: {
          select: {
            contest_participants: true
          }
        }
      }
    });

    if (!contest) {
      contestLogger.warn(`Contest not found: ${contestId}`);
      return null;
    }

    if (requiredStatus && contest.status !== requiredStatus) {
      contestLogger.warn(`Contest ${contestId} status is ${contest.status}, expected ${requiredStatus}`);
      return null;
    }

    return contest;
  } catch (error) {
    contestLogger.error('Error validating contest', {
      error: error.message,
      stack: error.stack,
      contestId
    });
    return null;
  }
}

/**
 * Validate contest parameters for creation/update
 * @param {Object} params - Contest parameters
 * @returns {Object} Object with isValid flag and errors array
 */
export function validateContestParams(params) {
  const errors = [];
  
  // Required fields
  const requiredFields = ['name', 'contest_code', 'entry_fee', 'start_time', 'end_time'];
  const missingFields = requiredFields.filter(field => !params[field]);
  
  if (missingFields.length > 0) {
    errors.push(`Missing required fields: ${missingFields.join(', ')}`);
  }
  
  // Validate dates if provided
  if (params.start_time && params.end_time) {
    const startTime = new Date(params.start_time);
    const endTime = new Date(params.end_time);
    
    if (isNaN(startTime.getTime())) {
      errors.push('Invalid start_time format');
    }
    
    if (isNaN(endTime.getTime())) {
      errors.push('Invalid end_time format');
    }
    
    if (startTime >= endTime) {
      errors.push('end_time must be after start_time');
    }
    
    const now = new Date();
    if (startTime < now && params.status === 'pending') {
      errors.push('start_time must be in the future for pending contests');
    }
  }
  
  // Validate numeric fields
  try {
    if (params.entry_fee) {
      // Accept various formats and convert to Decimal
      const entryFee = new Prisma.Decimal(
        String(params.entry_fee).replace(/,/g, '')
      );
      
      if (entryFee.lessThan(0)) {
        errors.push('entry_fee must be non-negative');
      }
    }
    
    
    if (params.min_participants) {
      const minParticipants = parseInt(params.min_participants, 10);
      if (isNaN(minParticipants) || minParticipants < 2) {
        errors.push('min_participants must be at least 2');
      }
    }
    
    if (params.max_participants) {
      const maxParticipants = parseInt(params.max_participants, 10);
      if (isNaN(maxParticipants) || maxParticipants < 2) {
        errors.push('max_participants must be at least 2');
      }
      
      if (params.min_participants && 
          parseInt(params.min_participants, 10) > maxParticipants) {
        errors.push('max_participants must be greater than or equal to min_participants');
      }
    }
  } catch (error) {
    errors.push(`Invalid numeric parameter: ${error.message}`);
  }
  
  // Validate allowed buckets if provided
  if (params.allowed_buckets) {
    if (!Array.isArray(params.allowed_buckets)) {
      errors.push('allowed_buckets must be an array');
    } else if (params.allowed_buckets.some(bucket => typeof bucket !== 'number')) {
      errors.push('allowed_buckets must contain only numbers');
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Check if a user can participate in a contest
 * @param {string} walletAddress - User wallet address
 * @param {number|string} contestId - Contest ID
 * @returns {Promise<Object>} Object with canParticipate flag and reason if not
 */
export async function canUserParticipate(walletAddress, contestId) {
  try {
    const contest = await getAndValidateContest(contestId);
    if (!contest) {
      return { canParticipate: false, reason: 'contest_not_found' };
    }
    
    // Check contest status
    if (contest.status !== 'pending' && contest.status !== 'active') {
      return { 
        canParticipate: false, 
        reason: 'invalid_status',
        status: contest.status
      };
    }
    
    // Check participant count against max_participants
    if (contest.max_participants && 
        contest._count.contest_participants >= contest.max_participants) {
      return { 
        canParticipate: false, 
        reason: 'contest_full',
        currentCount: contest._count.contest_participants,
        maxParticipants: contest.max_participants
      };
    }
    
    // Check if already participating
    const existingParticipation = await prisma.contest_participants.findFirst({
      where: {
        contest_id: parseInt(contestId, 10),
        wallet_address: walletAddress
      }
    });
    
    if (existingParticipation) {
      return { 
        canParticipate: false, 
        reason: 'already_participating',
        participationId: existingParticipation.id
      };
    }
    
    return { canParticipate: true };
  } catch (error) {
    contestLogger.error('Error checking participation eligibility', {
      error: error.message,
      stack: error.stack,
      walletAddress,
      contestId
    });
    return { canParticipate: false, reason: 'error', message: error.message };
  }
}

/**
 * Get user's participations in contests
 * @param {string} walletAddress - User wallet address
 * @param {string|null} status - Optional contest status filter
 * @returns {Promise<Array>} Array of contest participations
 */
export async function getUserContestParticipations(walletAddress, status = null) {
  try {
    const where = {
      wallet_address: walletAddress
    };
    
    if (status) {
      where.contest = { status };
    }
    
    const participations = await prisma.contest_participants.findMany({
      where,
      include: {
        contest: {
          select: {
            id: true,
            name: true,
            description: true,
            status: true,
            start_time: true,
            end_time: true,
            entry_fee: true,
            prize_pool: true,
            contest_code: true,
            allowed_buckets: true,
            min_participants: true,
            max_participants: true,
            _count: {
              select: {
                contest_participants: true
              }
            }
          }
        }
      },
      orderBy: {
        created_at: 'desc'
      }
    });
    
    return participations;
  } catch (error) {
    contestLogger.error('Error fetching user contest participations', {
      error: error.message,
      stack: error.stack,
      walletAddress,
      status
    });
    return [];
  }
}

/**
 * Validate portfolio selections
 * @param {Array} selections - Token selections with weights
 * @param {Array} allowedBuckets - Allowed token buckets for the contest
 * @returns {Object} Object with isValid flag and errors array
 */
export function validatePortfolioSelections(selections, allowedBuckets) {
  const errors = [];
  
  if (!Array.isArray(selections)) {
    return { isValid: false, errors: ['Selections must be an array'] };
  }
  
  if (selections.length === 0) {
    return { isValid: false, errors: ['At least one token selection is required'] };
  }
  
  // Check total weight
  const totalWeight = selections.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight !== 100) {
    errors.push(`Total weight must be 100%, currently ${totalWeight}%`);
  }
  
  // Validate each selection
  for (const selection of selections) {
    if (!selection.token_id) {
      errors.push('Each selection must include a token_id');
      continue;
    }
    
    if (typeof selection.weight !== 'number' || selection.weight <= 0) {
      errors.push(`Invalid weight for token ${selection.token_id}: ${selection.weight}`);
    }
    
    // Check if token is in allowed buckets if specified
    if (allowedBuckets && allowedBuckets.length > 0 && selection.bucket) {
      if (!allowedBuckets.includes(selection.bucket)) {
        errors.push(`Token bucket ${selection.bucket} is not allowed in this contest`);
      }
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Create or update a user's portfolio in a contest
 * @param {number|string} contestId - Contest ID
 * @param {string} walletAddress - User wallet address
 * @param {Array} tokenSelections - Token selections with weights
 * @returns {Promise<Object>} Created or updated portfolio
 */
export async function updateUserPortfolio(contestId, walletAddress, tokenSelections) {
  try {
    const parsedContestId = parseInt(contestId, 10);
    
    // Delete existing portfolio if exists
    await prisma.contest_portfolios.deleteMany({
      where: {
        contest_id: parsedContestId,
        wallet_address: walletAddress
      }
    });
    
    // Create new portfolio entries
    const portfolioEntries = tokenSelections.map(selection => ({
      contest_id: parsedContestId,
      wallet_address: walletAddress,
      token_id: selection.token_id,
      weight: selection.weight,
      created_at: new Date()
    }));
    
    await prisma.contest_portfolios.createMany({
      data: portfolioEntries
    });
    
    // Fetch and return the created portfolio
    const portfolio = await prisma.contest_portfolios.findMany({
      where: {
        contest_id: parsedContestId,
        wallet_address: walletAddress
      },
      include: {
        tokens: true
      }
    });
    
    return portfolio;
  } catch (error) {
    contestLogger.error('Error updating user portfolio', {
      error: error.message,
      stack: error.stack,
      contestId,
      walletAddress
    });
    throw error;
  }
}

/**
 * Start a contest and update its status
 * @param {number|string} contestId - Contest ID
 * @param {string} adminId - Admin wallet address
 * @returns {Promise<Object>} Updated contest
 */
export async function startContest(contestId, adminId) {
  try {
    const parsedContestId = parseInt(contestId, 10);
    const contest = await getAndValidateContest(parsedContestId, 'pending');
    
    if (!contest) {
      return null;
    }
    
    // Check minimum participants
    if (contest._count.contest_participants < contest.min_participants) {
      return { 
        error: 'insufficient_participants',
        current: contest._count.contest_participants,
        minimum: contest.min_participants
      };
    }
    
    // Update contest status
    const updatedContest = await prisma.contests.update({
      where: { id: parsedContestId },
      data: {
        status: 'active',
        started_at: new Date(),
        started_by: adminId
      }
    });
    
    contestLogger.info(`Contest ${contestId} started by admin ${adminId}`, {
      contestId,
      adminId,
      participantCount: contest._count.contest_participants
    });
    
    return updatedContest;
  } catch (error) {
    contestLogger.error('Error starting contest', {
      error: error.message,
      stack: error.stack,
      contestId,
      adminId
    });
    throw error;
  }
}

/**
 * End a contest and calculate results
 * @param {number|string} contestId - Contest ID
 * @param {string} adminId - Admin wallet address
 * @returns {Promise<Object>} Updated contest with results
 */
export async function endContest(contestId, adminId) {
  try {
    const parsedContestId = parseInt(contestId, 10);
    const contest = await getAndValidateContest(parsedContestId, 'active');
    
    if (!contest) {
      return null;
    }
    
    // Calculate final rankings and prize distribution
    await calculateContestRankings(parsedContestId);
    
    // Update contest status
    const updatedContest = await prisma.contests.update({
      where: { id: parsedContestId },
      data: {
        status: 'completed',
        ended_at: new Date(),
        ended_by: adminId
      }
    });
    
    contestLogger.info(`Contest ${contestId} ended by admin ${adminId}`, {
      contestId,
      adminId
    });
    
    return updatedContest;
  } catch (error) {
    contestLogger.error('Error ending contest', {
      error: error.message,
      stack: error.stack,
      contestId,
      adminId
    });
    throw error;
  }
}

/**
 * Calculate contest rankings
 * @param {number|string} contestId - Contest ID
 * @returns {Promise<Array>} Updated participants with rankings
 */
export async function calculateContestRankings(contestId) {
  try {
    const parsedContestId = parseInt(contestId, 10);
    
    // Get all participants
    const participants = await prisma.contest_participants.findMany({
      where: { contest_id: parsedContestId },
      orderBy: { current_balance: 'desc' }
    });
    
    // Calculate prize pool distribution (simplified)
    const contest = await prisma.contests.findUnique({
      where: { id: parsedContestId }
    });
    
    if (!contest) {
      throw new Error(`Contest ${contestId} not found`);
    }
    
    // Calculate prizes based on rank (simplified)
    const prizePool = new Prisma.Decimal(contest.prize_pool || '0');
    const updatedParticipants = [];
    
    // Example prize distribution: 1st: 50%, 2nd: 30%, 3rd: 20%
    const prizeDistribution = [0.5, 0.3, 0.2];
    
    for (let i = 0; i < participants.length; i++) {
      const rank = i + 1;
      let prizeAmount = new Prisma.Decimal('0');
      
      // Assign prize only to top 3 (simplified)
      if (rank <= prizeDistribution.length && prizePool.greaterThan(0)) {
        prizeAmount = prizePool.mul(prizeDistribution[i]);
      }
      
      // Update participant with final rank and prize
      const updated = await prisma.contest_participants.update({
        where: { id: participants[i].id },
        data: {
          final_rank: rank,
          prize_amount: prizeAmount.toString()
        }
      });
      
      updatedParticipants.push(updated);
    }
    
    return updatedParticipants;
  } catch (error) {
    contestLogger.error('Error calculating contest rankings', {
      error: error.message,
      stack: error.stack,
      contestId
    });
    throw error;
  }
}

export default {
  getAndValidateContest,
  validateContestParams,
  canUserParticipate,
  getUserContestParticipations,
  validatePortfolioSelections,
  updateUserPortfolio,
  startContest,
  endContest,
  calculateContestRankings
};