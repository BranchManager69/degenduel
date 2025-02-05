import prisma from '../config/prisma.js';
import { logApi } from '../utils/logger-suite/logger.js';

/**
 * Middleware to check if the system is in maintenance mode
 * Skips the check for admin and superadmin users
 */
export const maintenanceCheck = async (req, res, next) => {
    try {
        // 1. First check if user is admin/superadmin
        if (req.user?.role === 'admin' || req.user?.role === 'superadmin') {
            logApi.debug('Admin user bypassing maintenance check', {
                user: req.user.wallet_address,
                role: req.user.role,
                path: req.path
            });
            return next();
        }

        // 2. Check if path is in the whitelist (e.g., auth endpoints)
        const whitelistedPaths = [
            '/api/auth/session',      // Allow session checks
            '/api/auth/challenge',    // Allow getting login challenge
            '/api/auth/verify-wallet', // Allow wallet verification
            '/api/auth',              // General auth endpoints
            '/api/admin',             // Admin routes
            '/api/superadmin',        // Superadmin routes
            '/api/health'             // Health check
        ];
        
        if (whitelistedPaths.some(path => req.path.startsWith(path))) {
            logApi.debug('Whitelisted path bypassing maintenance check', {
                path: req.path
            });
            return next();
        }

        // 3. Check maintenance status
        const setting = await prisma.system_settings.findUnique({
            where: { key: 'maintenance_mode' }
        });

        if (setting?.value?.enabled) {
            logApi.info('Maintenance mode active - blocking request', {
                path: req.path,
                method: req.method,
                ip: req.ip,
                user: req.user?.wallet_address
            });

            return res.status(503).json({
                error: 'Service unavailable - Maintenance in progress',
                retry_after: 300 // 5 minutes, adjust as needed
            });
        }

        next();
    } catch (error) {
        logApi.error('Failed to check maintenance mode', {
            error: {
                name: error.name,
                message: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            },
            path: req.path,
            method: req.method
        });

        // Allow request to proceed if we can't check maintenance mode
        // This prevents the site from becoming completely inaccessible if there's a DB issue
        next();
    }
};

export default maintenanceCheck; 