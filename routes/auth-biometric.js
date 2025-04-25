// routes/auth-biometric.js
// WebAuthn (Face ID/Touch ID) Authentication Implementation

import express from 'express';
import { randomBytes } from 'crypto';
import * as SimpleWebAuthnServer from '@simplewebauthn/server';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} from '@simplewebauthn/server';

// Helper function to replace the previous base64url import
const base64url = {
  encode: (buffer) => Buffer.from(buffer).toString('base64url'),
  decode: (base64url) => Buffer.from(base64url, 'base64url')
};
import { logApi } from '../utils/logger-suite/logger.js';
import prisma from '../config/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { config } from '../config/config.js';
import jwt from 'jsonwebtoken';

const router = express.Router();

// WebAuthn configuration
const rpName = 'DegenDuel';
const rpID = config.webauthn?.rpID || 'degenduel.me';
const expectedOrigin = config.webauthn?.origin || 'https://degenduel.me';

// NOTE: Before using this module, run the proper Prisma migration:
// - Add biometric_credentials table to schema.prisma
// - Add credential_id column to auth_challenges table
// - Run 'npx prisma migrate dev --name add_biometric_auth'

// Log availability of biometric authentication
logApi.info('Biometric authentication initialized - requires proper schema migration');

/**
 * Helper to get all credentials for a user
 */
async function getUserCredentials(userId) {
  try {
    const credentials = await prisma.biometric_credentials.findMany({
      where: { user_id: userId }
    });
    
    return credentials.map(cred => ({
      credentialID: cred.credential_id,
      publicKey: cred.public_key,
      counter: cred.counter || 0,
      deviceInfo: cred.device_info || {},
    }));
  } catch (error) {
    logApi.error('Error getting user credentials', {
      error: error.message,
      userId,
    });
    return [];
  }
}

/**
 * Save challenge to auth_challenges table
 */
async function saveChallenge(userId, challenge, credentialId = null) {
  try {
    // Expire in 5 minutes
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    
    // Check if there's an existing challenge
    const existingChallenge = await prisma.auth_challenges.findUnique({
      where: { wallet_address: userId }
    });
    
    if (existingChallenge) {
      // Update existing challenge
      await prisma.auth_challenges.update({
        where: { wallet_address: userId },
        data: {
          nonce: challenge,
          expires_at: expiresAt,
          credential_id: credentialId,
        }
      });
    } else {
      // Create new challenge
      await prisma.auth_challenges.create({
        data: {
          wallet_address: userId,
          nonce: challenge,
          expires_at: expiresAt,
          credential_id: credentialId,
        }
      });
    }
    
    return true;
  } catch (error) {
    logApi.error('Error saving challenge', {
      error: error.message,
      userId,
    });
    return false;
  }
}

/**
 * Retrieve challenge from auth_challenges table
 */
async function getChallenge(userId) {
  try {
    const challenge = await prisma.auth_challenges.findUnique({
      where: { wallet_address: userId }
    });
    
    if (!challenge || challenge.expires_at < new Date()) {
      return null;
    }
    
    return {
      challenge: challenge.nonce,
      credentialId: challenge.credential_id,
    };
  } catch (error) {
    logApi.error('Error getting challenge', {
      error: error.message,
      userId,
    });
    return null;
  }
}

/**
 * @route POST /api/auth/biometric/register-options
 * @description Get options for registering a new biometric credential
 * @access Private (must be authenticated)
 */
router.post('/register-options', requireAuth, async (req, res) => {
  try {
    const { nickname, authenticatorType } = req.body;
    const userId = req.user.wallet_address;
    
    // Get existing credentials
    const userCredentials = await getUserCredentials(userId);
    
    // Generate registration options
    const options = generateRegistrationOptions({
      rpName,
      rpID,
      userID: userId,
      userName: nickname || userId.slice(0, 8) + '...',
      attestationType: 'none',
      excludeCredentials: userCredentials.map(cred => ({
        id: base64url.decode(cred.credentialID),
        type: 'public-key',
        transports: ['internal'],
      })),
      authenticatorSelection: {
        authenticatorAttachment: authenticatorType || undefined,
        requireResidentKey: false,
        userVerification: 'preferred',
      },
    });
    
    // Store challenge for verification
    await saveChallenge(userId, options.challenge);
    
    res.json(options);
  } catch (error) {
    logApi.error('Error generating biometric registration options', {
      error: error.message,
      stack: error.stack,
      user: req.user?.wallet_address,
    });
    
    res.status(500).json({
      error: 'Failed to generate registration options',
      message: error.message,
    });
  }
});

/**
 * @route POST /api/auth/biometric/register-verify
 * @description Verify registration response and store credential
 * @access Private (must be authenticated)
 */
router.post('/register-verify', requireAuth, async (req, res) => {
  try {
    const userId = req.user.wallet_address;
    const { deviceName, deviceType } = req.body;
    
    // Get the original challenge
    const storedData = await getChallenge(userId);
    
    if (!storedData || !storedData.challenge) {
      return res.status(400).json({
        error: 'invalid_challenge',
        message: 'Registration challenge not found or expired',
      });
    }
    
    // Verify attestation response
    const verification = await verifyRegistrationResponse({
      response: req.body,
      expectedChallenge: storedData.challenge,
      expectedOrigin,
      expectedRPID: rpID,
    });
    
    if (!verification.verified) {
      return res.status(400).json({
        error: 'verification_failed',
        message: 'Failed to verify registration response',
      });
    }
    
    // Store the credential in the database
    const { credentialID, credentialPublicKey, counter } = verification.registrationInfo;
    
    // Create credential using Prisma model
    await prisma.biometric_credentials.create({
      data: {
        user_id: userId,
        credential_id: credentialID.toString('base64url'),
        public_key: credentialPublicKey.toString('base64url'),
        device_info: {
          name: deviceName || 'Unknown Device',
          type: deviceType || 'unknown',
          userAgent: req.headers['user-agent'],
        },
        counter: counter,
        created_at: new Date(),
        last_used: new Date()
      }
    });
    
    res.json({
      success: true,
      message: 'Biometric authentication registered successfully',
      credentialId: credentialID.toString('base64url'),
    });
  } catch (error) {
    logApi.error('Error verifying biometric registration', {
      error: error.message,
      stack: error.stack,
      user: req.user?.wallet_address,
    });
    
    res.status(500).json({
      error: 'Failed to register biometric authentication',
      message: error.message,
    });
  }
});

/**
 * @route POST /api/auth/biometric/auth-options
 * @description Get options for authenticating with biometric
 * @access Public
 */
router.post('/auth-options', async (req, res) => {
  try {
    const { userId, credentialId } = req.body;
    
    if (!userId) {
      return res.status(400).json({
        error: 'missing_user_id',
        message: 'User ID is required',
      });
    }
    
    // Get user's credentials
    const userCredentials = await getUserCredentials(userId);
    
    if (userCredentials.length === 0) {
      return res.status(404).json({
        error: 'no_credentials',
        message: 'No biometric credentials found for this user',
      });
    }
    
    // Generate authentication options
    const options = generateAuthenticationOptions({
      rpID,
      allowCredentials: userCredentials.map(cred => ({
        id: base64url.decode(cred.credentialID),
        type: 'public-key',
        transports: ['internal', 'hybrid', 'ble', 'nfc', 'usb'],
      })),
      userVerification: 'preferred',
    });
    
    // Store challenge for verification
    await saveChallenge(userId, options.challenge, credentialId);
    
    res.json(options);
  } catch (error) {
    logApi.error('Error generating biometric authentication options', {
      error: error.message,
      stack: error.stack,
    });
    
    res.status(500).json({
      error: 'Failed to generate authentication options',
      message: error.message,
    });
  }
});

/**
 * @route POST /api/auth/biometric/auth-verify
 * @description Verify authentication response and issue JWT
 * @access Public
 */
router.post('/auth-verify', async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({
        error: 'missing_user_id',
        message: 'User ID is required',
      });
    }
    
    // Get user's credentials
    const userCredentials = await getUserCredentials(userId);
    const credentialID = req.body.id;
    
    if (!userCredentials || userCredentials.length === 0) {
      return res.status(404).json({
        error: 'no_credentials',
        message: 'No biometric credentials found for this user',
      });
    }
    
    // Find the specific credential
    const credential = userCredentials.find(
      cred => cred.credentialID === credentialID
    );
    
    if (!credential) {
      return res.status(404).json({
        error: 'credential_not_found',
        message: 'Credential not found',
      });
    }
    
    // Get stored challenge
    const storedData = await getChallenge(userId);
    
    if (!storedData || !storedData.challenge) {
      return res.status(400).json({
        error: 'invalid_challenge',
        message: 'Authentication challenge not found or expired',
      });
    }
    
    // Verify the authentication response
    const verification = await verifyAuthenticationResponse({
      response: req.body,
      expectedChallenge: storedData.challenge,
      expectedOrigin,
      expectedRPID: rpID,
      authenticator: {
        credentialID: base64url.decode(credential.credentialID),
        credentialPublicKey: base64url.decode(credential.publicKey),
        counter: credential.counter,
      },
    });
    
    if (!verification.verified) {
      return res.status(400).json({
        error: 'verification_failed',
        message: 'Failed to verify authentication',
      });
    }
    
    // Update the credential's counter using Prisma
    await prisma.biometric_credentials.update({
      where: { credential_id: credentialID },
      data: {
        counter: verification.authenticationInfo.newCounter,
        last_used: new Date()
      }
    });
    
    // Find user in database
    const user = await prisma.users.findUnique({
      where: { wallet_address: userId },
    });
    
    if (!user) {
      return res.status(404).json({
        error: 'user_not_found',
        message: 'User not found',
      });
    }
    
    // Generate session ID for tracking and analytics
    const sessionId = Buffer.from(randomBytes(16)).toString('hex');
    
    // Create JWT token for session
    const jwtToken = jwt.sign(
      {
        wallet_address: user.wallet_address,
        role: user.role,
        session_id: sessionId,
        auth_method: 'biometric',
      },
      config.jwt.secret,
      { expiresIn: '12h' }
    );
    
    // Set cookie
    const cookieOptions = {
      httpOnly: true,
      sameSite: 'none',
      secure: true,
      maxAge: 12 * 60 * 60 * 1000, // 12 hours
      domain: '.degenduel.me',
    };
    
    res.cookie('session', jwtToken, cookieOptions);
    
    // Update user's last login
    await prisma.users.update({
      where: { wallet_address: userId },
      data: { last_login: new Date() },
    });
    
    // Get device info
    const deviceInfo = credential.deviceInfo || {};
    
    // Return user info
    res.json({
      verified: true,
      user: {
        wallet_address: user.wallet_address,
        role: user.role,
        nickname: user.nickname,
      },
      device: {
        device_authorized: true,
        device_id: credentialID,
        device_name: deviceInfo.name || 'Biometric Device',
        requires_authorization: false,
      },
      auth_method: 'biometric',
    });
  } catch (error) {
    logApi.error('Error verifying biometric authentication', {
      error: error.message,
      stack: error.stack,
    });
    
    res.status(500).json({
      error: 'Failed to verify biometric authentication',
      message: error.message,
    });
  }
});

/**
 * @route GET /api/auth/biometric/credentials
 * @description Get all biometric credentials for the current user
 * @access Private (must be authenticated)
 */
router.get('/credentials', requireAuth, async (req, res) => {
  try {
    const userId = req.user.wallet_address;
    
    // Get all credentials for the user
    const credentials = await getUserCredentials(userId);
    
    // Return sanitized credential info (don't expose the public key)
    const sanitizedCredentials = credentials.map(cred => ({
      id: cred.credentialID,
      name: cred.deviceInfo?.name || 'Unknown Device',
      created_at: cred.deviceInfo?.created_at || null,
      last_used: cred.deviceInfo?.last_used || null,
      device_type: cred.deviceInfo?.type || 'unknown',
    }));
    
    res.json({
      credentials: sanitizedCredentials,
    });
  } catch (error) {
    logApi.error('Error fetching biometric credentials', {
      error: error.message,
      stack: error.stack,
      user: req.user?.wallet_address,
    });
    
    res.status(500).json({
      error: 'Failed to fetch biometric credentials',
      message: error.message,
    });
  }
});

/**
 * @route DELETE /api/auth/biometric/credentials/:id
 * @description Delete a biometric credential
 * @access Private (must be authenticated)
 */
router.delete('/credentials/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.user.wallet_address;
    const credentialId = req.params.id;
    
    // Delete the credential using Prisma
    try {
      await prisma.biometric_credentials.deleteMany({
        where: {
          user_id: userId,
          credential_id: credentialId
        }
      });
      
      // Check if anything was deleted
      const count = await prisma.biometric_credentials.count({
        where: {
          user_id: userId,
          credential_id: credentialId
        }
      });
      
      if (count > 0) {
        return res.status(404).json({
          error: 'credential_not_found',
          message: 'Credential not found or already deleted',
        });
      }
    } catch (deleteError) {
      throw deleteError;
    }
    
    res.json({
      success: true,
      message: 'Credential deleted successfully',
    });
  } catch (error) {
    logApi.error('Error deleting biometric credential', {
      error: error.message,
      stack: error.stack,
      user: req.user?.wallet_address,
      credential_id: req.params.id,
    });
    
    res.status(500).json({
      error: 'Failed to delete biometric credential',
      message: error.message,
    });
  }
});

export default router;