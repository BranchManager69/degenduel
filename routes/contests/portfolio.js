/**
 * Contest Portfolio Routes
 * 
 * @description Routes for managing contest portfolios
 * 
 * @author BranchManager69
 * @version 1.0.0
 * @created 2025-05-08
 */

import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import prisma from '../../config/prisma.js';
import { 
  getAndValidateContest,
  validatePortfolioSelections,
  updateUserPortfolio
} from '../../utils/contest-helpers.js';

// Router
const router = express.Router();

// Create a dedicated logger for contest portfolio operations
const portfolioLogger = {
  ...logApi.forService('CONTESTS_PORTFOLIO'),
  analytics: logApi.analytics
};

/**
 * @route POST /api/contests/:id/portfolio
 * @description Create or update a portfolio for a contest
 * @access Private (requires auth)
 */
router.post('/:id/portfolio', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { selections } = req.body;
    const userWallet = req.user.wallet_address;
    
    const parsedId = parseInt(id, 10);
    if (isNaN(parsedId)) {
      return res.status(400).json({ error: 'Invalid contest ID' });
    }
    
    // Validate selections
    if (!Array.isArray(selections) || selections.length === 0) {
      return res.status(400).json({
        error: 'invalid_selections',
        message: 'Portfolio selections must be a non-empty array'
      });
    }
    
    // Get contest to check if user can update portfolio
    const contest = await getAndValidateContest(parsedId);
    if (!contest) {
      return res.status(404).json({ error: 'Contest not found' });
    }
    
    // Check if contest allows portfolio updates
    if (contest.status !== 'pending' && contest.status !== 'active') {
      return res.status(400).json({
        error: 'invalid_contest_status',
        message: `Cannot update portfolio for contest with status "${contest.status}"`,
        status: contest.status
      });
    }
    
    // Check if user is participating in the contest
    const participation = await prisma.contest_participants.findFirst({
      where: {
        contest_id: parsedId,
        wallet_address: userWallet
      }
    });
    
    if (!participation) {
      return res.status(403).json({
        error: 'not_participating',
        message: 'You must be a participant to create a portfolio'
      });
    }
    
    // Validate portfolio selections against allowed buckets
    const validation = validatePortfolioSelections(selections, contest.allowed_buckets);
    if (!validation.isValid) {
      return res.status(400).json({
        error: 'invalid_portfolio',
        message: 'Invalid portfolio selections',
        errors: validation.errors
      });
    }
    
    // Check if tokens exist in database
    const tokenIds = selections.map(s => s.token_id);
    const tokens = await prisma.tokens.findMany({
      where: {
        id: { in: tokenIds }
      }
    });
    
    if (tokens.length !== tokenIds.length) {
      const foundIds = tokens.map(t => t.id);
      const missingIds = tokenIds.filter(id => !foundIds.includes(id));
      
      return res.status(400).json({
        error: 'invalid_tokens',
        message: 'One or more tokens not found',
        missing_tokens: missingIds
      });
    }
    
    // Create or update portfolio
    const portfolio = await updateUserPortfolio(parsedId, userWallet, selections);
    
    // Track analytics
    portfolioLogger.analytics.trackEvent('portfolio_update', {
      contestId: parsedId,
      userWallet,
      tokenCount: selections.length
    });
    
    portfolioLogger.info(`User ${userWallet} updated portfolio for contest ${parsedId}`, {
      contestId: parsedId,
      userWallet,
      tokenCount: selections.length
    });
    
    res.json({
      portfolio,
      message: 'Portfolio updated successfully'
    });
  } catch (error) {
    portfolioLogger.error('Failed to update portfolio:', error);
    res.status(500).json({ error: 'Failed to update portfolio', message: error.message });
  }
});

/**
 * @route GET /api/contests/:id/portfolio/:wallet
 * @description Get a user's portfolio for a contest
 * @access Private (requires auth)
 */
router.get('/:id/portfolio/:wallet', requireAuth, async (req, res) => {
  try {
    const { id, wallet } = req.params;
    const userWallet = req.user.wallet_address;
    
    const parsedId = parseInt(id, 10);
    if (isNaN(parsedId)) {
      return res.status(400).json({ error: 'Invalid contest ID' });
    }
    
    // Check if contest exists
    const contest = await getAndValidateContest(parsedId);
    if (!contest) {
      return res.status(404).json({ error: 'Contest not found' });
    }
    
    // Check if requesting user is either:
    // 1. The owner of the portfolio
    // 2. An admin/superadmin
    // 3. The contest is completed (anyone can view portfolios of completed contests)
    const isAdmin = ['admin', 'superadmin'].includes(req.user.role);
    const isOwner = userWallet === wallet;
    const isCompleted = contest.status === 'completed';
    
    if (!isAdmin && !isOwner && !isCompleted) {
      return res.status(403).json({
        error: 'unauthorized',
        message: 'You cannot view this portfolio'
      });
    }
    
    // Get portfolio
    const portfolio = await prisma.contest_portfolios.findMany({
      where: {
        contest_id: parsedId,
        wallet_address: wallet
      },
      include: {
        tokens: {
          select: {
            id: true,
            symbol: true,
            name: true,
            image_url: true,
            price: true,
            price_change_24h: true
          }
        }
      }
    });
    
    // Check if portfolio exists
    if (!portfolio || portfolio.length === 0) {
      return res.status(404).json({
        error: 'portfolio_not_found',
        message: 'Portfolio not found for this wallet in this contest'
      });
    }
    
    // Get participant info
    const participant = await prisma.contest_participants.findFirst({
      where: {
        contest_id: parsedId,
        wallet_address: wallet
      }
    });
    
    // Format response
    const formattedPortfolio = portfolio.map(item => ({
      token_id: item.token_id,
      weight: item.weight,
      token: item.tokens
    }));
    
    res.json({
      wallet_address: wallet,
      contest_id: parsedId,
      initial_balance: participant?.initial_balance || "0",
      current_balance: participant?.current_balance || "0",
      rank: participant?.rank || 0,
      portfolio: formattedPortfolio
    });
  } catch (error) {
    portfolioLogger.error('Failed to fetch portfolio:', error);
    res.status(500).json({ error: 'Failed to fetch portfolio', message: error.message });
  }
});

export default router;