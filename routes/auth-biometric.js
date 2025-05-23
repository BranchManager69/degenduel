// routes/auth-biometric.js

/**
 * Biometric Authentication Routes (Refactored to use user.id)
 * 
 * @description Handles biometric authentication routes for the application
 * 
 * @author BranchManager69
 * @version 2.0.0 
 * @created 2025-04-01
 * @updated 2025-05-08
 */

import express from 'express';
import { randomBytes } from 'crypto';
import { Buffer } from 'buffer'; // Needed for Buffer operations
// SimpleWebAuthn is a library for implementing WebAuthn (Face ID/Touch ID) authentication
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} from '@simplewebauthn/server';
import { isoUint8Array } from '@simplewebauthn/server/helpers';

// Helper function to replace the previous base64url import
const base64url = {
  encode: (buffer) => Buffer.from(buffer).toString('base64url'),
  decode: (base64url) => Buffer.from(base64url, 'base64url')
};

import { logApi } from '../utils/logger-suite/logger.js';
import prisma from '../config/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { config } from '../config/config.js';
// Import authentication helpers
import {
  generateAccessToken,
  createRefreshToken,
  setAuthCookies,
  generateSessionId
} from '../utils/auth-helpers.js';

const router = express.Router();

// Create a dedicated logger for biometric auth operations
const authLogger = {
  ...logApi.forService('AUTH_BIOMETRIC'),
  analytics: logApi.analytics
};

// WebAuthn configuration
const rpName = 'DegenDuel';
const rpID = config.webauthn?.rpID || 'degenduel.me';
const expectedOrigin = config.webauthn?.origin || 'https://degenduel.me'; // is this ALWAYS the case?

// Log availability of biometric authentication
logApi.info('Biometric authentication initialized (using user.id)');

/**
 * Helper to get all credentials for a user by user.id
 */
async function getUserCredentials(userIdInt) {
  try {
    if (typeof userIdInt !== 'number' || !Number.isInteger(userIdInt)) {
        throw new Error('Invalid user ID type provided to getUserCredentials');
    }
    const credentials = await prisma.biometric_credentials.findMany({
      where: { user_id: userIdInt } // Use integer user_id
    });
    
    // Convert stored base64url strings back to Buffers for SimpleWebAuthn
    return credentials.map(cred => ({
      // Ensure credentialID and publicKey are Buffers
      credentialID: base64url.decode(cred.credential_id),
      publicKey: base64url.decode(cred.public_key),
      counter: BigInt(cred.counter || 0), // Ensure counter is BigInt
      transports: cred.device_info?.transports || undefined,
      // Include original string IDs for potential internal use if needed
      _credentialIDString: cred.credential_id,
      _deviceInfo: cred.device_info || {},
    }));
  } catch (error) {
    authLogger.error('Error getting user credentials', {
      error: error.message,
      stack: error.stack,
      userIdInt,
    });
    return [];
  }
}

/**
 * Save biometric challenge to biometric_auth_challenges table
 */
async function saveBiometricChallenge(userIdInt, challenge, type, credentialId = null) {
  try {
     if (typeof userIdInt !== 'number' || !Number.isInteger(userIdInt)) {
        throw new Error('Invalid user ID type provided to saveBiometricChallenge');
    }
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes expiry

    // Clean up any old challenges for this user first
    await prisma.biometric_auth_challenges.deleteMany({
        where: { user_id: userIdInt }
    });

    // Create new challenge
    await prisma.biometric_auth_challenges.create({
      data: {
        user_id: userIdInt,
        challenge: challenge,
        expires_at: expiresAt,
        type: type, // 'registration' or 'authentication'
        credential_id: credentialId, // Store intended credential ID if provided
      }
    });
    
    authLogger.debug(`Saved biometric challenge for user ${userIdInt}`, { type });
    return true;
  } catch (error) {
    authLogger.error('Error saving biometric challenge', {
      error: error.message,
      stack: error.stack,
      userIdInt,
    });
    return false;
  }
}

/**
 * Retrieve biometric challenge from biometric_auth_challenges table
 */
async function getBiometricChallenge(userIdInt, type) {
  try {
    if (typeof userIdInt !== 'number' || !Number.isInteger(userIdInt)) {
        throw new Error('Invalid user ID type provided to getBiometricChallenge');
    }
    const record = await prisma.biometric_auth_challenges.findFirst({
      where: { 
        user_id: userIdInt,
        type: type, // Match the type of challenge expected
        expires_at: { gt: new Date() } // Ensure it hasn't expired
       },
       orderBy: {
         created_at: 'desc' // Get the latest one if multiple somehow exist
       }
    });
    
    if (!record) {
        authLogger.warn(`No valid biometric challenge found for user ${userIdInt}`, { type });
        return null;
    }
    
    // Optionally delete the challenge once retrieved to prevent reuse (single-use challenge)
    // await prisma.biometric_auth_challenges.delete({ where: { id: record.id } });

    return {
      challenge: record.challenge,
      credentialId: record.credential_id, // Return associated credential ID if stored
    };
  } catch (error) {
    authLogger.error('Error getting biometric challenge', {
      error: error.message,
      stack: error.stack,
      userIdInt,
    });
    return null;
  }
}

/**
 * @route POST /api/auth/biometric/register-options
 * @description Get options for registering a new biometric credential
 * @access Private (must be authenticated via existing session)
 */
router.post('/register-options', requireAuth, async (req, res) => {
  try {
    const { nickname, authenticatorType } = req.body;
    
    // Use user.id (integer) from the authenticated session
    const userIdInt = req.user.id;
    const userWallet = req.user.wallet_address;
    const userNickname = nickname || userWallet.slice(0, 6) + '...'; // Use wallet for default username

    if (!userIdInt) {
      authLogger.warn('User ID missing from authenticated request in register-options');
      return res.status(401).json({ error: 'Invalid session' });
    }

    // Get existing credentials using user.id
    const userCredentials = await getUserCredentials(userIdInt);
    
    // Generate registration options
    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      // WebAuthn userID should be a stable, unique identifier for the user. 
      // Using the database integer ID (converted to proper Uint8Array format) is best practice.
      userID: isoUint8Array.fromUTF8String(`DD${userIdInt}`), // Convert to proper format with prefix
      userName: userNickname, 
      attestationType: 'direct', // Request attestation for better device info
      excludeCredentials: userCredentials.map(cred => ({
        id: cred.credentialID, // Pass the Buffer directly
        type: 'public-key',
        transports: cred.transports, // Use transports if available
      })),
      authenticatorSelection: {
        residentKey: 'required', // Require resident keys (Passkeys) for cross-device sync
        requireResidentKey: true, // Make resident keys required for Passkey support
        userVerification: 'required', // Require biometric verification
        authenticatorAttachment: authenticatorType || undefined,
      },
    });
    
    // Store challenge for verification using user.id
    await saveBiometricChallenge(userIdInt, options.challenge, 'registration');
    
    authLogger.info(`Generated biometric registration options for user ${userIdInt}`);
    // Return the options
    res.json(options);
  } catch (error) {
    authLogger.error('Error generating biometric registration options', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
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
 * @access Private (must be authenticated via existing session)
 */
router.post('/register-verify', requireAuth, async (req, res) => {
  try {
    // Use user.id (integer) from the authenticated session
    const userIdInt = req.user.id;
    if (!userIdInt) {
        authLogger.warn('User ID missing from authenticated request in register-verify');
        return res.status(401).json({ error: 'Invalid session' });
    }

    // Get the device name and type
    const { deviceName, deviceType } = req.body;
    
    // Get the original challenge for this user.id
    const storedData = await getBiometricChallenge(userIdInt, 'registration');
    
    if (!storedData || !storedData.challenge) {
      return res.status(400).json({
        error: 'invalid_challenge',
        message: 'Registration challenge not found or expired',
      });
    }
    
    // Verify attestation response
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: req.body, // The full attestation response from the client
        expectedChallenge: storedData.challenge,
        expectedOrigin,
        expectedRPID: rpID,
        requireUserVerification: true, // Require user verification (biometric/PIN)
      });
    } catch (verificationError) {
        authLogger.error('Biometric registration verification library error', {
            error: verificationError.message,
            stack: verificationError.stack,
            userId: userIdInt,
        });
        return res.status(400).json({ error: 'verification_library_error', message: verificationError.message });
    }
    
    // If the verification fails, return an error
    if (!verification.verified || !verification.registrationInfo) {
      authLogger.warn('Biometric registration verification failed', { userId: userIdInt, verificationResult: verification });
      return res.status(400).json({
        error: 'verification_failed',
        message: 'Failed to verify registration response',
      });
    }
    
    // Store the credential in the database using user.id
    const { credentialID, credentialPublicKey, counter } = verification.registrationInfo;
    
    await prisma.biometric_credentials.create({
      data: {
        user_id: userIdInt, // Store integer user_id
        // Store the raw credential ID and public key as base64url strings
        credential_id: base64url.encode(credentialID),
        public_key: base64url.encode(credentialPublicKey),
        device_info: {
          name: deviceName || 'Unknown Device',
          type: deviceType || 'unknown',
          userAgent: req.headers['user-agent'],
        },
        counter: counter, // Store counter as BigInt
        created_at: new Date(),
        last_used: new Date()
      }
    });
    
    authLogger.info(`Biometric credential registered successfully for user ${userIdInt}`);
    // Return the success message
    res.json({
      success: true,
      message: 'Biometric authentication registered successfully',
      credentialId: base64url.encode(credentialID), // Return base64url encoded ID
    });
  } catch (error) {
    authLogger.error('Error verifying biometric registration', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
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
    // NOTE: This route is tricky. WebAuthn allows for username-less login.
    // If the frontend supports that, `userId` might be empty here.
    // If `userId` is provided (e.g., user typed username/wallet first),
    // we can narrow down credentials. If not, we generate a challenge
    // without `allowCredentials` and let the browser figure it out.
    
    const { userId } = req.body; // Expecting integer user.id if provided
    let allowCredentialsOption = undefined;
    let userIdInt = null;

    if (userId) {
      userIdInt = parseInt(userId, 10);
      if (isNaN(userIdInt)) {
        return res.status(400).json({ error: 'invalid_user_id', message: 'User ID must be an integer.' });
      }
      // Get user's credentials by integer ID
      const userCredentials = await getUserCredentials(userIdInt);
      if (userCredentials.length > 0) {
        allowCredentialsOption = userCredentials.map(cred => ({
          id: cred.credentialID, // Pass Buffer directly
          type: 'public-key',
          transports: cred.transports,
        }));
      } else {
        // User provided ID but has no credentials - maybe prevent challenge generation?
        authLogger.warn(`Auth options requested for user ${userIdInt} but no credentials found.`);
        // Depending on desired UX, either return error or generate challenge anyway
         return res.status(404).json({ error: 'no_credentials', message: 'No biometric credentials found for this user ID.'});
      }
    }
    
    // Generate authentication options
    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: allowCredentialsOption, // May be undefined for username-less flow
      userVerification: 'preferred', 
    });
    
    // Store challenge for verification.
    // If userId is provided, link challenge to them. 
    // If not (username-less), we can't store it linked to a user yet.
    // The verification step will need to handle finding the user based on the returned credential.
    // For simplicity *for now*, let's assume userId IS provided by frontend until username-less is fully implemented.
    if (!userIdInt) { // Check if userIdInt was successfully parsed
         authLogger.error('Auth options requested without valid userId - username-less flow not fully supported in this backend version.');
         return res.status(400).json({ error: 'user_id_required', message: 'User ID is currently required for biometric auth options.'});
    }
    // const userIdInt = parseInt(userId, 10); // Already parsed above if userId was provided
    await saveBiometricChallenge(userIdInt, options.challenge, 'authentication');
    
    authLogger.info(`Generated biometric authentication options for user ${userIdInt}`);
    res.json(options);

  } catch (error) {
    authLogger.error('Error generating biometric authentication options', {
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
 * @description Verify authentication response and issue JWT session
 * @access Public
 */
router.post('/auth-verify', async (req, res) => {
  try {
    // The response object from the client
    const assertionResponse = req.body;
    const providedCredentialIDString = assertionResponse.id; // base64url string

    // We need the user associated with this credential ID to verify.
    // Find the credential first, then get the user.
    const credentialRecord = await prisma.biometric_credentials.findUnique({
        where: { credential_id: providedCredentialIDString },
        include: { user: true }
    });

    if (!credentialRecord) {
        authLogger.warn('Biometric auth verification attempt for unknown credential ID', { credential_id: providedCredentialIDString });
        return res.status(404).json({ error: 'credential_not_found', message: 'Credential not found.'});
    }

    const user = credentialRecord.user;
    const userIdInt = user.id;
    if (!user) {
         // Should not happen if credentialRecord was found due to FK constraint, but check anyway
         authLogger.error('Biometric credential found but user missing', { credential_id: providedCredentialIDString, user_id: credentialRecord.user_id });
         return res.status(404).json({ error: 'user_not_found', message: 'User associated with credential not found.'});
    }

    // Get stored challenge for this user
    const storedData = await getBiometricChallenge(userIdInt, 'authentication');
    
    if (!storedData || !storedData.challenge) {
      authLogger.warn(`Biometric auth challenge not found or expired for user ${userIdInt}`);
      return res.status(400).json({
        error: 'invalid_challenge',
        message: 'Authentication challenge not found or expired',
      });
    }
    
    // Verify the authentication response
    let verification;
    try {
        verification = await verifyAuthenticationResponse({
            response: assertionResponse, // The assertion response from the client
            expectedChallenge: storedData.challenge,
            expectedOrigin,
            expectedRPID: rpID,
            authenticator: {
              credentialID: base64url.decode(credentialRecord.credential_id),
              credentialPublicKey: base64url.decode(credentialRecord.public_key),
              counter: BigInt(credentialRecord.counter),
            },
            requireUserVerification: true, // Ensure user interaction (biometric/PIN)
          });
    } catch (verificationError) {
        authLogger.error('Biometric authentication verification library error', {
            error: verificationError.message,
            stack: verificationError.stack,
            userId: userIdInt,
            credential_id: providedCredentialIDString
        });
        return res.status(400).json({ error: 'verification_library_error', message: verificationError.message });
    }
    
    if (!verification.verified) {
      authLogger.warn('Biometric authentication verification failed', { userId: userIdInt, credential_id: providedCredentialIDString, verificationResult: verification });
      return res.status(400).json({
        error: 'verification_failed',
        message: 'Failed to verify authentication',
      });
    }
    
    // Update the credential's counter
    await prisma.biometric_credentials.update({
      where: { credential_id: providedCredentialIDString },
      data: {
        counter: verification.authenticationInfo.newCounter,
        last_used: new Date()
      }
    });
    
    // --- Authentication Success - Issue Session --- 
    const sessionId = generateSessionId();
    const accessToken = generateAccessToken(user, sessionId, 'biometric');
    const refreshToken = await createRefreshToken(user);
    setAuthCookies(res, req, accessToken, refreshToken);
    
    // Update user's last login
    await prisma.users.update({
      where: { id: userIdInt },
      data: { last_login: new Date() },
    });
    
    authLogger.info(`Biometric authentication successful for user ${userIdInt}`);

    // Return user info
    res.json({
      verified: true,
      user: {
        id: user.id,
        wallet_address: user.wallet_address,
        role: user.role,
        nickname: user.nickname,
      },
      auth_method: 'biometric',
    });

  } catch (error) {
    authLogger.error('Error verifying biometric authentication', {
      error: error.message,
      stack: error.stack,
      credential_id: req.body?.id
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
    // Use user.id from authenticated session
    const userIdInt = req.user.id;
    if (!userIdInt) {
        authLogger.warn('User ID missing from authenticated request in GET /credentials');
        return res.status(401).json({ error: 'Invalid session' });
    }

    // Get all credentials for the user by user.id
    const credentials = await prisma.biometric_credentials.findMany({
        where: { user_id: userIdInt },
        select: { credential_id: true, device_info: true, created_at: true, last_used: true } // Select specific fields
    });
    
    // Return sanitized credential info 
    const sanitizedCredentials = credentials.map(cred => ({
      id: cred.credential_id, // Keep base64url string ID for client use
      name: cred.device_info?.name || 'Unknown Device',
      created_at: cred.created_at,
      last_used: cred.last_used,
      device_type: cred.device_info?.type || 'unknown',
    }));
    
    res.json({
      credentials: sanitizedCredentials,
    });
  } catch (error) {
    authLogger.error('Error fetching biometric credentials', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
    });
    
    res.status(500).json({
      error: 'Failed to fetch biometric credentials',
      message: error.message,
    });
  }
});

/**
 * @route DELETE /api/auth/biometric/credentials/:id
 * @description Delete a biometric credential by its ID (base64url string)
 * @access Private (must be authenticated)
 */
router.delete('/credentials/:id', requireAuth, async (req, res) => {
  try {
    // Use user.id from authenticated session
    const userIdInt = req.user.id;
    if (!userIdInt) {
        authLogger.warn('User ID missing from authenticated request in DELETE /credentials');
        return res.status(401).json({ error: 'Invalid session' });
    }

    // Get the credential ID (base64url string) from URL params
    const credentialIdString = req.params.id;
    
    // Delete the credential ensuring it belongs to the authenticated user
    const deleteResult = await prisma.biometric_credentials.deleteMany({
      where: {
        user_id: userIdInt, // Ensure ownership
        credential_id: credentialIdString
      }
    });
      
    // Check if a credential was actually deleted
    if (deleteResult.count === 0) {
        authLogger.warn('Attempt to delete non-existent or unauthorized biometric credential', {
             userId: userIdInt,
             credential_id: credentialIdString
         });
        return res.status(404).json({
          error: 'credential_not_found',
          message: 'Credential not found for this user or already deleted',
        });
      }
    
    authLogger.info(`Deleted biometric credential ${credentialIdString} for user ${userIdInt}`);
    // Return the success message
    res.json({
      success: true,
      message: 'Credential deleted successfully',
    });
  } catch (error) {
    authLogger.error('Error deleting biometric credential', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      credential_id: req.params.id,
    });
    
    res.status(500).json({
      error: 'Failed to delete biometric credential',
      message: error.message,
    });
  }
});

export default router;