// routes/auth-privy.js

/**
 * Privy Authentication Routes
 * 
 * @description Handles Privy-based authentication routes
 * 
 * @author BranchManager69
 * @version 1.0.0
 * @created 2025-05-08
 */

import express from 'express';
import { config } from '../config/config.js';
import prisma from '../config/prisma.js';
import { logApi } from '../utils/logger-suite/logger.js';
import { requireAuth } from '../middleware/auth.js';
import { UserRole } from '../types/userRole.js';
import privyClient from '../utils/privy-auth.js';
import {
  generateAccessToken,
  createRefreshToken,
  setAuthCookies,
  generateSessionId
} from '../utils/auth-helpers.js';

const router = express.Router();

// Create a dedicated logger for Privy auth operations
const authLogger = {
  ...logApi.forService('AUTH_PRIVY'),
  analytics: logApi.analytics
};


/**
 * @swagger
 * /api/auth/verify-privy:
 *   post:
 *     summary: Verify Privy authentication token and login user
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *               - userId
 *             properties:
 *               token:
 *                 type: string
 *                 description: Privy authentication token
 *               userId:
 *                 type: string
 *                 description: Privy user ID
 *     responses:
 *       200:
 *         description: User authenticated successfully
 *       401:
 *         description: Invalid Privy token
 *       400:
 *         description: Missing required fields or wallet address
 *       500:
 *         description: Internal server error
 */
router.post('/verify-privy', async (req, res) => {
  try {
    const { token, userId, device_id, device_name, device_type } = req.body;
    
    authLogger.info(`Privy verification request received \n\t`, { 
      userId, 
      hasToken: !!token, 
      hasDeviceInfo: !!device_id,
      requestHeaders: {
        userAgent: req.headers['user-agent'],
        origin: req.headers['origin'],
        referer: req.headers['referer']
      }
    });

    if (!token || !userId) {
      authLogger.warn(`Missing required fields for Privy verification \n\t`, { 
        hasToken: !!token, 
        hasUserId: !!userId,
        requestIp: req.ip
      });
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Log token format (first 10 chars only for security)
    const truncatedToken = token.substring(0, 10) + '...';
    authLogger.debug(`Processing Privy token verification \n\t`, {
      tokenPrefix: truncatedToken,
      tokenLength: token.length,
      userId
    });

    let authClaims;
    try {
      // Verify the token with Privy
      authLogger.debug(`Calling Privy client to verify token \n\t`, {
        clientConfigured: !!privyClient,
        appId: process.env.PRIVY_APP_ID ? 'configured' : 'missing',
        appSecret: process.env.PRIVY_APP_SECRET ? 'configured' : 'missing'
      });
      
      const verifyStartTime = performance.now();
      authClaims = await privyClient.verifyAuthToken(token);
      const verifyEndTime = performance.now();
      
      authLogger.info(`Privy token verified successfully \n\t`, { 
        userId: authClaims.userId,
        tokenUserId: userId,
        tokenMatch: authClaims.userId === userId,
        verificationTimeMs: (verifyEndTime - verifyStartTime).toFixed(2),
        tokenClaims: {
          iss: authClaims.iss,
          sub: authClaims.sub,
          exp: new Date(authClaims.exp * 1000).toISOString(),
          iat: new Date(authClaims.iat * 1000).toISOString(),
          hasEmail: !!authClaims.email,
          hasPhone: !!authClaims.phone
        }
      });
      
      // Verify that the userId in the token matches the userId in the request
      if (authClaims.userId !== userId) {
        authLogger.warn(`User ID mismatch in Privy verification \n\t`, { 
          tokenUserId: authClaims.userId, 
          requestUserId: userId,
          requestIp: req.ip
        });
        return res.status(401).json({ error: 'Invalid user ID' });
      }
    } catch (error) {
      authLogger.error(`Failed to verify Privy token \n\t`, {
        error: error.message,
        errorName: error.name,
        stack: error.stack,
        userId,
        requestIp: req.ip,
        headers: {
          userAgent: req.headers['user-agent'],
          origin: req.headers['origin']
        }
      });
      return res.status(401).json({ error: 'Invalid Privy token' });
    }

    // Get user details from Privy
    authLogger.debug(`Retrieving Privy user details for userId: ${userId} \n\t`);
    let privyUser;
    try {
      const userStartTime = performance.now();
      privyUser = await privyClient.getUser(userId);
      const userEndTime = performance.now();
      
      authLogger.info(`Retrieved Privy user details successfully \n\t`, {
        userId,
        retrievalTimeMs: (userEndTime - userStartTime).toFixed(2),
        userDetails: {
          hasWallet: !!privyUser.wallet,
          walletAddress: privyUser.wallet?.address ? `${privyUser.wallet.address.substring(0, 6)}...${privyUser.wallet.address.slice(-4)}` : 'none',
          hasEmail: !!privyUser.email?.address,
          hasPhone: !!privyUser.phone?.number,
          hasFido: !!privyUser.fido,
          linkedAccounts: privyUser.linkedAccounts?.length || 0
        }
      });
    } catch (error) {
      authLogger.error(`Failed to get Privy user details \n\t`, {
        error: error.message,
        errorName: error.name,
        stack: error.stack,
        userId,
        requestIp: req.ip
      });
      return res.status(500).json({ error: 'Failed to get user details from Privy' });
    }

    // Handle wallet address from Privy user data
    const walletAddress = privyUser.wallet?.address;

    if (!walletAddress) {
      authLogger.warn(`No wallet address found in Privy user data \n\t`, {
        userId,
        privyUserFields: Object.keys(privyUser || {}).join(', '),
        hasWalletField: !!privyUser?.wallet,
        walletFields: privyUser?.wallet ? Object.keys(privyUser.wallet).join(', ') : 'none'
      });
      return res.status(400).json({ error: 'No wallet address found in Privy user data' });
    }

    // Check if this is a new user or returning user
    let existingUser;
    try {
      existingUser = await prisma.users.findUnique({
        where: { wallet_address: walletAddress }
      });
      
      authLogger.debug(`User lookup for wallet ${walletAddress} \n\t`, {
        userExists: !!existingUser,
        isNewUser: !existingUser,
        userId
      });
    } catch (dbError) {
      authLogger.error(`Database error during user lookup \n\t`, {
        error: dbError.message,
        stack: dbError.stack,
        wallet: walletAddress,
        userId
      });
      // Continue with the flow, will create user if needed
    }

    // Create or update user in the database, respecting auto_create_accounts flag
    const nowIso = new Date().toISOString();
    const newUserDefaultNickname = `degen_${walletAddress.slice(0, 6)}`;
    
    // Check if we should auto-create accounts
    const shouldAutoCreate = config.privy.auto_create_accounts;
    
    authLogger.debug(`Processing user database operation \n\t`, {
      wallet: walletAddress,
      isNewUser: !existingUser,
      nickname: existingUser?.nickname || newUserDefaultNickname,
      userId,
      shouldAutoCreate,
      autoCreateConfigured: config.privy.auto_create_accounts
    });
    
    // If user exists, update them
    // If user doesn't exist and auto-create is enabled, create them
    // If user doesn't exist and auto-create is disabled, return error
    let user;
    
    if (existingUser) {
      // User exists, just update last login
      user = await prisma.users.update({
        where: { wallet_address: walletAddress },
        data: { last_login: nowIso }
      });
    } else if (shouldAutoCreate) {
      // User doesn't exist but auto-create is enabled
      user = await prisma.users.create({
        data: {
          wallet_address: walletAddress,
          nickname: newUserDefaultNickname,
          created_at: nowIso,
          last_login: nowIso,
          role: UserRole.user
        }
      });
      
      authLogger.info(`Auto-created new user account from Privy auth \n\t`, {
        wallet: walletAddress,
        nickname: newUserDefaultNickname,
        userId
      });
    } else {
      // User doesn't exist and auto-create is disabled
      authLogger.warn(`Privy auth: User doesn't exist and auto-create accounts is disabled \n\t`, {
        wallet: walletAddress,
        userId,
        privyUserExists: true
      });
      
      return res.status(404).json({ 
        error: 'No user found with this wallet address', 
        details: 'Auto-creation of accounts from Privy is disabled. Please register through wallet authentication first.'
      });
    }

    // Handle device authorization if device_id is provided
    let deviceInfo = null;
    if (config.device_auth_enabled && device_id) {
      try {
        authLogger.debug(`Processing device authorization for Privy auth \n\t`, {
          wallet: walletAddress,
          device_id,
          device_name,
          device_type
        });
        
        // Check if this is the first device for this user
        const deviceCount = await prisma.authorized_devices.count({
          where: { wallet_address: walletAddress }
        });

        // If auto-authorize is enabled, and this is the first device, auto-authorize it
        const shouldAutoAuthorize = config.device_auth.auto_authorize_first_device && deviceCount === 0;
        
        // Check if device is already authorized
        let existingDevice = await prisma.authorized_devices.findUnique({
          where: {
            wallet_address_device_id: {
              wallet_address: walletAddress,
              device_id: device_id
            }
          }
        });
        
        // If the device is already authorized, update it
        if (existingDevice) {
          // Update existing device
          deviceInfo = await prisma.authorized_devices.update({
            where: { id: existingDevice.id },
            data: {
              device_name: device_name || existingDevice.device_name,
              device_type: device_type || existingDevice.device_type,
              last_used: new Date(),
              is_active: existingDevice.is_active
            }
          });
          
          authLogger.info(`Updated existing device for Privy auth user \n\t`, {
            wallet: walletAddress,
            device_id,
            is_authorized: deviceInfo.is_active,
            device_name: deviceInfo.device_name
          });
        } else if (shouldAutoAuthorize) {
          // Auto-authorize first device
          deviceInfo = await prisma.authorized_devices.create({
            data: {
              wallet_address: walletAddress,
              device_id: device_id,
              device_name: device_name || 'First Privy Device',
              device_type: device_type || 'Unknown',
              is_active: true
            }
          });
          
          authLogger.info(`Auto-authorized first device for Privy auth user \n\t`, {
            wallet: walletAddress,
            device_id,
            device_name: deviceInfo.device_name,
            auth_method: 'privy'
          });
        } else {
          // Create unauthorized device record
          deviceInfo = await prisma.authorized_devices.create({
            data: {
              wallet_address: walletAddress,
              device_id: device_id,
              device_name: device_name || 'Unknown Privy Device',
              device_type: device_type || 'Unknown',
              is_active: false // Not authorized yet
            }
          });
          
          authLogger.info(`Created unauthorized device record for Privy auth \n\t`, {
            wallet: walletAddress,
            device_id,
            device_name: deviceInfo.device_name,
            requires_authorization: true
          });
        }
      } catch (deviceError) {
        authLogger.error(`Error handling device authorization for Privy auth \n\t`, {
          wallet: walletAddress,
          device_id,
          error: deviceError.message,
          stack: deviceError.stack
        });
        // Continue with login even if device handling fails
      }
    }

    // Generate session ID for tracking and analytics
    const sessionId = generateSessionId();

    // Create access token with user.id included
    const accessToken = generateAccessToken(user, sessionId, 'privy');
    
    // Create refresh token
    const refreshToken = await createRefreshToken(user);

    // Set auth cookies
    setAuthCookies(res, req, accessToken, refreshToken);

    // Track session with analytics
    authLogger.analytics.trackSession(user, {
      ...req.headers,
      'x-real-ip': req.ip,
      'x-forwarded-for': req.headers['x-forwarded-for'],
      'user-agent': req.headers['user-agent'],
      'sec-ch-ua-platform': req.headers['sec-ch-ua-platform'],
      'sec-ch-ua-mobile': req.headers['sec-ch-ua-mobile'],
      'x-device-id': device_id,
      'auth-method': 'privy',
      'privy-user-id': userId
    });

    // Return device authorization status
    const deviceAuthStatus = deviceInfo ? {
      device_authorized: deviceInfo.is_active,
      device_id: deviceInfo.device_id,
      device_name: deviceInfo.device_name,
      requires_authorization: config.device_auth_enabled && !deviceInfo.is_active
    } : null;

    // Log successful authentication
    authLogger.info(`Privy authentication successful \n\t`, {
      userId: user.id,
      wallet: user.wallet_address,
      role: user.role,
      privyUserId: userId,
      sessionId,
      deviceAuthStatus: deviceInfo ? {
        isAuthorized: deviceInfo.is_active,
        requiresAuthorization: config.device_auth_enabled && !deviceInfo.is_active
      } : 'no device info'
    });

    return res.json({
      verified: true,
      user: {
        id: user.id,
        wallet_address: user.wallet_address,
        role: user.role,
        nickname: user.nickname
      },
      device: deviceAuthStatus
    });
  } catch (error) {
    authLogger.error(`Privy authentication failed \n\t`, {
      error: error.message,
      errorName: error.name, 
      stack: error.stack,
      requestBody: {
        hasUserId: !!req.body?.userId,
        hasToken: !!req.body?.token
      },
      requestIp: req.ip
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/auth/link-privy:
 *   post:
 *     summary: Link Privy account to existing authenticated user
 *     tags: [Authentication]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *               - userId
 *             properties:
 *               token:
 *                 type: string
 *                 description: Privy authentication token
 *               userId:
 *                 type: string
 *                 description: Privy user ID
 *     responses:
 *       200:
 *         description: Privy account linked successfully
 *       400:
 *         description: Missing required fields
 *       401:
 *         description: Invalid Privy token or not authenticated
 *       500:
 *         description: Internal server error
 */
router.post('/link-privy', requireAuth, async (req, res) => {
  try {
    const { token, userId } = req.body;
    const authenticatedWallet = req.user.wallet_address;
    
    authLogger.info(`Link Privy request received \n\t`, { 
      userId, 
      authenticatedWallet,
      hasToken: !!token
    });

    // Validate request data
    if (!token || !userId) {
      authLogger.warn(`Missing required fields for Privy linking \n\t`, { 
        hasToken: !!token, 
        hasUserId: !!userId,
        authenticatedWallet
      });
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Verify the Privy token
    let authClaims;
    try {
      const verifyStartTime = performance.now();
      authClaims = await privyClient.verifyAuthToken(token);
      const verifyEndTime = performance.now();
      
      authLogger.info(`Privy token verified for linking \n\t`, { 
        userId: authClaims.userId,
        tokenUserId: userId,
        tokenMatch: authClaims.userId === userId,
        verificationTimeMs: (verifyEndTime - verifyStartTime).toFixed(2),
        authenticatedWallet
      });
      
      // Verify that the userId in the token matches the userId in the request
      if (authClaims.userId !== userId) {
        authLogger.warn(`User ID mismatch in Privy linking \n\t`, { 
          tokenUserId: authClaims.userId, 
          requestUserId: userId,
          authenticatedWallet
        });
        return res.status(401).json({ error: 'Invalid user ID' });
      }
    } catch (error) {
      authLogger.error(`Failed to verify Privy token for linking \n\t`, {
        error: error.message,
        stack: error.stack,
        userId,
        authenticatedWallet
      });
      return res.status(401).json({ error: 'Invalid Privy token' });
    }

    // Get user details from Privy
    let privyUser;
    try {
      privyUser = await privyClient.getUser(userId);
      
      authLogger.info(`Retrieved Privy user details for linking \n\t`, {
        userId,
        userDetails: {
          hasWallet: !!privyUser.wallet,
          walletAddress: privyUser.wallet?.address 
            ? `${privyUser.wallet.address.substring(0, 6)}...${privyUser.wallet.address.slice(-4)}` 
            : 'none',
          hasEmail: !!privyUser.email?.address,
          hasPhone: !!privyUser.phone?.number,
          hasFido: !!privyUser.fido,
          linkedAccounts: privyUser.linkedAccounts?.length || 0
        },
        authenticatedWallet
      });
    } catch (error) {
      authLogger.error(`Failed to get Privy user details for linking \n\t`, {
        error: error.message,
        stack: error.stack,
        userId,
        authenticatedWallet
      });
      return res.status(500).json({ error: 'Failed to get user details from Privy' });
    }

    // Since we don't yet have a proper table migration, use user_social_profiles
    // This follows your existing pattern for social identities
    
    // Check if this Privy account is already linked to another wallet
    const existing = await prisma.user_social_profiles.findFirst({
      where: { 
        platform: 'privy',
        platform_user_id: userId
      }
    });

    if (existing && existing.wallet_address !== authenticatedWallet) {
      authLogger.warn(`Privy account already linked to a different wallet \n\t`, {
        privyUserId: userId,
        existingWallet: existing.wallet_address,
        requestingWallet: authenticatedWallet
      });
      
      return res.status(400).json({
        error: 'Privy account already linked',
        details: 'This Privy account is already linked to a different wallet address'
      });
    }

    // Create or update the Privy link in user_social_profiles
    const now = new Date();
    
    // Prepare metadata
    const metadata = {
      email: privyUser.email?.address,
      phone: privyUser.phone?.number,
      linkedAccounts: privyUser.linkedAccounts?.map(account => ({
        type: account.type,
        linkedAt: account.linkedAt
      })),
      lastVerified: now.toISOString()
    };

    // We'll use user_social_profiles which already exists in your schema
    try {
      // Upsert the social profile
      await prisma.user_social_profiles.upsert({
        where: {
          wallet_address_platform: {
            wallet_address: authenticatedWallet,
            platform: 'privy'
          }
        },
        update: {
          platform_user_id: userId,
          username: privyUser.email?.address || `privy_user_${userId.substring(0, 8)}`,
          verified: true,
          last_verified: now,
          metadata: metadata,
          updated_at: now
        },
        create: {
          wallet_address: authenticatedWallet,
          platform: 'privy',
          platform_user_id: userId,
          username: privyUser.email?.address || `privy_user_${userId.substring(0, 8)}`,
          verified: true,
          verification_date: now,
          last_verified: now,
          metadata: metadata,
          created_at: now,
          updated_at: now
        }
      });
      
      authLogger.info(`Privy account successfully linked \n\t`, {
        wallet: authenticatedWallet,
        privyUserId: userId,
        linkTime: now.toISOString()
      });
      
      return res.json({
        success: true,
        message: 'Privy account linked successfully',
        wallet: authenticatedWallet,
        privy_user_id: userId
      });
    } catch (upsertError) {
      // Log and return any errors
      authLogger.error(`Failed to link Privy account \n\t`, {
        error: upsertError.message,
        stack: upsertError.stack,
        authenticatedWallet,
        privyUserId: userId
      });
      return res.status(500).json({ error: 'Failed to link Privy account' });
    }
  } catch (error) {
    authLogger.error(`Privy account linking failed \n\t`, {
      error: error.message,
      stack: error.stack,
      wallet: req.user?.wallet_address
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});


export default router;