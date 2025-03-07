// websocket/system-settings-ws.js

/**
 * @description This file contains the WebSocket server for the backend system settings.
 */

import { BaseWebSocketServer } from './base-websocket.js';
//import { systemSettings } from '../config/config.js'; // TODO: maybe use as a fallback for the cached settings? (Nah)
import { logApi } from '../utils/logger-suite/logger.js';
import { fancyColors } from '../utils/colors.js';
import prisma from '../config/prisma.js';

// Extends BaseWebSocketServer to create a new SystemSettingsWebSocket class
class SystemSettingsWebSocket extends BaseWebSocketServer {
    constructor(server) {
        super(server, {
            path: '/api/ws/system-settings',
            maxMessageSize: 1024 * 1024, // 1MB should be plenty for settings
            requireAuth: true, // Require authentication for security
            perMessageDeflate: false // Disable compression by default
        });

        // Keep latest settings in memory for faster responses
        this.cachedSettings = {};

        // Log successful initialization of the SystemSettingsWebSocket
        logApi.info(`${fancyColors.BLUE}[SystemSettingsWebSocket]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.LIGHT_WHITE} System Settings ${fancyColors.RESET}${fancyColors.BLUE} WebSocket initialized${fancyColors.RESET}`);
    }

    // Initialize method to support the WebSocket initialization process
    async initialize() {
        try {
            // Load current settings into cache during initialization
            await this.refreshSettingsCache();

            logApi.info(`${fancyColors.MAGENTA}[SystemSettingsWebSocket]${fancyColors.RESET} ${fancyColors.GREEN}System Settings 
WebSocket server initialized with ${Object.keys(this.cachedSettings).length} settings${fancyColors.RESET}`);
            return true;
        } catch (error) {
            logApi.error(`${fancyColors.MAGENTA}[SystemSettingsWebSocket]${fancyColors.RESET} ${fancyColors.RED}Failed to 
initialize System Settings WebSocket:${fancyColors.RESET}`, error);
            return false;
        }
    }

    async refreshSettingsCache() {
        try {
            const settings = await prisma.system_settings.findMany();

            // Transform the settings into a more usable format
            this.cachedSettings = settings.reduce((acc, setting) => {
                // Parse JSON values if possible
                try {
                    acc[setting.key] = typeof setting.value === 'string'
                        ? JSON.parse(setting.value)
                        : setting.value;
                } catch (e) {
                    acc[setting.key] = setting.value;
                }
                return acc;
            }, {});

            logApi.info(`${fancyColors.MAGENTA}[SystemSettingsWebSocket]${fancyColors.RESET} ${fancyColors.GREEN}Settings cache 
refreshed${fancyColors.RESET}`);
        } catch (error) {
            logApi.error(`${fancyColors.MAGENTA}[SystemSettingsWebSocket]${fancyColors.RESET} ${fancyColors.RED}Failed to refresh
 settings cache:${fancyColors.RESET}`, error);
        }
    }

    async handleClientMessage(ws, message, clientInfo) {
        try {
            // Check if user is authorized to access/modify settings
            const canModifySettings = ['admin', 'superadmin'].includes(clientInfo.role);
            const canViewSettings = true;

            if (!canViewSettings) {
                return this.sendError(ws, 'Unauthorized: Insufficient permissions to read system settings', 4003);
            }

            switch (message.type) {
                case 'GET_SYSTEM_SETTINGS':
                    await this.handleGetSystemSettings(ws, message);
                    break;

                case 'UPDATE_SYSTEM_SETTINGS':
                    if (!canModifySettings) {
                        return this.sendError(ws, 'Unauthorized: Insufficient permissions to modify system settings', 4003);
                    }
                    await this.handleUpdateSystemSettings(ws, message, clientInfo);
                    break;

                case 'SUBSCRIBE_SYSTEM_SETTINGS':
                    await this.handleSubscribeSystemSettings(ws, clientInfo);
                    break;

                default:
                    this.sendError(ws, `Unsupported message type: ${message.type}`, 4004);
                    break;
            }
        } catch (error) {
            logApi.error(`${fancyColors.MAGENTA}[SystemSettingsWebSocket]${fancyColors.RESET} ${fancyColors.RED}Error handling 
client message:${fancyColors.RESET}`, error);
            this.sendError(ws, 'Internal server error', 5000);
        }
    }

    async handleGetSystemSettings(ws, message) {
        try {
            const { key } = message;

            // If a specific key is requested, return just that setting
            if (key && typeof key === 'string') {
                const setting = this.cachedSettings[key];

                if (setting === undefined) {
                    return this.sendError(ws, `Setting not found: ${key}`, 4004);
                }

                this.sendToClient(ws, {
                    type: 'SYSTEM_SETTINGS_UPDATE',
                    data: { [key]: setting },
                    timestamp: new Date().toISOString(),
                    requestId: message.requestId
                });
                return;
            }

            // Otherwise return all settings
            this.sendToClient(ws, {
                type: 'SYSTEM_SETTINGS_UPDATE',
                data: this.cachedSettings,
                timestamp: new Date().toISOString(),
                requestId: message.requestId
            });
        } catch (error) {
            logApi.error(`${fancyColors.MAGENTA}[SystemSettingsWebSocket]${fancyColors.RESET} ${fancyColors.RED}Error getting 
system settings:${fancyColors.RESET}`, error);
            this.sendError(ws, 'Failed to fetch system settings', 5000);
        }
    }

    async handleUpdateSystemSettings(ws, message, clientInfo) {
        try {
            const { key, value } = message;

            if (!key || value === undefined) {
                return this.sendError(ws, 'Missing required parameters: key and value', 4000);
            }

            // Serialize the value if it's an object
            const serializedValue = typeof value === 'object' ? JSON.stringify(value) : value;

            // Update or create the setting
            await prisma.system_settings.upsert({
                where: { key },
                update: {
                    value: serializedValue,
                    updated_at: new Date(),
                    updated_by: clientInfo.userId
                },
                create: {
                    key,
                    value: serializedValue,
                    created_at: new Date(),
                    updated_at: new Date(),
                    created_by: clientInfo.userId,
                    updated_by: clientInfo.userId
                }
            });

            // Update cache
            await this.refreshSettingsCache();

            // Respond to the client
            this.sendToClient(ws, {
                type: 'SYSTEM_SETTINGS_UPDATED',
                data: { key, success: true },
                timestamp: new Date().toISOString(),
                requestId: message.requestId
            });

            // Broadcast the update to all subscribed clients
            this.broadcastSystemSettingsUpdate({ [key]: value });

            // Log the update
            logApi.info(`${fancyColors.MAGENTA}[SystemSettingsWebSocket]${fancyColors.RESET} ${fancyColors.GREEN}System setting 
updated:${fancyColors.RESET}`, {
                key,
                updatedBy: clientInfo.userId
            });
        } catch (error) {
            logApi.error(`${fancyColors.MAGENTA}[SystemSettingsWebSocket]${fancyColors.RESET} ${fancyColors.RED}Error updating 
system setting:${fancyColors.RESET}`, error);
            this.sendError(ws, 'Failed to update system setting', 5000);
        }
    }

    async handleSubscribeSystemSettings(ws, clientInfo) {
        // Mark this client as subscribed to settings updates
        // We don't need to do anything special here since we'll broadcast to all connected clients
        this.sendToClient(ws, {
            type: 'SYSTEM_SETTINGS_SUBSCRIBED',
            timestamp: new Date().toISOString()
        });

        // Send the current settings immediately
        this.sendToClient(ws, {
            type: 'SYSTEM_SETTINGS_UPDATE',
            data: this.cachedSettings,
            timestamp: new Date().toISOString()
        });
    }

    broadcastSystemSettingsUpdate(settings) {
        // Send to all connected clients
        this.broadcast({
            type: 'SYSTEM_SETTINGS_UPDATE',
            data: settings,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Clean up resources before shutdown
     */
    cleanup() {
        super.cleanup();
        logApi.info(`${fancyColors.MAGENTA}[SystemSettingsWebSocket]${fancyColors.RESET} ${fancyColors.GREEN}System Settings 
WebSocket cleaned up${fancyColors.RESET}`);
    }
}

export function createSystemSettingsWebSocket(server) {
    return new SystemSettingsWebSocket(server);
}

