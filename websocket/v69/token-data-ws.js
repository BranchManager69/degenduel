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
const WSS_PER_MESSAGE_DEFLATE = false; // Disable per-message deflate for compression
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
    // Standard configuration for token data WebSocket
    const baseOptions = {
      path: WSS_PATH,
      requireAuth: false, // Authentication disabled for public data
      publicEndpoints: WSS_PUBLIC_ENDPOINTS,
      maxPayload: WSS_MAX_PAYLOAD,
      rateLimit: WSS_RATE_LIMIT,
      heartbeatInterval: 60000,
      perMessageDeflate: false, // No compression
      authMode: 'auto'          // Accept any auth method
    };
    
    super(server, baseOptions);
    
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
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 INIT-ERROR ${fancyColors.RESET} ${fancyColors.RED}Error initializing Token Data WebSocket: ${error.message}${fancyColors.RESET}`, error);
      return false;
    }
  }

  /**
   * Handle market data broadcast from marketDataService
   * @param {Object} data - Market data to broadcast
   */
  async handleMarketDataBroadcast(data) {
    try {
      if (!data) return;

      // Update broadcast stats
      this.broadcasts.count++;
      this.broadcasts.lastUpdate = new Date();
      this.broadcasts.tokenCount = data.tokens?.length || 0;

      // Broadcast to public.tokens channel
      if (data.type === 'token-data' && data.tokens) {
        this.broadcastToChannel('public.tokens', {
          type: 'TOKEN_DATA',
          data: data.tokens,
          timestamp: new Date().toISOString()
        });
      }

      // Broadcast to public.market channel
      if (data.type === 'market-data' && data.market) {
        this.broadcastToChannel('public.market', {
          type: 'MARKET_DATA',
          data: data.market,
          timestamp: new Date().toISOString()
        });
      }

      // Broadcast specific token updates to their respective channels
      if (data.type === 'token-update' && data.token) {
        const token = data.token;
        
        // Broadcast to token specific channel
        if (token.symbol) {
          this.broadcastToChannel(`token.${token.symbol.toLowerCase()}`, {
            type: 'TOKEN_UPDATE',
            data: token,
            timestamp: new Date().toISOString()
          });
        }
      }
    } catch (error) {
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 BROADCAST-ERROR ${fancyColors.RESET} ${fancyColors.RED}Error broadcasting market data: ${error.message}${fancyColors.RESET}`, error);
    }
  }

  /**
   * Handle client connection
   * @param {WebSocket} ws - The WebSocket connection
   * @param {http.IncomingMessage} req - The HTTP request
   */
  async onConnection(ws, req) {
    try {
      const clientInfo = this.clientInfoMap.get(ws);
      if (!clientInfo) return;

      // Auto-subscribe to public channels
      if (this.publicChannels && this.publicChannels.length > 0) {
        for (const channel of this.publicChannels) {
          await this.handleSubscribe(ws, channel);
        }
      }

      // Send initial token data if available and client is subscribed
      const tokenData = await marketDataService.getTokenData();
      if (tokenData && tokenData.length > 0) {
        this.sendToClient(ws, {
          type: 'TOKEN_DATA',
          timestamp: new Date().toISOString(),
          data: tokenData
        });
      }

      // Send initial market data if available and client is subscribed
      const marketData = await marketDataService.getMarketSummary();
      if (marketData) {
        this.sendToClient(ws, {
          type: 'MARKET_DATA',
          timestamp: new Date().toISOString(),
          data: marketData
        });
      }
    } catch (error) {
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 CONN-ERROR ${fancyColors.RESET} ${fancyColors.RED}Error handling token-data connection: ${error.message}${fancyColors.RESET}`, error);
    }
  }

  /**
   * Handle client message
   * @param {WebSocket} ws - The WebSocket connection
   * @param {Object} message - The message
   */
  async onMessage(ws, message) {
    try {
      // Standard message handling by type
      const { type, channel, token, tokens } = message;

      switch (type) {
        case 'SUBSCRIBE':
          if (channel) {
            await this.handleSubscribe(ws, channel);
          } else if (token) {
            // Support for subscribing to a single token
            await this.handleSubscribe(ws, `token.${token.toLowerCase()}`);
          } else if (tokens && Array.isArray(tokens)) {
            // Support for subscribing to multiple tokens
            for (const tokenSymbol of tokens) {
              await this.handleSubscribe(ws, `token.${tokenSymbol.toLowerCase()}`);
            }
          }
          break;

        case 'UNSUBSCRIBE':
          if (channel) {
            await this.handleUnsubscribe(ws, channel);
          } else if (token) {
            await this.handleUnsubscribe(ws, `token.${token.toLowerCase()}`);
          } else if (tokens && Array.isArray(tokens)) {
            for (const tokenSymbol of tokens) {
              await this.handleUnsubscribe(ws, `token.${tokenSymbol.toLowerCase()}`);
            }
          }
          break;

        case 'GET_TOKEN':
          if (token) {
            await this.handleGetToken(ws, token);
          }
          break;

        case 'GET_ALL_TOKENS':
          await this.handleGetAllTokens(ws);
          break;

        case 'GET_MARKET_DATA':
          await this.handleGetMarketData(ws);
          break;

        case 'PING':
          this.sendToClient(ws, {
            type: 'PONG',
            timestamp: new Date().toISOString()
          });
          break;

        default:
          this.sendToClient(ws, {
            type: 'ERROR',
            error: `Unknown message type: ${type}`,
            timestamp: new Date().toISOString()
          });
      }
    } catch (error) {
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 MSG-ERROR ${fancyColors.RESET} ${fancyColors.RED}Error handling message: ${error.message}${fancyColors.RESET}`, error);
      this.sendToClient(ws, {
        type: 'ERROR',
        error: `Error processing message: ${error.message}`,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Handle client subscription to a channel
   * @param {WebSocket} ws - The WebSocket connection
   * @param {string} channel - The channel to subscribe to
   */
  async handleSubscribe(ws, channel) {
    // Create channel if it doesn't exist
    if (!this.channelSubscriptions.has(channel)) {
      this.channelSubscriptions.set(channel, new Set());
    }

    // Add client to subscribers
    this.channelSubscriptions.get(channel).add(ws);

    // Send subscription confirmation
    this.sendToClient(ws, {
      type: 'SUBSCRIBED',
      channel,
      timestamp: new Date().toISOString()
    });

    // Call the parent method for additional handling
    await this.onSubscribe(ws, channel);

    // If this is a token-specific channel, send latest token data
    if (channel.startsWith('token.')) {
      const tokenSymbol = channel.split('.')[1];
      await this.handleGetToken(ws, tokenSymbol);
    }
  }

  /**
   * Handle client unsubscription from a channel
   * @param {WebSocket} ws - The WebSocket connection
   * @param {string} channel - The channel to unsubscribe from
   */
  async handleUnsubscribe(ws, channel) {
    // Remove client from subscribers
    if (this.channelSubscriptions.has(channel)) {
      this.channelSubscriptions.get(channel).delete(ws);
    }

    // Send unsubscription confirmation
    this.sendToClient(ws, {
      type: 'UNSUBSCRIBED',
      channel,
      timestamp: new Date().toISOString()
    });

    // Call the parent method for additional handling
    await this.onUnsubscribe(ws, channel);
  }

  /**
   * Handle get token request
   * @param {WebSocket} ws - The WebSocket connection
   * @param {string} tokenSymbol - The token symbol
   */
  async handleGetToken(ws, tokenSymbol) {
    try {
      const token = await marketDataService.getTokenBySymbol(tokenSymbol);

      if (token) {
        this.sendToClient(ws, {
          type: 'TOKEN',
          data: token,
          timestamp: new Date().toISOString()
        });
      } else {
        this.sendToClient(ws, {
          type: 'ERROR',
          error: `Token not found: ${tokenSymbol}`,
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 GET-TOKEN-ERROR ${fancyColors.RESET} ${fancyColors.RED}Error getting token ${tokenSymbol}: ${error.message}${fancyColors.RESET}`, error);
      this.sendToClient(ws, {
        type: 'ERROR',
        error: `Error getting token: ${error.message}`,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Handle get all tokens request
   * @param {WebSocket} ws - The WebSocket connection
   */
  async handleGetAllTokens(ws) {
    try {
      const tokens = await marketDataService.getTokenData();

      if (tokens && tokens.length > 0) {
        this.sendToClient(ws, {
          type: 'TOKEN_DATA',
          data: tokens,
          timestamp: new Date().toISOString()
        });
      } else {
        this.sendToClient(ws, {
          type: 'TOKEN_DATA',
          data: [],
          timestamp: new Date().toISOString(),
          message: 'No token data available'
        });
      }
    } catch (error) {
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 GET-ALL-TOKENS-ERROR ${fancyColors.RESET} ${fancyColors.RED}Error getting all tokens: ${error.message}${fancyColors.RESET}`, error);
      this.sendToClient(ws, {
        type: 'ERROR',
        error: `Error getting all tokens: ${error.message}`,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Handle get market data request
   * @param {WebSocket} ws - The WebSocket connection
   */
  async handleGetMarketData(ws) {
    try {
      const marketData = await marketDataService.getMarketSummary();

      if (marketData) {
        this.sendToClient(ws, {
          type: 'MARKET_DATA',
          data: marketData,
          timestamp: new Date().toISOString()
        });
      } else {
        this.sendToClient(ws, {
          type: 'MARKET_DATA',
          data: {},
          timestamp: new Date().toISOString(),
          message: 'No market data available'
        });
      }
    } catch (error) {
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 GET-MARKET-DATA-ERROR ${fancyColors.RESET} ${fancyColors.RED}Error getting market data: ${error.message}${fancyColors.RESET}`, error);
      this.sendToClient(ws, {
        type: 'ERROR',
        error: `Error getting market data: ${error.message}`,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Clean up resources when the WebSocket server is shutting down
   */
  async onCleanup() {
    try {
      // Remove event listeners
      serviceEvents.off('market:broadcast', this.marketDataListener);

      return true;
    } catch (error) {
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 CLEANUP-ERROR ${fancyColors.RESET} ${fancyColors.RED}Error cleaning up TokenDataWebSocket: ${error.message}${fancyColors.RESET}`, error);
      return false;
    }
  }

  /**
   * Get metrics for the WebSocket server
   */
  getMetrics() {
    const baseMetrics = super.getMetrics();
    
    return {
      ...baseMetrics,
      broadcasts: this.broadcasts,
      tokenCount: this.broadcasts.tokenCount
    };
  }
}

/**
 * Create a new TokenDataWebSocket
 * @param {http.Server} server - The HTTP server to attach the WebSocket to
 * @returns {TokenDataWebSocket} - The token data WebSocket server
 */
export function createTokenDataWebSocket(server) {
  return new TokenDataWebSocket(server);
}

export default createTokenDataWebSocket;