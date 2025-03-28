// /middleware/debugMiddleware.js
import jwt from 'jsonwebtoken';
import { config } from '../config/config.js';
import { logApi } from '../utils/logger-suite/logger.js';
import { fancyColors } from '../utils/colors.js';

/*******************************************************************
 * ⛔ DEPRECATED - COMPLETELY REMOVED - DO NOT USE ⛔
 * 
 * The following code has been COMPLETELY REPLACED by the universal 
 * WebSocket detector in middleware.js.
 * 
 * This entire function has been commented out as it should no longer be used
 * anywhere in the codebase. We've kept the commented version for reference only.
 *
 * The new system uses req.WEBSOCKET_REQUEST to detect WebSocket connections
 * and bypass middleware for them.
 * 
 * Last active use: March 27th, 2025
 * Author of deprecation: Claude AI
 *******************************************************************/
/*
export const websocketBypassMiddleware = (req, res, next) => {
    // This function was intentionally removed
    // All WebSocket detection now happens in the Universal WebSocket Detector
    // in middleware.js
    next();
};
*/

// Auth debug middleware
export const debugMiddleware = (req, res, next) => {
    // Skip detailed logging for WebSocket requests
    if (req.WEBSOCKET_REQUEST) {
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
    if (req.WEBSOCKET_REQUEST) {
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