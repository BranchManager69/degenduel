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
    // MAXIMUM COMPATIBILITY MODE FOR TOKEN-DATA WEBSOCKET
    // This configuration is specifically designed to fix the token-data WebSocket issues
    const baseOptions = {
      path: WSS_PATH,
      requireAuth: false, // Authentication disabled for maximum compatibility
      publicEndpoints: WSS_PUBLIC_ENDPOINTS,
      maxPayload: WSS_MAX_PAYLOAD,
      rateLimit: WSS_RATE_LIMIT,
      heartbeatInterval: 60000,
      perMessageDeflate: false, // Explicitly disable compression
      useCompression: false,    // Alias for clarity
      authMode: 'auto',         // Accept any auth method
      
      // CRITICAL COMPATIBILITY FIX: Bypass normal verifyClient
      // This is the key to fixing the WebSocket upgrade issues
      _verifyClient: {
        // Always accept connections with no validation
        skipUTF8Validation: true,
        verifyClient: () => true,
        
        // This is the critical function we need to override
        verifyClient: (info, callback) => {
          // Immediately approve all connections
          logApi.info(`${fancyColors.BG_GREEN}${fancyColors.BLACK} TOKEN-DATA-VERIFY ${fancyColors.RESET} Auto-approving client verification for maximum compatibility`);
          callback(true);
        }
      },
      
      // DIRECT WEBSOCKET SERVER CONFIGURATION OVERRIDE
      // These options go directly to the WebSocket.Server constructor
      _ws_direct_options: {
        // Core settings for maximum compatibility
        perMessageDeflate: false,  // Force disable compression
        skipUTF8Validation: true,  // Skip UTF-8 validation
        
        // Always verify client as OK but explicitly preserve required headers
        verifyClient: (info, cb) => {
          // Log all incoming headers for debugging
          logApi.warn(`${fancyColors.BG_GREEN}${fancyColors.BLACK} TOKEN-DATA-DIRECT ${fancyColors.RESET} Direct verifyClient with request info:`, {
            headers: info.req.headers,
            url: info.req.url,
            method: info.req.method,
            httpVersion: info.req.httpVersion,
            _highlight: true
          });
          
          // ULTRA-AGGRESSIVE HEADER RESTORATION
          // Completely recreate headers object to bypass any property descriptor or accessor issues
          const originalHeaders = info.req.headers;
          info.req.headers = {
            ...(originalHeaders || {}),
            'upgrade': 'websocket',
            'connection': 'Upgrade',
            'sec-websocket-key': originalHeaders['sec-websocket-key'] || 
              Buffer.from(Math.random().toString(36).substring(2, 15)).toString('base64'),
            'sec-websocket-version': originalHeaders['sec-websocket-version'] || '13'
          };
          
          // Add user agent if it doesn't exist
          if (!info.req.headers['user-agent']) {
            info.req.headers['user-agent'] = 'DegenDuel/v69 Token-Data-WS Client';
          }
          
          // Log the FIXED headers to confirm they're set
          logApi.warn(`${fancyColors.BG_YELLOW}${fancyColors.BLACK} HEADER FIXED ${fancyColors.RESET} Fixed WebSocket headers:`, {
            fixed_headers: {
              'upgrade': info.req.headers.upgrade,
              'connection': info.req.headers.connection,
              'sec-websocket-key': info.req.headers['sec-websocket-key'],
              'sec-websocket-version': info.req.headers['sec-websocket-version']
            },
            _highlight: true
          });
          
          // Always return true to allow connection
          if (cb) cb(true);
          return true;
        },
        
        // CRITICAL: Handle protocol negotiation to disable extensions
        handleProtocols: (protocols, request) => {
          // Log protocol details for debugging
          const protocolList = Array.isArray(protocols) ? protocols.join(', ') : 'none';
          logApi.warn(`${fancyColors.BG_YELLOW}${fancyColors.BLACK} TOKEN-DATA PROTOCOLS ${fancyColors.RESET} Client protocols: ${protocolList}`);
          
          // Add redundant header injection here too
          if (request && request.headers) {
            // ULTRA-AGGRESSIVE HEADER RESTORATION AGAIN
            // Completely recreate headers object to bypass any property descriptor issues
            const originalHeaders = request.headers;
            request.headers = {
              ...(originalHeaders || {}),
              'upgrade': 'websocket',
              'connection': 'Upgrade',
              'sec-websocket-key': originalHeaders['sec-websocket-key'] || 
                Buffer.from(Math.random().toString(36).substring(2, 15)).toString('base64'),
              'sec-websocket-version': originalHeaders['sec-websocket-version'] || '13'
            };
            
            // CRITICAL: Remove extension headers for maximum compatibility
            if (request.headers['sec-websocket-extensions']) {
              logApi.warn(`${fancyColors.BG_RED}${fancyColors.WHITE} EXTENSION OVERRIDE ${fancyColors.RESET} Removing extensions: ${request.headers['sec-websocket-extensions']}`);
              delete request.headers['sec-websocket-extensions'];
            }
            
            // Log the FIXED headers again
            logApi.warn(`${fancyColors.BG_YELLOW}${fancyColors.BLACK} PROTOCOL HEADER FIX ${fancyColors.RESET} Fixed headers in handleProtocols:`, {
              fixed_headers: {
                'upgrade': request.headers.upgrade,
                'connection': request.headers.connection,
                'sec-websocket-key': request.headers['sec-websocket-key'],
                'sec-websocket-version': request.headers['sec-websocket-version']
              },
              _highlight: true
            });
          }
          
          // Accept first protocol or null
          return protocols && protocols.length > 0 ? protocols[0] : null;
        },
        
        // Don't validate origin to accept connections from any client
        origin: '*'
      }
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
    if (!clientInfo) {
      logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} TOKEN-DATA ERROR ${fancyColors.RESET} onConnection called but clientInfo is missing`);
      return;
    }

    // Generate wallet display string for enhanced logging
    const walletDisplay = clientInfo.authenticated ? 
                       `${clientInfo.user.role === 'superadmin' || clientInfo.user.role === 'admin' ? 
                         fancyColors.RED : fancyColors.PURPLE}${clientInfo.user.wallet_address.substring(0,8)}...${fancyColors.RESET}` : 
                       `${fancyColors.LIGHT_GRAY}unauthenticated${fancyColors.RESET}`;
    
    const roleDisplay = clientInfo.authenticated ?
                      `${clientInfo.user.role === 'superadmin' || clientInfo.user.role === 'admin' ? 
                        fancyColors.RED : fancyColors.PURPLE}${clientInfo.user.role}${fancyColors.RESET}` :
                      `${fancyColors.LIGHT_GRAY}none${fancyColors.RESET}`;

    // Enhanced connection logging for debugging
    logApi.info(`${fancyColors.BG_GREEN}${fancyColors.BLACK} TOKEN-DATA CONNECTION ${fancyColors.RESET} Client connected: ${clientInfo.connectionId.substring(0,8)}, IP: ${clientInfo.ip}, Wallet: ${walletDisplay}, Role: ${roleDisplay}`);
    
    // Log request details that might be useful for debugging
    logApi.info(`${fancyColors.BG_GREEN}${fancyColors.BLACK} TOKEN-DATA REQUEST ${fancyColors.RESET} URL: ${req.url}, Method: ${req.method}, Headers: ${JSON.stringify(Object.keys(req.headers))}`);
    
    // If extension headers are present, log them specifically
    if (req.headers['sec-websocket-extensions']) {
      logApi.warn(`${fancyColors.BG_GREEN}${fancyColors.BLACK} TOKEN-DATA EXTENSIONS ${fancyColors.RESET} Extensions: ${req.headers['sec-websocket-extensions']}`);
    }

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
    
    // Add enhanced logging for debugging RSV1 issues with FULL token data
    const firstToken = data.data.length > 0 ? data.data[0] : null;
    
    logApi.info(`${fancyColors.BG_YELLOW}${fancyColors.BLACK} TOKEN-DATA BROADCAST RECEIVED ${fancyColors.RESET} Got market data broadcast with ${data.data.length} tokens, ID: ${data._broadcastId || 'none'}`, {
      wsEvent: 'market_broadcast',
      tokenCount: data.data.length,
      broadcastId: data._broadcastId || 'missing',
      flags: {
        disableRSV: !!data._disableRSV,
        noCompression: !!data._noCompression
      },
      // Include FULL details of the first token to see exactly what data we're working with
      tokenData: firstToken ? {
        id: firstToken.id,
        symbol: firstToken.symbol,
        name: firstToken.name,
        price: firstToken.price,
        market_cap: firstToken.market_cap,
        change_24h: firstToken.change_24h,
        // Include truncated full token JSON for complete view
        fullJSON: JSON.stringify(firstToken).substring(0, 500) + 
                 (JSON.stringify(firstToken).length > 500 ? '...' : '')
      } : 'no tokens',
      // Include size metrics to understand the volume of data
      dataMetrics: {
        messageSize: JSON.stringify(data).length,
        tokenCount: data.data.length,
        averageBytesPerToken: data.data.length > 0 ? 
                             Math.round(JSON.stringify(data).length / data.data.length) : 0
      }
    });
    
    // Add flags to ensure no compression is used
    const enhancedData = {
      type: 'token_update',
      data: data.data,
      timestamp: data.timestamp || new Date().toISOString(),
      _disableRSV: true,   // Add flag to disable RSV1 bit
      _noCompression: true // Add flag to disable compression
    };
    
    // Broadcast to all clients subscribed to public.tokens channel
    const sentCount = this.broadcastToChannel('public.tokens', enhancedData);
    
    // Log detailed info about what's actually being sent 
    logApi.info(`${fancyColors.BG_GREEN}${fancyColors.BLACK} TOKEN-DATA SENT ${fancyColors.RESET} Broadcasted to ${sentCount} clients on public.tokens channel`, {
      wsEvent: 'tokens_broadcast',
      sentCount,
      channel: 'public.tokens',
      broadcastId: enhancedData._broadcastId || 'missing',
      dataMetrics: {
        fullPayloadBytes: JSON.stringify(enhancedData).length,
        tokensCount: enhancedData.data.length,
        encodedMessage: JSON.stringify(enhancedData).substring(0, 200) + '...' // Show the actual start of the JSON
      },
      // Show exactly how we're sending data to clients
      sentWithFlags: {
        _disableRSV: enhancedData._disableRSV,
        _noCompression: enhancedData._noCompression
      }
    });
    
    // Also broadcast to the public.market channel
    this.broadcastToChannel('public.market', {
      type: 'market_update',
      data: data.data,
      timestamp: data.timestamp || new Date().toISOString(),
      _disableRSV: true,   // Add flag to disable RSV1 bit
      _noCompression: true // Add flag to disable compression
    });
    
    // Broadcast individual token updates to their respective channels
    let individualSentCount = 0;
    for (const token of data.data) {
      if (token.symbol) {
        const tokenChannel = `token.${token.symbol}`;
        // Only broadcast if anyone is listening
        if (this.channelSubscriptions.has(tokenChannel)) {
          const sent = this.broadcastToChannel(tokenChannel, {
            type: 'token_data',
            symbol: token.symbol,
            data: token,
            timestamp: data.timestamp || new Date().toISOString(),
            _disableRSV: true,   // Add flag to disable RSV1 bit
            _noCompression: true // Add flag to disable compression
          });
          individualSentCount += sent;
        }
      }
    }
    
    logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 TOKEN DATA ${fancyColors.RESET} ${fancyColors.GREEN}Broadcasted ${data.data.length} tokens to ${sentCount} clients on main channels and ${individualSentCount} individual token subscriptions${fancyColors.RESET}`);
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