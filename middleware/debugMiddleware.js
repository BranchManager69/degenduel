// /middleware/debugMiddleware.js
import jwt from 'jsonwebtoken';
import { config } from '../config/config.js';

// Auth debug middleware
export const debugMiddleware = (req, res, next) => {
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
    const currentEnv = config.getEnvironment(req.headers.origin);
    
    console.log(`\n🔍 ==== ${currentEnv} Post-Auth Debug ====`);
    console.log('👤 Original req.user:', req.user);
    console.log('🔑 Wallet address being used:', req.user?.wallet_address);
    console.log('📝 Complete user object keys:', Object.keys(req.user || {}));
    console.log('🎯 Contest ID being requested:', req.params.contestId);
    console.log('🛣️ Moving to route handler');
    
    next();
};