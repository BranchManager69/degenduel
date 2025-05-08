// routes/auth-discord.js

/**
 * Discord Authentication Routes
 * 
 * @description Handles Discord-based authentication routes
 * 
 * @author BranchManager69
 * @version 2.0.0
 * @updated 2025-05-08
 * @created 2025-05-08
 */

import express from 'express';
import { config } from '../config/config.js';
import prisma from '../config/prisma.js';
import { logApi } from '../utils/logger-suite/logger.js';
import { requireAuth } from '../middleware/auth.js';
import axios from 'axios';
import crypto from 'crypto';
import { randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';
import {
  generateAccessToken,
  createRefreshToken,
  setAuthCookies,
  generateSessionId
} from '../utils/auth-helpers.js';

const router = express.Router();

// Create a dedicated logger for Discord auth operations
const authLogger = {
  ...logApi.forService('AUTH_DISCORD'),
  analytics: logApi.analytics
};

/**
 * @swagger
 * /api/auth/discord/check-config:
 *   get:
 *     summary: Check Discord OAuth configuration
 *     tags: [Authentication]
 *     responses:
 *       200:
 *         description: Discord OAuth configuration check completed
 *       500:
 *         description: Failed to check Discord configuration
 */
router.get('/check-config', async (req, res) => {
  try {
    // Check Discord configuration from config object
    const discordConfig = {
      DISCORD_CLIENT_ID: config.discord.oauth.client_id ? '✅ Set' : '❌ Missing',
      DISCORD_CLIENT_SECRET: config.discord.oauth.client_secret ? '✅ Set' : '❌ Missing',
      DISCORD_CALLBACK_URI: config.discord.oauth.callback_uri ? '✅ Set' : '❌ Missing',
      DISCORD_CALLBACK_URI_DEVELOPMENT: config.discord.oauth.callback_uri_development ? '✅ Set' : '❌ Missing',
      NODE_ENV: process.env.NODE_ENV || 'development',
      ACTIVE_CALLBACK_URI: config.getEnvironment() === 'development'
        ? config.discord.oauth.callback_uri_development
        : config.discord.oauth.callback_uri
    };

    // Check session middleware
    const sessionStatus = req.session ? '✅ Working' : '❌ Not initialized';
    
    // Check Redis connection
    const redisManager = (await import('../utils/redis-suite/redis-manager.js')).default;
    const redisStatus = redisManager.isConnected ? '✅ Connected' : '❌ Not connected';
    
    // Try to use the session
    const sessionId = Math.random().toString(36).substring(7);
    req.session.test = sessionId;
    
    // Save session and verify
    await new Promise((resolve) => {
      req.session.save(() => resolve());
    });
    
    const sessionVerified = req.session.test === sessionId ? '✅ Verified' : '❌ Failed verification';
    
    return res.json({
      success: true,
      config: discordConfig,
      sessionStatus,
      redisStatus,
      sessionVerified,
      currentEnvironment: process.env.NODE_ENV || 'development',
      message: 'Discord OAuth configuration check completed'
    });
  } catch (error) {
    authLogger.error(`Discord config check failed \n\t`, {
      error: error.message,
      stack: error.stack
    });
    return res.status(500).json({
      success: false,
      error: 'Configuration check failed',
      details: error.message
    });
  }
});

/**
 * @swagger
 * /api/auth/discord/login:
 *   get:
 *     summary: Initiate Discord OAuth login
 *     tags: [Authentication]
 *     security: []
 *     responses:
 *       302:
 *         description: Redirects to Discord OAuth
 *       500:
 *         description: Failed to initiate Discord authentication
 */
router.get('/login', async (req, res) => {
  try {
    // Generate CSRF token and state for security
    const state = randomBytes(32).toString('hex');
    
    // Store state in cookie for verification later
    authLogger.info(`Discord OAuth: Creating state cookie \n\t`, {
      domain: req.get('host'),
      environment: config.getEnvironment(),
      cookieSettings: {
        httpOnly: true,
        secure: config.getEnvironment() === 'production',
        sameSite: 'lax',
        maxAge: '10 minutes'
      }
    });
    
    // SameSite=lax allows cookies to be sent during top-level navigations (like redirects)
    // but restricts cookies during cross-site subrequests (like image loads)
    res.cookie('discord_oauth_state', state, {
      httpOnly: true,
      secure: config.getEnvironment() === 'production',
      sameSite: 'lax', // Important: SameSite=lax needed for OAuth redirects to work
      maxAge: 10 * 60 * 1000 // 10 minutes
    });

    // Determine which callback URI to use based on environment
    const callbackUri = config.getEnvironment() === 'development'
      ? config.discord.oauth.callback_uri_development
      : config.discord.oauth.callback_uri;

    // Check if callback URI is properly configured
    if (!callbackUri) {
      authLogger.error(`Discord OAuth failed: Missing callback URI \n\t`, {
        environment: config.getEnvironment(),
        devCallback: config.discord.oauth.callback_uri_development,
        prodCallback: config.discord.oauth.callback_uri
      });
      return res.status(500).json({
        error: 'Configuration error',
        details: 'OAuth callback URI not configured'
      });
    }

    // Check if client ID is properly configured
    if (!config.discord.oauth.client_id) {
      authLogger.error(`Discord OAuth failed: Missing client ID \n\t`);
      return res.status(500).json({
        error: 'Configuration error',
        details: 'OAuth client ID not configured'
      });
    }

    // Construct the Discord OAuth URL
    const authUrl = new URL('https://discord.com/api/oauth2/authorize');
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('client_id', config.discord.oauth.client_id);
    authUrl.searchParams.append('redirect_uri', callbackUri);
    // Scopes for Discord - identify is required for basic user info
    const scopes = config.discord.oauth.scopes.join(' ');
    authUrl.searchParams.append('scope', scopes);
    authUrl.searchParams.append('state', state);

    // Log OAuth parameters for debugging
    authLogger.info(`Initiating Discord OAuth flow \n\t`, {
      state: state.substring(0, 6) + '...',
      callbackUri,
      clientId: config.discord.oauth.client_id.substring(0, 6) + '...',
      scope: scopes,
      fullUrl: authUrl.toString()
    });

    // Redirect user to Discord OAuth
    return res.redirect(authUrl.toString());
  } catch (error) {
    authLogger.error(`Discord OAuth initialization failed \n\t`, {
      error: error.message,
      stack: error.stack
    });
    return res.status(500).json({
      error: 'Could not initiate Discord authentication',
      details: error.message
    });
  }
});

/**
 * @swagger
 * /api/auth/discord/callback:
 *   get:
 *     summary: Handle Discord OAuth callback
 *     tags: [Authentication]
 *     security: []
 *     parameters:
 *       - name: code
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *       - name: state
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       302:
 *         description: Redirects to app with token
 *       400:
 *         description: Bad request
 *       500:
 *         description: Server error
 */
router.get('/callback', (req, res, next) => {
  // Bypass CORS for Discord callback - set required CORS headers explicitly
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  next();
}, async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query;
    
    // Handle explicit OAuth errors returned by Discord
    if (error) {
      authLogger.warn(`Discord OAuth error returned: ${error} \n\t`, { 
        error,
        error_description,
        state: state?.substring(0, 6) + '...' || 'missing'
      });
      // Return JSON error response instead of redirecting to static HTML
      return res.status(400).json({
        error: 'discord_oauth_error',
        error_type: error,
        error_description: error_description || '',
        message: 'An error occurred during Discord authentication.'
      });
    }
    
    // Check if all required parameters are present
    if (!code || !state) {
      authLogger.warn(`Discord OAuth callback missing required parameters \n\t`, { 
        codeExists: !!code,
        stateExists: !!state
      });
      return res.status(400).json({ 
        error: 'discord_oauth_error',
        error_type: 'missing_parameters',
        message: 'Missing required OAuth parameters'
      });
    }
    
    // Verify the state parameter matches what we sent
    const storedState = req.cookies.discord_oauth_state;
    if (!storedState || storedState !== state) {
      authLogger.warn(`Discord OAuth state mismatch \n\t`, {
        storedState: storedState ? `${storedState.substring(0, 6)}...` : 'missing',
        receivedState: `${state.substring(0, 6)}...`
      });
      
      return res.status(400).json({
        error: 'discord_oauth_error',
        error_type: 'state_mismatch',
        message: 'OAuth state verification failed'
      });
    }
    
    // Clear the state cookie since it's no longer needed
    res.clearCookie('discord_oauth_state');
    
    // Determine which callback URI to use based on environment
    const callbackUri = config.getEnvironment() === 'development' 
      ? config.discord.oauth.callback_uri_development 
      : config.discord.oauth.callback_uri;
    
    // Check for required configuration variables
    if (!config.discord.oauth.client_id || !config.discord.oauth.client_secret || !callbackUri) {
      authLogger.error(`Discord OAuth missing configuration \n\t`, {
        clientIdExists: !!config.discord.oauth.client_id,
        clientSecretExists: !!config.discord.oauth.client_secret,
        callbackUriExists: !!callbackUri
      });
      return res.status(500).json({
        error: 'discord_oauth_error',
        error_type: 'configuration_error',
        message: 'Server configuration error for Discord OAuth'
      });
    }
    
    // Exchange code for access token with detailed error handling
    let tokenResponse;
    try {
      // Prepare parameters for token request
      const tokenParams = new URLSearchParams({
        client_id: config.discord.oauth.client_id,
        client_secret: config.discord.oauth.client_secret,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: callbackUri
      });
      
      // Log token request parameters (with sensitive data masked)
      authLogger.info(`Exchanging code for Discord token with parameters \n\t`, {
        code: code.substring(0, 6) + '...',
        grant_type: 'authorization_code',
        client_id: config.discord.oauth.client_id.substring(0, 6) + '...',
        redirect_uri: callbackUri
      });
      
      // Make token request
      tokenResponse = await axios.post(
        'https://discord.com/api/oauth2/token',
        tokenParams.toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );
    } catch (tokenError) {
      // Handle token request error
      const responseData = tokenError.response?.data || {};
      authLogger.error(`Discord OAuth token exchange failed \n\t`, {
        status: tokenError.response?.status,
        statusText: tokenError.response?.statusText,
        error: tokenError.message,
        responseData
      });
      
      return res.status(400).json({
        error: 'discord_oauth_error',
        error_type: 'token_exchange',
        error_description: responseData.error || tokenError.message,
        message: 'Failed to exchange OAuth code for access token'
      });
    }
    
    // Extract token data
    const { access_token, refresh_token } = tokenResponse.data;
    
    // Get Discord user info with detailed error handling
    let userResponse;
    try {
      userResponse = await axios.get('https://discord.com/api/users/@me', {
        headers: {
          Authorization: `Bearer ${access_token}`
        }
      });
    } catch (userError) {
      // Handle user info request error
      const responseData = userError.response?.data || {};
      authLogger.error(`Discord user info request failed \n\t`, {
        status: userError.response?.status,
        statusText: userError.response?.statusText,
        error: userError.message,
        responseData
      });
      
      return res.status(400).json({
        error: 'discord_oauth_error',
        error_type: 'user_info',
        error_description: responseData.error || userError.message,
        message: 'Failed to retrieve Discord user information'
      });
    }
    
    // Extract user data
    const discordUser = userResponse.data;
    
    // Check if valid user data was returned
    if (!discordUser || !discordUser.id) {
      authLogger.error(`Discord returned invalid user data \n\t`, { 
        responseData: userResponse.data
      });
      return res.status(400).json({
        error: 'discord_oauth_error',
        error_type: 'invalid_user_data',
        message: 'Discord returned invalid or incomplete user data'
      });
    }
    
    // Log successful user info retrieval
    authLogger.info(`Retrieved Discord user info \n\t`, {
      id: discordUser.id,
      username: discordUser.username,
      hasAvatar: !!discordUser.avatar,
      email: discordUser.email ? `${discordUser.email.substring(0, 3)}...` : 'none'
    });
    
    // First, check if this Discord account is already linked and can be used for direct login
    const loginResult = await loginWithDiscord(discordUser.id, discordUser);
    
    if (loginResult.success) {
      // Generate session ID
      const sessionId = generateSessionId();
      
      // Create JWT token with user.id in payload
      const accessToken = generateAccessToken(loginResult.user, sessionId, 'discord');
      
      // Create refresh token
      const refreshToken = await createRefreshToken(loginResult.user);
      
      // Set auth cookies
      setAuthCookies(res, req, accessToken, refreshToken);
      
      authLogger.info(`Discord login: created session for wallet ${loginResult.wallet_address} \n\t`, {
        userId: loginResult.user.id,
        sessionId: sessionId
      });
      
      // Redirect to the proper /me profile page
      const baseUrl = config.getEnvironment() === 'development' ? 'https://dev.degenduel.me' : 'https://degenduel.me';
      authLogger.info(`Redirecting to ${baseUrl}/me after successful Discord login \n\t`);
      return res.redirect(`${baseUrl}/me`);
    }
    
    // If direct login wasn't successful, proceed with the linking flow
    
    // Store Discord info in session for linking to wallet later
    req.session.discord_user = {
      id: discordUser.id,
      username: discordUser.username,
      discriminator: discordUser.discriminator,
      avatar: discordUser.avatar,
      email: discordUser.email,
      access_token,
      refresh_token
    };
    
    // Save session explicitly to ensure discord_user data is persisted
    await new Promise((resolve, reject) => {
      req.session.save(err => {
        if (err) {
          authLogger.error(`Failed to save Discord user data to session \n\t`, { error: err.message });
          reject(err);
        } else {
          resolve();
        }
      });
    });
    
    authLogger.info(`Discord OAuth successful for user ${discordUser.username} \n\t`);
    
    // If user is already authenticated with a wallet, link accounts
    if (req.cookies.session) {
      try {
        const decoded = jwt.verify(req.cookies.session, config.jwt.secret);
        
        if (decoded && decoded.wallet_address) {
          // Link Discord account to wallet
          await linkDiscordToWallet(decoded.wallet_address, discordUser, access_token, refresh_token);
          
          // Redirect to the proper /me profile page
          const baseUrl = config.getEnvironment() === 'development' ? 'https://dev.degenduel.me' : 'https://degenduel.me';
          authLogger.info(`Redirecting to ${baseUrl}/me?discord_linked=true after linking \n\t`);
          return res.redirect(`${baseUrl}/me?discord_linked=true`);
        }
      } catch (error) {
        // Token verification failed, continue to login page
        authLogger.warn(`Failed to verify existing session when linking Discord \n\t`, { error: error.message });
      }
    }
    
    // If no wallet is connected yet, redirect to a page where user can connect wallet
    const baseUrl = config.getEnvironment() === 'development' ? 'https://dev.degenduel.me' : 'https://degenduel.me';
    // Redirect to the home page with query parameters instead of nonexistent /connect-wallet page
    authLogger.info(`Redirecting to ${baseUrl}/?action=connect-wallet&discord=pending to complete flow \n\t`);
    return res.redirect(`${baseUrl}/?action=connect-wallet&discord=pending`);
  } catch (error) {
    authLogger.error(`Discord OAuth callback failed \n\t`, {
      error: error.message,
      stack: error.stack
    });
    return res.status(500).json({
      error: 'discord_oauth_error',
      error_type: 'unexpected_error',
      error_description: error.message,
      message: 'An unexpected error occurred during Discord authentication'
    });
  }
});

/**
 * @swagger
 * /api/auth/discord/link:
 *   post:
 *     summary: Link Discord account to connected wallet
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Discord account linked successfully
 *       401:
 *         description: Not authenticated
 *       500:
 *         description: Server error
 */
router.post('/link', requireAuth, async (req, res) => {
  try {
    // Ensure user has Discord data in session
    if (!req.session?.discord_user) {
      authLogger.warn(`No Discord data in session for linking \n\t`);
      return res.status(400).json({ error: 'No Discord authentication data found' });
    }
    
    const { wallet_address } = req.user;
    const { id, username, discriminator, avatar, email, access_token, refresh_token } = req.session.discord_user;
    
    // Link Discord account to wallet
    await linkDiscordToWallet(wallet_address, 
      { id, username, discriminator, avatar, email }, 
      access_token, 
      refresh_token
    );
    
    // Clear Discord data from session
    delete req.session.discord_user;
    
    authLogger.info(`Discord account linked successfully for ${wallet_address} \n\t`);
    return res.json({ success: true, message: 'Discord account linked successfully' });
  } catch (error) {
    authLogger.error(`Failed to link Discord account \n\t`, {
      error: error.message,
      stack: error.stack,
      wallet: req.user?.wallet_address
    });
    return res.status(500).json({ error: 'Failed to link Discord account' });
  }
});

/**
 * Find wallet by Discord ID and create a session
 * @param {string} discordId - Discord user ID
 * @param {object} discordUser - Discord user data
 * @returns {Promise<{success: boolean, wallet_address?: string, error?: string}>}
 */
async function loginWithDiscord(discordId, discordUser) {
  try {
    // Look up the user_social_profiles entry
    const socialProfile = await prisma.user_social_profiles.findFirst({
      where: {
        platform: 'discord',
        platform_user_id: discordId,
        verified: true
      }
    });
    
    // If no linked account found, return error
    if (!socialProfile) {
      authLogger.warn(`No verified Discord account found for login \n\t`, {
        discordId,
        discordUsername: discordUser.username
      });
      return {
        success: false,
        error: 'No linked wallet found for this Discord account'
      };
    }
    
    // Get the wallet user
    const user = await prisma.users.findUnique({
      where: { wallet_address: socialProfile.wallet_address }
    });
    
    // If no user found, return error
    if (!user) {
      authLogger.warn(`Discord linked to wallet but user not found \n\t`, {
        discordId,
        wallet: socialProfile.wallet_address
      });
      return {
        success: false,
        error: 'User not found for linked Discord account'
      };
    }
    
    // Update user last login time
    await prisma.users.update({
      where: { wallet_address: user.wallet_address },
      data: { last_login: new Date() }
    });
    
    // Update Discord profile data if needed
    if (discordUser.username !== socialProfile.username || 
        discordUser.avatar !== socialProfile.metadata?.avatar) {
      
      await prisma.user_social_profiles.update({
        where: {
          wallet_address_platform: {
            wallet_address: socialProfile.wallet_address,
            platform: 'discord'
          }
        },
        data: {
          username: discordUser.username,
          last_verified: new Date(),
          metadata: {
            ...socialProfile.metadata,
            avatar: discordUser.avatar,
            discriminator: discordUser.discriminator,
            email: discordUser.email
          },
          updated_at: new Date()
        }
      });
    }
    
    // Check if we should update the user's profile image
    try {
      authLogger.info(`Checking whether to update profile image for ${socialProfile.wallet_address} \n\t`, {
        discordUsername: discordUser.username,
        hasDiscordAvatar: !!discordUser.avatar,
        discordId: discordUser.id
      });
      
      // Get the current user profile details
      const userProfile = await prisma.users.findUnique({
        where: { wallet_address: socialProfile.wallet_address },
        select: { profile_image_url: true }
      });
      
      authLogger.info(`Current profile image status \n\t`, {
        wallet: socialProfile.wallet_address,
        hasProfileImage: !!userProfile.profile_image_url,
        currentImageUrl: userProfile.profile_image_url || 'none'
      });
      
      // Check if profile image is Discord-sourced by URL pattern
      const isDiscordProfileImage = userProfile.profile_image_url && 
        userProfile.profile_image_url.includes('cdn.discordapp.com/avatars');
      
      authLogger.info(`Profile image analysis \n\t`, {
        wallet: socialProfile.wallet_address,
        isDiscordImage: isDiscordProfileImage,
        needsUpdate: !userProfile.profile_image_url || isDiscordProfileImage
      });
      
      // If user has no profile image or has a Discord profile image that may be outdated
      if ((!userProfile.profile_image_url || isDiscordProfileImage) && discordUser.avatar) {
        // Use Discord CDN URL for the avatar
        const avatarUrl = `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png?size=1024`;
        
        authLogger.info(`Processing Discord profile image \n\t`, {
          wallet: socialProfile.wallet_address,
          discordAvatar: discordUser.avatar,
          avatarUrl: avatarUrl,
          isDifferent: avatarUrl !== userProfile.profile_image_url
        });
        
        // Update profile image if it's different from current one
        if (avatarUrl !== userProfile.profile_image_url) {
          authLogger.info(`About to update profile image in database \n\t`, {
            wallet: socialProfile.wallet_address,
            oldImage: userProfile.profile_image_url || 'none',
            newImage: avatarUrl
          });
          
          await prisma.users.update({
            where: { wallet_address: socialProfile.wallet_address },
            data: {
              profile_image_url: avatarUrl,
              profile_image_updated_at: new Date()
            }
          });
          
          authLogger.info(`Successfully updated Discord profile image on login \n\t`, {
            wallet: socialProfile.wallet_address,
            oldImage: userProfile.profile_image_url || 'none',
            newImage: avatarUrl,
            success: true
          });
        } else {
          authLogger.info(`No profile image update needed \n\t`, {
            wallet: socialProfile.wallet_address,
            reason: 'Images are identical'
          });
        }
      } else if (!discordUser.avatar) {
        authLogger.info(`No profile image update needed \n\t`, {
          wallet: socialProfile.wallet_address,
          reason: 'No Discord avatar available'
        });
      }
    } catch (imageError) {
      authLogger.warn(`Failed to sync Discord profile image on login \n\t`, {
        wallet: socialProfile.wallet_address,
        error: imageError.message,
        stack: imageError.stack,
        discordId: discordUser.id
      });
      // Continue with login despite image sync error
    }
    
    authLogger.info(`Discord login successful for ${user.wallet_address} \n\t`, {
      discordUsername: discordUser.username,
      wallet: user.wallet_address
    });
    
    return {
      success: true,
      wallet_address: user.wallet_address,
      user
    };
  } catch (error) {
    authLogger.error(`Failed to login with Discord \n\t`, {
      error: error.message,
      stack: error.stack,
      discordId
    });
    
    return {
      success: false,
      error: 'Failed to login with Discord'
    };
  }
}

/**
 * Helper function to link Discord account to wallet
 */
async function linkDiscordToWallet(walletAddress, discordUser, accessToken, refreshToken) {
  const now = new Date();
  
  // Check if this Discord account is already linked to another wallet
  const existingLink = await prisma.user_social_profiles.findFirst({
    where: {
      platform: 'discord',
      platform_user_id: discordUser.id
    }
  });
  
  if (existingLink && existingLink.wallet_address !== walletAddress) {
    authLogger.warn(`Discord account already linked to different wallet \n\t`, {
      discordId: discordUser.id,
      existingWallet: existingLink.wallet_address,
      requestedWallet: walletAddress
    });
    throw new Error('This Discord account is already linked to another wallet');
  }
  
  // Create or update social profile
  await prisma.user_social_profiles.upsert({
    where: {
      wallet_address_platform: {
        wallet_address: walletAddress,
        platform: 'discord'
      }
    },
    create: {
      wallet_address: walletAddress,
      platform: 'discord',
      platform_user_id: discordUser.id,
      username: discordUser.username,
      verified: true,
      verification_date: now,
      last_verified: now,
      metadata: {
        discriminator: discordUser.discriminator,
        avatar: discordUser.avatar,
        email: discordUser.email,
        access_token: accessToken,
        refresh_token: refreshToken
      },
      created_at: now,
      updated_at: now
    },
    update: {
      username: discordUser.username,
      verified: true,
      last_verified: now,
      metadata: {
        discriminator: discordUser.discriminator,
        avatar: discordUser.avatar,
        email: discordUser.email,
        access_token: accessToken,
        refresh_token: refreshToken
      },
      updated_at: now
    }
  });
  
  // If the Discord profile has an avatar, update user's profile image if not already set
  try {
    authLogger.info(`Discord account linking: checking profile image \n\t`, {
      wallet: walletAddress,
      discordUsername: discordUser.username,
      hasDiscordAvatar: !!discordUser.avatar,
      discordId: discordUser.id
    });
    
    if (discordUser.avatar) {
      // Get the user to check if they already have a profile image
      const user = await prisma.users.findUnique({
        where: { wallet_address: walletAddress },
        select: { profile_image_url: true }
      });
      
      authLogger.info(`Discord link: current user profile status \n\t`, {
        wallet: walletAddress,
        hasExistingImage: !!user.profile_image_url,
        currentImageUrl: user.profile_image_url || 'none'
      });
      
      // If user has no profile image, use the Discord avatar
      if (!user.profile_image_url) {
        // Discord CDN URL for the avatar
        const avatarUrl = `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png?size=1024`;
        
        authLogger.info(`Discord link: preparing to update profile image \n\t`, {
          wallet: walletAddress,
          avatarUrl: avatarUrl
        });
        
        await prisma.users.update({
          where: { wallet_address: walletAddress },
          data: {
            profile_image_url: avatarUrl,
            profile_image_updated_at: now
          }
        });
        
        authLogger.info(`Discord link: successfully updated user profile image \n\t`, {
          wallet: walletAddress,
          imageUrl: avatarUrl,
          success: true,
          updatedAt: now.toISOString()
        });
      } else {
        authLogger.info(`Discord link: skipping profile image update (user already has one) \n\t`, {
          wallet: walletAddress,
          existingImage: user.profile_image_url
        });
      }
    } else {
      authLogger.info(`Discord link: no avatar available from Discord \n\t`, {
        wallet: walletAddress,
        discordUsername: discordUser.username
      });
    }
  } catch (imageError) {
    // Log warning but don't prevent the linking if image update fails
    authLogger.error(`Failed to update profile image from Discord, but account linking succeeded \n\t`, {
      wallet: walletAddress,
      error: imageError.message,
      stack: imageError.stack,
      discordUsername: discordUser.username,
      discordId: discordUser.id
    });
  }
  
  authLogger.info(`Discord account linked to wallet ${walletAddress} \n\t`, {
    discordUsername: discordUser.username
  });
}

export default router;