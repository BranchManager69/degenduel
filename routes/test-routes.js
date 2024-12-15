import express from 'express';
import { pool } from '../config/pg-database.js';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Test
 *   description: Testing and development endpoints
 *   x-display-name: "⚠️ Test Routes"
 */

/**
 * @swagger
 * /api/test/health:
 *   get:
 *     summary: Server health check
 *     tags: [Test]
 *     responses:
 *       200:
 *         description: Server is operational
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "ok"
 *                 database:
 *                   type: string
 *                   example: "connected"
 *                 version:
 *                   type: string
 *                   example: "1.0.0"
 */
router.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({
            status: 'ok',
            database: 'connected',
            version: '1.0.0',
        });
    } catch (error) {
        logger.error('Health check failed:', error);
        res.status(500).json({
            status: 'error',
            database: 'disconnected',
            version: '1.0.0',
        });
    }
});

/**
 * @swagger
 * /api/test/users:
 *   post:
 *     summary: Create a single test user
 *     tags: [Test]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               wallet_address:
 *                 type: string
 *                 example: "0xTestWallet123"
 *               nickname:
 *                 type: string
 *                 example: "TestUser1"
 *     responses:
 *       200:
 *         description: Test user created successfully
 */
router.post('/users', async (req, res) => {
    try {
        const { wallet_address = '0xTestWallet123', nickname = 'TestUser1' } = req.body;
        const result = await pool.query(`
            INSERT INTO users (wallet_address, nickname, rank_score)
            VALUES ($1, $2, $3)
            RETURNING *
        `, [wallet_address, nickname, 1000]);
        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Create test user failed:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * @swagger
 * /api/test/users/bulk:
 *   post:
 *     summary: Bulk add test users
 *     tags: [Test]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               count:
 *                 type: integer
 *                 example: 10
 *     responses:
 *       200:
 *         description: Test users added successfully
 */
router.post('/users/bulk', async (req, res) => {
    const { count = 10 } = req.body;
    const users = Array.from({ length: count }).map((_, i) => ({
        wallet_address: `TeStUser${i + 1}TeSt`,
        nickname: `test_user_${i + 1}`,
        rank_score: 1000,
    }));

    try {
        const query = `
            INSERT INTO users (wallet_address, nickname, rank_score)
            VALUES ${users.map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`).join(', ')}
            ON CONFLICT (wallet_address) DO NOTHING
        `;
        const values = users.flatMap(u => [u.wallet_address, u.nickname, u.rank_score]);
        const result = await pool.query(query, values);
        res.json({ added: result.rowCount });
    } catch (error) {
        logger.error('Bulk add test users failed:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * @swagger
 * /api/test/users/{wallet}:
 *   put:
 *     summary: Update test user
 *     tags: [Test]
 *     parameters:
 *       - in: path
 *         name: wallet
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               rank_score:
 *                 type: integer
 *               settings:
 *                 type: object
 *               nickname:
 *                 type: string
 *     responses:
 *       200:
 *         description: User updated successfully
 */
router.put('/users/:wallet', async (req, res) => {
    const { wallet } = req.params;
    const { rank_score, settings, nickname } = req.body;
    
    try {
        let updateFields = [];
        let values = [wallet];
        let valueIndex = 2;

        if (rank_score !== undefined) {
            updateFields.push(`rank_score = rank_score + $${valueIndex}`);
            values.push(rank_score);
            valueIndex++;
        }
        if (settings) {
            updateFields.push(`settings = settings || $${valueIndex}::jsonb`);
            values.push(JSON.stringify(settings));
            valueIndex++;
        }
        if (nickname) {
            updateFields.push(`nickname = $${valueIndex}`);
            values.push(nickname);
            valueIndex++;
        }

        const query = `
            UPDATE users 
            SET ${updateFields.join(', ')},
                last_login = CURRENT_TIMESTAMP
            WHERE wallet_address = $1
            RETURNING *
        `;
        
        const result = await pool.query(query, values);
        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Update test user failed:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * @swagger
 * /api/test/users:
 *   delete:
 *     summary: Delete test users
 *     tags: [Test]
 *     responses:
 *       200:
 *         description: Test users deleted successfully
 */
router.delete('/users', async (req, res) => {
    try {
        const result = await pool.query(
            `DELETE FROM users WHERE nickname LIKE 'test_%' OR wallet_address LIKE 'TeSt%TeSt'`
        );
        res.json({ deleted: result.rowCount });
    } catch (error) {
        logger.error('Delete test users failed:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * @swagger
 * /api/test/users/{wallet}/settings:
 *   put:
 *     summary: Update test user settings
 *     tags: [Test]
 *     parameters:
 *       - in: path
 *         name: wallet
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               settings:
 *                 type: object
 *                 example: {"theme": "dark", "notifications": true}
 *     responses:
 *       200:
 *         description: Settings updated successfully
 */
router.put('/users/:wallet/settings', async (req, res) => {
    const { wallet } = req.params;
    const { settings } = req.body;
    try {
        const result = await pool.query(`
            UPDATE users
            SET settings = settings || $1::jsonb
            WHERE wallet_address = $2
            RETURNING *
        `, [JSON.stringify(settings), wallet]);
        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Update test user settings failed:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * @swagger
 * /api/test/users/{wallet}/reset:
 *   post:
 *     summary: Reset test user data
 *     tags: [Test]
 *     parameters:
 *       - in: path
 *         name: wallet
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User data reset successfully
 */
router.post('/users/:wallet/reset', async (req, res) => {
    const { wallet } = req.params;

    try {
        await pool.query('BEGIN');
        await pool.query(`DELETE FROM contest_participants WHERE wallet_address = $1`, [wallet]);
        await pool.query(`DELETE FROM contest_token_performance WHERE wallet_address = $1`, [wallet]);
        await pool.query(`DELETE FROM contest_token_prices WHERE wallet_address = $1`, [wallet]);
        await pool.query('COMMIT');
        res.json({ wallet_address: wallet, reset: true });
    } catch (error) {
        await pool.query('ROLLBACK');
        logger.error('Reset test user data failed:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;