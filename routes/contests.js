import express from 'express';
import { pool } from '../config/pg-database.js';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Contests
 *   description: API endpoints for managing trading contests
 */

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
 * /api/contests/{contestId}/enter:
 *   post:
 *     summary: Enter a contest
 *     tags: [Contests]
 *     parameters:
 *       - in: path
 *         name: contestId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the contest to enter
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - wallet
 *             properties:
 *               wallet:
 *                 type: string
 *                 description: User's wallet address
 *     responses:
 *       200:
 *         description: Successfully entered contest
 *       500:
 *         description: Server error or contest already started
 */
router.post('/:contestId/enter', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { contestId } = req.params;
    const { wallet } = req.body;

    // Validate contest joinability and max participants
    const contestCheck = await client.query(`
      SELECT 
        c.*,
        COUNT(cp.wallet_address) AS current_participants
      FROM contests c
      LEFT JOIN contest_participants cp ON c.id = cp.contest_id
      WHERE c.id = $1
      GROUP BY c.id
    `, [contestId]);

    if (contestCheck.rows.length === 0) {
      throw new Error('Contest not found');
    }

    const contest = contestCheck.rows[0];

    // Check if contest is joinable
    if (new Date(contest.start_time) <= new Date() || new Date(contest.end_time) <= new Date()) {
      throw new Error('Contest not joinable (already started or ended)');
    }

    // Check if max participants reached
    if (parseInt(contest.current_participants, 10) >= parseInt(contest.settings.max_participants, 10)) {
      throw new Error('Maximum participants reached for this contest');
    }

    // Validate wallet existence
    const walletCheck = await client.query(`
      SELECT wallet_address FROM users WHERE wallet_address = $1
    `, [wallet]);

    if (walletCheck.rows.length === 0) {
      throw new Error('Invalid wallet address');
    }

    // Insert participant and check if they are already entered
    const insertResult = await client.query(`
      INSERT INTO contest_participants (contest_id, wallet_address)
      SELECT $1, u.wallet_address
      FROM users u
      WHERE u.wallet_address = $2
      ON CONFLICT DO NOTHING
      RETURNING wallet_address
    `, [contestId, wallet]);

    await client.query('COMMIT');

    if (insertResult.rowCount === 0) {
      // The user was already entered in the contest
      res.json({ success: false, message: 'User is already entered in this contest' });
    } else {
      // User was successfully entered
      res.json({ success: true, message: 'User successfully entered into the contest' });
    }
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error(`Enter contest failed for contest ID: ${req.params.contestId}, wallet: ${req.body.wallet}`, error);

    if (error.message.includes('not joinable')) {
      res.status(403).json({ error: error.message });
    } else if (error.message.includes('Invalid wallet')) {
      res.status(400).json({ error: error.message });
    } else if (error.message.includes('Maximum participants reached')) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Unexpected server error' });
    }
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


// WIP ENDPOINTS (TESTING):

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

export default router;