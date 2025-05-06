// routes/admin/redis-admin-auth-validator.js
import express from 'express';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';
import { logApi } from '../../utils/logger-suite/logger.js';

const router = express.Router();

/**
 * Redis Admin Tool Authentication Validator
 * 
 * Special endpoint used by Nginx auth_request directive to secure Redis Commander
 * This validates admin credentials using our existing authentication system
 * Returns 200 if the user is authenticated as admin, 401/403 otherwise
 * 
 * @route GET /api/admin/redis-admin-auth-validator
 * @access Admin only
 */
router.get('/', requireAuth, requireAdmin, (req, res) => {
  // If middleware passes, return 200
  logApi.debug(`[Redis Admin] Auth validation passed for admin ${req.user.wallet_address}`);
  res.status(200).send('OK');
});

export default router;