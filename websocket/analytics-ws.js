import WebSocket from 'ws';
import { logApi } from '../utils/logger-suite/logger.js';
import jwt from 'jsonwebtoken';
import { config } from '../config/config.js';

const analyticsLogger = logApi.forService('ANALYTICS');

// Store admin connections
const adminConnections = new Map();

export function createAnalyticsWebSocket(server) {
    const wss = new WebSocket.Server({ 
        server,
        path: '/analytics',
        verifyClient: async ({ req }, done) => {
            try {
                // Get token from query string
                const url = new URL(req.url, `wss://${req.headers.host}`);
                const token = url.searchParams.get('token');
                
                if (!token) {
                    analyticsLogger.warn('WebSocket connection attempt without token');
                    done(false, 401, 'Unauthorized');
                    return;
                }

                // Verify JWT and check for superadmin role
                const decoded = jwt.verify(token, config.jwt.secret);
                if (decoded.role !== 'superadmin') {
                    analyticsLogger.warn('Non-superadmin attempted to connect to analytics websocket', {
                        wallet: decoded.wallet_address,
                        role: decoded.role
                    });
                    done(false, 403, 'Forbidden');
                    return;
                }

                req.user = decoded;
                done(true);
            } catch (error) {
                analyticsLogger.error('WebSocket auth error:', error);
                done(false, 401, 'Invalid token');
            }
        }
    });

    wss.on('connection', (ws, req) => {
        const user = req.user;
        analyticsLogger.info('Admin connected to analytics websocket', {
            wallet: user.wallet_address
        });

        // Store connection with user info
        adminConnections.set(ws, {
            wallet: user.wallet_address,
            connected_at: new Date(),
            last_ping: Date.now()
        });

        // Send initial connection success
        ws.send(JSON.stringify({
            type: 'connection_established',
            timestamp: new Date().toISOString()
        }));

        // Handle incoming messages (like ping/pong)
        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);
                if (data.type === 'ping') {
                    const connection = adminConnections.get(ws);
                    if (connection) {
                        connection.last_ping = Date.now();
                        ws.send(JSON.stringify({
                            type: 'pong',
                            timestamp: new Date().toISOString()
                        }));
                    }
                }
            } catch (error) {
                analyticsLogger.error('Error handling websocket message:', error);
            }
        });

        // Handle disconnection
        ws.on('close', () => {
            analyticsLogger.info('Admin disconnected from analytics websocket', {
                wallet: user.wallet_address
            });
            adminConnections.delete(ws);
        });

        // Handle errors
        ws.on('error', (error) => {
            analyticsLogger.error('WebSocket error:', {
                error,
                wallet: user.wallet_address
            });
        });
    });

    // Broadcast analytics updates to all connected admins
    setInterval(() => {
        const deadConnections = [];
        const now = Date.now();

        // Clean up dead connections
        for (const [ws, connection] of adminConnections) {
            if (now - connection.last_ping > 30000) { // 30 seconds timeout
                deadConnections.push(ws);
            }
        }

        deadConnections.forEach(ws => {
            ws.terminate();
            adminConnections.delete(ws);
        });

        // Only broadcast if we have active connections
        if (adminConnections.size > 0) {
            broadcastAnalyticsUpdate();
        }
    }, 1000); // Check every second

    return wss;
}

// Broadcast analytics update to all connected admins
export async function broadcastAnalyticsUpdate() {
    try {
        // Get active sessions in last 15 minutes
        const activeSessions = await prisma.system_settings.findMany({
            where: {
                key: 'user_session',
                updated_at: {
                    gte: new Date(Date.now() - 15 * 60 * 1000)
                }
            }
        });

        const update = {
            type: 'analytics_update',
            timestamp: new Date().toISOString(),
            data: {
                active_users: activeSessions.length,
                sessions: activeSessions.map(session => {
                    const data = JSON.parse(session.value);
                    return {
                        wallet: data.user.wallet_address,
                        current_page: data.last_page,
                        last_action: data.last_action
                    };
                })
            }
        };

        // Broadcast to all connected admins
        for (const [ws, connection] of adminConnections) {
            try {
                ws.send(JSON.stringify(update));
            } catch (error) {
                analyticsLogger.error('Failed to send update to admin:', {
                    error,
                    wallet: connection.wallet
                });
            }
        }
    } catch (error) {
        analyticsLogger.error('Failed to broadcast analytics update:', error);
    }
}

// Export for use in other parts of the app
export function getConnectedAdmins() {
    return Array.from(adminConnections.values());
} 