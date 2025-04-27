/**
 * Admin Routes
 * 
 * This file registers the admin routes for the LiquiditySim service.
 */

import express from 'express';
import tokenLiquidationRoutes from './admin/token-liquidation.js';

const router = express.Router();

// Mount the Token Liquidation routes
router.use('/admin/token-liquidation', tokenLiquidationRoutes);

export default router;