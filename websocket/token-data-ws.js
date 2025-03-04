import { BaseWebSocketServer } from './base-websocket.js';
import { logApi } from '../utils/logger-suite/logger.js';

class TokenDataWebSocket extends BaseWebSocketServer {
    constructor(server) {
        super(server, {
            path: '/api/ws/token-data',
            maxMessageSize: 5 * 1024 * 1024, // 5MB, plenty of room
            requireAuth: false, // We'll add auth later
            perMessageDeflate: false // Disable compression for this WebSocket
        });

        logApi.info('Token Data WebSocket initialized');
    }

    // Add initialize method to support the WebSocket initialization process
    async initialize() {
        // Any specific initialization logic for token data WebSocket
        logApi.info('Token Data WebSocket server initialized');
        return true;
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

    /**
     * Clean up resources before shutdown
     */
    cleanup() {
        super.cleanup();
        logApi.info('Token Data WebSocket cleaned up');
    }
}

export function createTokenDataWebSocket(server) {
    return new TokenDataWebSocket(server);
} 