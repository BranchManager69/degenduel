// websocket/v69/token-data-ws.js

/**
 * 
 * This file is responsible for the token data WebSocket server.
 * It is responsible for broadcasting token data to all connected clients.
 * 
 */

/**
 * TokenDataWebSocket (v69)
 * 
 * Real-time token data WebSocket implementation with:
 * - Integration with the new market database
 * - Market data broadcasting
 * - Token subscriptions
 * - Token price alerts
 */

import { BaseWebSocketServer } from './base-websocket.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors } from '../../utils/colors.js';
import marketDataService from '../../services/marketDataService.js';
import serviceEvents from '../../utils/service-suite/service-events.js';

// Config
const WSS_PATH = `/api/v69/ws/token-data`; // path to the WebSocket token data server // TODO: VERIFY THIS!
const WSS_REQUIRE_AUTH = false; // whether the WebSocket server requires authentication
const WSS_PUBLIC_ENDPOINTS = ['public.tokens', 'public.market']; // public endpoints to subscribe to by default
const WSS_MAX_PAYLOAD = 5 * 1024 * 1024; // 5MB
const WSS_PER_MESSAGE_DEFLATE = false; // whether to use per-message deflate
const WSS_RATE_LIMIT = 500; // rate limit for the WebSocket server

// Public channels to subscribe to by default
const WSS_PUBLIC_CHANNELS = WSS_PUBLIC_ENDPOINTS; // kind of confusing, but it's the correct term


// TokenDataWebSocket (v69)
class TokenDataWebSocket extends BaseWebSocketServer {
  /**
   * Create a new TokenDataWebSocket
   * @param {http.Server} server - The HTTP server to attach the WebSocket to
   */
  constructor(server) {
    super(server, {
      path: WSS_PATH,
      requireAuth: WSS_REQUIRE_AUTH,
      publicEndpoints: WSS_PUBLIC_ENDPOINTS,
      maxPayload: WSS_MAX_PAYLOAD,
      perMessageDeflate: WSS_PER_MESSAGE_DEFLATE,
      rateLimit: WSS_RATE_LIMIT
    });

    // Initialize token-specific state
    this.broadcasts = {
      count: 0,
      lastUpdate: null,
      tokenCount: 0
    };

    // Set up broadcast listener
    this.marketDataListener = this.handleMarketDataBroadcast.bind(this);

    logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.BOLD}${fancyColors.WHITE} V69 WEBSOCKET ${fancyColors.RESET} ${fancyColors.CYAN}${fancyColors.BOLD}TokenDataWebSocket initialized${fancyColors.RESET}`);
  }

  /**
   * Initialize the token data WebSocket
   */
  async onInitialize() {
    try {
      // Set up market data service listener via serviceEvents
      serviceEvents.on('market:broadcast', this.marketDataListener);

      // Subscribe to public channels by default
      this.publicChannels = WSS_PUBLIC_CHANNELS;

      logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 INIT ${fancyColors.RESET} ${fancyColors.CYAN}Token Data WebSocket initialized${fancyColors.RESET}`);
      return true;
    } catch (error) {
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 INIT ${fancyColors.RESET} ${fancyColors.RED}Failed to initialize Token Data WebSocket:${fancyColors.RESET} ${error.message}`);
      return false;
    }
  }

  /**
   * Handle new client connection
   * @param {WebSocket} ws - The WebSocket connection
   * @param {http.IncomingMessage} req - The HTTP request
   */
  async onConnection(ws, req) {
    const clientInfo = this.clientInfoMap.get(ws);
    if (!clientInfo) return;

    // Subscribe to public channels by default
    for (const channel of this.publicChannels) {
      await this.subscribeToChannel(ws, channel);
    }

    // Send initial token data to client
    try {
      const tokenData = await marketDataService.getAllTokens();
      if (tokenData && tokenData.length > 0) {
        this.sendToClient(ws, {
          type: 'token_update',
          timestamp: new Date().toISOString(),
          data: tokenData
        });

        logApi.debug(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 TOKEN DATA ${fancyColors.RESET} ${fancyColors.DARK_GREEN}Sent initial token data (${tokenData.length} tokens) to ${clientInfo.connectionId.substring(0,8)}${fancyColors.RESET}`);
      } else {
        logApi.warn(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 TOKEN DATA ${fancyColors.RESET} ${fancyColors.YELLOW}No initial token data available${fancyColors.RESET}`);
      }
    } catch (error) {
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 TOKEN DATA ${fancyColors.RESET} ${fancyColors.RED}Error fetching initial token data:${fancyColors.RESET} ${error.message}`);
    }
  }

  /**
   * Handle incoming message from client
   * @param {WebSocket} ws - The WebSocket connection
   * @param {Object} message - The parsed message
   */
  async onMessage(ws, message) {
    const clientInfo = this.clientInfoMap.get(ws);
    if (!clientInfo) return;

    // Handle token-specific message types
    switch (message.type) {
      case 'subscribe_tokens':
        // Subscribe to specific tokens
        if (Array.isArray(message.symbols)) {
          const validSymbols = [];
          
          // Validate symbols exist
          for (const symbol of message.symbols) {
            try {
              const token = await marketDataService.getToken(symbol);
              if (token) {
                validSymbols.push(symbol);
                // Create token-specific channel
                const tokenChannel = `token.${symbol}`;
                await this.subscribeToChannel(ws, tokenChannel);
              }
            } catch (error) {
              logApi.debug(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 TOKEN DATA ${fancyColors.RESET} ${fancyColors.YELLOW}Invalid token symbol: ${symbol}${fancyColors.RESET}`);
            }
          }
          
          // Send success response
          this.sendToClient(ws, {
            type: 'tokens_subscribed',
            symbols: validSymbols,
            count: validSymbols.length,
            timestamp: new Date().toISOString()
          });
          
          // Send current data for these tokens
          if (validSymbols.length > 0) {
            const tokenData = [];
            for (const symbol of validSymbols) {
              const token = await marketDataService.getToken(symbol);
              if (token) {
                tokenData.push(token);
              }
            }
            
            if (tokenData.length > 0) {
              this.sendToClient(ws, {
                type: 'token_update',
                timestamp: new Date().toISOString(),
                data: tokenData
              });
            }
          }
        }
        break;
        
      case 'unsubscribe_tokens':
        // Unsubscribe from specific tokens
        if (Array.isArray(message.symbols)) {
          for (const symbol of message.symbols) {
            const tokenChannel = `token.${symbol}`;
            await this.unsubscribeFromChannel(ws, tokenChannel);
          }
          
          // Send success response
          this.sendToClient(ws, {
            type: 'tokens_unsubscribed',
            symbols: message.symbols,
            count: message.symbols.length,
            timestamp: new Date().toISOString()
          });
        }
        break;
        
      case 'get_token':
        // Get data for a specific token
        if (message.symbol) {
          try {
            const token = await marketDataService.getToken(message.symbol);
            if (token) {
              this.sendToClient(ws, {
                type: 'token_data',
                timestamp: new Date().toISOString(),
                symbol: message.symbol,
                data: token
              });
            } else {
              this.sendError(ws, 'TOKEN_NOT_FOUND', `Token ${message.symbol} not found`);
            }
          } catch (error) {
            this.sendError(ws, 'TOKEN_FETCH_ERROR', `Error fetching token data: ${error.message}`);
          }
        } else {
          this.sendError(ws, 'INVALID_REQUEST', 'Symbol is required for token data request');
        }
        break;
        
      case 'get_all_tokens':
        // Get data for all tokens
        try {
          const tokens = await marketDataService.getAllTokens();
          this.sendToClient(ws, {
            type: 'token_update',
            timestamp: new Date().toISOString(),
            data: tokens
          });
        } catch (error) {
          this.sendError(ws, 'TOKEN_FETCH_ERROR', `Error fetching token data: ${error.message}`);
        }
        break;
        
      // Admin-only: token data providers can send token updates
      case 'token_update':
        if (clientInfo.authenticated && (clientInfo.user.role === 'admin' || clientInfo.user.role === 'superadmin')) {
          if (message.data && Array.isArray(message.data)) {
            // Store the data in a global reference for other services
            global.lastTokenData = message.data;
            
            // Broadcast to all subscribers
            this.broadcastToChannel('public.tokens', {
              type: 'token_update',
              data: message.data,
              timestamp: new Date().toISOString()
            });
            
            // Send success response
            this.sendToClient(ws, {
              type: 'token_update_received',
              count: message.data.length,
              timestamp: new Date().toISOString()
            });
            
            logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 TOKEN DATA ${fancyColors.RESET} ${fancyColors.GREEN}Received token update from admin (${message.data.length} tokens)${fancyColors.RESET}`);
          } else {
            this.sendError(ws, 'INVALID_DATA', 'Invalid token data format');
          }
        } else {
          this.sendError(ws, 'UNAUTHORIZED', 'Only admins can send token updates');
        }
        break;
      
      default:
        // Unknown message type, log it
        logApi.debug(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 TOKEN DATA ${fancyColors.RESET} ${fancyColors.YELLOW}Unknown message type: ${message.type}${fancyColors.RESET}`);
    }
  }

  /**
   * Handle market data broadcast from the market data service
   * @param {Object} data - The market data broadcast
   */
  handleMarketDataBroadcast(data) {
    if (!data || !data.data || !Array.isArray(data.data)) {
      return;
    }
    
    // Update our statistics
    this.broadcasts.count++;
    this.broadcasts.lastUpdate = new Date().toISOString();
    this.broadcasts.tokenCount = data.data.length;
    
    // Broadcast to all clients subscribed to public.tokens channel
    this.broadcastToChannel('public.tokens', {
      type: 'token_update',
      data: data.data,
      timestamp: data.timestamp || new Date().toISOString()
    });
    
    // Also broadcast to the public.market channel
    this.broadcastToChannel('public.market', {
      type: 'market_update',
      data: data.data,
      timestamp: data.timestamp || new Date().toISOString()
    });
    
    // Broadcast individual token updates to their respective channels
    for (const token of data.data) {
      if (token.symbol) {
        const tokenChannel = `token.${token.symbol}`;
        // Only broadcast if anyone is listening
        if (this.channelSubscriptions.has(tokenChannel)) {
          this.broadcastToChannel(tokenChannel, {
            type: 'token_data',
            symbol: token.symbol,
            data: token,
            timestamp: data.timestamp || new Date().toISOString()
          });
        }
      }
    }
    
    logApi.debug(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 TOKEN DATA ${fancyColors.RESET} ${fancyColors.GREEN}Broadcasted token data update (${data.data.length} tokens)${fancyColors.RESET}`);
  }

  /**
   * Override the onCleanup method to remove the market data listener
   */
  async onCleanup() {
    // Remove event listener - use serviceEvents since that's where we added the listener
    serviceEvents.off('market:broadcast', this.marketDataListener);
    
    logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 CLEANUP ${fancyColors.RESET} ${fancyColors.CYAN}Token Data WebSocket cleaned up${fancyColors.RESET}`, {
      broadcasts: this.broadcasts.count,
      lastUpdate: this.broadcasts.lastUpdate
    });
  }
  
  /**
   * Get custom metrics for this WebSocket
   * @returns {Object} - Custom metrics
   */
  getCustomMetrics() {
    return {
      broadcasts: {
        count: this.broadcasts.count,
        lastUpdate: this.broadcasts.lastUpdate,
        tokenCount: this.broadcasts.tokenCount
      },
      channels: {
        totalSubscriptions: Array.from(this.channelSubscriptions.entries())
          .reduce((acc, [_, subs]) => acc + subs.size, 0),
        mostPopular: Array.from(this.channelSubscriptions.entries())
          .sort((a, b) => b[1].size - a[1].size)
          .slice(0, 5)
          .map(([channel, subs]) => ({ channel, subscribers: subs.size }))
      }
    };
  }
}

export function createTokenDataWebSocket(server) {
  return new TokenDataWebSocket(server);
}