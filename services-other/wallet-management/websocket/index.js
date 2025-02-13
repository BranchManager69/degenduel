import { WebSocketServer } from 'ws';
import { verifyToken } from '../utils/auth.js';
import { logApi } from '../../../utils/logger-suite/logger.js';

class WalletWebSocketServer {
    static instance = null;
    #wss = null;
    #clients = new Map(); // Map<ws, { userId, role }>
    
    constructor(server) {
        if (WalletWebSocketServer.instance) {
            return WalletWebSocketServer.instance;
        }
        this.#initializeWSS(server);
        WalletWebSocketServer.instance = this;
    }

    #initializeWSS(server) {
        this.#wss = new WebSocketServer({ 
            server,
            path: '/api/v2/ws/wallet',
            verifyClient: this.#verifyClient,
            handleProtocols: (protocols, request) => {
                // Get the token from either protocols or headers
                const token = protocols[0] || request.headers['sec-websocket-protocol'];
                if (!token) return false;
                
                // Store the token in the request for later use in connection handling
                request.token = token;
                return token;
            }
        });

        this.#wss.on('connection', this.#handleConnection.bind(this));
        
        // Heartbeat to keep connections alive
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

        logApi.info('Wallet WebSocket server initialized');
    }

    #verifyClient = async (info, callback) => {
        try {
            const token = info.req.headers['sec-websocket-protocol'] || 
                         info.req.headers.protocol?.[0] ||
                         info.req.token;
                         
            if (!token) {
                return callback(false, 401, 'Unauthorized');
            }

            const user = await verifyToken(token);
            if (!user || user.role !== 'superadmin') {
                return callback(false, 403, 'Forbidden');
            }

            info.req.user = user;
            callback(true);
        } catch (error) {
            logApi.error('WebSocket authentication error:', error);
            callback(false, 401, 'Unauthorized');
        }
    }

    #handleConnection(ws, req) {
        try {
            logApi.info('New WebSocket connection attempt');
            ws.isAlive = true;
            this.#clients.set(ws, {
                userId: req.user.id,
                role: req.user.role
            });
            logApi.info('Client added to tracking map');

            // Handle pong messages for connection keepalive
            ws.on('pong', () => {
                ws.isAlive = true;
            });

            // Handle client messages (if needed)
            ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data);
                    logApi.debug('Received wallet ws message:', message);
                } catch (error) {
                    logApi.error('Error handling wallet ws message:', error);
                }
            });

            // Handle disconnection
            ws.on('close', () => {
                logApi.info('WebSocket connection closed');
                this.#clients.delete(ws);
            });

            // Send initial connection success
            const initialMessage = {
                type: 'CONNECTED',
                timestamp: new Date().toISOString()
            };
            logApi.info('Sending initial connection message:', initialMessage);
            ws.send(JSON.stringify(initialMessage));
            logApi.info('WebSocket connection established successfully');
        } catch (error) {
            logApi.error('Error in handleConnection:', error);
            ws.terminate();
        }
    }

    // Private broadcast method
    #broadcast(message) {
        try {
            logApi.info('Broadcasting message:', {
                type: message.type,
                data: message.data,
                timestamp: message.timestamp
            });
            const payload = JSON.stringify(message);
            let sentCount = 0;
            let clientStates = [];
            
            this.#wss.clients.forEach((client) => {
                clientStates.push(client.readyState);
                if (client.readyState === client.OPEN) {
                    client.send(payload);
                    sentCount++;
                }
            });
            
            logApi.info(`Broadcast complete. Client states:`, clientStates, `Sent to ${sentCount} clients`);
        } catch (error) {
            logApi.error('Error broadcasting message:', error);
        }
    }

    // Public methods for broadcasting events
    broadcastWalletUpdate(walletData) {
        logApi.info('Wallet update event:', walletData);
        this.#broadcast({
            type: 'WALLET_UPDATED',
            data: walletData,
            timestamp: new Date().toISOString()
        });
    }

    broadcastTransferStarted(transferData) {
        this.#broadcast({
            type: 'TRANSFER_STARTED',
            data: transferData,
            timestamp: new Date().toISOString()
        });
    }

    broadcastTransferComplete(transferData) {
        this.#broadcast({
            type: 'TRANSFER_COMPLETE',
            data: transferData,
            timestamp: new Date().toISOString()
        });
    }

    broadcastError(error) {
        this.#broadcast({
            type: 'ERROR',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }

    // Get active connections count
    getConnectionsCount() {
        return this.#clients.size;
    }

    // Cleanup method
    cleanup() {
        this.#wss?.clients.forEach((ws) => {
            ws.terminate();
        });
        this.#clients.clear();
        this.#wss?.close();
        WalletWebSocketServer.instance = null;
    }
}

export default WalletWebSocketServer; 