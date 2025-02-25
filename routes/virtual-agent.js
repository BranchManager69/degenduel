// routes/virtual-agent.js

import express from 'express';
import axios from 'axios';
import { logApi } from '../utils/logger-suite/logger.js';
import { colors } from '../utils/colors.js';
import { requireAuth } from '../middleware/auth.js';
import cache from '../utils/cache.js';

const router = express.Router();

// Environment variables - NOTE: These need to be set in the server environment
const VIRTUAL_API_KEY = process.env.VIRTUAL_API_KEY || '';
const VIRTUAL_API_SECRET = process.env.VIRTUAL_API_SECRET || '';
const VIRTUAL_API_URL = 'https://api.virtual.xyz/v1/auth/token';

// Token generation endpoint
router.post('/token', requireAuth, async (req, res) => {
    const requestId = crypto.randomUUID();
    const startTime = Date.now();
    const { virtualId, userUid, userName } = req.body;

    logApi.info(`🤖 ${colors.cyan}Virtual agent token request${colors.reset}`, {
        requestId,
        virtualId,
        userUid,
        userName
    });

    // Input validation
    if (!virtualId || !userUid) {
        logApi.warn(`⚠️ ${colors.yellow}Invalid virtual agent token request${colors.reset}`, {
            requestId,
            missingFields: {
                virtualId: !virtualId,
                userUid: !userUid
            }
        });
        
        return res.status(400).json({
            error: 'invalid_request',
            message: 'virtualId and userUid are required'
        });
    }

    try {
        // Check cache first
        const cacheKey = `virtual:token:${virtualId}:${userUid}`;
        const cachedToken = await cache.get(cacheKey);

        if (cachedToken && new Date(cachedToken.expiresAt) > new Date()) {
            logApi.info(`🔍 ${colors.cyan}Virtual agent token (CACHE HIT)${colors.reset}`, {
                requestId,
                virtualId,
                userUid,
                duration: Date.now() - startTime,
                fromCache: true
            });

            return res.json({
                token: cachedToken.token,
                expiresAt: cachedToken.expiresAt
            });
        }

        // Validate API credentials
        if (!VIRTUAL_API_KEY || !VIRTUAL_API_SECRET) {
            throw new Error('Missing VIRTUAL API credentials');
        }

        // Request new token from VIRTUAL API
        const virtualResponse = await axios.post(VIRTUAL_API_URL, {
            apiKey: VIRTUAL_API_KEY,
            apiSecret: VIRTUAL_API_SECRET,
            virtualId,
            metadata: {
                userUid,
                userName: userName || 'Trader'
            }
        });

        if (!virtualResponse.data || !virtualResponse.data.token) {
            throw new Error('Failed to get token from VIRTUAL API');
        }

        const token = virtualResponse.data.token;
        // Set expiration to 1 hour from now (3600000 ms)
        const expiresAt = new Date(Date.now() + 3600000).toISOString();

        // Cache the token
        await cache.set(cacheKey, { token, expiresAt }, 3500); // Cache for slightly less than expiry

        logApi.info(`🎉 ${colors.green}Virtual agent token generated successfully${colors.reset}`, {
            requestId,
            virtualId,
            userUid,
            expiresAt,
            duration: Date.now() - startTime
        });

        // Return the token to the client
        return res.json({ token, expiresAt });

    } catch (error) {
        logApi.error(`💥 ${colors.red}Virtual agent token generation failed${colors.reset}`, {
            requestId,
            error: {
                name: error.name,
                message: error.message,
                stack: error.stack
            },
            duration: Date.now() - startTime
        });

        // Determine if it's an API error or internal error
        if (error.response) {
            // The request was made and the server responded with a status code
            // that falls out of the range of 2xx
            return res.status(error.response.status).json({
                error: 'virtual_api_error',
                message: 'Error from Virtual API service',
                details: error.response.data
            });
        } else if (error.request) {
            // The request was made but no response was received
            return res.status(502).json({
                error: 'virtual_api_unavailable',
                message: 'Virtual API service unavailable',
                details: 'No response received from Virtual API'
            });
        } else {
            // Something happened in setting up the request that triggered an Error
            return res.status(500).json({
                error: 'token_generation_failed',
                message: 'Failed to generate virtual agent token',
                details: error.message
            });
        }
    }
});

// Health check endpoint to verify the Virtual API connection
router.get('/health', async (req, res) => {
    try {
        // If we don't have API credentials, return a warning status
        if (!VIRTUAL_API_KEY || !VIRTUAL_API_SECRET) {
            return res.status(200).json({
                status: 'warning',
                message: 'Missing VIRTUAL API credentials',
                timestamp: new Date().toISOString()
            });
        }

        // Simple check to see if the credentials are valid
        const response = await axios.post(VIRTUAL_API_URL, {
            apiKey: VIRTUAL_API_KEY,
            apiSecret: VIRTUAL_API_SECRET,
            virtualId: 1, // Test with default virtual ID
            metadata: {
                userUid: 'health-check',
                userName: 'Health Check'
            }
        });

        return res.status(200).json({
            status: 'healthy',
            message: 'Successfully connected to Virtual API',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        return res.status(500).json({
            status: 'unhealthy',
            message: 'Failed to connect to Virtual API',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

export default router;