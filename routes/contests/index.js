/**
 * Contest Routes (Modular Implementation)
 * 
 * @description Main router that combines all contest route modules
 * 
 * @author BranchManager69
 * @version 1.0.0
 * @created 2025-05-08
 */

import express from 'express';
import { logApi } from '../../utils/logger-suite/logger.js';

// Import modular routes
import baseRouter from './base.js';
import participationRouter from './participation.js';
import adminRouter from './admin.js';
import leaderboardRouter from './leaderboard.js';
import portfolioRouter from './portfolio.js';
import scheduleRouter from './schedule.js';

const router = express.Router();

// Create a dedicated logger for contest operations
const contestLogger = {
  ...logApi.forService('CONTESTS'),
  analytics: logApi.analytics
};

// Mount all route modules
router.use('/', baseRouter);
router.use('/', participationRouter);
router.use('/', adminRouter);
router.use('/', leaderboardRouter);
router.use('/', portfolioRouter);
router.use('/', scheduleRouter);

// Route to check refactoring status
router.get('/refactor-status', (req, res) => {
  res.json({
    status: 'completed',
    message: 'Contest routes refactoring completed',
    completedModules: [
      'base.js', 
      'participation.js', 
      'admin.js', 
      'leaderboard.js', 
      'portfolio.js', 
      'schedule.js'
    ],
    pendingModules: []
  });
});

// Debug
contestLogger.info('[*NEW*] Modular contest routes initialized');

export default router;