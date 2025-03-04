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

const VERBOSE_CONTEST_WS_INIT = false;

// Message type constants
const MESSAGE_TYPES = {
    // Client -> Server
    SUBSCRIBE_CONTEST: 'SUBSCRIBE_CONTEST',
    UNSUBSCRIBE_CONTEST: 'UNSUBSCRIBE_CONTEST',
    SEND_CHAT_MESSAGE: 'SEND_CHAT_MESSAGE',
    PARTICIPANT_ACTIVITY: 'PARTICIPANT_ACTIVITY',
    JOIN_ROOM: 'JOIN_ROOM',
    LEAVE_ROOM: 'LEAVE_ROOM',
    
    // Server -> Client
    CONTEST_UPDATED: 'CONTEST_UPDATED',
    LEADERBOARD_UPDATED: 'LEADERBOARD_UPDATED',
    CHAT_MESSAGE: 'CHAT_MESSAGE',
    PARTICIPANT_JOINED: 'PARTICIPANT_JOINED',
    PARTICIPANT_LEFT: 'PARTICIPANT_LEFT',
    PARTICIPANT_ACTIVITY: 'PARTICIPANT_ACTIVITY',
    ROOM_STATE: 'ROOM_STATE',
    ERROR: 'ERROR'
};

// Error codes
const ERROR_CODES = {
    CONTEST_NOT_FOUND: 4044,
    INVALID_MESSAGE: 4004,
    SUBSCRIPTION_FAILED: 5002,
    SERVER_ERROR: 5001,
    UNAUTHORIZED: 4003,
    ROOM_NOT_FOUND: 4045,
    NOT_A_PARTICIPANT: 4032,
    MESSAGE_TOO_LONG: 4003,
    RATE_LIMITED: 4290
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
        
        /** @type {Map<string, Set<WebSocket>>} contestId -> Set<WebSocket> */
        this.contestRooms = new Map();
        
        /** @type {Map<string, Object>} contestId -> roomState */
        this.roomStates = new Map();
        
        /** @type {Map<string, Map<string, Object>>} contestId -> Map<userId, participantInfo> */
        this.roomParticipants = new Map();
        
        /** @type {Map<WebSocket, String>} ws -> contestId */
        this.clientContestMap = new Map();
        
        // Message rate limiting for chat
        this.chatRateLimits = new Map(); // userId -> {count, resetTime}
        this.CHAT_RATE_LIMIT = 10; // messages per 10 seconds
        this.CHAT_RATE_WINDOW = 10000; // 10 seconds
        this.MAX_CHAT_LENGTH = 200; // characters
        
        // Start periodic updates
        this.startPeriodicUpdates();
        this.startChatRateLimitReset();
        
        if (VERBOSE_CONTEST_WS_INIT) {
            logApi.info('Contest WebSocket server initialized with room support');
        }
    }
  
    // Add initialize method to support the WebSocket initialization process
    async initialize() {
        // Any specific initialization logic for contest WebSocket
        logApi.info('Contest WebSocket server initialized');
        return true;
    }
    
    /**
     * Handle incoming client messages
     * @param {WebSocket} ws - WebSocket connection
     * @param {Object} message - Parsed message object
     * @param {Object} clientInfo - Client information
     */
    async handleClientMessage(ws, message, clientInfo) {
        try {
            const { type, contestId, roomId } = message;
            const targetId = contestId || roomId;
            
            if (!type) {
                this.sendError(ws, 'Message type is required', ERROR_CODES.INVALID_MESSAGE);
                return;
            }

            switch (type) {
                case MESSAGE_TYPES.SUBSCRIBE_CONTEST:
                    await this.handleContestSubscription(ws, clientInfo, targetId);
                    break;
                    
                case MESSAGE_TYPES.UNSUBSCRIBE_CONTEST:
                    await this.handleContestUnsubscription(ws, clientInfo, targetId);
                    break;
                
                case MESSAGE_TYPES.JOIN_ROOM:
                    await this.handleRoomJoin(ws, clientInfo, targetId);
                    break;
                    
                case MESSAGE_TYPES.LEAVE_ROOM:
                    await this.handleRoomLeave(ws, clientInfo, targetId);
                    break;
                    
                case MESSAGE_TYPES.SEND_CHAT_MESSAGE:
                    await this.handleChatMessage(ws, clientInfo, message);
                    break;
                    
                case MESSAGE_TYPES.PARTICIPANT_ACTIVITY:
                    await this.handleParticipantActivity(ws, clientInfo, message);
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
        this.contestRooms.clear();
        this.roomParticipants.clear();
        this.roomStates.clear();
        this.clientContestMap.clear();
        this.chatRateLimits.clear();
        super.cleanup();
        logApi.info('Contest WebSocket server cleaned up');
    }
    
    /**
     * Reset chat rate limits periodically
     */
    startChatRateLimitReset() {
        setInterval(() => {
            const now = Date.now();
            for (const [userId, limitInfo] of this.chatRateLimits.entries()) {
                if (now > limitInfo.resetTime) {
                    this.chatRateLimits.delete(userId);
                }
            }
        }, 10000); // Check every 10 seconds
    }
    
    /**
     * Handle room join request
     * @param {WebSocket} ws - WebSocket connection
     * @param {Object} clientInfo - Client information
     * @param {string} contestId - Contest room to join
     */
    async handleRoomJoin(ws, clientInfo, contestId) {
        try {
            if (!contestId) {
                this.sendError(ws, 'Contest ID is required', ERROR_CODES.INVALID_MESSAGE);
                return;
            }
            
            // Verify contest exists
            const contest = await prisma.contests.findUnique({
                where: { id: parseInt(contestId) },
                include: {
                    contest_participants: {
                        where: { wallet_address: clientInfo.wallet }
                    }
                }
            });
            
            if (!contest) {
                this.sendError(ws, 'Contest not found', ERROR_CODES.CONTEST_NOT_FOUND);
                return;
            }
            
            // Verify user is a participant
            const isParticipant = contest.contest_participants.length > 0;
            const isAdmin = ['admin', 'superadmin'].includes(clientInfo.role);
            
            if (!isParticipant && !isAdmin) {
                this.sendError(ws, 'You must be a participant to join this contest room', ERROR_CODES.NOT_A_PARTICIPANT);
                return;
            }
            
            // Add client to room
            if (!this.contestRooms.has(contestId)) {
                this.contestRooms.set(contestId, new Set());
                this.roomParticipants.set(contestId, new Map());
                this.roomStates.set(contestId, {
                    contestId,
                    participantCount: 0,
                    lastActivity: new Date().toISOString(),
                    status: contest.status
                });
            }
            
            const room = this.contestRooms.get(contestId);
            room.add(ws);
            
            // Map this connection to the contest room
            this.clientContestMap.set(ws, contestId);
            
            // Track participant in room state
            const participants = this.roomParticipants.get(contestId);
            const participantInfo = {
                userId: clientInfo.userId,
                wallet: clientInfo.wallet,
                nickname: clientInfo.nickname || clientInfo.username || `User_${clientInfo.userId.substring(0, 6)}`,
                joinedAt: new Date().toISOString(),
                isAdmin: isAdmin
            };
            
            participants.set(clientInfo.userId, participantInfo);
            
            // Update room state
            const roomState = this.roomStates.get(contestId);
            roomState.participantCount = participants.size;
            roomState.lastActivity = new Date().toISOString();
            
            // Send room state to new participant
            this.sendToClient(ws, {
                type: MESSAGE_TYPES.ROOM_STATE,
                contestId,
                participants: Array.from(participants.values()),
                roomState
            });
            
            // Broadcast that a new participant joined
            this.broadcastToRoom(contestId, {
                type: MESSAGE_TYPES.PARTICIPANT_JOINED,
                contestId,
                participant: participantInfo
            }, [ws]); // Exclude the client that just joined
            
            logApi.info('Client joined contest room', {
                userId: clientInfo.userId,
                contestId,
                wallet: clientInfo.wallet,
                isAdmin
            });
            
        } catch (error) {
            logApi.error('Error joining contest room:', error);
            this.sendError(ws, 'Failed to join contest room', ERROR_CODES.SERVER_ERROR);
        }
    }
    
    /**
     * Handle room leave request
     * @param {WebSocket} ws - WebSocket connection
     * @param {Object} clientInfo - Client information
     * @param {string} contestId - Contest room to leave
     */
    async handleRoomLeave(ws, clientInfo, contestId) {
        try {
            // If no contestId provided, use the mapped one
            if (!contestId) {
                contestId = this.clientContestMap.get(ws);
                if (!contestId) {
                    return; // Not in any room
                }
            }
            
            // Remove from room
            if (this.contestRooms.has(contestId)) {
                const room = this.contestRooms.get(contestId);
                room.delete(ws);
                
                // Remove client-room mapping
                this.clientContestMap.delete(ws);
                
                // Remove participant from room state
                const participants = this.roomParticipants.get(contestId);
                if (participants && participants.has(clientInfo.userId)) {
                    const participantInfo = participants.get(clientInfo.userId);
                    participants.delete(clientInfo.userId);
                    
                    // Update room state
                    const roomState = this.roomStates.get(contestId);
                    roomState.participantCount = participants.size;
                    roomState.lastActivity = new Date().toISOString();
                    
                    // Broadcast that participant left
                    this.broadcastToRoom(contestId, {
                        type: MESSAGE_TYPES.PARTICIPANT_LEFT,
                        contestId,
                        userId: clientInfo.userId,
                        participantInfo
                    });
                    
                    logApi.info('Client left contest room', {
                        userId: clientInfo.userId,
                        contestId
                    });
                }
                
                // If room is empty, clean up
                if (room.size === 0) {
                    this.contestRooms.delete(contestId);
                    this.roomParticipants.delete(contestId);
                    this.roomStates.delete(contestId);
                    logApi.info('Contest room closed (empty)', { contestId });
                }
            }
        } catch (error) {
            logApi.error('Error leaving contest room:', error);
        }
    }
    
    /**
     * Handle chat message from client
     * @param {WebSocket} ws - WebSocket connection
     * @param {Object} clientInfo - Client information
     * @param {Object} message - Message data
     */
    async handleChatMessage(ws, clientInfo, message) {
        try {
            const { contestId, text } = message;
            
            // Verify parameters
            if (!contestId || !text) {
                this.sendError(ws, 'Contest ID and message text are required', ERROR_CODES.INVALID_MESSAGE);
                return;
            }
            
            // Check if in room
            if (!this.contestRooms.has(contestId) || !this.contestRooms.get(contestId).has(ws)) {
                this.sendError(ws, 'You must join the room before sending messages', ERROR_CODES.ROOM_NOT_FOUND);
                return;
            }
            
            // Check message length
            if (text.length > this.MAX_CHAT_LENGTH) {
                this.sendError(ws, `Message too long, maximum ${this.MAX_CHAT_LENGTH} characters`, ERROR_CODES.MESSAGE_TOO_LONG);
                return;
            }
            
            // Check rate limiting
            const now = Date.now();
            if (!this.chatRateLimits.has(clientInfo.userId)) {
                this.chatRateLimits.set(clientInfo.userId, {
                    count: 0,
                    resetTime: now + this.CHAT_RATE_WINDOW
                });
            }
            
            const userLimit = this.chatRateLimits.get(clientInfo.userId);
            userLimit.count++;
            
            if (userLimit.count > this.CHAT_RATE_LIMIT) {
                this.sendError(ws, 'Rate limit exceeded for chat messages', ERROR_CODES.RATE_LIMITED);
                return;
            }
            
            // Get participant info
            const participants = this.roomParticipants.get(contestId);
            const participantInfo = participants.get(clientInfo.userId);
            
            if (!participantInfo) {
                this.sendError(ws, 'Participant information not found', ERROR_CODES.SERVER_ERROR);
                return;
            }
            
            // Create chat message
            const chatMessage = {
                type: MESSAGE_TYPES.CHAT_MESSAGE,
                contestId,
                messageId: `${contestId}-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`,
                userId: clientInfo.userId,
                nickname: participantInfo.nickname,
                isAdmin: participantInfo.isAdmin,
                text,
                timestamp: new Date().toISOString()
            };
            
            // Broadcast to room
            this.broadcastToRoom(contestId, chatMessage);
            
            // Update room activity timestamp
            const roomState = this.roomStates.get(contestId);
            roomState.lastActivity = new Date().toISOString();
            
            logApi.info('Chat message sent', {
                userId: clientInfo.userId,
                contestId,
                messageLength: text.length
            });
            
        } catch (error) {
            logApi.error('Error sending chat message:', error);
            this.sendError(ws, 'Failed to send chat message', ERROR_CODES.SERVER_ERROR);
        }
    }
    
    /**
     * Handle participant activity update
     * @param {WebSocket} ws - WebSocket connection
     * @param {Object} clientInfo - Client information
     * @param {Object} message - Activity data
     */
    async handleParticipantActivity(ws, clientInfo, message) {
        try {
            const { contestId, activity, data } = message;
            
            if (!contestId || !activity) {
                this.sendError(ws, 'Contest ID and activity type are required', ERROR_CODES.INVALID_MESSAGE);
                return;
            }
            
            // Check if in room
            if (!this.contestRooms.has(contestId)) {
                this.sendError(ws, 'Contest room not found', ERROR_CODES.ROOM_NOT_FOUND);
                return;
            }
            
            // Get participant info
            const participants = this.roomParticipants.get(contestId);
            const participantInfo = participants.get(clientInfo.userId);
            
            if (!participantInfo) {
                this.sendError(ws, 'You must join the room first', ERROR_CODES.NOT_A_PARTICIPANT);
                return;
            }
            
            // Broadcast activity to room
            this.broadcastToRoom(contestId, {
                type: MESSAGE_TYPES.PARTICIPANT_ACTIVITY,
                contestId,
                userId: clientInfo.userId,
                nickname: participantInfo.nickname,
                activity,
                data: data || {},
                timestamp: new Date().toISOString()
            });
            
            // Update room activity timestamp
            const roomState = this.roomStates.get(contestId);
            roomState.lastActivity = new Date().toISOString();
            
        } catch (error) {
            logApi.error('Error handling participant activity:', error);
            this.sendError(ws, 'Failed to process activity', ERROR_CODES.SERVER_ERROR);
        }
    }
    
    /**
     * Broadcast message to all clients in a room
     * @param {string} contestId - Contest room ID
     * @param {Object} message - Message to broadcast
     * @param {Array<WebSocket>} exclude - Clients to exclude from broadcast
     */
    broadcastToRoom(contestId, message, exclude = []) {
        if (!this.contestRooms.has(contestId)) return;
        
        const room = this.contestRooms.get(contestId);
        for (const client of room) {
            if (exclude.includes(client)) continue;
            this.sendToClient(client, message);
        }
    }
    
    /**
     * Clean up when a client disconnects
     * @param {WebSocket} ws - WebSocket connection
     * @param {Object} clientInfo - Client information
     */
    onClientDisconnect(ws, clientInfo) {
        // Cleanup room membership if needed
        const contestId = this.clientContestMap.get(ws);
        if (contestId) {
            this.handleRoomLeave(ws, clientInfo, contestId);
        }
        
        // Call parent cleanup
        super.onClientDisconnect?.(ws, clientInfo);
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
            logApi.info('Contest WebSocket server initialized');
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