import { BaseWebSocketServer } from './base-websocket.js';
import { logApi } from '../utils/logger-suite/logger.js';
import { fancyColors } from '../utils/colors.js';
import marketDataService from '../services/marketDataService.js';

class TokenDataWebSocket extends BaseWebSocketServer {
    constructor(server) {
        super(server, {
            path: '/api/ws/token-data',
            maxMessageSize: 5 * 1024 * 1024, // 5MB, plenty of room
            requireAuth: false, // We'll add auth later
            perMessageDeflate: false, // IMPORTANT: Disable compression for this WebSocket
            useCompression: false // Also set the alias property for clarity
        });

        // Initialize state
        this.connectedClients = new Set();
        this.messageCounter = {
            broadcast: 0,
            received: 0,
            errors: 0
        };

        logApi.info(`${fancyColors.MAGENTA}[token-data-ws]${fancyColors.RESET} ${fancyColors.GREEN}Token Data WebSocket initialized${fancyColors.RESET}`);
    }

    // Add initialize method to support the WebSocket initialization process
    async initialize() {
        try {
            // Set up listener for market data broadcasts
            marketDataService.on('market:broadcast', (data) => {
                this.broadcastMarketData(data);
            });

            // Initial data push to clients that connect before the first broadcast
            const initialData = await marketDataService.getAllTokens();
            if (initialData && initialData.length > 0) {
                this.initialTokenData = {
                    type: 'token_update',
                    timestamp: new Date().toISOString(),
                    data: initialData
                };
                logApi.info(`${fancyColors.MAGENTA}[token-data-ws]${fancyColors.RESET} ${fancyColors.DARK_GREEN}Loaded initial token data with ${initialData.length} tokens${fancyColors.RESET}`);
            }

            logApi.info(`${fancyColors.MAGENTA}[token-data-ws]${fancyColors.RESET} ${fancyColors.GREEN}Token Data WebSocket server initialized${fancyColors.RESET}`);
            return true;
        } catch (error) {
            logApi.error(`${fancyColors.MAGENTA}[token-data-ws]${fancyColors.RESET} ${fancyColors.RED}Error initializing Token Data WebSocket:${fancyColors.RESET}`, error);
            return false;
        }
    }

    // Override the connection handler to track connected clients
    onConnection(ws, req, clientInfo) {
        // Call parent method first
        super.onConnection(ws, req, clientInfo);
        
        // Add client to our set
        this.connectedClients.add(ws);
        
        // Send initial data if available
        if (this.initialTokenData) {
            this.send(ws, this.initialTokenData);
            logApi.info(`${fancyColors.MAGENTA}[token-data-ws]${fancyColors.RESET} ${fancyColors.DARK_GREEN}Sent initial token data to new client${fancyColors.RESET}`);
        }
        
        // Override close handler to remove client from set
        const originalCloseHandler = ws.onclose;
        ws.onclose = (event) => {
            this.connectedClients.delete(ws);
            if (originalCloseHandler) {
                originalCloseHandler.call(ws, event);
            }
            
            logApi.info(`${fancyColors.MAGENTA}[token-data-ws]${fancyColors.RESET} ${fancyColors.DARK_YELLOW}Client disconnected, ${this.connectedClients.size} clients remaining${fancyColors.RESET}`);
        };
        
        logApi.info(`${fancyColors.MAGENTA}[token-data-ws]${fancyColors.RESET} ${fancyColors.DARK_GREEN}Client connected, ${this.connectedClients.size} total clients${fancyColors.RESET}`);
    }

    // Broadcast market data to all connected clients
    broadcastMarketData(data) {
        if (!data || !data.data || !Array.isArray(data.data)) {
            logApi.warn(`${fancyColors.MAGENTA}[token-data-ws]${fancyColors.RESET} ${fancyColors.RED}Invalid market data for broadcast${fancyColors.RESET}`);
            return;
        }
        
        // Update global reference for other services to access
        global.lastTokenData = data.data;
        
        // Store for new connections
        this.initialTokenData = data;
        
        // Only broadcast if we have connected clients
        if (this.connectedClients.size === 0) {
            return;
        }
        
        // Log broadcast stats
        this.messageCounter.broadcast++;
        
        logApi.info(`${fancyColors.MAGENTA}[token-data-ws]${fancyColors.RESET} ${fancyColors.DARK_GREEN}Broadcasting market data to ${this.connectedClients.size} clients: ${data.data.length} tokens${fancyColors.RESET}`);
        
        // Broadcast to all connected clients
        this.broadcast(data);
    }

    // Handle incoming messages from clients
    async handleClientMessage(ws, message, clientInfo) {
        try {
            this.messageCounter.received++;
            
            // Check if this is a subscription message
            if (message.type === 'subscribe') {
                // Handle subscription updates
                if (message.symbols && Array.isArray(message.symbols)) {
                    logApi.info(`${fancyColors.MAGENTA}[token-data-ws]${fancyColors.RESET} ${fancyColors.DARK_GREEN}Client subscribed to ${message.symbols.length} tokens${fancyColors.RESET}`);
                    
                    // Store subscription details on the client
                    ws.subscriptions = message.symbols;
                    
                    // Send current data for requested symbols
                    const tokens = [];
                    for (const symbol of message.symbols) {
                        const token = await marketDataService.getToken(symbol);
                        if (token) {
                            tokens.push(token);
                        }
                    }
                    
                    if (tokens.length > 0) {
                        this.send(ws, {
                            type: 'token_update',
                            timestamp: new Date().toISOString(),
                            data: tokens
                        });
                    }
                }
                return;
            }
            
            // For external data providers, accept token updates
            if (message.type === 'token_update' && message.data && Array.isArray(message.data) && clientInfo.isAdmin) {
                logApi.info(`${fancyColors.MAGENTA}[token-data-ws]${fancyColors.RESET} ${fancyColors.GREEN}Received token data from admin: ${message.data.length} tokens${fancyColors.RESET}`);
                
                // Store for use by other services
                global.lastTokenData = message.data;
                
                // Broadcast to other clients
                this.broadcast(message, [ws]); // Exclude the sender
                
                return;
            }
            
            // Log unexpected messages
            logApi.warn(`${fancyColors.MAGENTA}[token-data-ws]${fancyColors.RESET} ${fancyColors.YELLOW}Unexpected message type: ${message.type}${fancyColors.RESET}`);

        } catch (error) {
            this.messageCounter.errors++;
            logApi.error(`${fancyColors.MAGENTA}[token-data-ws]${fancyColors.RESET} ${fancyColors.RED}Error handling token data:${fancyColors.RESET}`, error);
            this.sendError(ws, error.message);
        }
    }

    /**
     * Clean up resources before shutdown
     */
    cleanup() {
        try {
            // Remove event listeners
            marketDataService.removeAllListeners('market:broadcast');
            
            // Clear client tracking
            this.connectedClients.clear();
            
            // Log stats before cleanup
            logApi.info(`${fancyColors.MAGENTA}[token-data-ws]${fancyColors.RESET} ${fancyColors.YELLOW}Token Data WebSocket stats:${fancyColors.RESET}`, this.messageCounter);
            
            // Call parent cleanup
            super.cleanup();
            
            logApi.info(`${fancyColors.MAGENTA}[token-data-ws]${fancyColors.RESET} ${fancyColors.RED}Token Data WebSocket cleaned up${fancyColors.RESET}`);
        } catch (error) {
            logApi.error(`${fancyColors.MAGENTA}[token-data-ws]${fancyColors.RESET} ${fancyColors.RED}Error during cleanup:${fancyColors.RESET}`, error);
        }
    }
}

export function createTokenDataWebSocket(server) {
    return new TokenDataWebSocket(server);
}