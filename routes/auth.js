// routes/auth.js

/**
 * Auth Routes
 * 
 * @description Main auth router that combines all authentication route modules
 * 
 * @author BranchManager69
 * @version 2.0.2
 * @created 2025-01-01
 * @updated 2025-05-08
 */

import express from 'express';
import { logApi } from '../utils/logger-suite/logger.js';

// Import modular auth routes
import walletAuthRoutes from './auth-wallet.js';
import sessionAuthRoutes from './auth-session.js';
import privyAuthRoutes from './auth-privy.js';
import socialAuthRoutes from './auth-social.js';
import discordAuthRoutes from './auth-discord.js';
import devAuthRoutes from './auth-dev.js';
import biometricAuthRoutes from './auth-biometric.js';
import statusAuthRoutes from './auth-status.js';
import qrAuthRoutes from './auth-qr.js';

const router = express.Router();

// Create a dedicated logger for auth operations
const authLogger = {
  ...logApi.forService('AUTH'),
  analytics: logApi.analytics
};

// Mount the wallet authentication routes
router.use('/', walletAuthRoutes);

// Mount the session management routes
router.use('/', sessionAuthRoutes);

// Mount the Privy authentication routes
router.use('/', privyAuthRoutes);

// Mount the social authentication routes (Twitter)
router.use('/', socialAuthRoutes);

// Mount the Discord authentication routes
router.use('/discord', discordAuthRoutes);

// Mount the biometric authentication routes
router.use('/biometric', biometricAuthRoutes);

// Mount the QR code authentication routes
router.use('/qr', qrAuthRoutes);

// Mount the development-only authentication routes
router.use('/', devAuthRoutes);

// Mount the status routes
router.use('/', statusAuthRoutes);

// Debug
logApi.info('[*NEW*] Auth routes mounted');

/*
 * Note to DegenDuel developers: This file should remain minimal
 * and only include route mounting logic. All actual
 * route implementations should be in their respective
 * module files.
 */

export default router;