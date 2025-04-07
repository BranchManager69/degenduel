// routes/admin/vanity-callback.js

import express from 'express';
import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors } from '../../utils/colors.js';
import VanityApiClient from '../../services/vanity-wallet/vanity-api-client.js';
import { requireSuperAdmin } from '../../middleware/auth.js';
import AdminLogger from '../../utils/admin-logger.js';
import { ServiceError } from '../../utils/service-suite/service-error.js';
import config from '../../config/config.js';

const router = express.Router();

/**
 * GET /api/admin/vanity-callback/status
 * Get the status of the vanity wallet generator
 */
router.get('/status', requireSuperAdmin, async (req, res) => {
  try {
    const isHealthy = await VanityApiClient.checkHealth();
    
    return res.status(200).json({
      status: isHealthy ? 'ok' : 'error',
      message: isHealthy ? 'Local generator is healthy' : 'Local generator is not responding',
      generator: 'local'
    });
  } catch (error) {
    logApi.error(`${fancyColors.MAGENTA}[VanityCallback]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} Error ${fancyColors.RESET} Checking generator health: ${error.message}`, {
      error: error.message,
      stack: error.stack
    });
    
    return res.status(500).json({
      status: 'error',
      message: 'Failed to check generator health',
      error: error.message
    });
  }
});

export default router;