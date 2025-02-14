import { BaseWebSocketServer } from '../utils/websocket-suite/base-websocket.js';
import { logApi } from '../utils/logger-suite/logger.js';
import prisma from '../config/prisma.js';

class ContestWebSocketServer extends BaseWebSocketServer {
    constructor(httpServer) {
        super(httpServer, {
            path: '/api/v2/ws/contest',
            maxPayload: 1024 * 32, // 32KB max payload
            requireAuth: true,
            rateLimit: 120 // 2 updates/second as per requirements
        });

        this.contestSubscriptions = new Map(); // clientId -> Set<contestId>
        this.startPeriodicUpdates();
    }

    async handleClientMessage(ws, message, clientInfo) {
        try {
            const { type, contestId } = message;

            switch (type) {
                case 'SUBSCRIBE_CONTEST':
                    await this.handleContestSubscription(ws, clientInfo, contestId);
                    break;
                case 'UNSUBSCRIBE_CONTEST':
                    await this.handleContestUnsubscription(ws, clientInfo, contestId);
                    break;
                default:
                    this.sendError(ws, 'Unknown message type', 4004);
            }
        } catch (error) {
            logApi.error('Error handling contest message:', error);
            this.sendError(ws, 'Failed to process contest request', 5001);
        }
    }

    async handleContestSubscription(ws, clientInfo, contestId) {
        try {
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
                this.sendError(ws, 'Contest not found', 4044);
                return;
            }

            // Add to subscriptions
            if (!this.contestSubscriptions.has(clientInfo.userId)) {
                this.contestSubscriptions.set(clientInfo.userId, new Set());
            }
            this.contestSubscriptions.get(clientInfo.userId).add(contestId);

            // Send initial state
            await this.sendContestState(ws, contestId);
            await this.sendLeaderboardState(ws, contestId);

        } catch (error) {
            logApi.error('Error in contest subscription:', error);
            this.sendError(ws, 'Failed to subscribe to contest', 5002);
        }
    }

    async handleContestUnsubscription(ws, clientInfo, contestId) {
        const userSubs = this.contestSubscriptions.get(clientInfo.userId);
        if (userSubs) {
            userSubs.delete(contestId);
        }
    }

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
                type: 'CONTEST_UPDATED',
                data: {
                    contest_id: contest.id,
                    status: contest.status,
                    current_round: contest.current_round,
                    time_remaining: contest.end_time ? new Date(contest.end_time).getTime() - Date.now() : null,
                    total_participants: contest._count.participants,
                    total_prize_pool: contest.prize_pool
                }
            });
        } catch (error) {
            logApi.error('Error sending contest state:', error);
        }
    }

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
                type: 'LEADERBOARD_UPDATED',
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

    startPeriodicUpdates() {
        // Update contest states every 5 seconds
        setInterval(async () => {
            for (const [userId, contestIds] of this.contestSubscriptions) {
                for (const contestId of contestIds) {
                    const clients = this._getConnectedClients()
                        .filter(client => this._getClientInfo(client)?.userId === userId);
                    
                    for (const client of clients) {
                        await this.sendContestState(client, contestId);
                        await this.sendLeaderboardState(client, contestId);
                    }
                }
            }
        }, 5000);
    }

    // Public methods for external use
    broadcastParticipantActivity(contestId, activity) {
        this.broadcast(
            {
                type: 'PARTICIPANT_ACTIVITY',
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

    cleanup() {
        this.contestSubscriptions.clear();
        super.cleanup();
    }
}

export function createContestWebSocket(httpServer) {
    return new ContestWebSocketServer(httpServer);
}

export default ContestWebSocketServer; 