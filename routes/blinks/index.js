// routes/blinks/index.js

/**
 * Blinks implementation using Dialect's Blinks Provider & Registry
 *
 * @author BranchManager69
 * @version 1.10.0
 * @created 2025-04-29
 * @updated 2025-05-11
 */

import express from 'express';
import * as crypto from 'crypto';
import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { createMemoInstruction } from '@solana/spl-memo';
import { logApi } from '../../utils/logger-suite/logger.js';
import { prisma } from '../../config/prisma.js';
import { solanaEngine } from '../../services/solana-engine/index.js';

// Import Dialect Service
import dialectService from '../../services/dialect/index.js';

// Config
import { config } from '../../config/config.js';

// Get wallet address of the DegenDuel Treasury
const DEGENDUEL_TREASURY_ADDRESS = config.degenduel_treasury_wallet;
logApi.info('🏦 DegenDuel Treasury address:', DEGENDUEL_TREASURY_ADDRESS);

// Initialize Dialect Service if enabled
if (config.services.dialect_service) {
  try {
    // Initialize the service - it will be started automatically by the service manager
    dialectService.initialize().then(initialized => {
      if (initialized) {
        logApi.info('✅ Dialect Service initialized successfully for Blinks');
      } else {
        logApi.warn('⚠️ Dialect Service initialization failed, some Blinks functionality may be limited');
      }
    });
  } catch (error) {
    logApi.error('Failed to initialize Dialect Service for Blinks', { error });
  }
}

// Import auth router
import authRouter from './auth.js';

// Blinks router
const router = express.Router();

// Mount auth router
router.use('/auth', authRouter);

/* HELPERS */

/**
 * Helper function to build a transaction for Solana Actions
 * 
 * @param {PublicKey} feePayer - The user's public key who will pay the transaction fee
 * @param {Array<TransactionInstruction>} instructions - Array of transaction instructions
 * @returns {Promise<{transaction: Transaction, blockhash: string, lastValidBlockHeight: number}>}
 */
async function buildActionTransaction(feePayer, instructions) {
  try {
    // Get the latest blockhash
    const { blockhash, lastValidBlockHeight } = await solanaEngine.executeConnectionMethod('getLatestBlockhash');
    
    // Create a new transaction
    const transaction = new Transaction({
      feePayer,
      blockhash,
      lastValidBlockHeight
    });
    
    // Add all instructions
    transaction.add(...instructions);
    
    return {
      transaction,
      blockhash,
      lastValidBlockHeight
    };
  } catch (error) {
    logApi.error('Error building action transaction', { error });
    throw new Error(`Failed to build transaction: ${error.message}`);
  }
}

/* Protocol Headers */

// Add Dialect Actions protocol headers
const setupActionProtocolHeaders = (req, res, next) => {
  // Add only the required Dialect protocol headers
  res.setHeader('X-Action-Version', '1');
  res.setHeader('X-Blockchain-Ids', 'solana');

  // Skip OPTIONS handling - let NGINX handle it
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  next();
};

// Apply protocol headers to all Actions routes (no CORS headers, let NGINX handle it)
router.use(setupActionProtocolHeaders);

/* ACTIONS ROUTES */

/**
 * GET /api/blinks/join-contest
 *
 * Returns metadata about the join contest action
 * Uses Dialect Blinks registry if available
 */
router.get('/join-contest', async (req, res) => {
  try {
    // Explicitly remove any CORS headers that might have been set by middleware
    // This ensures NGINX is solely responsible for CORS headers
    res.removeHeader('Access-Control-Allow-Origin');
    res.removeHeader('Access-Control-Allow-Methods');
    res.removeHeader('Access-Control-Allow-Headers');
    res.removeHeader('Access-Control-Allow-Credentials');

    // First check if Dialect service is initialized
    if (config.services.dialect_service && dialectService.initialized) {
      try {
        // Get the blink from Dialect registry
        const blink = await dialectService.getBlink('join-contest');

        // If found in registry, return the metadata
        if (blink) {
          logApi.info('Found join-contest blink in Dialect registry, using registered metadata');
          return res.json({
            name: blink.name,
            description: blink.description,
            icon: blink.iconUrl || "https://degenduel.me/images/logo192.png",
            label: "Join Contest",
            parameters: blink.parameters || {
              account: {
                type: "string",
                description: "Wallet address of the user joining the contest",
                required: true
              },
              contest_id: {
                type: "string",
                description: "Contest ID to join",
                required: true
              },
              referrer: {
                type: "string",
                description: "Wallet address of the referrer",
                required: false
              }
            }
          });
        }
      } catch (error) {
        // Log error but continue with fallback
        logApi.warn('Error fetching join-contest blink from Dialect registry', { error });
      }
    }

    // Fallback to hardcoded metadata if Dialect registry is not available or fails
    logApi.info('Using fallback metadata for join-contest blink');

    // Return standard metadata for the action
    res.json({
      name: "Join Contest",
      description: "Join a contest on DegenDuel with an AI-selected portfolio",
      icon: "https://degenduel.me/images/logo192.png",
      label: "Join Contest",
      parameters: {
        account: {
          type: "string",
          description: "Wallet address of the user joining the contest",
          required: true
        },
        contest_id: {
          type: "string",
          description: "Contest ID to join",
          required: true
        },
        referrer: {
          type: "string",
          description: "Wallet address of the referrer",
          required: false
        }
      }
    });
  } catch (error) {
    logApi.error('Error fetching join contest action metadata', { error });
    res.status(500).json({ error: 'Failed to fetch action metadata' });
  }
});

/**
 * Process contest entry after validation
 *
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @param {string} account - User's wallet address
 * @param {string|number} contest_id - Contest ID
 * @param {PublicKey} userPubkey - User's public key
 * @param {string} contestWalletAddress - Contest wallet address
 * @param {number} entryFee - Contest entry fee
 * @param {object} contestData - Contest data object
 * @returns {object} Express response
 */
async function processContestEntry(req, res, account, contest_id, userPubkey, contestWalletAddress, entryFee, contestData) {
  try {
    // Get or generate portfolio for user
    let portfolio;
    let portfolioSource = "previous"; // Track source for analytics

    // First, try to get the user's most recent contest portfolio
    const recentPortfolio = await prisma.contest_portfolios.findMany({
      where: {
        users: {
          wallet_address: account
        }
      },
      include: {
        tokens: {
          select: {
            address: true,
            symbol: true,
            name: true
          }
        }
      },
      orderBy: {
        created_at: 'desc'
      },
      take: 10 // Get several to ensure we get enough unique tokens
    });

    if (recentPortfolio && recentPortfolio.length > 0) {
      // Process user's previous portfolio selections
      const tokenWeights = {};

      // Count token occurrences to find favorites
      recentPortfolio.forEach(entry => {
        const tokenAddress = entry.tokens.address;
        if (!tokenWeights[tokenAddress]) {
          tokenWeights[tokenAddress] = {
            weight: 0,
            count: 0,
            address: tokenAddress,
            symbol: entry.tokens.symbol,
            name: entry.tokens.name
          };
        }
        tokenWeights[tokenAddress].weight += entry.weight;
        tokenWeights[tokenAddress].count += 1;
      });

      // Convert to array and normalize weights to total 100%
      const tokens = Object.values(tokenWeights);
      const totalWeight = tokens.reduce((sum, token) => sum + token.weight, 0);

      portfolio = {
        tokens: tokens.map(token => ({
          contractAddress: token.address,
          weight: Math.round((token.weight / totalWeight) * 100),
          symbol: token.symbol || null,
          name: token.name || null
        }))
      };

      // Ensure weights sum to exactly 100%
      const actualTotal = portfolio.tokens.reduce((sum, token) => sum + token.weight, 0);
      if (actualTotal !== 100 && portfolio.tokens.length > 0) {
        // Add/subtract the difference from the highest weight token
        const sortedTokens = [...portfolio.tokens].sort((a, b) => b.weight - a.weight);
        sortedTokens[0].weight += (100 - actualTotal);
      }
    } else {
      // No previous portfolio, generate an "AI portfolio"
      portfolioSource = "ai";

      // Get trending tokens for the AI portfolio - reduced to 4 tokens
      const trendingTokens = await prisma.tokens.findMany({
        where: {
          is_active: true
        },
        orderBy: {
          priority_score: 'desc'
        },
        take: 4
      });

      if (trendingTokens.length > 0) {
        // Create a portfolio with trending tokens
        portfolio = {
          tokens: trendingTokens.map((token, index) => {
            // Improved weight distribution: 40-30-20-10
            let weight;
            if (index === 0) weight = 40;      // First token: 40%
            else if (index === 1) weight = 30; // Second token: 30%
            else if (index === 2) weight = 20; // Third token: 20%
            else weight = 10;                  // Fourth token: 10%

            return {
              contractAddress: token.address,
              weight: Math.round(weight),
              symbol: token.symbol || null,
              name: token.name || null
            };
          })
        };

        // Ensure weights sum to exactly 100%
        const actualTotal = portfolio.tokens.reduce((sum, token) => sum + token.weight, 0);
        if (actualTotal !== 100 && portfolio.tokens.length > 0) {
          portfolio.tokens[0].weight += (100 - actualTotal);
        }
      } else {
        // Fallback if no trending tokens found
        return res.status(500).json({
          error: 'Unable to generate portfolio',
          action: "redirect",
          redirect_url: `https://degenduel.me/contest/${contest_id}/select-portfolio?wallet=${account}`
        });
      }
    }

    // Format portfolio details for memo and response
    const portfolioSummary = portfolio.tokens.map(t =>
      `${t.symbol || t.contractAddress.slice(0,4)}...: ${t.weight}%`
    ).join(', ');

    // Generate a unique ID for this specific portfolio entry attempt
    const portfolioId = crypto.randomUUID();

    // Track this blink usage in Dialect if service is enabled
    if (config.services.dialect_service && dialectService.initialized) {
      try {
        // Log the usage in our database (will happen regardless of Dialect registration)
        await prisma.dialect_blinks_usage.create({
          data: {
            blink_id: 'join-contest',
            wallet_address: account,
            success: true,
            metadata: {
              contest_id,
              portfolio_source: portfolioSource,
              tokens: portfolio.tokens.map(t => ({
                address: t.contractAddress,
                weight: t.weight,
                symbol: t.symbol || null
              }))
            }
          }
        });

        // Notify Dialect of this blink usage (if implemented in service)
        try {
          await dialectService.trackBlinkUsage('join-contest', account, {
            contest_id,
            portfolio_source: portfolioSource,
            contest_name: contestData.name
          });
          logApi.info('Successfully tracked Dialect blink usage', {
            blink_id: 'join-contest',
            wallet_address: account,
            contest_id
          });
        } catch (err) {
          // Just log error, don't block the main flow
          logApi.warn('Failed to track Dialect blink usage', {
            error: err.message || 'Unknown error',
            stack: err.stack
          });
        }
      } catch (error) {
        // Log but don't block the main flow
        logApi.warn('Error recording Dialect blink usage', {
          error: error.message || 'Unknown error',
          stack: error.stack
        });
      }
    }

    // --- Create the formatted memo string with Bar Chart ---
    const MAX_BAR_WIDTH = 20; // Max characters for the bar
    const PERCENT_PER_BLOCK = 100 / MAX_BAR_WIDTH; // e.g., 5% if width is 20
    const LABEL_WIDTH = 10; // Width for "SYMBOL: " part (e.g., 8 + 2)
    const BLOCK_CHAR = '█'; // Unicode Full Block

    let memoLines = [];

    // Line 1: Contest Name (ALL CAPS)
    memoLines.push(`${contestData.name.toUpperCase()}`);
    memoLines.push(''); // Blank line for separation

    // Line 2: Portfolio Source Description with Emoji
    const sourceEmoji = portfolioSource === "ai" ? '🤖' : '📊';
    const portfolioSourceDescription = portfolioSource === "ai"
      ? `${sourceEmoji} AI Selection:`
      : `${sourceEmoji} Your Latest Lineup:`;
    memoLines.push(portfolioSourceDescription);

    // Lines 3+: Portfolio Bar Chart
    portfolio.tokens.forEach(token => {
      // Prepare label (Symbol + :), pad to LABEL_WIDTH
      const symbol = token.symbol || token.contractAddress.slice(0, 6); // Use symbol or fallback to short address
      const label = `${symbol}: `.padEnd(LABEL_WIDTH, ' ');

      // Calculate bar length
      const weight = token.weight || 0;
      let numBlocks = 0;
      if (weight > 0) {
        numBlocks = Math.max(1, Math.ceil(weight / PERCENT_PER_BLOCK)); // At least 1 block if > 0%
        numBlocks = Math.min(numBlocks, MAX_BAR_WIDTH); // Cap at max width
      }
      const bar = BLOCK_CHAR.repeat(numBlocks);

      memoLines.push(`${label}${bar}`);
    });
    memoLines.push(''); // Blank line for separation

    // Updated format: CID and Fee on same line, Ref on its own line
    memoLines.push(`CID: ${contest_id} Fee: ${entryFee} SOL`);
    memoLines.push(`Ref: ${portfolioId}`);

    const memoData = memoLines.join('\\n');
    // --- End formatted memo string ---

    // Create a memo instruction with the formatted string
    const memoInstruction = createMemoInstruction(
      memoData,          // First argument: the formatted memo string
      [userPubkey]       // Second argument: array of signers (the user paying the fee)
    );

    // Create a SOL transfer instruction (lamports = SOL * 10^9)
    const lamports = Math.floor(entryFee * 1_000_000_000);
    const transferInstruction = SystemProgram.transfer({
      fromPubkey: userPubkey,
      toPubkey: new PublicKey(contestWalletAddress),
      lamports: lamports
    });

    // Build the transaction using our helper
    const { transaction, blockhash } = await buildActionTransaction(
      userPubkey,
      [transferInstruction, memoInstruction]
    );

    // Serialize transaction to base64
    const serializedTransaction = transaction.serialize({ requireAllSignatures: false }).toString('base64');

    // For demonstration purposes in development, we're creating a mock pending entry
    // In production, we'd use the actual portfolio and transactional data
    try {
      await prisma.pending_contest_entries.create({
        data: {
          wallet_address: account,
          contest_id: parseInt(contest_id),
          portfolio: portfolio, // The actual portfolio object
          portfolio_id: portfolioId, // Store the generated ID to link it
          expires_at: new Date(Date.now() + 3600000), // 1 hour expiration
          status: 'pending'
        }
      });

      logApi.info('Created pending contest entry', { portfolioId, account });
    } catch (error) {
      logApi.warn('Could not create pending contest entry', { error });
      // Continue anyway - this is not fatal
    }

    // Return the transaction for signing in Solana Actions format
    return res.json({
      transaction: serializedTransaction,
      message: `Join contest with ${portfolioSource === "ai" ? "AI generated" : "your latest"} portfolio (${entryFee} SOL)`, // Updated message text
      memo_preview: memoData, // Add the generated memo for preview if desired
      portfolio_summary: portfolioSummary, // Keep original summary for potential non-Action UI use
      portfolio_source: portfolioSource, // Keep source info
      portfolio_tokens: portfolio.tokens.map(t => ({
        address: t.contractAddress,
        weight: t.weight,
        symbol: t.symbol || null
      })),
      blockhash
    });

  } catch (error) {
    // Enhanced error logging with more details
    logApi.error('Error in processContestEntry', {
      error: error.message || 'Unknown error',
      stack: error.stack,
      userId: account,
      contestId: contest_id,
      portfolioSource: portfolioSource || 'unknown'
    });

    // Return a more specific error message if possible
    let errorMessage = 'Failed to process contest entry';
    if (error.message && error.message.includes('portfolio')) {
      errorMessage = 'Failed to create portfolio for contest entry';
    } else if (error.message && error.message.includes('transaction')) {
      errorMessage = 'Failed to create transaction for contest entry';
    }

    return res.status(500).json({
      error: errorMessage,
      info: 'Your entry was not processed. Please try again or try joining through the website.'
    });
  }
}

// Handle POST /join-contest route
router.post('/join-contest', async (req, res) => {
  try {
    // Explicitly remove any CORS headers that might have been set by middleware
    // This ensures NGINX is solely responsible for CORS headers
    res.removeHeader('Access-Control-Allow-Origin');
    res.removeHeader('Access-Control-Allow-Methods');
    res.removeHeader('Access-Control-Allow-Headers');
    res.removeHeader('Access-Control-Allow-Credentials');

    const { account, contest_id } = req.body;

    // Log the request for debugging
    logApi.info('Received join-contest request', {
      account: account ? account.substring(0, 8) + '...' : undefined,
      contest_id
    });

    if (!account || !contest_id) {
      logApi.warn('Missing required parameters in join-contest request');
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
      logApi.warn('Invalid Solana address format in join-contest request', { account });
      return res.status(400).json({ error: 'Invalid Solana address format' });
    }

    // 2. Get contest data in a single step
    let contest;
    let contestIdToUse;

    try {
      // Try to convert contest_id to an integer if it's a string
      const contestIdInt = parseInt(contest_id);
      contestIdToUse = isNaN(contestIdInt) ? contest_id : contestIdInt;

      // Log what we're looking for
      logApi.info('Looking for contest', { contest_id: contestIdToUse });

      // Get the contest data
      contest = await prisma.contests.findUnique({
        where: { id: contestIdToUse }
      });

      logApi.info('Contest lookup result', {
        found: !!contest,
        contest_id: contestIdToUse,
        contest_status: contest?.status || 'unknown'
      });

      if (!contest) {
        return res.status(404).json({ error: 'Contest not found' });
      }

      // Check if contest is in 'pending' status (open for entry)
      if (contest.status !== 'pending') {
        return res.status(400).json({ error: 'Contest is not open for entry' });
      }
    } catch (error) {
      logApi.error('Error checking contest status', { error, contest_id });
      return res.status(500).json({ error: 'Error checking contest status' });
    }

    // 3. Now that we have the contest, get the wallet information
    try {
      // Get the contest wallet information from the contest_wallets table
      const contestWallet = await prisma.contest_wallets.findFirst({
        where: { contest_id: contestIdToUse }
      });

      // Get the entry fee from the contest record (now safely in scope)
      const entryFee = contest.entry_fee || 0.05; // Use contest entry fee or default to 0.05

      // Log wallet lookup information
      logApi.info('Contest wallet lookup', {
        found: !!contestWallet,
        contest_id: contestIdToUse,
        has_wallet_address: !!contestWallet?.wallet_address,
        entry_fee: entryFee
      });

      if (!contestWallet || !contestWallet.wallet_address) {
        // Fallback to treasury wallet if no contest wallet found
        const contestWalletAddress = DEGENDUEL_TREASURY_ADDRESS;
        logApi.info('Using fallback treasury address', { contestWalletAddress });

        // Continue with these values
        return processContestEntry(req, res, account, contest_id, userPubkey, contestWalletAddress, entryFee, contest);
      }

      // Use the actual contest wallet address
      const contestWalletAddress = contestWallet.wallet_address;

      // Continue with the contest entry process
      return processContestEntry(req, res, account, contest_id, userPubkey, contestWalletAddress, entryFee, contest);
    } catch (error) {
      logApi.error('Error getting contest wallet configuration', { error });
      return res.status(500).json({ error: 'Error getting contest wallet configuration' });
    }
  } catch (error) {
    // Single catch block to handle all errors
    logApi.error('Error processing join contest request', { error });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;