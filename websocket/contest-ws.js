// websocket/contest-ws.js

/*
 * This is the WebSocket server for the contest service.
 * It handles real-time contest updates, leaderboard changes, and participant activities.
 * 
 * Features:
 * - Contest state subscription/unsubscription
 * - Real-time leaderboard updates
 * - Participant activity broadcasting
 * - Periodic state updates
 * 
 * Message Types:
 * - SUBSCRIBE_CONTEST: Subscribe to contest updates
 * - UNSUBSCRIBE_CONTEST: Unsubscribe from contest updates
 * - CONTEST_UPDATED: Contest state update
 * - LEADERBOARD_UPDATED: Leaderboard state update
 * - PARTICIPANT_ACTIVITY: Real-time participant actions
 * - ERROR: Error messages
 */

import { BaseWebSocketServer } from './base-websocket.js';
import { logApi } from '../utils/logger-suite/logger.js';
import prisma from '../config/prisma.js';

// Message type constants
const MESSAGE_TYPES = {
    // Client -> Server
    SUBSCRIBE_CONTEST: 'SUBSCRIBE_CONTEST',
    UNSUBSCRIBE_CONTEST: 'UNSUBSCRIBE_CONTEST',
    
    // Server -> Client
    CONTEST_UPDATED: 'CONTEST_UPDATED',
    LEADERBOARD_UPDATED: 'LEADERBOARD_UPDATED',
    PARTICIPANT_ACTIVITY: 'PARTICIPANT_ACTIVITY',
    ERROR: 'ERROR'
};

// Error codes
const ERROR_CODES = {
    CONTEST_NOT_FOUND: 4044,
    INVALID_MESSAGE: 4004,
    SUBSCRIPTION_FAILED: 5002,
    SERVER_ERROR: 5001,
    UNAUTHORIZED: 4003
};

/**
 * ContestWebSocketServer class
 * Handles real-time contest updates and participant interactions
 */
class ContestWebSocketServer extends BaseWebSocketServer {
    constructor(httpServer) {
        super(httpServer, {
            path: '/api/v2/ws/contest',
            maxPayload: 1024 * 32, // 32KB max payload
            requireAuth: true,
            rateLimit: 120 // 2 updates/second as per requirements
        });

        /** @type {Map<string, Set<string>>} userId -> Set<contestId> */
        this.contestSubscriptions = new Map();
        
        // Start periodic updates
        this.startPeriodicUpdates();
        
        logApi.info('Contest WebSocket server initialized');
    }

    /**
     * Handle incoming client messages
     * @param {WebSocket} ws - WebSocket connection
     * @param {Object} message - Parsed message object
     * @param {Object} clientInfo - Client information
     */
    async handleClientMessage(ws, message, clientInfo) {
        try {
            const { type, contestId } = message;

            switch (type) {
                case MESSAGE_TYPES.SUBSCRIBE_CONTEST:
                    await this.handleContestSubscription(ws, clientInfo, contestId);
                    break;
                    
                case MESSAGE_TYPES.UNSUBSCRIBE_CONTEST:
                    await this.handleContestUnsubscription(ws, clientInfo, contestId);
                    break;
                    
                default:
                    this.sendError(ws, 'Unknown message type', ERROR_CODES.INVALID_MESSAGE);
                    logApi.warn('Unknown contest message type received', {
                        type,
                        clientId: clientInfo.userId
                    });
            }
        } catch (error) {
            logApi.error('Error handling contest message:', error);
            this.sendError(ws, 'Failed to process contest request', ERROR_CODES.SERVER_ERROR);
        }
    }

    /**
     * Handle contest subscription request
     * @param {WebSocket} ws - WebSocket connection
     * @param {Object} clientInfo - Client information
     * @param {string} contestId - Contest ID to subscribe to
     */
    async handleContestSubscription(ws, clientInfo, contestId) {
        try {
            if (!contestId) {
                this.sendError(ws, 'Contest ID is required', ERROR_CODES.INVALID_MESSAGE);
                return;
            }

            // Verify contest exists and user has access
            const contest = await prisma.contests.findUnique({
                where: { id: contestId },
                include: {
                    participants: {
                        where: { wallet_address: clientInfo.wallet }
                    }
                }
            });

            if (!contest) {
                this.sendError(ws, 'Contest not found', ERROR_CODES.CONTEST_NOT_FOUND);
                return;
            }

            // Add to subscriptions
            if (!this.contestSubscriptions.has(clientInfo.userId)) {
                this.contestSubscriptions.set(clientInfo.userId, new Set());
            }
            this.contestSubscriptions.get(clientInfo.userId).add(contestId);

            // Send initial state
            await Promise.all([
                this.sendContestState(ws, contestId),
                this.sendLeaderboardState(ws, contestId)
            ]);

            logApi.info('Client subscribed to contest', {
                userId: clientInfo.userId,
                contestId,
                wallet: clientInfo.wallet
            });

        } catch (error) {
            logApi.error('Error in contest subscription:', error);
            this.sendError(ws, 'Failed to subscribe to contest', ERROR_CODES.SUBSCRIPTION_FAILED);
        }
    }

    /**
     * Handle contest unsubscription request
     * @param {WebSocket} ws - WebSocket connection
     * @param {Object} clientInfo - Client information
     * @param {string} contestId - Contest ID to unsubscribe from
     */
    async handleContestUnsubscription(ws, clientInfo, contestId) {
        const userSubs = this.contestSubscriptions.get(clientInfo.userId);
        if (userSubs) {
            userSubs.delete(contestId);
            logApi.info('Client unsubscribed from contest', {
                userId: clientInfo.userId,
                contestId
            });
        }
    }

    /**
     * Send contest state to client
     * @param {WebSocket} ws - WebSocket connection
     * @param {string} contestId - Contest ID
     */
    async sendContestState(ws, contestId) {
        try {
            const contest = await prisma.contests.findUnique({
                where: { id: contestId },
                include: {
                    _count: {
                        select: { participants: true }
                    }
                }
            });

            if (!contest) return;

            this.sendToClient(ws, {
                type: MESSAGE_TYPES.CONTEST_UPDATED,
                data: {
                    contest_id: contest.id,
                    status: contest.status,
                    current_round: contest.current_round,
                    time_remaining: contest.end_time ? new Date(contest.end_time).getTime() - Date.now() : null,
                    total_participants: contest._count.participants,
                    total_prize_pool: contest.prize_pool,
                    timestamp: new Date().toISOString()
                }
            });
        } catch (error) {
            logApi.error('Error sending contest state:', error);
        }
    }

    /**
     * Send leaderboard state to client
     * @param {WebSocket} ws - WebSocket connection
     * @param {string} contestId - Contest ID
     */
    async sendLeaderboardState(ws, contestId) {
        try {
            const leaderboard = await prisma.$queryRaw`
                SELECT 
                    ROW_NUMBER() OVER (ORDER BY cp.total_value DESC) as rank,
                    cp.wallet_address,
                    u.nickname as username,
                    cp.total_value as portfolio_value,
                    ((cp.total_value - cp.initial_value) / cp.initial_value * 100) as performance,
                    MAX(t.timestamp) as last_trade_time
                FROM contest_portfolios cp
                JOIN users u ON cp.wallet_address = u.wallet_address
                LEFT JOIN trades t ON cp.wallet_address = t.wallet_address AND cp.contest_id = t.contest_id
                WHERE cp.contest_id = ${contestId}
                GROUP BY cp.wallet_address, u.nickname, cp.total_value, cp.initial_value
                ORDER BY cp.total_value DESC
                LIMIT 100
            `;

            this.sendToClient(ws, {
                type: MESSAGE_TYPES.LEADERBOARD_UPDATED,
                data: {
                    contest_id: contestId,
                    leaderboard,
                    timestamp: new Date().toISOString()
                }
            });
        } catch (error) {
            logApi.error('Error sending leaderboard state:', error);
        }
    }

    /**
     * Start periodic updates for contest and leaderboard states
     */
    startPeriodicUpdates() {
        // Update contest states every 5 seconds
        setInterval(async () => {
            try {
                for (const [userId, contestIds] of this.contestSubscriptions) {
                    for (const contestId of contestIds) {
                        const clients = this._getConnectedClients()
                            .filter(client => this._getClientInfo(client)?.userId === userId);
                        
                        for (const client of clients) {
                            await Promise.all([
                                this.sendContestState(client, contestId),
                                this.sendLeaderboardState(client, contestId)
                            ]);
                        }
                    }
                }
            } catch (error) {
                logApi.error('Error in periodic updates:', error);
            }
        }, 5000);
    }

    /**
     * Broadcast participant activity to subscribed clients
     * @param {string} contestId - Contest ID
     * @param {Object} activity - Activity data to broadcast
     */
    broadcastParticipantActivity(contestId, activity) {
        this.broadcast(
            {
                type: MESSAGE_TYPES.PARTICIPANT_ACTIVITY,
                data: {
                    ...activity,
                    contest_id: contestId,
                    timestamp: new Date().toISOString()
                }
            },
            (client) => {
                const clientInfo = this._getClientInfo(client);
                return clientInfo && this.contestSubscriptions.get(clientInfo.userId)?.has(contestId);
            }
        );
    }

    /**
     * Get server metrics
     * @returns {Object} Server metrics
     */
    getMetrics() {
        try {
            const connectedClients = this._getConnectedClients()?.length || 0;
            const activeSubscriptions = Array.from(this.contestSubscriptions.values())
                .reduce((total, contests) => total + (contests?.size || 0), 0);

            return {
                metrics: {
                    totalConnections: connectedClients,
                    activeSubscriptions,
                    messageCount: 0,
                    errorCount: 0,
                    lastUpdate: new Date().toISOString(),
                    cacheHitRate: 0,
                    averageLatency: 0
                },
                performance: {
                    messageRate: 0,
                    errorRate: 0,
                    latencyTrend: []
                },
                status: connectedClients > 0 ? 'operational' : 'idle'
            };
        } catch (error) {
            logApi.error('Error getting contest WebSocket metrics:', error);
            return {
                metrics: {
                    totalConnections: 0,
                    activeSubscriptions: 0,
                    messageCount: 0,
                    errorCount: 1,
                    lastUpdate: new Date().toISOString(),
                    cacheHitRate: 0,
                    averageLatency: 0
                },
                performance: {
                    messageRate: 0,
                    errorRate: 1,
                    latencyTrend: []
                },
                status: 'error'
            };
        }
    }

    /**
     * Clean up resources
     */
    cleanup() {
        this.contestSubscriptions.clear();
        super.cleanup();
        logApi.info('Contest WebSocket server cleaned up');
    }
}

// Singleton instance
let instance = null;

/**
 * Create or return existing ContestWebSocketServer instance
 * @param {http.Server} httpServer - HTTP server instance
 * @returns {ContestWebSocketServer} WebSocket server instance
 */
export function createContestWebSocket(httpServer) {
    try {
        if (!instance && httpServer) {
            instance = new ContestWebSocketServer(httpServer);
            logApi.info('Contest WebSocket server instance created');
        } else if (!httpServer) {
            logApi.error('HTTP server instance is required for WebSocket initialization');
            return null;
        }
        return instance;
    } catch (error) {
        logApi.error('Failed to create contest WebSocket server:', error);
        return null;
    }
}

// Export the class for testing
export { ContestWebSocketServer };

// Export the createContestWebSocket function as default
export default createContestWebSocket; 