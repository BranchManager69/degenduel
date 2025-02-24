import { BaseWebSocketServer } from './base-websocket.js';
import { logApi } from '../utils/logger-suite/logger.js';

class TokenDataWebSocket extends BaseWebSocketServer {
    constructor(server) {
        super(server, {
            path: '/api/ws/token-data',
            maxMessageSize: 5 * 1024 * 1024, // 5MB, plenty of room
            requireAuth: false // We'll add auth later
        });

        logApi.info('Token Data WebSocket initialized');
    }

    async handleClientMessage(ws, message, clientInfo) {
        try {
            // Just log what we get for now
            logApi.info('Received token data:', {
                type: message.type,
                tokenCount: message.data?.length || 0,
                timestamp: message.timestamp
            });

            // Store it somewhere we can access it
            if (message.type === 'token_update' && message.data) {
                global.lastTokenData = message.data;
            }

        } catch (error) {
            logApi.error('Error handling token data:', error);
            this.sendError(ws, error.message);
        }
    }
}

export function createTokenDataWebSocket(server) {
    return new TokenDataWebSocket(server);
} 