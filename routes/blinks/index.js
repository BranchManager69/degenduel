// routes/blinks/index.js

/**
 * Blinks routes
 * 
 * SIMPLE ROUTES FOR NOW - HAVEN'T EVEN TESTED!
 * 
 */

import express from 'express';
import { requireAuth, requireAdmin, requireSuperAdmin } from '../../middleware/auth.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import { generateTokenAIResponse } from '../../services/ai-service/ai-service.js';

// Config
import { config } from '../../config/config.js';

const router = express.Router();

// Get all blinks
router.get('/', requireAuth, async (req, res) => {
  try {
    const blinks = await Blink.find();
    res.json(blinks);
  } catch (error) {
    logApi(error, 'Error fetching blinks');
    res.status(500).json({ error: 'Failed to fetch blinks' });
  }
});

// Get a single blink by ID
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const blink = await Blink.findById(req.params.id);
    if (!blink) {
      return res.status(404).json({ error: 'Blink not found' });
    }
    res.json(blink);
  } catch (error) {
    logApi(error, 'Error fetching blink');
    res.status(500).json({ error: 'Failed to fetch blink' });
  }
});

export default router;
