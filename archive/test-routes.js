// /archive/test-routes.js
import express from 'express';
import prisma from '../config/prisma.js';
import { logApi } from '../utils/logger-suite/logger.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Test
 *   description: Testing and development endpoints
 *   x-display-name: "⚠️ Test Routes"
 */

/* Test Routes */

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
// Server Health check
router.get('/health', async (req, res) => {
    try {
        await prisma.$queryRaw`SELECT 1`;
        res.json({
            status: 'ok',
            database: 'connected',
            version: '1.0.0',
        });
    } catch (error) {
        logApi.error('Health check failed:', error);
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
// Create a single test user
router.post('/users', async (req, res) => {
    try {
        const { wallet_address = '0xTestWallet123', nickname = 'TestUser1' } = req.body;
        const result = await prisma.users.create({
            data: {
                wallet_address,
                nickname,
                rank_score: 1000
            }
        });
        res.json(result);
    } catch (error) {
        logApi.error('Create test user failed:', error);
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
// Bulk add test users
router.post('/users/bulk', async (req, res) => {
    const { count = 10 } = req.body;
    const users = Array.from({ length: count }).map((_, i) => ({
        wallet_address: `TeStUser${i + 1}TeSt`,
        nickname: `test_user_${i + 1}`,
        rank_score: 1000,
    }));

    try {
        const result = await prisma.users.createMany({
            data: users,
            skipDuplicates: true
        });
        res.json({ added: result.count });
    } catch (error) {
        logApi.error('Bulk add test users failed:', error);
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
// Update test user
router.put('/users/:wallet', async (req, res) => {
    const { wallet } = req.params;
    const { rank_score, settings, nickname } = req.body;
    
    try {
        const updateData = {};
        
        if (rank_score !== undefined) {
            const user = await prisma.users.findUnique({
                where: { wallet_address: wallet },
                select: { rank_score: true }
            });
            updateData.rank_score = (user?.rank_score || 0) + rank_score;
        }
        if (settings) {
            updateData.settings = settings;
        }
        if (nickname) {
            updateData.nickname = nickname;
        }
        
        updateData.last_login = new Date();

        const result = await prisma.users.update({
            where: { wallet_address: wallet },
            data: updateData
        });
        
        res.json(result);
    } catch (error) {
        logApi.error('Update test user failed:', error);
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
// Delete test users
router.delete('/users', async (req, res) => {
    try {
        const result = await prisma.users.deleteMany({
            where: {
                OR: [
                    { nickname: { startsWith: 'test_' } },
                    { wallet_address: { startsWith: 'TeSt', endsWith: 'TeSt' } }
                ]
            }
        });
        res.json({ deleted: result.count });
    } catch (error) {
        logApi.error('Delete test users failed:', error);
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
// Update test user settings
router.put('/users/:wallet/settings', async (req, res) => {
    const { wallet } = req.params;
    const { settings } = req.body;
    try {
        const result = await prisma.users.update({
            where: { wallet_address: wallet },
            data: {
                settings: settings
            }
        });
        res.json(result);
    } catch (error) {
        logApi.error('Update test user settings failed:', error);
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
// Reset test user data
router.post('/users/:wallet/reset', async (req, res) => {
    const { wallet } = req.params;

    try {
        await prisma.contest_participants.deleteMany({
            where: { wallet_address: wallet }
        });
        await prisma.contest_token_performance.deleteMany({
            where: { wallet_address: wallet }
        });
        await prisma.contest_token_prices.deleteMany({
            where: { wallet_address: wallet }
        });
        res.json({ wallet_address: wallet, reset: true });
    } catch (error) {
        logApi.error('Reset test user data failed:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;