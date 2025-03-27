// websocket/system-settings-ws.js

/**
 * @description This file contains the WebSocket server for the backend system settings.
 * Enhanced with diagnostic capabilities for WebSocket header debugging.
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
            perMessageDeflate: false, // Disable compression by default
            // Diagnostic flag to help troubleshoot header issues
            _diagnosticMode: true
        });

        // Keep latest settings in memory for faster responses
        this.cachedSettings = {};
        
        // Add connection diagnostic tracking
        this.diagnosticStats = {
            connections: 0,
            lastHandshake: null,
            lastHeaders: null,
            headerProblems: []
        };

        // Log successful initialization of the SystemSettingsWebSocket
        logApi.info(`${fancyColors.BG_BLUE}${fancyColors.WHITE} SYSTEM SETTINGS WS CREATED ${fancyColors.RESET} System Settings WebSocket created at ${this.path}`);
    }

    // Initialize method to support the WebSocket initialization process
    async initialize() {
        try {
            // Load current settings into cache during initialization
            await this.refreshSettingsCache();

            logApi.info(`${fancyColors.BG_BLUE}${fancyColors.WHITE} SYSTEM SETTINGS WS INIT ${fancyColors.RESET} System Settings WebSocket server initialized with ${Object.keys(this.cachedSettings).length} settings`);
            return true;
        } catch (error) {
            logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} SYSTEM SETTINGS WS ERROR ${fancyColors.RESET} Failed to initialize System Settings WebSocket:`, error);
            return false;
        }
    }

    // Override the onConnection method to add diagnostic header tracking
    async onConnection(ws, req) {
        // Ultra-verbose connection logging for diagnostics
        this.diagnosticStats.connections++;
        this.diagnosticStats.lastHandshake = new Date().toISOString();
        
        // Log all headers in a clear, highlighted format
        const allHeaders = req.headers || {};
        const headerList = Object.entries(allHeaders).map(([key, value]) => `${key}: ${value}`);
        
        // Store for diagnostics
        this.diagnosticStats.lastHeaders = headerList;
        
        // Check for critical WebSocket headers
        const criticalHeaders = ['upgrade', 'connection', 'sec-websocket-key', 'sec-websocket-version'];
        const missingHeaders = criticalHeaders.filter(header => !allHeaders[header]);
        
        if (missingHeaders.length > 0) {
            this.diagnosticStats.headerProblems.push({
                time: new Date().toISOString(),
                missingHeaders,
                presentHeaders: Object.keys(allHeaders)
            });
            
            // Log header problems with high visibility
            logApi.warn(`${fancyColors.BG_RED}${fancyColors.WHITE} SYSTEM SETTINGS WS HEADER PROBLEM ${fancyColors.RESET} Missing critical WebSocket headers: ${missingHeaders.join(', ')}`, {
                missingHeaders,
                allHeaders,
                url: req.url,
                ip: req.ip || req.socket.remoteAddress,
                _highlight: true
            });
        }
        
        // Log the headers in a highly visible format
        logApi.info(`${fancyColors.BG_BLUE}${fancyColors.WHITE} SYSTEM SETTINGS WS CONNECTION ${fancyColors.RESET} ${fancyColors.BOLD}CLIENT CONNECTED WITH HEADERS:${fancyColors.RESET}`, {
            url: req.url,
            method: req.method,
            complete_headers: req.headers,
            ip: req.ip || req.socket.remoteAddress,
            connection: {
                id: this.diagnosticStats.connections,
                time: this.diagnosticStats.lastHandshake
            },
            _highlight: true
        });
        
        // Store diagnostic data on the connection
        ws.connectionData = {
            connectedAt: new Date(),
            ip: req.ip || req.socket.remoteAddress || 'unknown',
            userAgent: req.headers['user-agent'] || 'unknown',
            headers: allHeaders,
            messageCount: 0
        };
        
        // If we have the ability to send a diagnostic message before auth, do it
        // This won't actually send if requireAuth is true until after auth
        try {
            this.sendToClient(ws, {
                type: 'DIAGNOSTIC_CONNECTION_INFO',
                message: 'System settings WebSocket connection diagnostic info',
                timestamp: new Date().toISOString(),
                yourHeaders: req.headers,
                connection: {
                    id: this.diagnosticStats.connections,
                    time: this.diagnosticStats.lastHandshake
                },
                headerValidation: {
                    missingCriticalHeaders: missingHeaders,
                    hasCriticalHeaders: missingHeaders.length === 0
                }
            });
        } catch (err) {
            // Ignore errors, this is just diagnostic
        }
        
        // Call the parent onConnection method if it exists
        if (super.onConnection) {
            await super.onConnection(ws, req);
        }
    }
    
    // Add diagnostic information to message handling
    async onMessage(ws, message) {
        // Update connection stats
        if (ws.connectionData) {
            ws.connectionData.messageCount++;
        }
        
        // Log the incoming message for diagnostic purposes
        logApi.info(`${fancyColors.BG_BLUE}${fancyColors.WHITE} SYSTEM SETTINGS WS MESSAGE ${fancyColors.RESET} Got message: ${typeof message === 'string' ? message : JSON.stringify(message)}`, {
            message: message,
            timestamp: new Date().toISOString(),
            connectionData: ws.connectionData,
            _highlight: true
        });
        
        // Process the message normally by calling handleClientMessage
        await this.handleClientMessage(ws, message, ws.clientInfo);
    }
    
    // Add diagnostic closure tracking
    async onClose(ws, code, reason) {
        // Get connection duration
        const duration = ws.connectionData?.connectedAt 
            ? Math.floor((Date.now() - ws.connectionData.connectedAt) / 1000)
            : 'unknown';
        
        // Log the disconnection with bright colors
        logApi.info(`${fancyColors.BG_RED}${fancyColors.WHITE} SYSTEM SETTINGS WS DISCONNECT ${fancyColors.RESET} Client disconnected, code: ${code}, reason: ${reason || 'none'}`, {
            code: code,
            reason: reason,
            connectionData: ws.connectionData,
            duration: duration + ' seconds',
            timestamp: new Date().toISOString(),
            _highlight: true
        });
    }
    
    // Enhanced error tracking
    async onError(ws, error) {
        // Log the error with bright colors
        logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} SYSTEM SETTINGS WS ERROR ${fancyColors.RESET} ${error.message}`, {
            error: error.message,
            stack: error.stack,
            connectionData: ws?.connectionData,
            timestamp: new Date().toISOString(),
            _highlight: true
        });
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

            logApi.info(`${fancyColors.BG_BLUE}${fancyColors.WHITE} SYSTEM SETTINGS WS ${fancyColors.RESET} Settings cache refreshed with ${settings.length} settings`);
        } catch (error) {
            logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} SYSTEM SETTINGS WS ERROR ${fancyColors.RESET} Failed to refresh settings cache:`, error);
        }
    }

    // This function has been replaced by the enhanced version below

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
     * Add diagnostic command handling
     */
    async handleClientMessage(ws, message, clientInfo) {
        try {
            // Add diagnostics command for system admins
            if (message.type === 'GET_WEBSOCKET_DIAGNOSTICS' && ['admin', 'superadmin'].includes(clientInfo?.role)) {
                return this.sendToClient(ws, {
                    type: 'WEBSOCKET_DIAGNOSTICS',
                    data: this.getDiagnosticMetrics(),
                    timestamp: new Date().toISOString(),
                    requestId: message.requestId
                });
            }
            
            // Check if user is authorized to access/modify settings
            const canModifySettings = ['admin', 'superadmin'].includes(clientInfo?.role);
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
            logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} SYSTEM SETTINGS WS ERROR ${fancyColors.RESET} Error handling client message:`, error);
            this.sendError(ws, 'Internal server error', 5000);
        }
    }
    
    /**
     * Get diagnostic information about WebSocket connections
     */
    getDiagnosticMetrics() {
        // Get base metrics
        const baseMetrics = super.getMetrics ? super.getMetrics() : {
            connections: this.clients ? this.clients.size : 0,
            path: this.path
        };
        
        return {
            ...baseMetrics,
            diagnostics: {
                headerStats: {
                    totalConnections: this.diagnosticStats.connections,
                    headerProblems: this.diagnosticStats.headerProblems,
                    lastHeaders: this.diagnosticStats.lastHeaders,
                    lastConnection: this.diagnosticStats.lastHandshake
                },
                websocketOptions: {
                    path: this.path,
                    requireAuth: this.requireAuth,
                    perMessageDeflate: this.perMessageDeflate,
                    maxMessageSize: this.maxMessageSize
                },
                clientConnections: Array.from(this.clients || []).map(client => ({
                    id: client.connectionData?.id || 'unknown',
                    ip: client.connectionData?.ip || 'unknown',
                    userAgent: client.connectionData?.userAgent || 'unknown',
                    connectedAt: client.connectionData?.connectedAt || 'unknown',
                    messageCount: client.connectionData?.messageCount || 0,
                    authenticated: !!client.clientInfo
                }))
            }
        };
    }
    
    /**
     * Clean up resources before shutdown
     */
    cleanup() {
        super.cleanup();
        logApi.info(`${fancyColors.BG_BLUE}${fancyColors.WHITE} SYSTEM SETTINGS WS CLEANUP ${fancyColors.RESET} System Settings WebSocket cleaned up`);
    }
}

export function createSystemSettingsWebSocket(server) {
    logApi.info(`${fancyColors.BG_BLUE}${fancyColors.WHITE} SYSTEM SETTINGS WS FACTORY ${fancyColors.RESET} Creating System Settings WebSocket server with diagnostics`);
    return new SystemSettingsWebSocket(server);
}

