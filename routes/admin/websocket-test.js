import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { logApi } from '../../utils/logger-suite/logger.js';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth.js';

const router = express.Router();

// In-memory circular buffer for recent test logs
class CircularBuffer {
    constructor(maxSize = 100) {
        this.maxSize = maxSize;
        this.buffer = [];
    }

    add(item) {
        this.buffer.unshift(item);
        if (this.buffer.length > this.maxSize) {
            this.buffer.pop();
        }
    }

    getAll() {
        return this.buffer;
    }

    clear() {
        this.buffer = [];
    }
}

const testLogs = new CircularBuffer(100);

// Rate limiting setup
const testMessageLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 requests per minute
    message: 'Too many test messages, please try again later'
});

const hourlyTestMessageLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 100, // 100 requests per hour
    message: 'Hourly test message limit reached'
});

// Validation schemas for different socket types
const messageSchemas = {
    portfolio: {
        PORTFOLIO_UPDATED: {
            tokens: 'array',
            total_value: 'number',
            performance_24h: 'number'
        },
        TRADE_EXECUTED: {
            trade_id: 'string',
            wallet_address: 'string',
            symbol: 'string',
            amount: 'number',
            price: 'number'
        }
    },
    market: {
        MARKET_PRICE: {
            symbol: 'string',
            price: 'number',
            change_24h: 'number',
            volume_24h: 'number'
        },
        MARKET_VOLUME: {
            symbol: 'string',
            volume: 'number',
            trades_count: 'number'
        },
        MARKET_SENTIMENT: {
            symbol: 'string',
            sentiment_score: 'number',
            buy_pressure: 'number',
            sell_pressure: 'number'
        }
    },
    contest: {
        CONTEST_UPDATED: {
            contest_id: 'string',
            status: 'string',
            current_round: 'number',
            time_remaining: 'number'
        },
        LEADERBOARD_UPDATED: {
            contest_id: 'string',
            leaderboard: 'array'
        }
    },
    analytics: {
        user_activity_update: {
            users: 'array'
        }
    },
    wallet: {
        WALLET_UPDATED: {
            type: 'string',
            publicKey: 'string',
            balance: 'number'
        },
        TRANSFER_COMPLETE: {
            transfer_id: 'string',
            status: 'string'
        }
    }
};

// Validate payload against schema
function validatePayload(socketType, messageType, payload) {
    const schema = messageSchemas[socketType]?.[messageType];
    if (!schema) return false;

    for (const [key, type] of Object.entries(schema)) {
        if (!(key in payload)) return false;
        if (type === 'array' && !Array.isArray(payload[key])) return false;
        if (type !== 'array' && typeof payload[key] !== type) return false;
    }

    return true;
}

// POST endpoint for sending test messages
router.post('/test', 
    requireAuth,
    requireSuperAdmin,
    testMessageLimiter,
    hourlyTestMessageLimiter,
    async (req, res) => {
        try {
            const { socketType, messageType, payload } = req.body;

            // Validate input
            if (!socketType || !messageType || !payload) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required fields'
                });
            }

            // Validate socket type
            if (!messageSchemas[socketType]) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid socket type'
                });
            }

            // Validate message type and payload
            if (!validatePayload(socketType, messageType, payload)) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid message type or payload format'
                });
            }

            // Get the appropriate WebSocket server instance
            const wsServer = global.wsServers?.[socketType];
            if (!wsServer) {
                return res.status(500).json({
                    success: false,
                    error: 'WebSocket server not available'
                });
            }

            // Broadcast test message
            wsServer.broadcast({
                type: messageType,
                data: payload,
                timestamp: new Date().toISOString(),
                isTest: true
            });

            // Log test activity in memory
            testLogs.add({
                socket_type: socketType,
                message_type: messageType,
                payload: payload,
                admin: req.user.wallet_address,
                timestamp: new Date().toISOString()
            });

            res.json({
                success: true,
                message: 'Test message sent successfully'
            });

        } catch (error) {
            logApi.error('WebSocket test error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to send test message'
            });
        }
    }
);

// GET endpoint for WebSocket status
router.get('/status',
    requireAuth,
    requireSuperAdmin,
    async (req, res) => {
        try {
            const status = {};
            
            for (const [type, server] of Object.entries(global.wsServers || {})) {
                status[type] = {
                    connections: server.getConnectionsCount(),
                    uptime: process.uptime(),
                    memory: process.memoryUsage(),
                    errors: server.stats?.errors || 0,
                    messagesSent: server.stats?.messagesSent || 0,
                    messagesReceived: server.stats?.messagesReceived || 0
                };
            }

            res.json({
                success: true,
                status
            });

        } catch (error) {
            logApi.error('WebSocket status error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get WebSocket status'
            });
        }
    }
);

// GET endpoint for WebSocket logs
router.get('/logs',
    requireAuth,
    requireSuperAdmin,
    async (req, res) => {
        try {
            res.json({
                success: true,
                logs: testLogs.getAll()
            });
        } catch (error) {
            logApi.error('WebSocket logs error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get WebSocket logs'
            });
        }
    }
);

export default router; 