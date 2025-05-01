/**
 * @file Example contest status handler
 * @description Shows how to handle contest status changes
 */

import prisma from '../../../config/prisma.js';
import realtime from '../index.js';
import { CONTEST_CHANNELS } from '../channels.js';
import { logApi } from '../../logger-suite/logger.js';

/**
 * Update a contest status and publish the event
 * @param {number} contestId - Contest ID
 * @param {string} contestCode - Contest code
 * @param {string} newStatus - New status (pending, active, completed, cancelled)
 * @param {string} [reason] - Optional reason for status change
 */
export async function updateContestStatus(contestId, contestCode, newStatus, reason = null) {
  try {
    // Get current status
    const contest = await prisma.contests.findUnique({
      where: { id: contestId },
      select: {
        status: true,
        participant_count: true,
        current_prize_pool: true,
      }
    });
    
    if (!contest) {
      throw new Error(`Contest ${contestId} not found`);
    }
    
    const previousStatus = contest.status;
    
    // Don't update if status hasn't changed
    if (previousStatus === newStatus) {
      logApi.debug(`Contest ${contestId} status already ${newStatus}`);
      return {
        success: true,
        changed: false,
        previousStatus,
        newStatus
      };
    }
    
    // Update status in database
    let updatedContest;
    
    if (newStatus === 'completed') {
      updatedContest = await prisma.contests.update({
        where: { id: contestId },
        data: {
          status: newStatus,
          completed_at: new Date()
        }
      });
    } else if (newStatus === 'cancelled') {
      updatedContest = await prisma.contests.update({
        where: { id: contestId },
        data: {
          status: newStatus,
          cancelled_at: new Date(),
          cancellation_reason: reason
        }
      });
    } else {
      updatedContest = await prisma.contests.update({
        where: { id: contestId },
        data: {
          status: newStatus
        }
      });
    }
    
    // Publish event
    await realtime.publish(CONTEST_CHANNELS.STATUS, {
      id: contestId,
      code: contestCode,
      previousStatus,
      status: newStatus,
      participantCount: contest.participant_count,
      prizePool: contest.current_prize_pool.toString(),
      reason: reason,
      timestamp: Date.now()
    });
    
    logApi.info(`Contest ${contestId} status changed from ${previousStatus} to ${newStatus}`);
    
    return {
      success: true,
      changed: true,
      previousStatus,
      newStatus,
      contest: updatedContest
    };
  } catch (err) {
    logApi.error(`Error updating contest ${contestId} status:`, err);
    throw err;
  }
}