// /middleware/debugMiddleware.js
import jwt from 'jsonwebtoken';
import { config } from '../config/config.js';
import { logApi } from '../utils/logger-suite/logger.js';
import { fancyColors } from '../utils/colors.js';

// WebSocket bypass middleware - ADD THIS AT THE TOP OF THE MIDDLEWARE CHAIN
export const websocketBypassMiddleware = (req, res, next) => {
    // Check if this is a WebSocket upgrade request
    const isWebSocketRequest = (
        req.headers.upgrade && 
        req.headers.upgrade.toLowerCase() === 'websocket'
    ) || (
        // Also check URL patterns for WebSocket endpoints
        req.url.includes('/ws/') || 
        req.url.includes('/websocket/')
    );

    if (isWebSocketRequest) {
        // Log the bypass for debugging
        logApi.info(`${fancyColors.BG_GREEN}${fancyColors.BLACK} WS-BYPASS ${fancyColors.RESET} Bypassing middleware for WebSocket request: ${req.url}`, {
            headers: req.headers,
            url: req.url,
            method: req.method,
            wsEvent: 'middleware_bypass',
            _highlight: true
        });

        // Ensure WebSocket headers are present and properly set
        if (!req.headers['sec-websocket-key']) {
            const wsKey = Buffer.from(Math.random().toString(36).substring(2, 15)).toString('base64');
            req.headers['sec-websocket-key'] = wsKey;
            logApi.warn(`${fancyColors.BG_YELLOW}${fancyColors.BLACK} WS-BYPASS ${fancyColors.RESET} Added missing Sec-WebSocket-Key header`);
        }

        if (!req.headers['sec-websocket-version']) {
            req.headers['sec-websocket-version'] = '13';
            logApi.warn(`${fancyColors.BG_YELLOW}${fancyColors.BLACK} WS-BYPASS ${fancyColors.RESET} Added missing Sec-WebSocket-Version header`);
        }

        // Force these critical headers
        req.headers.upgrade = 'websocket';
        req.headers.connection = 'Upgrade';

        // No special handling needed for WebSocket extensions

        // Set a flag to indicate this request is a WebSocket connection
        req._isWebSocketRequest = true;
    }
    
    next();
};

// Auth debug middleware
export const debugMiddleware = (req, res, next) => {
    // Skip detailed logging for WebSocket requests
    if (req._isWebSocketRequest) {
        return next();
    }

    const currentEnv = config.getEnvironment(req.headers.origin);
    
    console.log(`\n🔍 ====== ${currentEnv} Auth Debug Log ======`);
    console.log(`⏰ Time: ${new Date().toISOString()}`);
    console.log(`📍 Route: ${req.method} ${req.originalUrl}`);

    // Log wallet address header
    const walletHeader = req.headers['x-wallet-address'];
    console.log('\n👛 X-Wallet-Address Header:', walletHeader || 'Not present');

    // Log session cookie
    const sessionCookie = req.cookies.session;
    console.log('\n🍪 Session Cookie:', sessionCookie ? 'Present' : 'Not present');

    if (sessionCookie) {
        try {
            const decoded = jwt.verify(sessionCookie, config.jwt.secret);
            console.log('\n🔓 Decoded JWT Token:');
            console.log('   Wallet:', decoded.wallet);
            console.log('   Issued At:', new Date(decoded.iat * 1000).toISOString());
            console.log('   Expires:', new Date(decoded.exp * 1000).toISOString());
            console.log('   Current Time:', new Date().toISOString());
        } catch (error) {
            console.log('\n❌ JWT Verification Failed:', error.message);
        }
    }

    next();
};

// Post-auth debug middleware
export const postAuthDebug = (req, res, next) => {
    // Skip for WebSocket requests
    if (req._isWebSocketRequest) {
        return next();
    }

    const currentEnv = config.getEnvironment(req.headers.origin);
    
    console.log(`\n🔍 ==== ${currentEnv} Post-Auth Debug ====`);
    console.log('👤 Original req.user:', req.user);
    console.log('🔑 Wallet address being used:', req.user?.wallet_address);
    console.log('📝 Complete user object keys:', Object.keys(req.user || {}));
    console.log('🎯 Contest ID being requested:', req.params.contestId);
    console.log('🛣️ Moving to route handler');
    
    next();
};