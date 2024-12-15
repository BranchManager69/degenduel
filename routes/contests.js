import express from 'express';
import { pool } from '../config/pg-database.js';
import logger from '../utils/logger.js';
import crypto from 'crypto';

const router = express.Router();

class ContestError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'ContestError';
    this.code = code;
    this.details = details;
  }
}

const validateContestEntry = async (client, contestId, wallet) => {
  const contestResult = await client.query(`
    SELECT 
      c.*,
      COUNT(cp.wallet_address) AS current_participants,
      EXISTS(
        SELECT 1 FROM contest_participants 
        WHERE contest_id = c.id AND wallet_address = $2
      ) as is_registered,
      (
        SELECT json_build_object(
          'balance', u.balance,
          'total_contests', u.total_contests,
          'is_banned', u.is_banned
        )
        FROM users u WHERE u.wallet_address = $2
      ) as user_info
    FROM contests c
    LEFT JOIN contest_participants cp ON c.id = cp.contest_id
    WHERE c.id = $1
    GROUP BY c.id
  `, [contestId, wallet]);

  if (contestResult.rows.length === 0) {
    throw new ContestError('Contest not found', 'CONTEST_NOT_FOUND', { contestId });
  }

  const contest = contestResult.rows[0];
  const now = new Date();
  const userInfo = contest.user_info || {};

  // Comprehensive validation
  if (contest.is_registered) {
    throw new ContestError(
      'Already registered for this contest', 
      'ALREADY_REGISTERED',
      { contestId, wallet }
    );
  }

  if (new Date(contest.start_time) <= now) {
    throw new ContestError(
      'Contest has already started', 
      'CONTEST_STARTED',
      { 
        startTime: contest.start_time,
        currentTime: now,
        timeElapsed: `${Math.floor((now - new Date(contest.start_time)) / 1000 / 60)} minutes`
      }
    );
  }

  if (contest.status !== 'pending' && contest.status !== 'active') {
    throw new ContestError(
      'Contest is not open for registration', 
      'CONTEST_NOT_OPEN',
      { status: contest.status }
    );
  }

  if (parseInt(contest.current_participants) >= parseInt(contest.settings.max_participants)) {
    throw new ContestError(
      'Contest is full', 
      'CONTEST_FULL',
      { 
        maxParticipants: contest.settings.max_participants,
        currentParticipants: contest.current_participants
      }
    );
  }

  if (userInfo.is_banned) {
    throw new ContestError(
      'Account is banned from contests', 
      'USER_BANNED'
    );
  }

  if (contest.entry_fee > userInfo.balance) {
    throw new ContestError(
      'Insufficient funds for entry fee', 
      'INSUFFICIENT_FUNDS',
      {
        required: contest.entry_fee,
        available: userInfo.balance
      }
    );
  }

  return {
    contest,
    userInfo
  };
};

const validatePortfolio = async (client, portfolio, contestId) => {
  // Basic structure validation
  if (!Array.isArray(portfolio)) {
    throw new ContestError(
      'Invalid portfolio format', 
      'INVALID_PORTFOLIO_FORMAT',
      { expected: 'array', received: typeof portfolio }
    );
  }

  if (portfolio.length === 0) {
    throw new ContestError(
      'Portfolio cannot be empty', 
      'EMPTY_PORTFOLIO'
    );
  }

  if (portfolio.length > 10) {
    throw new ContestError(
      'Too many tokens in portfolio', 
      'EXCESS_TOKENS',
      { 
        maximum: 10, 
        received: portfolio.length,
        tokens: portfolio.map(p => p.symbol)
      }
    );
  }

  // Weight validation
  const totalWeight = portfolio.reduce((sum, { weight }) => {
    if (!Number.isInteger(weight)) {
      throw new ContestError(
        'Portfolio weights must be integers', 
        'NON_INTEGER_WEIGHT',
        { token: symbol, weight }
      );
    }
    return sum + weight;
  }, 0);

  if (totalWeight !== 100) {
    throw new ContestError(
      'Portfolio weights must sum to 100%', 
      'INVALID_TOTAL_WEIGHT',
      { 
        expected: 100, 
        received: totalWeight,
        weights: portfolio.map(p => ({ symbol: p.symbol, weight: p.weight }))
      }
    );
  }

  // Individual weight validation
  for (const { symbol, weight } of portfolio) {
    if (weight < 5 || weight > 50) {
      throw new ContestError(
        'Invalid token weight', 
        'INVALID_TOKEN_WEIGHT',
        {
          token: symbol,
          weight,
          limits: { min: 5, max: 50 }
        }
      );
    }
  }

  // Duplicate token check
  const symbols = portfolio.map(p => p.symbol);
  const uniqueSymbols = new Set(symbols);
  if (uniqueSymbols.size !== portfolio.length) {
    throw new ContestError(
      'Duplicate tokens in portfolio', 
      'DUPLICATE_TOKENS',
      {
        duplicates: symbols.filter(
          (s, i) => symbols.indexOf(s) !== i
        )
      }
    );
  }

  // Token existence and eligibility validation
  const tokenResult = await client.query(`
    WITH contest_buckets AS (
      SELECT DISTINCT tb.id
      FROM token_buckets tb
      JOIN contest_token_buckets ctb ON tb.id = ctb.bucket_id
      WHERE ctb.contest_id = $1
    )
    SELECT 
      t.id,
      t.symbol,
      t.name,
      t.is_active,
      EXISTS(
        SELECT 1 
        FROM token_bucket_memberships tbm
        WHERE tbm.token_id = t.id
        AND tbm.bucket_id IN (SELECT id FROM contest_buckets)
      ) as is_eligible
    FROM tokens t
    WHERE t.symbol = ANY($2)
  `, [contestId, symbols]);

  // Validate all tokens exist and are eligible
  const validTokens = new Map(tokenResult.rows.map(t => [t.symbol, t]));
  const invalidTokens = [];
  const ineligibleTokens = [];

  for (const symbol of symbols) {
    const token = validTokens.get(symbol);
    if (!token) {
      invalidTokens.push(symbol);
    } else if (!token.is_active) {
      ineligibleTokens.push({
        symbol,
        reason: 'Token is not active'
      });
    } else if (!token.is_eligible) {
      ineligibleTokens.push({
        symbol,
        reason: 'Token not eligible for this contest'
      });
    }
  }

  if (invalidTokens.length > 0) {
    throw new ContestError(
      'Invalid tokens in portfolio', 
      'INVALID_TOKENS',
      {
        invalidTokens,
        suggestion: 'Use GET /tokens to see available tokens'
      }
    );
  }

  if (ineligibleTokens.length > 0) {
    throw new ContestError(
      'Ineligible tokens in portfolio', 
      'INELIGIBLE_TOKENS',
      { ineligibleTokens }
    );
  }

  return {
    validatedPortfolio: portfolio.map(p => ({
      ...p,
      tokenId: validTokens.get(p.symbol).id
    }))
  };
};

const processEntryFee = async (client, wallet, contestId, entryFee) => {
  // Start with optimistic locking for balance check
  const balanceResult = await client.query(`
    SELECT balance 
    FROM users 
    WHERE wallet_address = $1 
    FOR UPDATE
  `, [wallet]);

  const currentBalance = balanceResult.rows[0].balance;
  if (currentBalance < entryFee) {
    throw new ContestError(
      'Insufficient funds for entry fee', 
      'INSUFFICIENT_FUNDS',
      {
        required: entryFee,
        available: currentBalance
      }
    );
  }

  // Process the fee
  await client.query(`
    UPDATE users 
    SET 
      balance = balance - $1,
      total_contests = total_contests + 1
    WHERE wallet_address = $2
  `, [entryFee, wallet]);

  // Record the transaction
  const txnResult = await client.query(`
    INSERT INTO transactions (
      wallet_address,
      type,
      amount,
      contest_id,
      description
    ) VALUES (
      $1, 'CONTEST_ENTRY', $2, $3, 'Contest entry fee'
    ) RETURNING id
  `, [wallet, entryFee, contestId]);

  return {
    transactionId: txnResult.rows[0].id,
    newBalance: currentBalance - entryFee
  };
};


/**
 * @swagger
 * tags:
 *   name: Contests
 *   description: API endpoints for managing trading contests
 */

/*********************
  CONTEST ENDPOINTS  |
**********************/


/**
 * @swagger
 * /api/contests:
 *   get:
 *     summary: Get contests with optional filters
 *     tags: [Contests]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, active, completed]
 *         description: Filter contests by status.
 *       - in: query
 *         name: wallet
 *         schema:
 *           type: string
 *         description: User's wallet address to filter participation.
 *     responses:
 *       200:
 *         description: List of contests.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                   name:
 *                     type: string
 *                   description:
 *                     type: string
 *                   start_time:
 *                     type: string
 *                     format: date-time
 *                   end_time:
 *                     type: string
 *                     format: date-time
 *                   participant_count:
 *                     type: integer
 *                   is_participating:
 *                     type: boolean
 *       500:
 *         description: Server error.
 */
router.get('/', async (req, res) => {
  try {
    const { status, wallet } = req.query;
    const filters = [];
    const values = [];
    let walletFilter = 'false AS is_participating';

    if (status) {
      filters.push('c.status = $1');
      values.push(status);
    }

    if (wallet) {
      walletFilter = `
        EXISTS (
          SELECT 1 FROM contest_participants cp
          WHERE cp.contest_id = c.id AND cp.wallet_address = $${values.length + 1}
        ) AS is_participating
      `;
      values.push(wallet);
    }

    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const query = `
      SELECT c.*, 
             COUNT(cp.wallet_address) AS participant_count,
             ${walletFilter}
      FROM contests c
      LEFT JOIN contest_participants cp ON c.id = cp.contest_id
      ${whereClause}
      GROUP BY c.id
      ORDER BY c.start_time ASC
    `;

    const result = await pool.query(query, values);
    res.json(result.rows);
  } catch (error) {
    logger.error('Failed to fetch contests:', error);
    res.status(500).json({ error: 'Failed to fetch contests.' });
  }
});

/**
 * @swagger
 * /api/contests/{contestId}/enter:
 *   post:
 *     summary: Enter a contest with initial portfolio
 *     description: |
 *       Enters a contest by:
 *       1. Validating user eligibility
 *       2. Processing entry fee
 *       3. Registering initial portfolio
 *       
 *       Entry requirements:
 *       - Contest must be open for registration
 *       - User must not be already registered
 *       - Portfolio weights must sum to 100%
 *       - Individual weights: 5% minimum, 50% maximum
 *       - Maximum 10 tokens per portfolio
 *       - Sufficient balance for entry fee
 *     tags: [Contests]
 *     parameters:
 *       - in: path
 *         name: contestId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - wallet
 *               - portfolio
 *             properties:
 *               wallet:
 *                 type: string
 *                 description: User's wallet address
 *               portfolio:
 *                 type: array
 *                 minItems: 1
 *                 maxItems: 10
 *                 items:
 *                   type: object
 *                   required:
 *                     - symbol
 *                     - weight
 *                   properties:
 *                     symbol:
 *                       type: string
 *                     weight:
 *                       type: integer
 *                       minimum: 5
 *                       maximum: 50
 *     responses:
 *       201:
 *         description: Successfully entered contest
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     contestId:
 *                       type: string
 *                     wallet:
 *                       type: string
 *                     portfolio:
 *                       type: array
 *                     entryFee:
 *                       type: number
 *                     transactionId:
 *                       type: string
 *                     entryTime:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 code:
 *                   type: string
 *                 details:
 *                   type: object
 *       401:
 *         description: Authentication error
 *       403:
 *         description: Contest not joinable
 *       409:
 *         description: Already registered
 *       422:
 *         description: Invalid portfolio or insufficient funds
 *       500:
 *         description: Server error
 */
router.post('/:contestId/enter', async (req, res) => {
  const { contestId } = req.params;
  const { wallet, portfolio } = req.body;
  let client;
  
  // Request ID for tracking
  const requestId = crypto.randomUUID();
    
  try {
    // Debug log the incoming request
    console.log('Received request:', {
      requestId,
      contestId,
      wallet,
      portfolio
    });

    // Input validation
    if (!wallet || typeof wallet !== 'string') {
      console.log('Wallet validation failed:', { wallet });
      throw new ContestError(
        'Invalid wallet address format',
        'INVALID_WALLET_FORMAT',
        { received: typeof wallet }
      );
    }

    if (!portfolio || !Array.isArray(portfolio)) {
      console.log('Portfolio validation failed:', { portfolio });
      throw new ContestError(
        'Portfolio is required',
        'MISSING_PORTFOLIO',
        { received: typeof portfolio }
      );
    }

    client = await pool.connect();
    console.log('DB client connected');
    
    // Start transaction with serializable isolation
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');

    logger.info({
      message: 'Starting contest entry process',
      requestId,
      contestId,
      wallet: wallet.slice(0, 8) + '...' // Log partial wallet for privacy
    });

    // Step 1: Validate contest and user eligibility
    const { contest, userInfo } = await validateContestEntry(
      client, 
      contestId, 
      wallet
    );

    logger.debug({
      message: 'Contest entry validation passed',
      requestId,
      contestId,
      currentParticipants: contest.current_participants
    });

    // Step 2: Validate portfolio
    const { validatedPortfolio } = await validatePortfolio(
      client,
      portfolio,
      contestId
    );

    logger.debug({
      message: 'Portfolio validation passed',
      requestId,
      tokenCount: validatedPortfolio.length
    });

    // Step 3: Process entry fee
    const { transactionId, newBalance } = await processEntryFee(
      client,
      wallet,
      contestId,
      contest.entry_fee
    );

    logger.debug({
      message: 'Entry fee processed',
      requestId,
      transactionId
    });

    // Step 4: Register participation with retry logic for race conditions
    try {
      await client.query(`
        INSERT INTO contest_participants (
          contest_id, 
          wallet_address,
          entry_time,
          entry_transaction_id
        ) VALUES ($1, $2, NOW(), $3)
      `, [contestId, wallet, transactionId]);
    } catch (err) {
      if (err.code === '23505') { // Unique violation
        throw new ContestError(
          'Race condition: Contest entry already exists',
          'CONCURRENT_ENTRY',
          { contestId, wallet }
        );
      }
      throw err;
    }

    // Step 5: Insert portfolio entries
    for (const { tokenId, weight } of validatedPortfolio) {
      await client.query(`
        INSERT INTO contest_portfolios (
          contest_id,
          wallet_address,
          token_id,
          weight,
          created_at
        ) VALUES ($1, $2, $3, $4, NOW())
      `, [contestId, wallet, tokenId, weight]);
    }

    // Step 6: Update contest statistics
    await client.query(`
      UPDATE contests
      SET 
        current_prize_pool = current_prize_pool + $1,
        participant_count = participant_count + 1,
        last_entry_time = NOW()
      WHERE id = $2
    `, [contest.entry_fee, contestId]);

    // Commit transaction
    await client.query('COMMIT');

    logger.info({
      message: 'Contest entry completed successfully',
      requestId,
      contestId,
      wallet: wallet.slice(0, 8) + '...',
      transactionId
    });

    // Send success response
    res.status(201).json({
      success: true,
      message: 'Successfully entered contest',
      data: {
        requestId,
        contestId,
        wallet,
        portfolio: validatedPortfolio.map(({ symbol, weight }) => ({
          symbol,
          weight
        })),
        entryFee: contest.entry_fee,
        newBalance,
        transactionId,
        entryTime: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      code: error.code,
      stack: error.stack,
      details: error.details
    });
    
    // Rollback transaction if needed
    if (client) {
      await client.query('ROLLBACK');
    }

    logger.error({
      message: 'Contest entry failed',
      requestId,
      error: {
        name: error.name,
        message: error.message,
        code: error.code,
        details: error.details
      },
      contestId,
      wallet: wallet?.slice(0, 8) + '...'
    });

    // Handle different error types
    if (error instanceof ContestError) {
      const statusCodes = {
        'INVALID_WALLET_FORMAT': 400,
        'MISSING_PORTFOLIO': 400,
        'CONTEST_NOT_FOUND': 404,
        'ALREADY_REGISTERED': 409,
        'CONTEST_STARTED': 403,
        'CONTEST_NOT_OPEN': 403,
        'CONTEST_FULL': 403,
        'USER_BANNED': 403,
        'INSUFFICIENT_FUNDS': 422,
        'INVALID_PORTFOLIO_FORMAT': 400,
        'EMPTY_PORTFOLIO': 400,
        'EXCESS_TOKENS': 400,
        'NON_INTEGER_WEIGHT': 400,
        'INVALID_TOTAL_WEIGHT': 400,
        'INVALID_TOKEN_WEIGHT': 400,
        'DUPLICATE_TOKENS': 400,
        'INVALID_TOKENS': 422,
        'INELIGIBLE_TOKENS': 422,
        'CONCURRENT_ENTRY': 409
      };

      res.status(statusCodes[error.code] || 500).json({
        success: false,
        error: error.message,
        code: error.code,
        details: error.details,
        requestId
      });
    } else {
      // Unexpected errors
      res.status(500).json({
        success: false,
        error: 'An unexpected error occurred',
        requestId
      });
    }
  } finally {
    // Release client back to pool
    if (client) {
      client.release();
    }
  }
});


/**
 * @swagger
 * /api/contests/summary:
 *   get:
 *     summary: Get summarized contest data with participation details
 *     tags: [Contests]
 *     parameters:
 *       - in: query
 *         name: wallet
 *         schema:
 *           type: string
 *         description: User's wallet address to check participation status
 *     responses:
 *       200:
 *         description: List of contests with summary details
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                   name:
 *                     type: string
 *                   start_time:
 *                     type: string
 *                     format: date-time
 *                   end_time:
 *                     type: string
 *                     format: date-time
 *                   participant_count:
 *                     type: integer
 *                   is_participating:
 *                     type: boolean
 *       500:
 *         description: Server error
 */
router.get('/summary', async (req, res) => {
  try {
    const { wallet } = req.query;

    const query = `
      SELECT c.*, 
             COUNT(cp.wallet_address) AS participant_count,
             CASE 
               WHEN $1 IS NOT NULL AND COUNT(cp.wallet_address) > 0 THEN TRUE
               ELSE FALSE
             END AS is_participating
      FROM contests c
      LEFT JOIN contest_participants cp ON c.id = cp.contest_id
      GROUP BY c.id
      ORDER BY c.start_time ASC
    `;

    const result = await pool.query(query, [wallet || null]);
    res.json(result.rows);
  } catch (error) {
    logger.error('Get contest summaries failed:', error);
    res.status(500).json({ error: error.message });
  }
});


/**
 * @swagger
 * /api/contests/active:
 *   get:
 *     summary: Get all active contests
 *     tags: [Contests]
 *     parameters:
 *       - in: query
 *         name: wallet
 *         schema:
 *           type: string
 *         description: User's wallet address to check participation status
 *     responses:
 *       200:
 *         description: List of active contests
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                   name:
 *                     type: string
 *                   start_time:
 *                     type: string
 *                     format: date-time
 *                   end_time:
 *                     type: string
 *                     format: date-time
 *                   participant_count:
 *                     type: integer
 *                   is_participating:
 *                     type: boolean
 *       500:
 *         description: Server error
 */
router.get('/active', async (req, res) => {
  try {
    const { wallet } = req.query;

    const query = `
      SELECT c.*, 
             COUNT(cp.wallet_address) AS participant_count,
             CASE 
               WHEN $1 IS NOT NULL AND COUNT(cp.wallet_address) > 0 THEN TRUE
               ELSE FALSE
             END AS is_participating
      FROM contests c
      LEFT JOIN contest_participants cp ON c.id = cp.contest_id AND cp.wallet_address = $1
      WHERE c.start_time <= CURRENT_TIMESTAMP AND c.end_time > CURRENT_TIMESTAMP
      GROUP BY c.id
      ORDER BY c.start_time ASC
    `;

    const result = await pool.query(query, [wallet || null]);
    res.json(result.rows);
  } catch (error) {
    logger.error('Get active contests failed:', error);
    res.status(500).json({ error: 'Failed to fetch active contests.' });
  }
});


/**
 * @swagger
 * /api/contests/{contestId}:
 *   get:
 *     summary: Get contest details by ID
 *     tags: [Contests]
 *     parameters:
 *       - in: path
 *         name: contestId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the contest
 *     responses:
 *       200:
 *         description: Contest details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 name:
 *                   type: string
 *                 start_time:
 *                   type: string
 *                   format: date-time
 *                 end_time:
 *                   type: string
 *                   format: date-time
 *                 participant_count:
 *                   type: integer
 *                 allowed_tokens:
 *                   type: array
 *                   items:
 *                     type: string
 *       404:
 *         description: Contest not found
 *       500:
 *         description: Server error
 */
router.get('/:contestId', async (req, res) => {
  const { wallet } = req.query;
  const { contestId } = req.params;

  try {
    const query = `
      SELECT c.*, 
             COUNT(cp.wallet_address) AS participant_count,
             CASE 
               WHEN $1 IS NOT NULL AND COUNT(cp.wallet_address) > 0 THEN TRUE
               ELSE FALSE
             END AS is_participating,
             json_agg(DISTINCT t.symbol) AS allowed_tokens
      FROM contests c
      LEFT JOIN contest_participants cp ON c.id = cp.contest_id AND cp.wallet_address = $1
      LEFT JOIN token_bucket_memberships tbm ON c.id = tbm.bucket_id
      LEFT JOIN tokens t ON tbm.token_id = t.id
      WHERE c.id = $2
      GROUP BY c.id
    `;

    const result = await pool.query(query, [wallet || null, contestId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Contest not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Get contest failed:', error);
    res.status(500).json({ error: error.message });
  }
});



/**
 * @swagger
 * /api/contests:
 *   post:
 *     summary: Create a new contest
 *     tags: [Contests]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - start_time
 *               - end_time
 *             properties:
 *               name:
 *                 type: string
 *                 description: The name of the contest
 *               description:
 *                 type: string
 *                 description: Description of the contest
 *               start_time:
 *                 type: string
 *                 format: date-time
 *                 description: Start time of the contest
 *               end_time:
 *                 type: string
 *                 format: date-time
 *                 description: End time of the contest
 *               entry_fee:
 *                 type: number
 *                 description: Entry fee for the contest
 *               prize_pool:
 *                 type: number
 *                 description: Total prize pool for the contest
 *               settings:
 *                 type: object
 *                 description: Contest-specific settings
 *     responses:
 *       201:
 *         description: Contest created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 *                 name:
 *                   type: string
 *                 description:
 *                   type: string
 *                 start_time:
 *                   type: string
 *                 end_time:
 *                   type: string
 *                 entry_fee:
 *                   type: number
 *                 prize_pool:
 *                   type: number
 *                 settings:
 *                   type: object
 *       400:
 *         description: Missing required fields
 *       500:
 *         description: Failed to create contest
 */
router.post('/', async (req, res) => {
  const { name, description, start_time, end_time, entry_fee, prize_pool, settings } = req.body;

  if (!name || !start_time || !end_time) {
    return res.status(400).json({ error: 'Name, start_time, and end_time are required.' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const query = `
      INSERT INTO contests (name, description, start_time, end_time, entry_fee, prize_pool, settings)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *;
    `;
    const values = [
      name,
      description || null,
      start_time,
      end_time,
      entry_fee || 0,
      prize_pool || 0,
      settings || {}
    ];

    const result = await client.query(query, values);
    await client.query('COMMIT');

    res.status(201).json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating contest:', error);
    res.status(500).json({ error: 'Failed to create contest.' });
  } finally {
    client.release();
  }
});





/**
 * @swagger
 * /api/contests/{contestId}/leaderboard:
 *   get:
 *     summary: Get contest leaderboard
 *     tags: [Contests]
 *     parameters:
 *       - in: path
 *         name: contestId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the contest
 *     responses:
 *       200:
 *         description: Contest leaderboard
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   wallet_address:
 *                     type: string
 *                   nickname:
 *                     type: string
 *                   total_pl:
 *                     type: number
 *                   tokens_traded:
 *                     type: integer
 *                   best_trade:
 *                     type: number
 *                   rank:
 *                     type: integer
 *       500:
 *         description: Server error
 */
router.get('/:contestId/leaderboard', async (req, res) => {
  try {
    const result = await pool.query(`
      WITH user_performance AS (
        SELECT 
          cp.wallet_address,
          u.nickname,
          SUM(ctp.profit_loss) as total_pl,
          COUNT(DISTINCT ctp.token_id) as tokens_traded,
          MAX(ctp.profit_loss) as best_trade
        FROM contest_participants cp
        JOIN users u ON cp.wallet_address = u.wallet_address
        LEFT JOIN contest_token_performance ctp 
          ON cp.contest_id = ctp.contest_id 
          AND cp.wallet_address = ctp.wallet_address
        WHERE cp.contest_id = $1
        GROUP BY cp.wallet_address, u.nickname
      )
      SELECT 
        wallet_address,
        nickname,
        total_pl,
        tokens_traded,
        best_trade,
        RANK() OVER (ORDER BY total_pl DESC) as rank
      FROM user_performance
      ORDER BY total_pl DESC
    `, [req.params.contestId]);
    res.json(result.rows);
  } catch (error) {
    logger.error('Get contest leaderboard failed:', error);
    res.status(500).json({ error: error.message });
  }
});


/**
 * @swagger
 * /api/contests/{contestId}:
 *   delete:
 *     summary: Delete a contest
 *     tags: [Contests]
 *     parameters:
 *       - in: path
 *         name: contestId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the contest to delete
 *     responses:
 *       200:
 *         description: Contest deleted successfully
 *       404:
 *         description: Contest not found
 *       500:
 *         description: Server error
 */
router.delete('/:contestId', async (req, res) => {
  const { contestId } = req.params;

  try {
    const result = await pool.query(`
      DELETE FROM contests
      WHERE id = $1
      RETURNING *;
    `, [contestId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Contest not found.' });
    }

    res.json({ success: true, deleted: result.rows[0] });
  } catch (error) {
    logger.error('Delete contest failed:', error);
    res.status(500).json({ error: error.message });
  }
});


/**
 * @swagger
 * /api/contests/{contestId}:
 *   patch:
 *     summary: Update contest details
 *     tags: [Contests]
 *     parameters:
 *       - in: path
 *         name: contestId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the contest to update
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               start_time:
 *                 type: string
 *                 format: date-time
 *               end_time:
 *                 type: string
 *                 format: date-time
 *               entry_fee:
 *                 type: number
 *               prize_pool:
 *                 type: number
 *     responses:
 *       200:
 *         description: Contest updated successfully
 *       404:
 *         description: Contest not found
 *       500:
 *         description: Server error
 */
router.patch('/:contestId', async (req, res) => {
  const { contestId } = req.params;
  const { name, description, start_time, end_time, entry_fee, prize_pool } = req.body;

  try {
    const query = `
      UPDATE contests
      SET name = COALESCE($1, name),
          description = COALESCE($2, description),
          start_time = COALESCE($3, start_time),
          end_time = COALESCE($4, end_time),
          entry_fee = COALESCE($5, entry_fee),
          prize_pool = COALESCE($6, prize_pool)
      WHERE id = $7
      RETURNING *;
    `;

    const result = await pool.query(query, [
      name,
      description,
      start_time,
      end_time,
      entry_fee,
      prize_pool,
      contestId,
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Contest not found.' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Update contest failed:', error);
    res.status(500).json({ error: error.message });
  }
});


/******************************
  CONTEST PORTFOLIO ENDPOINTS  |
******************************/

/**
 * @swagger
 * /api/contests/{contestId}/portfolio:
 *   get:
 *     summary: Get portfolio information for a contest
 *     description: |
 *       Retrieves portfolio information for a contest. Behavior varies based on contest state:
 *       - Before entry: Shows entry fee and requirements
 *       - After entry, before start: Shows current portfolio and time until lock
 *       - After start: Shows performance and rankings
 *     tags: [Contests]
 *     parameters:
 *       - in: path
 *         name: contestId
 *         required: true
 *         schema:
 *           type: integer
 *         description: The ID of the contest
 *       - in: query
 *         name: wallet
 *         schema:
 *           type: string
 *         description: Optional wallet address to view other portfolios (only after contest starts)
 *     responses:
 *       200:
 *         description: Portfolio information retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 contestInfo:
 *                   type: object
 *                   properties:
 *                     status:
 *                       type: string
 *                       enum: [pending, active, completed]
 *                     startTime:
 *                       type: string
 *                       format: date-time
 *                     timeRemaining:
 *                       type: string
 *                     entryFee:
 *                       type: number
 *                 portfolio:
 *                   type: object
 *                   properties:
 *                     tokens:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           symbol:
 *                             type: string
 *                           weight:
 *                             type: integer
 *                           currentPrice:
 *                             type: number
 *                           performance:
 *                             type: number
 *                     totalValue:
 *                       type: number
 *                     ranking:
 *                       type: integer
 *                     totalParticipants:
 *                       type: integer
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Not authorized to view portfolio
 *       404:
 *         description: Contest not found
 *       500:
 *         description: Server error
 */
router.get('/:contestId/portfolio', async (req, res) => {
  const { contestId } = req.params;
  const { wallet: requestedWallet } = req.query;
  const walletAddress = req.user?.wallet_address;

  try {
    if (!walletAddress) {
      return res.status(401).json({ 
        error: 'Authentication required' 
      });
    }

    // Use the requested wallet or default to the authenticated user
    const targetWallet = requestedWallet || walletAddress;

    const client = await pool.connect();
    try {
      // Get comprehensive contest and portfolio information
      const result = await client.query(`
        WITH portfolio_data AS (
          SELECT 
            cp.wallet_address,
            json_agg(json_build_object(
              'symbol', t.symbol,
              'name', t.name,
              'weight', cp.weight,
              'currentPrice', tp.price
            ) ORDER BY cp.weight DESC) as tokens,
            sum(cp.weight * tp.price / 100) as total_value
          FROM contest_portfolios cp
          JOIN tokens t ON cp.token_id = t.id
          LEFT JOIN token_prices tp ON t.id = tp.token_id
          WHERE cp.contest_id = $1 AND cp.wallet_address = $2
          GROUP BY cp.wallet_address
        ),
        ranking_data AS (
          SELECT 
            wallet_address,
            RANK() OVER (ORDER BY total_value DESC) as rank,
            COUNT(*) OVER () as total_participants
          FROM portfolio_data
        )
        SELECT 
          c.*,
          cp.wallet_address IS NOT NULL as is_participant,
          pd.tokens,
          pd.total_value,
          rd.rank,
          rd.total_participants,
          (
            SELECT COUNT(*) 
            FROM contest_participants 
            WHERE contest_id = c.id
          ) as current_participants
        FROM contests c
        LEFT JOIN contest_participants cp 
          ON c.id = cp.contest_id 
          AND cp.wallet_address = $2
        LEFT JOIN portfolio_data pd ON pd.wallet_address = $2
        LEFT JOIN ranking_data rd ON rd.wallet_address = $2
        WHERE c.id = $1
      `, [contestId, targetWallet]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: 'Contest not found',
          details: { contestId }
        });
      }

      const contest = result.rows[0];
      const now = new Date();
      const startTime = new Date(contest.start_time);
      const hasStarted = startTime <= now;

      // If trying to view someone else's portfolio before contest starts
      if (targetWallet !== walletAddress && !hasStarted) {
        return res.status(403).json({
          error: 'Cannot view other portfolios before contest starts',
          details: {
            contestStart: startTime,
            timeUntilStart: `${Math.floor((startTime - now) / 1000 / 60)} minutes`
          }
        });
      }

      // Format response based on contest state
      const response = {
        contestInfo: {
          id: contest.id,
          name: contest.name,
          status: contest.status,
          startTime: contest.start_time,
          endTime: contest.end_time,
          timeRemaining: hasStarted 
            ? `${Math.floor((new Date(contest.end_time) - now) / 1000 / 60)} minutes`
            : `${Math.floor((startTime - now) / 1000 / 60)} minutes until start`,
          entryFee: contest.entry_fee,
          prizePool: contest.prize_pool,
          participantCount: contest.current_participants,
          maxParticipants: contest.settings?.max_participants
        }
      };

      // Add portfolio data if it exists
      if (contest.tokens) {
        response.portfolio = {
          tokens: contest.tokens,
          totalValue: contest.total_value,
          rank: hasStarted ? contest.rank : null,
          totalParticipants: contest.total_participants
        };

        // Add performance data if contest has started
        if (hasStarted) {
          response.portfolio.performance = {
            valueChange: 0, // Calculate from historical data
            percentageChange: 0, // Calculate from historical data
            ranking: contest.rank,
            totalParticipants: contest.total_participants
          };
        }
      } else if (!contest.is_participant) {
        response.entryInfo = {
          canEnter: contest.status === 'pending' || contest.status === 'active',
          requiresEntry: true,
          entryFee: contest.entry_fee,
          spotsRemaining: contest.settings?.max_participants - contest.current_participants
        };
      }

      res.json(response);

    } finally {
      client.release();
    }

  } catch (error) {
    logger.error('Failed to fetch portfolio:', error);
    res.status(500).json({ 
      error: 'Failed to fetch portfolio information',
      details: error.message 
    });
  }
});


/**
 * @swagger
 * /api/contests/{contestId}/portfolio:
 *   put:
 *     summary: Update an existing contest portfolio
 *     description: |
 *       Updates a portfolio for a contest that has already been entered.
 *       Only available until contest starts. No entry fee required.
 *     tags: [Contests]
 *     parameters:
 *       - in: path
 *         name: contestId
 *         required: true
 *         schema:
 *           type: integer
 *         description: The ID of the contest
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - portfolio
 *             properties:
 *               portfolio:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - symbol
 *                     - weight
 *                   properties:
 *                     symbol:
 *                       type: string
 *                     weight:
 *                       type: integer
 *                       minimum: 5
 *                       maximum: 50
 *             example:
 *               portfolio: [
 *                 { symbol: "SOL", weight: 45 },
 *                 { symbol: "BONK", weight: 30 },
 *                 { symbol: "USDC", weight: 25 }
 *               ]
 *     responses:
 *       200:
 *         description: Portfolio successfully updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     previousPortfolio:
 *                       type: array
 *                     newPortfolio:
 *                       type: array
 *                     updateTime:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: Invalid portfolio data
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Not entered in contest or contest has started
 *       404:
 *         description: Contest or portfolio not found
 *       500:
 *         description: Server error
 */
router.put('/:contestId/portfolio', async (req, res) => {
  const { contestId } = req.params;
  const { portfolio } = req.body;
  const walletAddress = req.user?.wallet_address;

  try {
    if (!walletAddress) {
      return res.status(401).json({ 
        error: 'Authentication required' 
      });
    }

    // Reuse portfolio validation from previous endpoint
    const validationError = validatePortfolio(portfolio);
    if (validationError) {
      return res.status(400).json({
        error: 'Portfolio validation failed',
        details: validationError
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get contest and participation status
      const contestResult = await client.query(`
        SELECT 
          c.*,
          cp.wallet_address IS NOT NULL as is_participant,
          (
            SELECT json_agg(json_build_object(
              'symbol', t.symbol,
              'weight', p.weight
            ))
            FROM contest_portfolios p
            JOIN tokens t ON p.token_id = t.id
            WHERE p.contest_id = c.id 
            AND p.wallet_address = $2
          ) as current_portfolio
        FROM contests c
        LEFT JOIN contest_participants cp 
          ON c.id = cp.contest_id 
          AND cp.wallet_address = $2
        WHERE c.id = $1
      `, [contestId, walletAddress]);

      if (contestResult.rows.length === 0) {
        return res.status(404).json({
          error: 'Contest not found',
          details: { contestId }
        });
      }

      const contest = contestResult.rows[0];

      // Comprehensive state validation
      if (!contest.is_participant) {
        return res.status(403).json({
          error: 'Not entered in contest',
          details: {
            contestId,
            walletAddress,
            action: 'Enter contest first using POST /contests/{contestId}/enter'
          }
        });
      }

      if (new Date(contest.start_time) <= new Date()) {
        return res.status(403).json({
          error: 'Contest has already started',
          details: {
            startTime: contest.start_time,
            currentTime: new Date(),
            timeElapsed: `${Math.floor((new Date() - new Date(contest.start_time)) / 1000 / 60)} minutes`
          }
        });
      }

      // Validate all tokens exist
      const symbols = portfolio.map(p => p.symbol);
      const tokenResult = await client.query(
        'SELECT id, symbol FROM tokens WHERE symbol = ANY($1)',
        [symbols]
      );

      if (tokenResult.rows.length !== symbols.length) {
        const validTokens = tokenResult.rows.map(t => t.symbol);
        const invalidTokens = symbols.filter(s => !validTokens.includes(s));
        return res.status(400).json({
          error: 'Invalid tokens in portfolio',
          details: {
            invalidTokens,
            validTokens,
            suggestion: 'Use GET /tokens to see available tokens'
          }
        });
      }

      // Store previous portfolio for response
      const previousPortfolio = contest.current_portfolio || [];

      // Update portfolio with optimistic locking
      await client.query(
        'DELETE FROM contest_portfolios WHERE contest_id = $1 AND wallet_address = $2',
        [contestId, walletAddress]
      );

      for (const { symbol, weight } of portfolio) {
        await client.query(`
          INSERT INTO contest_portfolios (contest_id, wallet_address, token_id, weight)
          SELECT $1, $2, tokens.id, $3
          FROM tokens WHERE tokens.symbol = $4
        `, [contestId, walletAddress, weight, symbol]);
      }

      await client.query('COMMIT');

      logger.info(`Portfolio updated for contest ${contestId} by ${walletAddress}`);
      
      res.json({
        message: 'Portfolio successfully updated',
        data: {
          previousPortfolio,
          newPortfolio: portfolio,
          updateTime: new Date().toISOString(),
          contestStart: contest.start_time,
          timeUntilStart: `${Math.floor((new Date(contest.start_time) - new Date()) / 1000 / 60)} minutes`
        }
      });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    logger.error('Failed to update portfolio:', error);
    res.status(500).json({ 
      error: 'Failed to update portfolio',
      details: error.message 
    });
  }
});



export default router;

