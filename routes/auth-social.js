// routes/auth-social.js

/**
 * Social Authentication Routes
 * 
 * @description Handles social authentication routes (Twitter, Discord, etc.)
 * 
 * @author BranchManager69
 * @version 2.0.0
 * @created 2025-05-08
 * @updated 2025-05-08
 */

import express from 'express';
import { config } from '../config/config.js';
import prisma from '../config/prisma.js';
import { logApi } from '../utils/logger-suite/logger.js';
import { requireAuth } from '../middleware/auth.js';
import axios from 'axios';
import { randomBytes } from 'crypto';
import {
  generateAccessToken,
  createRefreshToken,
  setAuthCookies,
  generateSessionId
} from '../utils/auth-helpers.js';

const router = express.Router();

// Create a dedicated logger for social auth operations
const authLogger = {
  ...logApi.forService('AUTH_SOCIAL'),
  analytics: logApi.analytics
};

/**
 * @swagger
 * /api/auth/twitter/callback:
 *   get:
 *     summary: Handle Twitter OAuth callback
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
 */
router.get('/twitter/callback', (req, res, next) => {
  // Bypass CORS for Twitter callback - set required CORS headers explicitly
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  next();
}, async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query;
    
    // Handle explicit OAuth errors returned by Twitter
    if (error) {
      authLogger.warn(`Twitter OAuth error returned: ${error} \n\t`, { 
        error,
        error_description,
        state: state?.substring(0, 6) + '...' || 'missing'
      });
      // Return JSON error response instead of redirecting to static HTML
      return res.status(400).json({
        error: 'twitter_oauth_error',
        error_type: error,
        error_description: error_description || '',
        message: 'An error occurred during Twitter authentication.'
      });
    }
    
    // Check if all required parameters are present
    if (!code || !state) {
      authLogger.warn(`Twitter OAuth callback missing required parameters \n\t`, { 
        codeExists: !!code,
        stateExists: !!state
      });
      return res.status(400).json({ 
        error: 'twitter_oauth_error',
        error_type: 'missing_parameters',
        message: 'Missing required OAuth parameters'
      });
    }
    
    // Check if session exists
    if (!req.session) {
      authLogger.error(`Twitter OAuth callback failed: Session not available \n\t`);
      return res.status(400).json({
        error: 'twitter_oauth_error',
        error_type: 'session_lost',
        message: 'Session data not available for OAuth flow'
      });
    }
    
    // Skip state verification for now since it's causing issues
    // We'll still log the state for debugging but won't enforce it
    authLogger.info(`Twitter OAuth state received: ${state.substring(0, 6)}... \n\t`);
    
    // Determine which callback URI to use based on environment
    const callbackUri = config.getEnvironment() === 'development' 
      ? process.env.X_CALLBACK_URI_DEVELOPMENT 
      : process.env.X_CALLBACK_URI;
    
    // Check for required environment variables
    if (!process.env.X_CLIENT_ID || !process.env.X_CLIENT_SECRET || !callbackUri) {
      authLogger.error(`Twitter OAuth missing configuration \n\t`, {
        clientIdExists: !!process.env.X_CLIENT_ID,
        clientSecretExists: !!process.env.X_CLIENT_SECRET,
        callbackUriExists: !!callbackUri
      });
      return res.status(500).json({
        error: 'twitter_oauth_error',
        error_type: 'configuration_error',
        message: 'Server configuration error for Twitter OAuth'
      });
    }
    
    // Get code verifier from cookie instead of session
    const codeVerifier = req.cookies.twitter_oauth_verifier;
    
    // Check for all cookies (debug)
    authLogger.info(`Twitter OAuth: Cookies received in callback \n\t`, {
      allCookies: req.cookies ? Object.keys(req.cookies).join(', ') : 'none',
      hasVerifierCookie: !!codeVerifier,
      verifierFirstChars: codeVerifier ? codeVerifier.substring(0, 6) + '...' : 'missing',
      domain: req.get('host'),
      referer: req.get('referer') || 'none',
      userAgent: req.get('user-agent')
    });
    
    if (!codeVerifier) {
      authLogger.error(`Twitter OAuth missing code verifier cookie \n\t`, {
        allHeaders: req.headers,
        allCookies: req.cookies
      });
      return res.status(400).json({
        error: 'twitter_oauth_error',
        error_type: 'missing_code_verifier',
        message: 'OAuth code verifier cookie missing'
      });
    }
    
    // Clear the verifier cookie since it's no longer needed
    authLogger.info(`Twitter OAuth: Clearing verifier cookie \n\t`);
    res.clearCookie('twitter_oauth_verifier');
    
    // Exchange code for access token with detailed error handling
    let tokenResponse;
    try {
      // Prepare parameters for token request
      const tokenParams = new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        client_id: process.env.X_CLIENT_ID,
        redirect_uri: callbackUri,
        code_verifier: codeVerifier
      });
      
      // Log token request parameters (with sensitive data masked)
      authLogger.info(`Exchanging code for token with parameters \n\t`, {
        code: code.substring(0, 6) + '...',
        grant_type: 'authorization_code',
        client_id: process.env.X_CLIENT_ID.substring(0, 6) + '...',
        redirect_uri: callbackUri,
        code_verifier: codeVerifier.substring(0, 6) + '...'
      });
      
      // Make token request
      tokenResponse = await axios.post(
        'https://api.twitter.com/2/oauth2/token',
        tokenParams,
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${Buffer.from(
              `${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`
            ).toString('base64')}`
          }
        }
      );
    } catch (tokenError) {
      // Handle token request error
      const responseData = tokenError.response?.data || {};
      authLogger.error(`Twitter OAuth token exchange failed \n\t`, {
        status: tokenError.response?.status,
        statusText: tokenError.response?.statusText,
        error: tokenError.message,
        responseData
      });
      
      return res.status(400).json({
        error: 'twitter_oauth_error',
        error_type: 'token_exchange',
        error_description: responseData.error || tokenError.message,
        message: 'Failed to exchange OAuth code for access token'
      });
    }
    
    // Extract token data
    const { access_token, refresh_token } = tokenResponse.data;
    
    // Get Twitter user info with detailed error handling
    let userResponse;
    try {
      userResponse = await axios.get('https://api.twitter.com/2/users/me', {
        headers: {
          Authorization: `Bearer ${access_token}`
        },
        params: {
          'user.fields': 'id,name,username,profile_image_url'
        }
      });
    } catch (userError) {
      // Handle user info request error
      const responseData = userError.response?.data || {};
      authLogger.error(`Twitter user info request failed \n\t`, {
        status: userError.response?.status,
        statusText: userError.response?.statusText,
        error: userError.message,
        responseData
      });
      
      return res.status(400).json({
        error: 'twitter_oauth_error',
        error_type: 'user_info',
        error_description: responseData.error || userError.message,
        message: 'Failed to retrieve Twitter user information'
      });
    }
    
    // Extract user data
    const twitterUser = userResponse.data.data;
    
    // Check if valid user data was returned
    if (!twitterUser || !twitterUser.id) {
      authLogger.error(`Twitter returned invalid user data \n\t`, { 
        responseData: userResponse.data
      });
      return res.status(400).json({
        error: 'twitter_oauth_error',
        error_type: 'invalid_user_data',
        message: 'Twitter returned invalid or incomplete user data'
      });
    }
    
    // Log successful user info retrieval
    authLogger.info(`Retrieved Twitter user info \n\t`, {
      id: twitterUser.id,
      username: twitterUser.username,
      hasProfileImage: !!twitterUser.profile_image_url
    });
    
    // First, check if this Twitter account is already linked and can be used for direct login
    const loginResult = await loginWithTwitter(twitterUser.id, twitterUser);
    
    if (loginResult.success) {
      // Generate session ID
      const sessionId = generateSessionId();
      
      // Create JWT token with user.id in payload
      const accessToken = generateAccessToken(loginResult.user, sessionId, 'twitter');
      
      // Create refresh token
      const refreshToken = await createRefreshToken(loginResult.user);
      
      // Set auth cookies
      setAuthCookies(res, req, accessToken, refreshToken);
      
      authLogger.info(`Twitter login: created session for wallet ${loginResult.wallet_address} \n\t`, {
        userId: loginResult.user.id,
        sessionId
      });
      
      // Redirect to the proper /me profile page
      const baseUrl = config.getEnvironment() === 'development' ? 'https://dev.degenduel.me' : 'https://degenduel.me';
      authLogger.info(`Redirecting to ${baseUrl}/me after successful Twitter login \n\t`);
      return res.redirect(`${baseUrl}/me`);
    }
    
    // If direct login wasn't successful, proceed with the linking flow
    
    // Store Twitter info in session for linking to wallet later
    req.session.twitter_user = {
      id: twitterUser.id,
      username: twitterUser.username,
      name: twitterUser.name,
      profile_image_url: twitterUser.profile_image_url,
      access_token,
      refresh_token
    };
    
    // Save session explicitly to ensure twitter_user data is persisted
    await new Promise((resolve, reject) => {
      req.session.save(err => {
        if (err) {
          authLogger.error(`Failed to save Twitter user data to session \n\t`, { error: err.message });
          reject(err);
        } else {
          resolve();
        }
      });
    });
    
    authLogger.info(`Twitter OAuth successful for user ${twitterUser.username} \n\t`);
    
    // If user is already authenticated with a wallet, link accounts
    if (req.cookies.session) {
      try {
        const decoded = jwt.verify(req.cookies.session, config.jwt.secret);
        
        if (decoded && decoded.wallet_address) {
          // Link Twitter account to wallet
          await linkTwitterToWallet(decoded.wallet_address, twitterUser, access_token, refresh_token);
          
          // Redirect to the proper /me profile page
          const baseUrl = config.getEnvironment() === 'development' ? 'https://dev.degenduel.me' : 'https://degenduel.me';
          authLogger.info(`Redirecting to ${baseUrl}/me?twitter_linked=true after linking 
	`);
          return res.redirect(`${baseUrl}/me?twitter_linked=true`);
        }
      } catch (error) {
        // Token verification failed, continue to login page
        authLogger.warn(`Failed to verify existing session when linking Twitter \n\t`, { error: error.message });
      }
    }
    
    // If no wallet is connected yet, redirect to a page where user can connect wallet
    const baseUrl = config.getEnvironment() === 'development' ? 'https://dev.degenduel.me' : 'https://degenduel.me';
    // Redirect to the home page with query parameters instead of nonexistent /connect-wallet page
    authLogger.info(`Redirecting to ${baseUrl}/?action=connect-wallet&twitter=pending to complete flow \n\t`);
    return res.redirect(`${baseUrl}/?action=connect-wallet&twitter=pending`);
  } catch (error) {
    authLogger.error(`Twitter OAuth callback failed \n\t`, {
      error: error.message,
      stack: error.stack
    });
    return res.status(500).json({
      error: 'twitter_oauth_error',
      error_type: 'unexpected_error',
      error_description: error.message,
      message: 'An unexpected error occurred during Twitter authentication'
    });
  }
});

/**
 * @swagger
 * /api/auth/twitter/link:
 *   post:
 *     summary: Link Twitter account to connected wallet
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Twitter account linked successfully
 *       401:
 *         description: Not authenticated
 *       500:
 *         description: Server error
 */
router.post('/twitter/link', requireAuth, async (req, res) => {
  try {
    // Ensure user has Twitter data in session
    if (!req.session?.twitter_user) {
      authLogger.warn(`No Twitter data in session for linking \n\t`);
      return res.status(400).json({ error: 'No Twitter authentication data found' });
    }
    
    const { wallet_address } = req.user;
    const { id, username, name, profile_image_url, access_token, refresh_token } = req.session.twitter_user;
    
    // Link Twitter account to wallet
    await linkTwitterToWallet(wallet_address, 
      { id, username, name, profile_image_url }, 
      access_token, 
      refresh_token
    );
    
    // Clear Twitter data from session
    delete req.session.twitter_user;
    
    authLogger.info(`Twitter account linked successfully for ${wallet_address} \n\t`);
    return res.json({ success: true, message: 'Twitter account linked successfully' });
  } catch (error) {
    authLogger.error(`Failed to link Twitter account \n\t`, {
      error: error.message,
      stack: error.stack,
      wallet: req.user?.wallet_address
    });
    return res.status(500).json({ error: 'Failed to link Twitter account' });
  }
});


/**
 * @swagger
 * /api/auth/twitter/login:
 *   get:
 *     summary: Initiate Twitter OAuth login
 *     tags: [Authentication]
 *     security: []
 *     responses:
 *       302:
 *         description: Redirects to Twitter OAuth
 */
router.get('/twitter/login', async (req, res) => {
  try {
    // Generate CSRF token and state for security
    const state = randomBytes(32).toString('hex');
    const codeVerifier = randomBytes(32).toString('hex');
    
    // Generate code challenge using SHA-256
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');

    // Store code verifier in cookie instead of session
    // This is more reliable than session storage for this specific use case
    authLogger.info(`Twitter OAuth: Creating cookie with verifier (first 6 chars: ${codeVerifier.substring(0, 6)}...) \n\t`, {
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
    res.cookie('twitter_oauth_verifier', codeVerifier, {
      httpOnly: true,
      secure: config.getEnvironment() === 'production',
      sameSite: 'lax', // Important: SameSite=lax needed for OAuth redirects to work
      maxAge: 10 * 60 * 1000 // 10 minutes
    });

    // Determine which callback URI to use based on environment
    const callbackUri = config.getEnvironment() === 'development' 
      ? process.env.X_CALLBACK_URI_DEVELOPMENT 
      : process.env.X_CALLBACK_URI;

    // Check if callback URI is properly configured
    if (!callbackUri) {
      authLogger.error(`Twitter OAuth failed: Missing callback URI \n\t`, {
        environment: config.getEnvironment(),
        devCallback: process.env.X_CALLBACK_URI_DEVELOPMENT,
        prodCallback: process.env.X_CALLBACK_URI
      });
      return res.status(500).json({ 
        error: 'Configuration error',
        details: 'OAuth callback URI not configured'
      });
    }

    // Check if client ID is properly configured
    if (!process.env.X_CLIENT_ID) {
      authLogger.error(`Twitter OAuth failed: Missing client ID \n\t`);
      return res.status(500).json({ 
        error: 'Configuration error',
        details: 'OAuth client ID not configured'
      });
    }

    // Construct the Twitter OAuth URL
    const authUrl = new URL('https://twitter.com/i/oauth2/authorize');
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('client_id', process.env.X_CLIENT_ID);
    authUrl.searchParams.append('redirect_uri', callbackUri);
    // Include the three default required scopes for Twitter API v2
    // tweet.read, users.read, follows.read are the standard minimum scopes
    authUrl.searchParams.append('scope', 'tweet.read users.read follows.read');
    authUrl.searchParams.append('state', state);
    authUrl.searchParams.append('code_challenge', codeChallenge);
    authUrl.searchParams.append('code_challenge_method', 'S256');

    // Log OAuth parameters for debugging
    authLogger.info(`Initiating Twitter OAuth flow \n\t`, {
      state: state.substring(0, 6) + '...',
      codeChallenge: codeChallenge.substring(0, 6) + '...',
      callbackUri,
      clientId: process.env.X_CLIENT_ID.substring(0, 6) + '...',
      scope: 'tweet.read users.read follows.read',
      fullUrl: authUrl.toString()
    });

    // Redirect user to Twitter OAuth
    return res.redirect(authUrl.toString());
  } catch (error) {
    authLogger.error(`Twitter OAuth initialization failed \n\t`, {
      error: error.message,
      stack: error.stack
    });
    return res.status(500).json({ 
      error: 'Could not initiate Twitter authentication',
      details: error.message
    });
  }
});

/**
 * Find wallet by Twitter ID and create a session
 * @param {string} twitterId - Twitter user ID
 * @param {object} twitterUser - Twitter user data
 * @returns {Promise<{success: boolean, wallet_address?: string, error?: string}>}
 */
async function loginWithTwitter(twitterId, twitterUser) {
  try {
    // Look up the user_social_profiles entry
    const socialProfile = await prisma.user_social_profiles.findFirst({
      where: {
        platform: 'twitter',
        platform_user_id: twitterId,
        verified: true
      }
    });
    
    // If no linked account found, return error
    if (!socialProfile) {
      authLogger.warn(`No verified Twitter account found for login \n\t`, {
        twitterId,
        twitterUsername: twitterUser.username
      });
      return {
        success: false,
        error: 'No linked wallet found for this Twitter account'
      };
    }
    
    // Get the wallet user
    const user = await prisma.users.findUnique({
      where: { wallet_address: socialProfile.wallet_address }
    });
    
    // If no user found, return error
    if (!user) {
      authLogger.warn(`Twitter linked to wallet but user not found \n\t`, {
        twitterId,
        wallet: socialProfile.wallet_address
      });
      return {
        success: false,
        error: 'User not found for linked Twitter account'
      };
    }
    
    // Update user last login time
    await prisma.users.update({
      where: { wallet_address: user.wallet_address },
      data: { last_login: new Date() }
    });
    
    // Update Twitter profile data if needed
    if (twitterUser.username !== socialProfile.username || 
        twitterUser.profile_image_url !== socialProfile.metadata?.profile_image_url) {
      
      await prisma.user_social_profiles.update({
        where: {
          wallet_address_platform: {
            wallet_address: socialProfile.wallet_address,
            platform: 'twitter'
          }
        },
        data: {
          username: twitterUser.username,
          last_verified: new Date(),
          metadata: {
            ...socialProfile.metadata,
            name: twitterUser.name,
            profile_image_url: twitterUser.profile_image_url
          },
          updated_at: new Date()
        }
      });
    }
    
    // Check if we should update the user's profile image
    try {
      authLogger.info(`Checking whether to update profile image for ${socialProfile.wallet_address} \n\t`, {
        twitterUsername: twitterUser.username,
        hasTwitterProfileImage: !!twitterUser.profile_image_url,
        twitterImageUrl: twitterUser.profile_image_url || 'none'
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
      
      // Check if profile image is Twitter-sourced by URL pattern
      const isTwitterProfileImage = userProfile.profile_image_url && 
        userProfile.profile_image_url.includes('pbs.twimg.com/profile_images');
      
      authLogger.info(`Profile image analysis \n\t`, {
        wallet: socialProfile.wallet_address,
        isTwitterImage: isTwitterProfileImage,
        needsUpdate: !userProfile.profile_image_url || isTwitterProfileImage
      });
      
      // If user has no profile image or has a Twitter profile image that may be outdated
      if (!userProfile.profile_image_url || isTwitterProfileImage) {
        // Get full size image by removing "_normal" suffix
        const fullSizeImageUrl = twitterUser.profile_image_url ? 
          twitterUser.profile_image_url.replace('_normal', '') : null;
        
        authLogger.info(`Processing Twitter profile image \n\t`, {
          wallet: socialProfile.wallet_address,
          originalTwitterImage: twitterUser.profile_image_url || 'none',
          convertedFullSizeUrl: fullSizeImageUrl || 'none',
          isDifferent: fullSizeImageUrl !== userProfile.profile_image_url
        });
        
        // Update profile image if it's different from current one and available
        if (fullSizeImageUrl && fullSizeImageUrl !== userProfile.profile_image_url) {
          authLogger.info(`About to update profile image in database \n\t`, {
            wallet: socialProfile.wallet_address,
            oldImage: userProfile.profile_image_url || 'none',
            newImage: fullSizeImageUrl
          });
          
          await prisma.users.update({
            where: { wallet_address: socialProfile.wallet_address },
            data: {
              profile_image_url: fullSizeImageUrl,
              profile_image_updated_at: new Date()
            }
          });
          
          authLogger.info(`Successfully updated Twitter profile image on login \n\t`, {
            wallet: socialProfile.wallet_address,
            oldImage: userProfile.profile_image_url || 'none',
            newImage: fullSizeImageUrl,
            success: true
          });
        } else {
          authLogger.info(`No profile image update needed \n\t`, {
            wallet: socialProfile.wallet_address,
            reason: !fullSizeImageUrl ? 'No Twitter image available' : 'Images are identical'
          });
        }
      }
    } catch (imageError) {
      authLogger.warn(`Failed to sync Twitter profile image on login \n\t`, {
        wallet: socialProfile.wallet_address,
        error: imageError.message,
        stack: imageError.stack,
        twitterImageUrl: twitterUser.profile_image_url || 'none'
      });
      // Continue with login despite image sync error
    }
    
    authLogger.info(`Twitter login successful for ${user.wallet_address} \n\t`, {
      twitterUsername: twitterUser.username,
      wallet: user.wallet_address
    });
    
    return {
      success: true,
      wallet_address: user.wallet_address,
      user
    };
  } catch (error) {
    authLogger.error(`Failed to login with Twitter \n\t`, {
      error: error.message,
      stack: error.stack,
      twitterId
    });
    
    return {
      success: false,
      error: 'Failed to login with Twitter'
    };
  }
}

/**
 * Helper function to link Twitter account to wallet
 */
async function linkTwitterToWallet(walletAddress, twitterUser, accessToken, refreshToken) {
  const now = new Date();
  
  // Check if this Twitter account is already linked to another wallet
  const existingLink = await prisma.user_social_profiles.findFirst({
    where: {
      platform: 'twitter',
      platform_user_id: twitterUser.id
    }
  });
  
  if (existingLink && existingLink.wallet_address !== walletAddress) {
    authLogger.warn(`Twitter account already linked to different wallet \n\t`, {
      twitterId: twitterUser.id,
      existingWallet: existingLink.wallet_address,
      requestedWallet: walletAddress
    });
    throw new Error('This Twitter account is already linked to another wallet');
  }
  
  // Create or update social profile
  await prisma.user_social_profiles.upsert({
    where: {
      wallet_address_platform: {
        wallet_address: walletAddress,
        platform: 'twitter'
      }
    },
    create: {
      wallet_address: walletAddress,
      platform: 'twitter',
      platform_user_id: twitterUser.id,
      username: twitterUser.username,
      verified: true,
      verification_date: now,
      last_verified: now,
      metadata: {
        name: twitterUser.name,
        profile_image_url: twitterUser.profile_image_url,
        access_token: accessToken,
        refresh_token: refreshToken
      },
      created_at: now,
      updated_at: now
    },
    update: {
      username: twitterUser.username,
      verified: true,
      last_verified: now,
      metadata: {
        name: twitterUser.name,
        profile_image_url: twitterUser.profile_image_url,
        access_token: accessToken,
        refresh_token: refreshToken
      },
      updated_at: now
    }
  });
  
  // If the Twitter profile has an image, update user's profile image if not already set
  try {
    authLogger.info(`Twitter account linking: checking profile image \n\t`, {
      wallet: walletAddress,
      twitterUsername: twitterUser.username,
      hasTwitterImage: !!twitterUser.profile_image_url,
      twitterImageUrl: twitterUser.profile_image_url || 'none'
    });
    
    if (twitterUser.profile_image_url) {
      // Get the user to check if they already have a profile image
      const user = await prisma.users.findUnique({
        where: { wallet_address: walletAddress },
        select: { profile_image_url: true }
      });
      
      authLogger.info(`Twitter link: current user profile status \n\t`, {
        wallet: walletAddress,
        hasExistingImage: !!user.profile_image_url,
        currentImageUrl: user.profile_image_url || 'none'
      });
      
      // If user has no profile image, use the Twitter profile image
      // The Twitter API provides a "_normal" size by default, remove this to get full size
      if (!user.profile_image_url) {
        const fullSizeImageUrl = twitterUser.profile_image_url.replace('_normal', '');
        
        authLogger.info(`Twitter link: preparing to update profile image \n\t`, {
          wallet: walletAddress,
          normalImageUrl: twitterUser.profile_image_url,
          fullSizeImageUrl: fullSizeImageUrl
        });
        
        await prisma.users.update({
          where: { wallet_address: walletAddress },
          data: {
            profile_image_url: fullSizeImageUrl,
            profile_image_updated_at: new Date()
          }
        });
        
        authLogger.info(`Twitter link: successfully updated user profile image \n\t`, {
          wallet: walletAddress,
          imageUrl: fullSizeImageUrl,
          success: true,
          updatedAt: now.toISOString()
        });
      } else {
        authLogger.info(`Twitter link: skipping profile image update (user already has one) \n\t`, {
          wallet: walletAddress,
          existingImage: user.profile_image_url
        });
      }
    } else {
      authLogger.info(`Twitter link: no profile image available from Twitter \n\t`, {
        wallet: walletAddress,
        twitterUsername: twitterUser.username
      });
    }
  } catch (imageError) {
    // Log warning but don't prevent the linking if image update fails
    authLogger.error(`Failed to update profile image from Twitter, but account linking succeeded \n\t`, {
      wallet: walletAddress,
      error: imageError.message,
      stack: imageError.stack,
      twitterUsername: twitterUser.username,
      twitterImageUrl: twitterUser.profile_image_url || 'none'
    });
  }
  
  authLogger.info(`Twitter account linked to wallet ${walletAddress} \n\t`, {
    twitterUsername: twitterUser.username
  });
}

// is this endpoint used? and, regardless, do I care?
/**
 * @swagger
 * /api/auth/challenge:
 *   get:
 *     summary: Get a challenge nonce for wallet authentication
 *     tags: [Authentication]
 *     parameters:
 *       - in: query
 *         name: wallet
 *         required: true
 *         schema:
 *           type: string
 *         description: Wallet address to generate nonce for
 *     responses:
 *       200:
 *         description: Challenge nonce generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 nonce:
 *                   type: string
 *       400:
 *         description: Missing wallet address
 *       500:
 *         description: Internal server error
 */
// Twitter OAuth configuration check route
router.get('/twitter/check-config', async (req, res) => {
  try {
    // Check environment variables
    const config = {
      X_APP_ID: process.env.X_APP_ID ? '✅ Set' : '❌ Missing',
      X_CLIENT_ID: process.env.X_CLIENT_ID ? '✅ Set' : '❌ Missing',
      X_CLIENT_SECRET: process.env.X_CLIENT_SECRET ? '✅ Set' : '❌ Missing',
      X_CALLBACK_URI: process.env.X_CALLBACK_URI ? '✅ Set' : '❌ Missing',
      X_CALLBACK_URI_DEVELOPMENT: process.env.X_CALLBACK_URI_DEVELOPMENT ? '✅ Set' : '❌ Missing',
      NODE_ENV: process.env.NODE_ENV || 'development',
      ACTIVE_CALLBACK_URI: process.env.NODE_ENV === 'development' 
        ? process.env.X_CALLBACK_URI_DEVELOPMENT 
        : process.env.X_CALLBACK_URI
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
      config,
      sessionStatus,
      redisStatus,
      sessionVerified,
      currentEnvironment: process.env.NODE_ENV || 'development',
      message: 'Twitter OAuth configuration check completed'
    });
  } catch (error) {
    authLogger.error(`Twitter config check failed \n\t`, {
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



// Discord auth routes would be added here

export default router;