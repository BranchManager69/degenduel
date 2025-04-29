import prisma from '../config/prisma.js';
import { logApi } from './logger-suite/logger.js';
import os from 'os';

class AdminLogger {
    static async logAction(adminAddress, action, details = {}, context = {}) {
        try {
            // Check for critical server events that should trigger alerts
            // Make sure action is defined before comparison
            if (action === undefined || action === null) {
                action = 'UNKNOWN_ACTION';
            }
            const isServerEvent = action === AdminLogger.Actions.SERVER.START || 
                                 action === AdminLogger.Actions.SERVER.STOP || 
                                 action === AdminLogger.Actions.SERVER.RESTART;
            
            // Enrich server event details with system information
            const enrichedDetails = isServerEvent 
                ? {
                    ...details,
                    hostname: os.hostname(),
                    uptime: process.uptime(),
                    memory: process.memoryUsage(),
                    nodeVersion: process.version,
                    platform: process.platform,
                    timestamp: new Date().toISOString()
                  }
                : details;
                
            // Save to database
            const log = await prisma.admin_logs.create({
                data: {
                    admin_address: adminAddress,
                    action: action,
                    details: enrichedDetails,
                    ip_address: context.ip_address,
                    user_agent: context.user_agent
                }
            });

            // Log standard info message
            if (isServerEvent) {
                // For server events, log a special, more noticeable format that Logtail can parse
                // The special structure and ALERT tag will be caught by Logtail alert rules
                logApi.warn(`🚨 SERVER_ALERT: ${action}`, {
                    alert_type: 'server_event',
                    alert_level: 'critical',
                    admin: adminAddress,
                    action,
                    environment: process.env.NODE_ENV || 'production',
                    service: process.env.LOGTAIL_SOURCE || 'unknown',
                    details: enrichedDetails
                });
            } else {
                // Normal logging for non-server events
                logApi.info(`Admin action logged: ${action}`, {
                    admin: adminAddress,
                    action,
                    details: enrichedDetails
                });
            }

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

    /**
     * Specialized method for logging server restart events
     * This sends a critical alert to Logtail
     */
    static async logServerRestart(initiatedBy = 'system', reason = 'unknown', isPlanned = false) {
        const details = {
            initiated_by: initiatedBy,
            reason: reason,
            is_planned: isPlanned,
            server_name: process.env.LOGTAIL_SOURCE || 'degenduel-api',
            environment: process.env.NODE_ENV || 'production',
            pm2_id: process.env.NODE_APP_INSTANCE || 'unknown'
        };
        
        // Use ERROR level for unplanned restarts and WARN for planned ones
        const logLevel = isPlanned ? 'warn' : 'error';
        const alertPrefix = isPlanned ? '🔄' : '❗';
        
        // Log with special alert format for Logtail to catch
        logApi[logLevel](`${alertPrefix} CRITICAL_ALERT: SERVER_RESTART`, {
            alert_type: 'server_restart',
            alert_level: isPlanned ? 'warning' : 'critical',
            service: process.env.LOGTAIL_SOURCE || 'unknown',
            environment: process.env.NODE_ENV || 'production',
            ...details
        });
        
        // Also record in admin logs database
        return this.logAction(
            initiatedBy, 
            AdminLogger.Actions.SERVER.RESTART, 
            details
        );
    }

    // Predefined action types for consistency
    static Actions = {
        CONTEST: {
            START: 'CONTEST_START',
            END: 'CONTEST_END',
            CANCEL: 'CONTEST_CANCEL',
            FORCE_EVALUATE: 'CONTEST_FORCE_EVALUATE',
            CREATE: 'CONTEST_CREATE'
        },
        CONTEST_MANAGEMENT: {
            VIEW_CREDITS: 'CONTEST_VIEW_CREDITS',
            VIEW_CREDIT: 'CONTEST_VIEW_CREDIT',
            GRANT_CREDIT: 'CONTEST_GRANT_CREDIT',
            REVOKE_CREDIT: 'CONTEST_REVOKE_CREDIT',
            VIEW_CREDIT_STATS: 'CONTEST_VIEW_CREDIT_STATS'
        },
        SERVICE: {
            START: 'SERVICE_START',
            STOP: 'SERVICE_STOP',
            CONFIGURE: 'SERVICE_CONFIGURE',
            STATUS: 'SERVICE_STATUS'
        },
        WALLET: {
            CREATE: 'WALLET_CREATE',
            UPDATE: 'WALLET_UPDATE',
            DELETE: 'WALLET_DELETE',
            VANITY_FALLBACK: 'VANITY_WALLET_FALLBACK'
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