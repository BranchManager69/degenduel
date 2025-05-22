// routes/auth-status.js

/**
 * Authentication Status Route
 * 
 * @description Handles the comprehensive authentication status check.
 * 
 * @author BranchManager69
 * @version 1.0.0
 * @created 2025-05-08
 */

import express from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/config.js';
import prisma from '../config/prisma.js';
import { logApi } from '../utils/logger-suite/logger.js';

const router = express.Router();

// Dedicated logger for auth status operations (can share with main auth or be separate)
const authLogger = {
  ...logApi.forService('AUTH_STATUS'),
  analytics: logApi.analytics // If status checks need analytics
};

/**
 * @swagger
 * /api/auth/status:
 *   get:
 *     summary: Get comprehensive authentication status
 *     tags: [Authentication]
 *     security:
 *       - cookieAuth: [] # Indicates session cookie might be sent
 *     responses:
 *       200:
 *         description: Comprehensive authentication status including all methods
 *         content:
 *           application/json:
 *             schema:
 *               # Add schema definition here based on the status object created
 *               type: object 
 *               properties:
 *                 timestamp: 
 *                   type: string
 *                   format: date-time
 *                 authenticated: 
 *                   type: boolean
 *                 methods: 
 *                   type: object
 *                   # Define structure for jwt, twitter, discord, privy, device statuses
 *                 device_auth_required: 
 *                   type: boolean
 *                 environment:
 *                   type: string
 *       500:
 *         description: Internal server error
 */
router.get('/status', async (req, res) => {
  try {
    authLogger.info(`Authentication status check requested \n\t`, {
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });

    // Check JWT/Session Auth Status
    let jwtStatus = {
      active: false,
      method: 'jwt',
      details: {}
    };
    
    const token = req.cookies.session;
    let decodedJwtPayload = null;
    if (token) {
      try {
        // Verify token
        decodedJwtPayload = jwt.verify(token, config.jwt.secret);
        
        // Check if user exists (using id from JWT if available, else wallet_address)
        const userWhere = decodedJwtPayload.id 
            ? { id: decodedJwtPayload.id } 
            : { wallet_address: decodedJwtPayload.wallet_address };
            
        const user = await prisma.users.findUnique({ where: userWhere });
        
        if (user) {
          jwtStatus.active = true;
          jwtStatus.details = {
            id: user.id, // Include id
            wallet_address: user.wallet_address,
            role: user.role,
            nickname: user.nickname,
            expires: new Date(decodedJwtPayload.exp * 1000).toISOString(),
            session_id: decodedJwtPayload.session_id,
            last_login: user.last_login
          };
        } else {
          jwtStatus.details.error = 'Valid token but user not found';
        }
      } catch (error) {
        jwtStatus.details.error = error.message;
        jwtStatus.details.errorType = error.name;
      }
    }

    // Check for Twitter connection
    let twitterStatus = {
      active: false,
      linked: false, // Explicitly add linked status
      method: 'twitter',
      details: {}
    };
    
    try {
      if (jwtStatus.active) {
        // Check if user has Twitter linked
        const twitterProfile = await prisma.user_social_profiles.findFirst({
          where: {
            wallet_address: jwtStatus.details.wallet_address, // Use wallet_address for lookup
            platform: 'twitter'
          }
        });
        
        if (twitterProfile) {
          twitterStatus.linked = true;
          twitterStatus.active = twitterProfile.verified || false; // Consider active only if verified?
          twitterStatus.details = {
            username: twitterProfile.username,
            verified: twitterProfile.verified,
            last_verified: twitterProfile.last_verified,
            profile_image: twitterProfile.metadata?.profile_image_url || null
          };
        }
      }
      
      // Also check for any pending Twitter auth in session
      if (req.session?.twitter_user) {
        twitterStatus.pending = true;
        twitterStatus.details.pendingUsername = req.session.twitter_user.username;
      }
    } catch (error) {
      authLogger.error(`Error checking Twitter status \n\t`, {
        error: error.message,
        stack: error.stack
      });
      twitterStatus.details.error = 'Error checking Twitter connection';
    }
    
    // Check for Discord connection
    let discordStatus = {
      active: false,
      linked: false, // Explicitly add linked status
      method: 'discord',
      details: {}
    };
    
    try {
      if (jwtStatus.active) {
        // Check if user has Discord linked
        const discordProfile = await prisma.user_social_profiles.findFirst({
          where: {
            wallet_address: jwtStatus.details.wallet_address, // Use wallet_address for lookup
            platform: 'discord'
          }
        });
        
        if (discordProfile) {
          discordStatus.linked = true;
          discordStatus.active = discordProfile.verified || false; // Consider active only if verified?
          discordStatus.details = {
            username: discordProfile.username,
            verified: discordProfile.verified,
            last_verified: discordProfile.last_verified,
            avatar: discordProfile.metadata?.avatar || null,
            discriminator: discordProfile.metadata?.discriminator || null
          };
        }
      }
      
      // Also check for any pending Discord auth in session
      if (req.session?.discord_user) {
        discordStatus.pending = true;
        discordStatus.details.pendingUsername = req.session.discord_user.username;
      }
    } catch (error) {
      authLogger.error(`Error checking Discord status \n\t`, {
        error: error.message,
        stack: error.stack
      });
      discordStatus.details.error = 'Error checking Discord connection';
    }

    // Check for Privy auth info
    let privyStatus = {
      active: false, // Active might mean recently used Privy to login
      linked: false, // Linked means connection exists in DB
      method: 'privy',
      details: {}
    };

    try {
      if (jwtStatus.active) {
        const walletAddress = jwtStatus.details.wallet_address; // Use wallet_address
        
        const privyProfile = await prisma.user_social_profiles.findFirst({
          where: {
            wallet_address: walletAddress,
            platform: 'privy',
          }
        });
        
        if (privyProfile) {
          privyStatus.linked = true;
          privyStatus.active = privyProfile.verified || false; // Consider active only if verified
          privyStatus.details.linked = {
            privy_user_id: privyProfile.platform_user_id,
            username: privyProfile.username, // Often email
            verified: privyProfile.verified,
            last_verified: privyProfile.last_verified
          };
          // Could add logic here to check if the current session was *initiated* by Privy if needed
        }
      }
    } catch (error) {
      authLogger.error(`Error checking Privy status \n\t`, {
        error: error.message, 
        stack: error.stack
      });
      privyStatus.details.error = 'Error checking Privy connection';
    }

    // Check device authorization status
    let deviceAuthStatus = {
      active: false, // Is the current device authorized?
      method: 'device',
      details: {}
    };
    
    try {
      if (jwtStatus.active && req.headers['x-device-id']) {
        const deviceId = req.headers['x-device-id'];
        
        const device = await prisma.authorized_devices.findUnique({
          where: {
            user_id_device_id: { // Assuming schema uses user_id now
              user_id: jwtStatus.details.id,
              device_id: deviceId
            }
          }
        });
        
        if (device) {
          deviceAuthStatus.active = device.is_active;
          deviceAuthStatus.details = {
            device_id: device.device_id,
            device_name: device.device_name,
            device_type: device.device_type,
            authorized: device.is_active,
            last_used: device.last_used,
            created_at: device.created_at
          };
        } else {
          deviceAuthStatus.details.error = 'Device not registered for this user';
        }
      } else if (config.device_auth_enabled) {
        // Only note required if feature enabled and user is logged in but no device ID sent
        if(jwtStatus.active) deviceAuthStatus.details.error = 'No device ID provided in headers';
        deviceAuthStatus.details.required = config.device_auth_enabled;
      } else {
        deviceAuthStatus.details.required = false;
      }
    } catch (error) {
      authLogger.error(`Error checking device auth status \n\t`, {
        error: error.message,
        stack: error.stack
      });
      deviceAuthStatus.details.error = 'Error checking device authorization';
    }
    
    // Check biometric status
    let biometricStatus = {
        linked: false,
        method: 'biometric',
        details: { credentials: [] }
    };
    try {
        if (jwtStatus.active) {
            const credentials = await prisma.biometric_credentials.findMany({
                where: { user_id: jwtStatus.details.id }, // Use user.id
                select: { credential_id: true, device_info: true, created_at: true, last_used: true }
            });
            if (credentials.length > 0) {
                biometricStatus.linked = true;
                biometricStatus.details.credentials = credentials.map(c => ({
                    id: c.credential_id,
                    name: c.device_info?.name || 'Unknown Device',
                    created_at: c.created_at,
                    last_used: c.last_used
                }));
            }
        }
    } catch(error) {
        authLogger.error(`Error checking biometric status \n\t`, {
            error: error.message,
            stack: error.stack
          });
        biometricStatus.details.error = 'Error checking biometric credentials';
    }


    // Compile comprehensive status
    const status = {
      timestamp: new Date().toISOString(),
      authenticated: jwtStatus.active,
      methods: {
        jwt: jwtStatus,
        twitter: twitterStatus,
        discord: discordStatus,
        privy: privyStatus,
        device: deviceAuthStatus,
        biometric: biometricStatus // Add biometric status
      },
      device_auth_required: config.device_auth_enabled,
      environment: process.env.NODE_ENV || 'development'
    };
    
    authLogger.debug(`Authentication status compiled \n\t`, { 
      authenticated: status.authenticated,
      activeAuthMethods: Object.entries(status.methods)
        .filter(([_, info]) => info.active || info.linked) // Consider linked as relevant status
        .map(([method]) => method)
    });
    
    return res.json(status);
  } catch (error) {
    authLogger.error(`Failed to generate auth status \n\t`, {
      error: error.message,
      stack: error.stack
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;