// websocket/base-websocket.js

/*
 * This is the base class for all WebSocket servers.
 * It provides a common interface for all WebSocket servers and handles
 * authentication, rate limiting, and message queuing.
 */

import { WebSocketServer } from 'ws';
import { logApi } from '../utils/logger-suite/logger.js';
import jwt from 'jsonwebtoken';
import { config } from '../config/config.js';
import prisma from '../config/prisma.js';

// Base WebSocket Server
export class BaseWebSocketServer {
    static instance = null;
    #wss = null;
    #clients = new Map(); // Map<ws, ClientInfo>
    #messageQueue = new Map(); // Map<clientId, Array<Message>>
    #rateLimits = new Map(); // Map<clientId, { count: number, resetTime: number }>
    
    constructor(server, options) {
        if (!server) {
            throw new Error('HTTP server instance is required for WebSocket initialization');
        }

        this.options = {
            path: options.path,
            maxMessageSize: options.maxMessageSize || 100 * 1024, // 100KB default
            rateLimit: options.rateLimit || 100, // messages per minute
            requireAuth: options.requireAuth !== false, // require auth by default
            ...options
        };

        this.#initializeWSS(server);
        this.startCleanupInterval();
    }

    #initializeWSS(server) {
        this.#wss = new WebSocketServer({
            noServer: true,
            maxPayload: this.options.maxMessageSize
        });

        // Handle upgrade requests
        server.on('upgrade', (request, socket, head) => {
            if (request.url === this.options.path) {
                this.#verifyClient(request, (verified, code, message) => {
                    if (!verified) {
                        socket.write(`HTTP/1.1 ${code} ${message}\r\n\r\n`);
                        socket.destroy();
                        return;
                    }

                    this.#wss.handleUpgrade(request, socket, head, (ws) => {
                        this.#wss.emit('connection', ws, request);
                    });
                });
            }
        });

        this.#wss.on('connection', this.#handleConnection.bind(this));
        
        logApi.info(`WebSocket server initialized on path: ${this.options.path}`);
    }

    async #verifyClient(request, callback) {
        try {
            if (!this.options.requireAuth) {
                return callback(true);
            }

            const token = this.#extractToken(request);
            if (!token) {
                return callback(false, 401, 'No token provided');
            }

            const decoded = jwt.verify(token, config.jwt.secret);
            const user = await this.#validateUser(decoded);
            
            if (!user) {
                return callback(false, 403, 'Invalid user');
            }

            request.user = user;
            callback(true);
        } catch (error) {
            logApi.error('WebSocket authentication error:', error);
            callback(false, 401, 'Authentication failed');
        }
    }

    #extractToken(request) {
        return (
            request.headers['sec-websocket-protocol'] ||
            request.headers.protocol?.[0] ||
            new URL(request.url, 'http://localhost').searchParams.get('token')
        );
    }

    async #validateUser(decoded) {
        return await prisma.users.findUnique({
            where: { wallet_address: decoded.wallet_address }
        });
    }

    #handleConnection(ws, req) {
        try {
            ws.isAlive = true;
            const clientInfo = {
                userId: req.user?.id,
                wallet: req.user?.wallet_address,
                role: req.user?.role,
                connectedAt: new Date()
            };
            
            this.#clients.set(ws, clientInfo);
            this.#setupMessageQueue(clientInfo.userId);
            
            logApi.info('New WebSocket connection:', {
                path: this.options.path,
                client: clientInfo
            });

            ws.on('pong', () => {
                ws.isAlive = true;
            });

            ws.on('message', (data) => this.#handleMessage(ws, data));

            ws.on('close', () => {
                this.#clients.delete(ws);
                logApi.info('WebSocket connection closed:', {
                    path: this.options.path,
                    client: clientInfo
                });
            });

            // Send any queued messages
            this.#sendQueuedMessages(ws, clientInfo.userId);

            // Send initial connection success
            this.sendToClient(ws, {
                type: 'CONNECTED',
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            logApi.error('Error in handleConnection:', error);
            ws.terminate();
        }
    }

    async #handleMessage(ws, data) {
        try {
            const clientInfo = this.#clients.get(ws);
            if (!this.#checkRateLimit(clientInfo.userId)) {
                this.sendError(ws, 'Rate limit exceeded', 4029);
                return;
            }

            const message = JSON.parse(data);
            
            // Check for test messages - only allow from superadmin
            if (message.isTest && clientInfo.role !== 'superadmin') {
                this.sendError(ws, 'Unauthorized - Test messages require superadmin role', 4003);
                return;
            }

            if (message.type === 'ping') {
                this.sendToClient(ws, {
                    type: 'pong',
                    timestamp: message.timestamp
                });
                return;
            }

            // Let child class handle the message
            await this.handleClientMessage(ws, message, clientInfo);

        } catch (error) {
            logApi.error('Error handling message:', error);
            this.sendError(ws, 'Invalid message format', 4004);
        }
    }

    #checkRateLimit(clientId) {
        const now = Date.now();
        const clientLimit = this.#rateLimits.get(clientId) || {
            count: 0,
            resetTime: now + 60000
        };

        if (now > clientLimit.resetTime) {
            clientLimit.count = 0;
            clientLimit.resetTime = now + 60000;
        }

        clientLimit.count++;
        this.#rateLimits.set(clientId, clientLimit);

        return clientLimit.count <= this.options.rateLimit;
    }

    startCleanupInterval() {
        // Heartbeat check
        setInterval(() => {
            this.#wss.clients.forEach((ws) => {
                if (ws.isAlive === false) {
                    this.#clients.delete(ws);
                    return ws.terminate();
                }
                ws.isAlive = false;
                ws.ping();
            });
        }, 30000);

        // Rate limit reset
        setInterval(() => {
            const now = Date.now();
            for (const [clientId, limit] of this.#rateLimits.entries()) {
                if (now > limit.resetTime) {
                    this.#rateLimits.delete(clientId);
                }
            }
        }, 60000);
    }

    // Message queueing
    #setupMessageQueue(clientId) {
        if (!this.#messageQueue.has(clientId)) {
            this.#messageQueue.set(clientId, []);
        }
    }

    async #sendQueuedMessages(ws, clientId) {
        const queue = this.#messageQueue.get(clientId) || [];
        while (queue.length > 0) {
            const message = queue.shift();
            await this.sendToClient(ws, message);
        }
        this.#messageQueue.set(clientId, []);
    }

    // Public methods for child classes
    broadcast(message, filter = null) {
        try {
            const payload = JSON.stringify(message);
            let sentCount = 0;
            
            this.#wss.clients.forEach((client) => {
                const clientInfo = this.#clients.get(client);
                if (!clientInfo) return;

                if (filter && !filter(clientInfo)) return;

                if (client.readyState === client.OPEN) {
                    client.send(payload);
                    sentCount++;
                } else if (message.store) {
                    // Queue message if it should be stored
                    const queue = this.#messageQueue.get(clientInfo.userId) || [];
                    queue.push(message);
                    this.#messageQueue.set(clientInfo.userId, queue);
                }
            });
            
            if (sentCount > 0) {
                logApi.info(`📢 Broadcasted to ${sentCount} clients`);
            }
        
        } catch (error) {
            logApi.error('Error broadcasting message:', error);
        }
    }

    sendToClient(ws, message) {
        try {
            if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify(message));
            }
        } catch (error) {
            logApi.error('Error sending message to client:', error);
        }
    }

    sendError(ws, error, code = 4000) {
        this.sendToClient(ws, {
            type: 'ERROR',
            error,
            code,
            timestamp: new Date().toISOString()
        });
    }

    // Methods to be implemented by child classes
    async handleClientMessage(ws, message, clientInfo) {
        throw new Error('handleClientMessage must be implemented by child class');
    }

    // Cleanup
    cleanup() {
        this.#wss?.clients.forEach((ws) => {
            ws.terminate();
        });
        this.#clients.clear();
        this.#messageQueue.clear();
        this.#rateLimits.clear();
        this.#wss?.close();
    }

    // Protected methods for child classes
    _getClients() {
        return this.#clients;
    }

    _getWSS() {
        return this.#wss;
    }

    _getConnectedClients() {
        return Array.from(this.#wss.clients);
    }

    _getClientInfo(client) {
        return this.#clients.get(client);
    }
} 