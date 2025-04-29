// utils/contest-credit-verifier.js

/**
 * Utility functions for verifying and consuming contest creation credits
 */

import prisma from '../config/prisma.js';
import { logApi } from '../utils/logger-suite/logger.js';
import { fancyColors } from '../utils/colors.js';

/**
 * Format tag for logging
 * @returns {string} Formatted tag for logs
 */
const formatLog = {
  tag: () => `${fancyColors.BG_MAGENTA}${fancyColors.WHITE}[credit-verifier]${fancyColors.RESET}`,
  info: (text) => `${fancyColors.CYAN}${text}${fancyColors.RESET}`,
  success: (text) => `${fancyColors.GREEN}${text}${fancyColors.RESET}`,
  error: (text) => `${fancyColors.RED}${text}${fancyColors.RESET}`,
  warn: (text) => `${fancyColors.YELLOW}${text}${fancyColors.RESET}`
};

/**
 * Check if a user has available credits for contest creation
 * 
 * @param {string} userId - The wallet address of the user
 * @param {boolean} requireCredit - Whether a credit is required (false for admins)
 * @returns {Promise<{hasCredit: boolean, credit: Object|null, error: string|null}>} Result object
 */
async function verifyUserHasCredit(userId, requireCredit = true) {
  try {
    // Skip credit verification for admin users if requireCredit is false
    if (!requireCredit) {
      return { hasCredit: true, credit: null, error: null };
    }

    // Check if user exists
    const user = await prisma.users.findUnique({
      where: { wallet_address: userId },
      select: { role: true }
    });

    if (!user) {
      return { hasCredit: false, credit: null, error: "User not found" };
    }

    // Admins and superadmins bypass credit requirement if requireCredit is false
    if ((user.role === 'admin' || user.role === 'superadmin') && !requireCredit) {
      return { hasCredit: true, credit: null, error: null };
    }

    // Find an available credit for the user
    const credit = await prisma.contest_creation_credits.findFirst({
      where: {
        user_id: userId,
        status: 'active',
        // Only include credits that haven't expired or where expires_at is null (never expires)
        OR: [
          { expires_at: null },
          { expires_at: { gt: new Date() } }
        ]
      },
      orderBy: {
        // Use older credits first (FIFO)
        created_at: 'asc'
      }
    });

    if (!credit) {
      return { hasCredit: false, credit: null, error: "No available contest creation credits" };
    }

    return { hasCredit: true, credit, error: null };
  } catch (error) {
    logApi.error(`${formatLog.tag()} ${formatLog.error('Error verifying user credits')}: ${error.message}`, {
      userId,
      error: error.message,
      stack: error.stack
    });
    return { hasCredit: false, credit: null, error: `Error verifying credits: ${error.message}` };
  }
}

/**
 * Consume a credit for contest creation
 * 
 * @param {number} creditId - ID of the credit to consume 
 * @param {number} contestId - ID of the contest created with this credit
 * @param {object} transaction - Optional transaction object for atomic operations
 * @returns {Promise<{success: boolean, error: string|null}>} Result of the operation
 */
async function consumeCredit(creditId, contestId, transaction = null) {
  const prismaClient = transaction || prisma;
  
  try {
    // Update the credit to mark it as used
    await prismaClient.contest_creation_credits.update({
      where: { id: creditId },
      data: {
        status: 'used',
        used_at: new Date(),
        contest: {
          connect: { id: contestId }
        }
      }
    });

    logApi.info(`${formatLog.tag()} ${formatLog.success('Credit consumed successfully')}: Credit #${creditId} for Contest #${contestId}`);
    return { success: true, error: null };
  } catch (error) {
    logApi.error(`${formatLog.tag()} ${formatLog.error('Error consuming credit')}: ${error.message}`, {
      creditId,
      contestId,
      error: error.message,
      stack: error.stack
    });
    return { success: false, error: `Error consuming credit: ${error.message}` };
  }
}

/**
 * Update a contest with the credit used to create it
 * 
 * @param {number} contestId - ID of the contest to update
 * @param {number} creditId - ID of the credit used
 * @param {object} transaction - Optional transaction object for atomic operations
 * @returns {Promise<{success: boolean, error: string|null}>} Result of the operation
 */
async function linkCreditToContest(contestId, creditId, transaction = null) {
  const prismaClient = transaction || prisma;
  
  try {
    // Update the contest to link it to the credit
    await prismaClient.contests.update({
      where: { id: contestId },
      data: {
        creator_credit_used: creditId
      }
    });

    return { success: true, error: null };
  } catch (error) {
    logApi.error(`${formatLog.tag()} ${formatLog.error('Error linking credit to contest')}: ${error.message}`, {
      creditId,
      contestId,
      error: error.message,
      stack: error.stack
    });
    return { success: false, error: `Error linking credit to contest: ${error.message}` };
  }
}

/**
 * Grant a contest creation credit to a user
 * 
 * @param {string} userId - Wallet address of user to grant credit to
 * @param {string} source - Source of the credit (admin_grant, purchase, achievement)
 * @param {string} grantedBy - Wallet address of admin who granted the credit
 * @param {object} options - Additional options (expires_at, metadata, etc.)
 * @returns {Promise<{success: boolean, credit: object|null, error: string|null}>} Result object
 */
async function grantCredit(userId, source, grantedBy, options = {}) {
  try {
    // Create the credit
    const credit = await prisma.contest_creation_credits.create({
      data: {
        user_id: userId,
        source,
        granted_by: grantedBy,
        expires_at: options.expires_at || null,
        price_paid: options.price_paid || null,
        transaction_id: options.transaction_id || null,
        purchase_txn_signature: options.purchase_txn_signature || null,
        receipt_number: options.receipt_number || null,
        metadata: options.metadata || {},
        contest_settings: options.contest_settings || {}
      }
    });

    logApi.info(`${formatLog.tag()} ${formatLog.success('Credit granted successfully')}: Credit #${credit.id} to User ${userId} by ${grantedBy}`);
    return { success: true, credit, error: null };
  } catch (error) {
    logApi.error(`${formatLog.tag()} ${formatLog.error('Error granting credit')}: ${error.message}`, {
      userId,
      grantedBy,
      source,
      error: error.message,
      stack: error.stack
    });
    return { success: false, credit: null, error: `Error granting credit: ${error.message}` };
  }
}

export {
  verifyUserHasCredit,
  consumeCredit,
  linkCreditToContest,
  grantCredit
};