// websocket/user-notification-ws.js

/*
 * This WebSocket server handles user-specific notifications like:
 * - Level-up events
 * - Achievement unlocks
 * - Contest invitations
 * - Profile updates
 * - System announcements
 * 
 * It polls the websocket_messages table for undelivered messages
 * and sends them to the appropriate users.
 */

import { BaseWebSocketServer } from './base-websocket.js';
import { logApi } from '../utils/logger-suite/logger.js';
import prisma from '../config/prisma.js';

class UserNotificationWebSocketServer extends BaseWebSocketServer {
    constructor(server) {
        super(server, {
            path: '/api/v2/ws/notifications',
            maxMessageSize: 50 * 1024, // 50KB
            requireAuth: true
        });

        this.pollingInterval = null;
        this.lastCleanup = null;
        this.messageTypes = [
            'LEVEL_UP',
            'ACHIEVEMENT_UNLOCK',
            'CONTEST_INVITE',
            'SYSTEM_ANNOUNCEMENT'
        ];
        
        // Metrics for monitoring
        this.metrics = {
            messagesDelivered: 0,
            messagesFailed: 0,
            connectedClients: 0,
            unreadMessages: 0, 
            averageLatencyMs: 0,
            lastUpdate: new Date(),
            totalPolls: 0,
            // Stats by message type
            byType: {
                LEVEL_UP: { delivered: 0, pending: 0 },
                ACHIEVEMENT_UNLOCK: { delivered: 0, pending: 0 },
                CONTEST_INVITE: { delivered: 0, pending: 0 },
                SYSTEM_ANNOUNCEMENT: { delivered: 0, pending: 0 }
            }
        };
        
        // Start polling for undelivered messages
        this.startMessagePolling();
        this.startCleanupInterval();
        
        logApi.info('User Notification WebSocket Server initialized');
    }
    
    /**
     * Start polling for undelivered messages
     */
    startMessagePolling() {
        // Poll every 5 seconds for undelivered messages
        this.pollingInterval = setInterval(async () => {
            try {
                await this.deliverPendingMessages();
                this.metrics.totalPolls++;
                this.metrics.lastUpdate = new Date();
            } catch (error) {
                logApi.error('Error polling for undelivered messages:', error);
            }
        }, 5000);
    }
    
    /**
     * Start periodic cleanup of old messages
     */
    startCleanupInterval() {
        // Clean up old messages every 24 hours
        setInterval(async () => {
            try {
                await this.cleanupOldMessages();
            } catch (error) {
                logApi.error('Error cleaning up old messages:', error);
            }
        }, 24 * 60 * 60 * 1000);
    }
    
    /**
     * Fetch and deliver pending messages to connected clients
     */
    async deliverPendingMessages() {
        const startTime = Date.now();
        
        // Find undelivered messages
        const pendingMessages = await prisma.websocket_messages.findMany({
            where: {
                delivered: false,
                type: {
                    in: this.messageTypes
                },
                timestamp: {
                    // Only messages from the last 7 days
                    gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
                }
            },
            orderBy: {
                timestamp: 'asc'
            },
            take: 100 // Limit batch size
        });
        
        if (pendingMessages.length === 0) return;
        
        logApi.debug(`Found ${pendingMessages.length} undelivered notification messages`);
        
        // Update metrics for pending messages
        pendingMessages.forEach(msg => {
            if (this.metrics.byType[msg.type]) {
                this.metrics.byType[msg.type].pending++;
            }
        });
        
        // Group messages by wallet address
        const messagesByWallet = pendingMessages.reduce((acc, message) => {
            const wallet = message.wallet_address;
            if (!acc[wallet]) acc[wallet] = [];
            acc[wallet].push(message);
            return acc;
        }, {});
        
        // Get all connected clients
        const clients = this._getConnectedClients();
        const clientsById = new Map();
        
        // Map clients by wallet address for quick lookup
        for (const client of clients) {
            const clientInfo = this._getClientInfo(client);
            if (clientInfo?.wallet) {
                clientsById.set(clientInfo.wallet, client);
            }
        }
        
        // Update connected clients metric
        this.metrics.connectedClients = clientsById.size;
        
        // Deliver messages to connected clients
        const deliveredMessageIds = [];
        
        for (const [wallet, messages] of Object.entries(messagesByWallet)) {
            const client = clientsById.get(wallet);
            
            if (client) {
                // Client is connected, send all their messages
                for (const message of messages) {
                    try {
                        this.sendToClient(client, {
                            type: message.type,
                            id: message.id,
                            timestamp: message.timestamp,
                            data: message.data
                        });
                        
                        deliveredMessageIds.push(message.id);
                        
                        // Update metrics
                        this.metrics.messagesDelivered++;
                        if (this.metrics.byType[message.type]) {
                            this.metrics.byType[message.type].delivered++;
                            this.metrics.byType[message.type].pending--;
                        }
                        
                        logApi.debug(`Delivered ${message.type} notification to ${wallet}`);
                    } catch (error) {
                        logApi.error(`Error delivering message ${message.id} to ${wallet}:`, error);
                        this.metrics.messagesFailed++;
                    }
                }
            }
        }
        
        // Mark messages as delivered
        if (deliveredMessageIds.length > 0) {
            await prisma.websocket_messages.updateMany({
                where: {
                    id: {
                        in: deliveredMessageIds
                    }
                },
                data: {
                    delivered: true,
                    delivered_at: new Date()
                }
            });
            
            logApi.info(`Marked ${deliveredMessageIds.length} messages as delivered`);
        }
        
        // Update latency metrics
        const duration = Date.now() - startTime;
        this.metrics.averageLatencyMs = 
            (this.metrics.averageLatencyMs * this.metrics.totalPolls + duration) / 
            (this.metrics.totalPolls + 1);
    }
    
    /**
     * Clean up old delivered messages
     */
    async cleanupOldMessages() {
        const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days
        
        const result = await prisma.websocket_messages.deleteMany({
            where: {
                delivered: true,
                delivered_at: {
                    lt: cutoffDate
                }
            }
        });
        
        this.lastCleanup = new Date();
        logApi.info(`Cleaned up ${result.count} old delivered messages`);
    }
    
    /**
     * Handle client messages
     */
    async handleClientMessage(ws, message, clientInfo) {
        switch (message.type) {
            case 'MARK_READ':
                if (message.messageId) {
                    await this.markMessageAsRead(message.messageId, clientInfo.wallet);
                    
                    // Acknowledge to client
                    this.sendToClient(ws, {
                        type: 'READ_CONFIRMED',
                        messageId: message.messageId,
                        timestamp: new Date().toISOString()
                    });
                }
                break;
                
            case 'GET_UNREAD':
                await this.sendUnreadMessages(ws, clientInfo.wallet);
                break;
                
            default:
                // Unknown message type
                this.sendError(ws, `Unknown message type: ${message.type}`);
                break;
        }
    }
    
    /**
     * Mark a message as read
     */
    async markMessageAsRead(messageId, walletAddress) {
        try {
            const updated = await prisma.websocket_messages.updateMany({
                where: {
                    id: messageId,
                    wallet_address: walletAddress
                },
                data: {
                    read: true,
                    read_at: new Date()
                }
            });
            
            if (updated.count > 0) {
                this.metrics.unreadMessages = Math.max(0, this.metrics.unreadMessages - 1);
                logApi.debug(`Marked message ${messageId} as read for ${walletAddress}`);
            }
        } catch (error) {
            logApi.error(`Error marking message ${messageId} as read:`, error);
        }
    }
    
    /**
     * Send all unread messages to a client
     */
    async sendUnreadMessages(ws, walletAddress) {
        try {
            const unreadMessages = await prisma.websocket_messages.findMany({
                where: {
                    wallet_address: walletAddress,
                    delivered: true,  // Only include delivered messages
                    read: false,      // Only include unread messages
                    type: {
                        in: this.messageTypes
                    },
                    timestamp: {
                        // Only messages from the last 30 days
                        gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
                    }
                },
                orderBy: {
                    timestamp: 'desc'
                }
            });
            
            if (unreadMessages.length > 0) {
                this.sendToClient(ws, {
                    type: 'UNREAD_NOTIFICATIONS',
                    count: unreadMessages.length,
                    messages: unreadMessages.map(msg => ({
                        id: msg.id,
                        type: msg.type,
                        timestamp: msg.timestamp,
                        data: msg.data
                    }))
                });
                
                // Update metrics
                this.metrics.unreadMessages = 
                    Math.max(this.metrics.unreadMessages, unreadMessages.length);
                
                logApi.debug(`Sent ${unreadMessages.length} unread notifications to ${walletAddress}`);
            } else {
                this.sendToClient(ws, {
                    type: 'UNREAD_NOTIFICATIONS',
                    count: 0,
                    messages: []
                });
            }
        } catch (error) {
            logApi.error(`Error sending unread messages to ${walletAddress}:`, error);
            this.sendError(ws, 'Failed to fetch unread notifications');
        }
    }
    
    /**
     * Get server metrics for monitoring
     */
    getMetrics() {
        return {
            ...this.metrics,
            timestamp: new Date().toISOString()
        };
    }
    
    /**
     * Clean up resources before shutdown
     */
    cleanup() {
        clearInterval(this.pollingInterval);
        super.cleanup();
        logApi.info('User Notification WebSocket Server cleaned up');
    }
}

// Singleton instance
let instance = null;

/**
 * Create or return existing UserNotificationWebSocketServer instance
 * @param {http.Server} httpServer - HTTP server instance
 * @returns {UserNotificationWebSocketServer} WebSocket server instance
 */
export function createUserNotificationWebSocket(httpServer) {
    if (!instance) {
        instance = new UserNotificationWebSocketServer(httpServer);
    }
    return instance;
}

export default { createUserNotificationWebSocket };