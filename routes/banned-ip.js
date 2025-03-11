// routes/banned-ip.js

import express from 'express';
import { checkIpBan } from '../middleware/ipBanMiddleware.js';
import { logApi } from '../utils/logger-suite/logger.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: IP Ban
 *   description: Public API for checking IP ban status
 */

/**
 * @swagger
 * /api/banned-ip/check:
 *   get:
 *     summary: Check if current IP is banned (public endpoint)
 *     tags: [IP Ban]
 *     responses:
 *       200:
 *         description: IP ban status
 *       500:
 *         description: Server error
 */
router.get('/check', async (req, res) => {
  try {
    // Get the client's IP address
    const clientIp = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    
    // Check if IP is banned
    const bannedIp = await checkIpBan(clientIp);
    
    // For security, don't return detailed ban info to the public
    res.json({
      success: true,
      is_banned: !!bannedIp,
      // Only return minimal info if banned
      ...(bannedIp && {
        restricted: true,
        // Don't expose reason or troll_level to prevent bypass attempts
        ban_type: bannedIp.is_permanent ? 'permanent' : 'temporary',
        expires_at: bannedIp.is_permanent ? null : bannedIp.expires_at
      })
    });
  } catch (error) {
    logApi.error(`Error checking public IP ban status: ${error.message}`, {
      error: error.stack,
      ip: req.ip
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to check IP ban status'
    });
  }
});

export default router;