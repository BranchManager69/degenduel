import prisma from '../config/prisma.js';
import { logApi } from './logger-suite/logger.js';

class AdminLogger {
    static async logAction(adminAddress, action, details = {}, context = {}) {
        try {
            const log = await prisma.admin_logs.create({
                data: {
                    admin_address: adminAddress,
                    action: action,
                    details: details,
                    ip_address: context.ip_address,
                    user_agent: context.user_agent
                }
            });

            logApi.info(`Admin action logged: ${action}`, {
                admin: adminAddress,
                action,
                details
            });

            return log;
        } catch (error) {
            logApi.error('Failed to log admin action:', {
                error: error.message,
                admin: adminAddress,
                action,
                details
            });
            // Don't throw - we don't want logging failures to break operations
        }
    }

    // Predefined action types for consistency
    static Actions = {
        CONTEST: {
            START: 'CONTEST_START',
            END: 'CONTEST_END',
            CANCEL: 'CONTEST_CANCEL',
            FORCE_EVALUATE: 'CONTEST_FORCE_EVALUATE'
        },
        SERVICE: {
            START: 'SERVICE_START',
            STOP: 'SERVICE_STOP',
            CONFIGURE: 'SERVICE_CONFIGURE'
        },
        WALLET: {
            CREATE: 'WALLET_CREATE',
            UPDATE: 'WALLET_UPDATE',
            DELETE: 'WALLET_DELETE'
        },
        TOKEN: {
            CREATE: 'TOKEN_CREATE',
            UPDATE: 'TOKEN_UPDATE',
            DELETE: 'TOKEN_DELETE'
        },
        SERVER: {
            START: 'SERVER_START',
            STOP: 'SERVER_STOP',
            RESTART: 'SERVER_RESTART'
        }
    };
}

export default AdminLogger; 