// websocket/v69/unified/handlers.js

/**
 * Unified WebSocket Handlers
 * 
 * This module contains all the connection and message handlers for the unified WebSocket system:
 * - handleConnection
 * - handleDisconnect
 * - handleError
 * - handleMessage
 * - handleSubscription
 * - handleUnsubscription
 * - handleClientLogs
 */

import jwt from 'jsonwebtoken';
import prisma from '../../../config/prisma.js';
import { logApi } from '../../../utils/logger-suite/logger.js';
import { fancyColors, wsColors } from '../../../utils/colors.js';
import { handleRequest } from './requestHandlers.js';
import { MESSAGE_TYPES, TOPICS, formatAuthFlowVisual, parseClientInfo, getLocationInfo, normalizeTopic } from './utils.js';
import { fetchTerminalData } from './services.js';
import { rateLimiter } from './modules/rate-limiter.js';
import { heliusBalanceTracker } from '../../../services/solana-engine/helius-balance-tracker.js';
import serviceEvents from '../../../utils/service-suite/service-events.js';
import marketDataService from '../../../services/market-data/marketDataService.js';

// Config
import config from '../../../config/config.js';

/**
 * Handle new WebSocket connection
 * @param {WebSocket} ws - WebSocket connection
 * @param {Request} req - HTTP request
 * @param {Object} server - The unified WebSocket server instance
 */
export async function handleConnection(ws, req, server) {
  // Initialize the connection data on the WebSocket object to prevent errors
  ws.clientId = generateConnectionId();
  ws.isAuthenticated = false;
  ws.userId = null;
  ws.role = null;
  ws.subscriptions = new Set();
  ws.messagesReceived = 0;
  ws.messagesSent = 0;
  ws.errors = {
    count: 0,
    lastError: null
  };
  try {
    // ===== DEBUG LOGGING: Connection start =====
    logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_CYAN}${fancyColors.WHITE} CONNECTION START ${fancyColors.RESET} WebSocket connection received`);
    // ===== END DEBUG LOGGING =====
    
    // Set up message handler for this connection
    ws.on('message', (message) => handleMessage(ws, message, req, server));
    
    // Set up close handler
    ws.on('close', (code, reason) => {
      // Store close code and reason on the ws object for the disconnect handler
      ws.closeCode = code;
      ws.closeReason = reason ? reason.toString() : null;
      handleDisconnect(ws, server);
    });
    
    // Set up error handler
    ws.on('error', (error) => handleError(ws, error, server));
    
    // Generate connection ID and counter
    const connectionId = generateConnectionId();
    const connectionCounter = server.metrics.uniqueClients + 1;
    
    // Client IP and user agent
    const clientIp = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    const origin = req.headers['origin'] || 'unknown';
    const clientInfo = parseClientInfo(userAgent);
    
    // Get location info (asynchronous)
    const locationInfo = await getLocationInfo(clientIp);
    const locationDisplay = locationInfo ? ` [${locationInfo.formattedString}]` : '';
    
    // Directly use the structured location info
    let locationCity = locationInfo?.city || null;
    let locationRegion = locationInfo?.region || null; 
    let locationCountry = locationInfo?.country || null;
    // Use country code if available (for the 2-char field) otherwise use full name
    let locationCountryCode = locationInfo?.countryCode || locationCountry;
    
    // Try to extract userId and lookup nickname and balance from auth token in cookie
    let userId = null;
    let nickname = null;
    let isAuthenticated = false;
    let role = null;
    let solanaBalance = null;
    let authFlowState = {
      cookie: false,     // Cookie found
      token: false,      // Token decoded
      wallet: false,     // Wallet found
      user: false,       // User found in DB
      nickname: false,   // Nickname found
      balance: false     // Balance found
    };
    
    try {
      // ===== DEBUG LOGGING: Auth attempt from cookies =====
      logApi.debug(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_CYAN}${fancyColors.WHITE} AUTH ATTEMPT ${fancyColors.RESET} Starting auth from cookies`);
      // ===== END DEBUG LOGGING =====
      
      // Check for session cookie
      const cookies = req.headers.cookie || '';
      const sessionCookie = cookies.split(';').find(cookie => cookie.trim().startsWith('session='));
      
      // ===== DEBUG LOGGING: Cookie check =====
      logApi.debug(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_CYAN}${fancyColors.WHITE} COOKIE CHECK ${fancyColors.RESET} Cookie found: ${!!sessionCookie}, cookies: "${cookies.substring(0, 100)}${cookies.length > 100 ? '...' : ''}"`);
      // ===== END DEBUG LOGGING =====
      
      if (sessionCookie) {
        authFlowState.cookie = true; // Cookie found
        
        // Extract the token from the cookie
        const token = sessionCookie.split('=')[1].trim();
        
        // ===== DEBUG LOGGING: Token extraction =====
        logApi.debug(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_CYAN}${fancyColors.WHITE} TOKEN EXTRACT ${fancyColors.RESET} Token length: ${token.length}, starts with: ${token.substring(0, 10)}...`);
        // ===== END DEBUG LOGGING =====
        
        // Store raw token for auth API calls
        ws.clientInfo = ws.clientInfo || {};
        ws.clientInfo._rawToken = token;
        
        // ===== DEBUG LOGGING: clientInfo initialization =====
        logApi.debug(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_CYAN}${fancyColors.WHITE} CLIENTINFO INIT ${fancyColors.RESET} Initial clientInfo object created with token`);
        // ===== END DEBUG LOGGING ====
        
        // Decode the token without verifying (to avoid exceptions) 
        try {
          // ===== DEBUG LOGGING: Token decode attempt =====
          logApi.debug(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_CYAN}${fancyColors.WHITE} TOKEN DECODE ${fancyColors.RESET} Attempting to decode JWT token without verification`);
          // ===== END DEBUG LOGGING =====
          
          const decoded = jwt.decode(token);
          
          // ===== DEBUG LOGGING: Decode result =====
          if (decoded) {
            logApi.debug(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_CYAN}${fancyColors.WHITE} TOKEN SUCCESS ${fancyColors.RESET} Token decoded successfully, has wallet: ${!!decoded.wallet_address}, has role: ${!!decoded.role}`);
          } else {
            logApi.debug(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} TOKEN FAIL ${fancyColors.RESET} Failed to decode token`);
          }
          // ===== END DEBUG LOGGING =====
          
          if (decoded && decoded.wallet_address) {
            authFlowState.token = true; // Token decoded
            userId = decoded.wallet_address;
            role = decoded.role;
            authFlowState.wallet = true; // Wallet address found
            
            // ===== DEBUG LOGGING: Wallet extraction =====
            logApi.debug(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_CYAN}${fancyColors.WHITE} WALLET FOUND ${fancyColors.RESET} Wallet: ${userId}, Role: ${role}`);
            // ===== END DEBUG LOGGING ====
            
            // Look up the user's nickname and balance
            const user = await prisma.users.findUnique({
              where: { wallet_address: userId },
              select: { 
                nickname: true, 
                last_known_balance: true 
              }
            });
            
            // ===== DEBUG LOGGING: DB lookup =====
            logApi.debug(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_CYAN}${fancyColors.WHITE} DB LOOKUP ${fancyColors.RESET} Looking up user in database: ${userId}`);
            // ===== END DEBUG LOGGING =====
            
            if (user) {
              authFlowState.user = true; // User found in DB
              
              // ===== DEBUG LOGGING: User found =====
              logApi.debug(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_CYAN}${fancyColors.WHITE} USER FOUND ${fancyColors.RESET} Found user in database: ${userId}, has nickname: ${!!user.nickname}, has balance: ${!!user.last_known_balance}`);
              // ===== END DEBUG LOGGING =====
              
              if (user.nickname) {
                nickname = user.nickname;
                authFlowState.nickname = true; // Nickname found
              }
              
              if (user.last_known_balance) {
                solanaBalance = user.last_known_balance;
                authFlowState.balance = true; // Balance found
              }
              
              isAuthenticated = true;
              
              // ===== DEBUG LOGGING: Auth success =====
              logApi.debug(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} AUTH SUCCESS ${fancyColors.RESET} User authenticated successfully: ${nickname || userId}`);
              // ===== END DEBUG LOGGING =====
            } else {
              // ===== DEBUG LOGGING: User not found =====
              logApi.debug(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} USER NOT FOUND ${fancyColors.RESET} User not found in database: ${userId}`);
              // ===== END DEBUG LOGGING =====
            }
          }
        } catch (tokenErr) {
          // ===== DEBUG LOGGING: Token error =====
          logApi.debug(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} TOKEN ERROR ${fancyColors.RESET} Error decoding token: ${tokenErr.message}`);
          // ===== END DEBUG LOGGING =====
          // Silently continue on token error
        }
      } else {
        // ===== DEBUG LOGGING: No cookie =====
        logApi.debug(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} NO COOKIE ${fancyColors.RESET} No session cookie found in request`);
        // ===== END DEBUG LOGGING =====
      }
    } catch (authErr) {
      // ===== DEBUG LOGGING: Auth error =====
      logApi.debug(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} AUTH ERROR ${fancyColors.RESET} Error during authentication: ${authErr.message}`);
      // ===== END DEBUG LOGGING =====
      // Silently continue on auth error
    }
    
    // ===== DEBUG LOGGING: Auth flow summary =====
    logApi.debug(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} AUTH FLOW SUMMARY ${fancyColors.RESET}`, {
      cookie: authFlowState.cookie,
      token: authFlowState.token,
      wallet: authFlowState.wallet,
      user: authFlowState.user,
      nickname: authFlowState.nickname,
      balance: authFlowState.balance,
      isAuthenticated,
      userId: userId || null
    });
    // ===== END DEBUG LOGGING =====
    
    // Format the auth flow for visual display in logs
    const authFlowVisual = formatAuthFlowVisual(authFlowState, nickname, userId, solanaBalance);
    
    // Extract and store all headers for logging and debugging
    const headerEntries = Object.entries(req.headers || {});
    const importantHeaders = ['host', 'origin', 'user-agent', 'sec-websocket-key', 'sec-websocket-version', 'x-forwarded-for', 'x-real-ip', 'sec-websocket-extensions', 'sec-websocket-protocol'];
    
    // Create enhanced connection log string with consistent field alignment and a visual frame
    // Define a consistent field width for better alignment
    const fieldWidth = 11; // Adjust based on the longest field name ("Connection")
    
    // Calculate a reasonable box width - allows for maximum value lengths (typically browser is longest)
    const maxValueWidth = Math.max(
      connectionId.length + clientIp.length + 3, // Connection: #A1B2C (127.0.0.1)
      origin.length,
      parseClientInfo(userAgent).length,
      (locationInfo?.formattedString || 'Unknown').length
    );
    
    // Create a shorter folder-tab style header
    const headerWidth = 10; // "CONNECTED" length
    const headerExtension = 5; // Short extension for tab-like appearance
    const headerBar = '═'.repeat(headerWidth + headerExtension);
    
    // Create the enhanced log with cleanly aligned fields and consistent spacing - folder tab style
    const bgColor = wsColors.connectBoxBg || ''; // Ensure we have a default if undefined
    const fgColor = wsColors.connectBoxFg || ''; // Ensure we have a default if undefined
    const connectColor = wsColors.connect || ''; // Ensure we have a default if undefined
    
    let connectionLog = `
${connectColor}╔${headerBar}╗${fancyColors.RESET}
${connectColor}║ CONNECTED ${' '.repeat(headerExtension)}║${fancyColors.RESET}
${bgColor}${fgColor}┌${'─'.repeat(fieldWidth + maxValueWidth + 3)}${fancyColors.RESET}
${bgColor}${fgColor}│ ${'Connection:'.padEnd(fieldWidth)} #${connectionId} (${clientIp})${fancyColors.RESET}
${bgColor}${fgColor}│ ${'Origin:'.padEnd(fieldWidth)} ${origin.padEnd(maxValueWidth)}${fancyColors.RESET}
${bgColor}${fgColor}│ ${'Browser:'.padEnd(fieldWidth)} ${parseClientInfo(userAgent).padEnd(maxValueWidth)}${fancyColors.RESET}
${bgColor}${fgColor}│ ${'Location:'.padEnd(fieldWidth)} ${(locationInfo?.formattedString ? locationInfo.formattedString.padEnd(maxValueWidth) : 'Unknown'.padEnd(maxValueWidth))}${fancyColors.RESET}
${bgColor}${fgColor}└${'─'.repeat(fieldWidth + maxValueWidth + 3)}${fancyColors.RESET}`;

    // ===== DEBUG LOGGING: Before final clientInfo assignment =====
    logApi.debug(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_MAGENTA}${fancyColors.WHITE} CLIENTINFO BEFORE ${fancyColors.RESET} Current state before final assignment:`, {
      exists: !!ws.clientInfo,
      rawTokenExists: ws.clientInfo?._rawToken ? 'yes' : 'no',
      authState: isAuthenticated ? 'authenticated' : 'not authenticated',
      userId: userId || 'none',
      hasValues: !!ws.clientInfo && Object.keys(ws.clientInfo).length > 0
    });
    // ===== END DEBUG LOGGING =====
    
    // Add client metadata - include ALL headers to help with debugging
    const oldClientInfo = ws.clientInfo || {};
    
    ws.clientInfo = {
      connectionId,
      connectionNumber: connectionCounter,
      ip: clientIp,
      userAgent,
      origin,
      host: req.headers['host'],
      connectedAt: new Date(),
      isAuthenticated,
      userId,
      nickname,
      role,
      remoteAddress: req.socket?.remoteAddress,
      remotePort: req.socket?.remotePort,
      protocol: req.protocol,
      url: req.url,
      wsProtocol: req.headers['sec-websocket-protocol'],
      wsExtensions: req.headers['sec-websocket-extensions'],
      wsVersion: req.headers['sec-websocket-version'],
      wsKey: req.headers['sec-websocket-key'],
      clientInfo,
      locationInfo,
      // Preserve raw token from initial state
      _rawToken: oldClientInfo._rawToken,
      // Store all headers for debugging
      headers: Object.fromEntries(headerEntries),
    };
    
    // If authenticated, store in authenticatedClients and clientsByUserId maps
    if (isAuthenticated && userId) {
      server.authenticatedClients.set(ws, {
        userId,
        role,
        nickname
      });
      
      // Add to clients by user ID map for direct messaging
      if (!server.clientsByUserId.has(userId)) {
        server.clientsByUserId.set(userId, new Set());
      }
      server.clientsByUserId.get(userId).add(ws);
    }
    
    // Update metrics
    server.metrics.uniqueClients = server.wss.clients.size;
    server.metrics.lastActivity = new Date();
    
    // Create simplified log object for console output
    const consoleLogObject = {
      connectionId,
      ip: clientIp,
      origin: origin,
      clientInfo: parseClientInfo(userAgent),
      userId: userId ? `${userId.slice(0, 6)}...` : null,
      isAuthenticated,
      timestamp: new Date().toISOString(),
      environment: config.getEnvironment(origin),
      _icon: "🔌",
      _color: "#E91E63" // Pink for connection
    };
    
    // Create detailed log object for Logtail with all extra details
    const fullLogObject = {
      ...consoleLogObject,
      service: 'uni-ws',
      auth: authFlowState,
      headers: importantHeaders.reduce((obj, key) => {
        obj[key] = req.headers[key] || null;
        return obj;
      }, {}),
      connectionNumber: connectionCounter,
      connectionLog, // Add enhanced log representation for visualization
      authFlowVisual, // Add auth flow visualization
      location: locationInfo
    };
    
    // Log the enhanced connection format to console
    console.log(connectionLog);
    
    // Also log the auth flow visual
    if (userId) {
      console.log(authFlowVisual);
    }
    
    // Also log through the regular logging system, but skip big formatting strings
    // to avoid duplicate console output
    logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${wsColors.connect}CONN#${connectionId} OPEN - ${clientIp} (${parseClientInfo(userAgent)})${locationDisplay}${fancyColors.RESET}`, 
      config.debug_modes.websocket ? fullLogObject : consoleLogObject
    );
    
    // Save connection to database if enabled
    if (config.database_settings?.save_websocket_connections) {
      saveConnectionToDatabase(connectionId, {
        ip_address: clientIp,
        user_agent: userAgent,
        wallet_address: userId,
        nickname,
        is_authenticated: isAuthenticated,
        environment: config.getEnvironment(origin),
        origin,
        country: locationCountry,
        country_code: locationCountryCode,
        region: locationRegion,
        city: locationCity
      }).catch(err => {
        logApi.error(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.RED}Error saving connection to database:${fancyColors.RESET}`, err);
      });
    }
    
  } catch (error) {
    logApi.error(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.RED}Error handling connection:${fancyColors.RESET}`, error);
  }
}

/**
 * Handle WebSocket disconnection
 * @param {WebSocket} ws - WebSocket connection
 * @param {Object} server - The unified WebSocket server instance
 */
export function handleDisconnect(ws, server) {
  try {
    if (!ws) {
      logApi.error(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.RED}Disconnect called with null WebSocket${fancyColors.RESET}`);
      return;
    }

    // Ensure we have a connection ID
    const connectionId = ws.clientId || 'unknown';

    const disconnectTime = new Date();

    // DEBUG: Log the WebSocket properties
    try {
      logApi.debug(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BLUE}Client disconnect - WebSocket properties: ${Object.keys(ws).filter(k => !k.startsWith('_')).join(', ')}${fancyColors.RESET}`);
    } catch (err) {
      // Ignore
    }

    // Calculate connection duration
    const connectedAt = ws.clientInfo?.connectedAt || disconnectTime; // Fallback to now
    const durationMs = disconnectTime - connectedAt;
    const durationSeconds = Math.round(durationMs / 1000);

    // Format duration for display
    let humanDuration;
    if (durationSeconds < 60) {
      humanDuration = `${durationSeconds}s`;
    } else if (durationSeconds < 3600) {
      const minutes = Math.floor(durationSeconds / 60);
      const seconds = durationSeconds % 60;
      humanDuration = `${minutes}m${seconds}s`;
    } else {
      const hours = Math.floor(durationSeconds / 3600);
      const minutes = Math.floor((durationSeconds % 3600) / 60);
      humanDuration = `${hours}h${minutes}m`;
    }
    
    // Get client auth data
    const authData = server.authenticatedClients.get(ws);
    const userId = authData?.userId || ws.clientInfo?.userId;
    let nickname = authData?.nickname || ws.clientInfo?.nickname;
    
    // Get list of subscribed topics
    const subscribedTopics = [];
    const clientSubs = server.clientSubscriptions.get(ws);
    if (clientSubs) {
      subscribedTopics.push(...clientSubs);
    }
    
    // Clean up maps and collections
    
    // Remove from clientSubscriptions
    server.clientSubscriptions.delete(ws);
    
    // Remove from topicSubscribers
    for (const [topic, subscribers] of server.topicSubscribers.entries()) {
      if (subscribers.has(ws)) {
        subscribers.delete(ws);
        if (subscribers.size === 0) {
          server.topicSubscribers.delete(topic);
        }
      }
    }
    
    // Remove from authenticatedClients
    server.authenticatedClients.delete(ws);
    
    // Remove from clientsByUserId
    if (userId) {
      // Remove from user's connections
      const userConnections = server.clientsByUserId.get(userId);
      if (userConnections) {
        userConnections.delete(ws);
        if (userConnections.size === 0) {
          server.clientsByUserId.delete(userId);
        }
      }
    }
    
    // Clean up rate limiter subscriptions
    rateLimiter.cleanupClient(connectionId);
    
    // Clean up token balance subscriptions
    if (ws.tokenBalanceHandlers) {
      for (const [key, handler] of ws.tokenBalanceHandlers.entries()) {
        const [walletAddr, tokenAddr] = key.split('_');
        try {
          heliusBalanceTracker.unsubscribeTokenBalance(walletAddr, tokenAddr, handler);
        } catch (e) {
          logApi.error(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.RED}Error unsubscribing token balance on disconnect:${fancyColors.RESET}`, e);
        }
      }
      ws.tokenBalanceHandlers.clear();
    }
    
    // Clean up SOL balance subscriptions
    if (ws.solanaBalanceHandlers) {
      for (const [walletAddr, handler] of ws.solanaBalanceHandlers.entries()) {
        try {
          heliusBalanceTracker.unsubscribeSolanaBalance(walletAddr, handler);
        } catch (e) {
          logApi.error(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.RED}Error unsubscribing SOL balance on disconnect:${fancyColors.RESET}`, e);
        }
      }
      ws.solanaBalanceHandlers.clear();
    }
    
    // Update metrics
    server.metrics.uniqueClients = server.wss.clients.size;
    server.metrics.subscriptions = [...server.clientSubscriptions.values()]
      .reduce((total, subs) => total + subs.size, 0);
    
    // Format client identification info
    const clientIdentifier = ws.clientInfo?.ip || 'unknown';
    const clientInfo = ws.clientInfo?.clientInfo || '';
    
    // Format topics summary if any
    const topicsSummary = subscribedTopics.length > 0 
      ? ` with ${subscribedTopics.length} subscriptions` 
      : '';
    
    // Format user information if authenticated
    let userInfo = '';
    if (userId) {
      // If we have a user ID but no nickname, try to look it up
      if (!nickname) {
        try {
          // Use a synchronous approach to avoid await in a non-async function
          prisma.users.findUnique({
            where: { wallet_address: userId },
            select: { nickname: true }
          })
          .then(user => {
            nickname = user?.nickname || null;
          })
          .catch(dbError => {
            logApi.debug(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.YELLOW}Failed to fetch nickname for ${userId} during disconnect: ${dbError.message}${fancyColors.RESET}`);
          });
        } catch (dbError) {
          logApi.debug(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.YELLOW}Failed to fetch nickname for ${userId} during disconnect: ${dbError.message}${fancyColors.RESET}`);
        }
      }
      
      const shortWallet = userId.slice(0, 6) + '...';
      userInfo = nickname 
        ? ` for user "${nickname}" (${shortWallet})` 
        : ` for wallet ${shortWallet}`;
    }
    
    // Create a simplified log object for console output
    const consoleLogObject = {
      connectionId: ws.clientInfo?.connectionId || 'unknown',
      ip: ws.clientInfo?.ip || 'unknown',
      userId,
      nickname,
      isAuthenticated: !!authData,
      timestamp: disconnectTime.toISOString(),
      environment: config.getEnvironment(ws.clientInfo?.origin),
      connection_duration: { human: humanDuration },
      _icon: "🔌",
      _color: "#FFA500" // Orange for disconnect
    };
    
    // Create a detailed log object for Logtail with all details
    const fullLogObject = {
      ...consoleLogObject,
      origin: ws.clientInfo?.origin || 'unknown',
      userAgent: ws.clientInfo?.userAgent || 'unknown',
      service: 'uni-ws',
      connection_duration: {
        ms: durationMs,
        seconds: durationSeconds,
        human: humanDuration
      },
      subscribed_topics: subscribedTopics
    };
    
    // Create enhanced disconnect log formatting with consistent visual style
    const disconnectFieldWidth = 12; // "Subscription:" is the longest field name
    
    // Calculate a reasonable box width for display
    const disconnectMaxValueWidth = Math.max(
      clientIdentifier.length + humanDuration.length + 3, // IP (duration)
      (userInfo ? userInfo.length : 0) + 3,
      (topicsSummary ? topicsSummary.length : 0) + 3,
      (ws.closeCode ? `Code ${ws.closeCode}`.length : 0) + (ws.closeReason ? `: ${ws.closeReason}`.length : 0)
    );
    
    // Create a shorter folder-tab style header
    const disconnectHeaderWidth = 12; // "DISCONNECTED" length
    const disconnectHeaderExtension = 5; // Short extension for tab-like appearance
    const disconnectHeaderBar = '═'.repeat(disconnectHeaderWidth + disconnectHeaderExtension);
    
    // Prepare topics list if any exists
    const topicsList = subscribedTopics.length > 0 
      ? subscribedTopics.join(', ') 
      : 'None';
    
    // Create the enhanced disconnect log with box drawing characters - more compact
    // Ensure we have default values for colors if they're undefined
    const disconnectColor = wsColors.disconnect || '';
    const disconnectBgColor = wsColors.disconnectBoxBg || '';
    const disconnectFgColor = wsColors.disconnectBoxFg || '';
    
    const disconnectLog = `
${disconnectColor}╔${disconnectHeaderBar}╗${fancyColors.RESET}
${disconnectColor}║ DISCONNECTED ${' '.repeat(disconnectHeaderExtension)}║${fancyColors.RESET}
${disconnectBgColor}${disconnectFgColor}┌${'─'.repeat(disconnectFieldWidth + disconnectMaxValueWidth + 3)}${fancyColors.RESET}
${disconnectBgColor}${disconnectFgColor}│ ${'Connection:'.padEnd(disconnectFieldWidth)} #${ws.clientInfo?.connectionId || 'unknown'} (${humanDuration})${' '.repeat(Math.max(0, disconnectMaxValueWidth - (ws.clientInfo?.connectionId || 'unknown').length - humanDuration.length - 3))}${fancyColors.RESET}
${disconnectBgColor}${disconnectFgColor}│ ${'IP:'.padEnd(disconnectFieldWidth)} ${clientIdentifier}${' '.repeat(Math.max(0, disconnectMaxValueWidth - clientIdentifier.length))}${fancyColors.RESET}
${userId ? `${disconnectBgColor}${disconnectFgColor}│ ${'User:'.padEnd(disconnectFieldWidth)} ${nickname || 'Unknown'} (${userId.slice(0, 6)}...)${' '.repeat(Math.max(0, disconnectMaxValueWidth - (nickname || 'Unknown').length - 11))}${fancyColors.RESET}` : ''}
${subscribedTopics.length > 0 ? `${disconnectBgColor}${disconnectFgColor}│ ${'Topics:'.padEnd(disconnectFieldWidth)} ${topicsList.length > disconnectMaxValueWidth ? topicsList.slice(0, disconnectMaxValueWidth - 3) + '...' : topicsList}${' '.repeat(Math.max(0, disconnectMaxValueWidth - Math.min(topicsList.length, disconnectMaxValueWidth)))}${fancyColors.RESET}` : ''}
${ws.closeCode ? `${disconnectBgColor}${disconnectFgColor}│ ${'Close Code:'.padEnd(disconnectFieldWidth)} ${ws.closeCode}${ws.closeReason ? `: ${ws.closeReason}` : ''}${' '.repeat(Math.max(0, disconnectMaxValueWidth - (ws.closeCode ? `${ws.closeCode}${ws.closeReason ? `: ${ws.closeReason}` : ''}`.length : 0)))}${fancyColors.RESET}` : ''}
${disconnectBgColor}${disconnectFgColor}└${'─'.repeat(disconnectFieldWidth + disconnectMaxValueWidth + 3)}${fancyColors.RESET}`;
    
    // Log the enhanced disconnect format to console
    console.log(disconnectLog);
    
    // Also log through the regular logging system, but without the formatted disconnectLog
    // to avoid duplicate formatting in logtail/console
    logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${wsColors.disconnect}CONN#${ws.clientInfo?.connectionId || 'unknown'} CLOSE - ${clientIdentifier} (${humanDuration})${userInfo}${topicsSummary}${fancyColors.RESET}`, 
      {
        ...(config.debug_modes.websocket ? fullLogObject : consoleLogObject),
        // Remove disconnectLog from metadata to avoid duplication
        closeCode: ws.closeCode,
        closeReason: ws.closeReason
      }
    );
    
    // Record disconnect in database
    updateConnectionOnDisconnect(ws.clientInfo?.connectionId, {
      code: ws.closeCode,
      reason: ws.closeReason,
      subscribedTopics,
      messagesReceived: ws.messagesReceived || 0,
      messagesSent: ws.messagesSent || 0
    }).catch(err => {
      logApi.error(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.RED}Error updating connection disconnect in database:${fancyColors.RESET}`, err);
    });
  } catch (error) {
    logApi.error(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.RED}Error handling disconnect:${fancyColors.RESET}`, error);
  }
}

/**
 * Handle websocket error
 * @param {WebSocket} ws - WebSocket connection
 * @param {Error} error - Error object
 * @param {Object} server - The unified WebSocket server instance
 */
export function handleError(ws, error, server) {
  server.metrics.errors++;
  
  // Log error with detailed context
  logApi.error(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${wsColors.error}WebSocket error:${fancyColors.RESET}`, {
    error: error.message,
    code: error.code,
    stack: error.stack,
    ip: ws.clientInfo?.ip || 'unknown',
    origin: ws.clientInfo?.origin || 'unknown',
    userAgent: ws.clientInfo?.userAgent || 'unknown',
    userId: ws.clientInfo?.userId || null,
    isAuthenticated: ws.clientInfo?.isAuthenticated || false,
    timestamp: new Date().toISOString(),
    environment: config.getEnvironment(ws.clientInfo?.origin),
    service: 'uni-ws',
    clientHeaders: ws.clientInfo?.headers || {},
    connectionAge: ws.clientInfo?.connectedAt 
      ? `${Math.floor((Date.now() - ws.clientInfo.connectedAt) / 1000)}s` 
      : 'unknown',
    _icon: "⚠️",
    _color: "#FF0000", // Red for error
    _highlight: true
  });
  
  // Close connection on critical errors
  if (['ECONNRESET', 'EPIPE'].includes(error.code)) {
    ws.terminate();
  }
}

/**
 * Handle incoming WebSocket message
 * @param {WebSocket} ws - WebSocket connection
 * @param {Buffer} rawMessage - Raw message buffer
 * @param {Request} req - HTTP request
 * @param {Object} server - The unified WebSocket server instance
 */
export async function handleMessage(ws, rawMessage, req, server) {
  try {
    // Update message count
    server.metrics.messagesReceived++;
    
    // Track message count on the connection object for database tracking
    ws.messagesReceived = (ws.messagesReceived || 0) + 1;
    
    // Track last activity time for keepalive purposes
    ws.lastMessageAt = Date.now();
    server.metrics.lastActivity = new Date();
    
    // Parse message
    let message;
    try {
      const messageText = rawMessage.toString();
      message = JSON.parse(messageText);
    } catch (error) {
      return server.sendError(ws, 'Invalid message format. JSON expected.', 4000);
    }
    
    // Validate message structure
    if (!message.type) {
      return server.sendError(ws, 'Message type is required', 4001);
    }
    
    // Special handling for client logs - they can be processed directly
    // This allows logs to be sent without requiring subscription first
    if (message.type === 'LOGS' || (message.type === MESSAGE_TYPES.DATA && message.topic === TOPICS.LOGS)) {
      await handleClientLogs(ws, message, server);
      return;
    }
    
    // Process based on message type
    switch (message.type) {
      case MESSAGE_TYPES.SUBSCRIBE:
        await handleSubscription(ws, message, req, server);
        break;
        
      case MESSAGE_TYPES.UNSUBSCRIBE:
        handleUnsubscription(ws, message, server);
        break;
        
      case MESSAGE_TYPES.REQUEST:
        await handleRequest(ws, message, 
          // Passing send functions as a callback to avoid circular dependencies
          (client, data) => server.send(client, data),
          (client, message, code) => server.sendError(client, message, code)
        );
        break;
        
      case MESSAGE_TYPES.COMMAND:
        await handleCommand(ws, message, server);
        break;
        
      default:
        server.sendError(ws, `Unknown message type: ${message.type}`, 4002);
    }
  } catch (error) {
    logApi.error(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.RED}Error handling message:${fancyColors.RESET}`, error);
    server.metrics.errors++;
    server.sendError(ws, 'Internal server error', 5000);
  }
}

/**
 * Handle subscription request
 * @param {WebSocket} ws - WebSocket connection
 * @param {Object} message - Parsed message
 * @param {Request} req - Original HTTP request
 * @param {Object} server - The unified WebSocket server instance
 */
export async function handleSubscription(ws, message, req, server) {
  // Initialize clientInfo if not exists
  if (!ws.clientInfo) {
    ws.clientInfo = {
      connectionId: ws.clientId || generateConnectionId(),
      ip: req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || 'unknown',
      userAgent: req?.headers?.['user-agent'] || 'unknown',
      isAuthenticated: false,
      userId: null,
      role: null,
      connectedAt: new Date(),
      subscriptions: new Set()
    };
  }

  // Initialize subscriptions if not exists
  if (!ws.subscriptions) {
    ws.subscriptions = new Set();
  }

  // ===== DEBUG LOGGING: Check if clientInfo exists =====
  logApi.debug(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} SUBSCRIPTION DEBUG ${fancyColors.RESET} clientInfo exists: ${!!ws.clientInfo}, topics: ${JSON.stringify(message.topics)}`);
  logApi.debug(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} CLIENTINFO STATE ${fancyColors.RESET} isAuthenticated: ${ws.clientInfo.isAuthenticated}, userId: ${ws.clientInfo.userId}, connectionId: ${ws.clientInfo.connectionId}`);
  // ===== END DEBUG LOGGING =====

  // Validate topics
  if (!message.topics || !Array.isArray(message.topics) || message.topics.length === 0) {
    return server.sendError(ws, 'Subscription requires at least one topic', 4003);
  }
  
  // Normalize topics to support both hyphenated and underscore formats
  const normalizedTopics = message.topics.map(topic => normalizeTopic(topic));
  
  // Check authorization for restricted topics
  const restrictedTopics = [TOPICS.ADMIN, TOPICS.PORTFOLIO, TOPICS.USER, TOPICS.WALLET, TOPICS.SKYDUEL];
  const hasRestrictedTopic = normalizedTopics.some(topic => restrictedTopics.includes(topic));
  
  // ===== DEBUG LOGGING: Topic restriction check =====
  logApi.debug(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} TOPIC CHECK ${fancyColors.RESET} hasRestrictedTopic: ${hasRestrictedTopic}, clientInfo exists: ${!!ws.clientInfo}`);
  // ===== END DEBUG LOGGING =====
  
  // Try/catch to safely handle potential null/undefined
  try {
    // First, check if clientInfo exists at all
    if (!ws.clientInfo) {
      // ENHANCED DIAGNOSTICS: Create a visually distinctive error box for critical state errors
      const errorHeaderBar = '═'.repeat(30);
      const criticalErrorLog = `
${fancyColors.BG_RED}${fancyColors.WHITE}╔${errorHeaderBar}╗${fancyColors.RESET}
${fancyColors.BG_RED}${fancyColors.WHITE}║ CRITICAL STATE ERROR         ║${fancyColors.RESET}
${fancyColors.BG_RED}${fancyColors.WHITE}╚${errorHeaderBar}╝${fancyColors.RESET}
${fancyColors.BG_RED}${fancyColors.WHITE}┌────────────────────────────────┐${fancyColors.RESET}
${fancyColors.BG_RED}${fancyColors.WHITE}│ Missing clientInfo object      │${fancyColors.RESET}
${fancyColors.BG_RED}${fancyColors.WHITE}│ During subscription processing │${fancyColors.RESET}
${fancyColors.BG_RED}${fancyColors.WHITE}└────────────────────────────────┘${fancyColors.RESET}`;

      // Log the fancy error box to console for high visibility
      console.log(criticalErrorLog);
      
      // Also log through the regular logging system
      logApi.warn(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} CRITICAL STATE ERROR ${fancyColors.RESET} Missing clientInfo during subscription processing`);
      
      // Add connection details to help diagnose the issue
      const diagnosticInfo = {
        messageTopics: message.topics,
        wsState: ws.readyState,
        hasAuthToken: !!message.authToken,
        timestamp: new Date().toISOString(),
        headers: req?.headers ? Object.keys(req.headers).join(',') : 'unknown',
        ip: req?.socket?.remoteAddress || 'unknown'
      };
      
      logApi.warn(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} CONNECTION DIAGNOSTICS ${fancyColors.RESET}`, diagnosticInfo);
      
      // If attempting to access restricted topics, send a specific error with recovery instructions
      if (hasRestrictedTopic) {
        return server.send(ws, {
          type: MESSAGE_TYPES.ERROR,
          code: 4050,
          reason: 'connection_state_invalid',
          message: 'Connection state is invalid. Please refresh your page to reestablish connection.',
          recoverable: true,
          timestamp: new Date().toISOString()
        });
      }
      
      // For public topics, we'll let it proceed but log that we're allowing it
      logApi.warn(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} ALLOWING PUBLIC TOPICS ${fancyColors.RESET} Despite missing clientInfo, allowing public topic subscription`);
      
      // Create a minimal tracking object just for this request
      // Store it directly on the ws object (NOT inside an if-block scoped variable)
      // so it's available throughout the request lifecycle and accessible in outer scopes
      ws.temporaryTracker = {
        isRequestOnly: true,
        isAuthenticated: false,
        connectionId: 'UNTRACKED-' + Math.random().toString(16).substring(2, 8).toUpperCase(),
        timestamp: new Date().toISOString()
      };
      
      // Log that we created a temporary tracker
      logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} CREATED TRACKER ${fancyColors.RESET} Temporary request tracker: ${ws.temporaryTracker.connectionId}`);
      
      // Continue to topic processing (for public topics only)
    } else if (hasRestrictedTopic && !ws.clientInfo.isAuthenticated) {
      logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} AUTH NEEDED ${fancyColors.RESET} Restricted topic requires authentication`);
      // Try to authenticate if auth token is provided
      if (message.authToken) {
        const authToken = message.authToken;

        // NEW LOGGING: Auth attempt with token
        logApi.info(`[WebSocketAuth] WS /api/v69/ws: Auth attempt for client ${ws.clientInfo.connectionId}. Token (first 10 chars): ${authToken.substring(0,10)}...`);

        try {
          // Track JWT tokens that were already denied to prevent repeated log spam
          if (!ws.authFailedTokens) {
            ws.authFailedTokens = new Set();
          }
          
          // Skip verification if this token already failed (prevents log spam)
          if (ws.authFailedTokens.has(authToken)) {
             // NEW LOGGING: Token previously failed
            logApi.warn(`[WebSocketAuth] WS /api/v69/ws: Auth token for client ${ws.clientInfo.connectionId} was previously marked as failed. Denying.`);
            return server.send(ws, {
              type: MESSAGE_TYPES.ERROR,
              code: 4401,
              reason: 'token_expired', // Or 'token_invalid_repeated'
              message: 'Your session has expired or the token is invalid. Please log in again.',
              timestamp: new Date().toISOString()
            });
          }
          
          // Manually verify token instead of using the imported function
          const decoded = jwt.verify(authToken, config.jwt.secret);
          const authData = {
            userId: decoded.wallet_address,
            role: decoded.role
          };
          
          if (!authData || !authData.userId) {
            // NEW LOGGING: Decoded token lacks userId
            logApi.warn(`[WebSocketAuth] WS /api/v69/ws: Auth FAILED for client ${ws.clientInfo.connectionId}. Decoded token missing wallet_address. Decoded: ${JSON.stringify(decoded)}`);
            return server.sendError(ws, 'Authentication required for restricted topics', 4010);
          }
          
          // Get user's nickname from database
          let userNickname = null;
          try {
            const user = await prisma.users.findUnique({
              where: { wallet_address: authData.userId },
              select: { nickname: true }
            });
            userNickname = user?.nickname || null;
          } catch (dbError) {
            // Silently continue if database lookup fails
            logApi.debug(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.YELLOW}Failed to fetch nickname for ${authData.userId}: ${dbError.message}${fancyColors.RESET}`);
          }
          
          // Update client info
          ws.clientInfo.isAuthenticated = true;
          ws.clientInfo.userId = authData.userId;
          ws.clientInfo.role = authData.role;
          ws.clientInfo.nickname = userNickname;
          
          // Add to authenticated clients map
          server.authenticatedClients.set(ws, authData);
          
          // Add to user's connections map
          if (!server.clientsByUserId.has(authData.userId)) {
            server.clientsByUserId.set(authData.userId, new Set());
          }
          server.clientsByUserId.get(authData.userId).add(ws);
          
          // Create a fancy auth log with a framed success message
          const authHeaderWidth = 16; // "AUTHENTICATION" length
          const authHeaderBar = '═'.repeat(authHeaderWidth);
          
          // Create the enhanced auth log
          const authLog = `
${fancyColors.BG_GREEN}${fancyColors.BLACK}╔${authHeaderBar}╗${fancyColors.RESET}
${fancyColors.BG_GREEN}${fancyColors.BLACK}║ AUTHENTICATION ║${fancyColors.RESET}
${fancyColors.BG_GREEN}${fancyColors.BLACK}╚${authHeaderBar}╝${fancyColors.RESET}
${fancyColors.BG_GREEN}${fancyColors.BLACK}┌${'─'.repeat(30)}┐${fancyColors.RESET}
${fancyColors.BG_GREEN}${fancyColors.BLACK}│ User authenticated successfully │${fancyColors.RESET}
${fancyColors.BG_GREEN}${fancyColors.BLACK}│ ${`Wallet: ${authData.userId.slice(0, 6)}...`.padEnd(28)} │${fancyColors.RESET}
${fancyColors.BG_GREEN}${fancyColors.BLACK}│ ${`Role: ${authData.role || 'USER'}`.padEnd(28)} │${fancyColors.RESET}
${userNickname ? `${fancyColors.BG_GREEN}${fancyColors.BLACK}│ ${`Nickname: ${userNickname}`.padEnd(28)} │${fancyColors.RESET}` : ''}
${fancyColors.BG_GREEN}${fancyColors.BLACK}└${'─'.repeat(30)}┘${fancyColors.RESET}`;
          
          // Log authentication success
          logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} AUTH SUCCESS ${fancyColors.RESET} User authenticated via token: ${authData.userId}`, {
            wallet: authData.userId,
            role: authData.role,
            nickname: userNickname,
            authLog, // Add fancy auth log
            _icon: "🔐",
            _color: "#3F51B5"
          });
          
          // Also log the fancy auth format to console
          console.log(authLog);

          // NEW LOGGING: Construct and log ACK payload before sending
          const ackPayloadForAuth = {
              type: MESSAGE_TYPES.ACKNOWLEDGMENT,
              operation: 'authenticate', // Specific operation for auth ACK
              status: 'success',
              message: "User authenticated successfully", // Ensure "authenticated" is present
              timestamp: new Date().toISOString(),
              // Optionally include some user details if helpful for client
              // userData: { userId: authData.userId, role: authData.role, nickname: userNickname }
          };
          logApi.info(`[WebSocketAuth] WS /api/v69/ws: Sending AUTH ACK to client ${ws.clientInfo.connectionId}. Payload: ${JSON.stringify(ackPayloadForAuth)}`);
          server.send(ws, ackPayloadForAuth);

        } catch (error) {
          // Detect the type of error
          const expiredJwt = error.name === 'TokenExpiredError';
          
          // Store this token in the failed tokens set to prevent repeated attempts
          if (authToken) { // authToken is defined in this scope
            ws.authFailedTokens.add(authToken);
          }
          
          // Only log the first occurrence of each expired token to reduce spam
          // NEW LOGGING: Auth failed (token invalid/expired)
          if (!expiredJwt || !authToken) { // if not expired, or if expired but no token (should not happen)
            logApi.error(`[WebSocketAuth] WS /api/v69/ws: Auth FAILED for client ${ws.clientInfo.connectionId}. Token error: ${error.message}. Token (first 10): ${authToken ? authToken.substring(0,10) : 'N/A'}...`);
          } else if (expiredJwt) {
            logApi.warn(`[WebSocketAuth] WS /api/v69/ws: Auth FAILED for client ${ws.clientInfo.connectionId}. Token EXPIRED. Token (first 10): ${authToken.substring(0,10)}...`);
          }
          
          // Special handling for expired tokens
          if (expiredJwt) {
            // Send a special error type that clients can detect to clear their tokens and redirect to login
            return server.send(ws, {
              type: MESSAGE_TYPES.ERROR,
              code: 4401,
              reason: 'token_expired',
              message: 'Your session has expired. Please log in again.',
              timestamp: new Date().toISOString()
            });
          } else {
            return server.sendError(ws, 'Invalid authentication token', 4011);
          }
        }
      } else {
         // NEW LOGGING: Auth needed but no token provided
        logApi.warn(`[WebSocketAuth] WS /api/v69/ws: Auth required for client ${ws.clientInfo.connectionId} for restricted topics, but no authToken provided in SUBSCRIBE message.`);
        return server.sendError(ws, 'Authentication required for restricted topics', 4010);
      }
    }
  } catch (error) {
    // Handle any errors that occurred during client info or auth processing
    logApi.error(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.RED}Error during subscription authentication:${fancyColors.RESET}`, error);
    return server.sendError(ws, 'Internal error during subscription processing', 5000);
  }
  
  // Check for admin-only topics
  if (message.topics.includes(TOPICS.ADMIN)) {
    // If we've gotten this far without clientInfo, we should have the temporary tracker
    // but we know it's not authenticated as an admin
    if (!ws.clientInfo || !ws.clientInfo.role || !['ADMIN', 'SUPERADMIN'].includes(ws.clientInfo.role.toLowerCase())) {
      // NEW LOGGING: Admin topic access denied
      logApi.warn(`[WebSocketAuth] WS /api/v69/ws: Admin topic access DENIED for client ${ws.clientInfo ? ws.clientInfo.connectionId : 'UNTRACKED'}. Role: ${ws.clientInfo ? ws.clientInfo.role : 'N/A'}`);
      return server.sendError(ws, 'Admin/superadmin role required for ADMIN topics', 4012);
    }
  }
  
  // Process valid topics
  const validTopics = normalizedTopics.filter(topic => Object.values(TOPICS).includes(topic));
  
  if (validTopics.length === 0) {
    return server.sendError(ws, 'No valid topics provided', 4004);
  }
  
  // Store original topic format for backwards compatibility (for logging)
  const topicMapping = new Map();
  normalizedTopics.forEach((normalized, index) => {
    if (validTopics.includes(normalized)) {
      topicMapping.set(normalized, message.topics[index]);
    }
  });
  
  // Update client subscriptions
  if (!server.clientSubscriptions.has(ws)) {
    server.clientSubscriptions.set(ws, new Set());
  }
  
  const clientSubs = server.clientSubscriptions.get(ws);
  
  // Add to topic subscribers
  for (const topic of validTopics) {
    // Add topic to client's subscriptions
    clientSubs.add(topic);
    
    // Add client to topic's subscribers
    if (!server.topicSubscribers.has(topic)) {
      server.topicSubscribers.set(topic, new Set());
    }
    server.topicSubscribers.get(topic).add(ws);
    
    // Send initial data for the topic if available
    await sendInitialData(ws, topic, server);
  }
  
  // Update metrics
  server.metrics.subscriptions = [...server.clientSubscriptions.values()]
    .reduce((total, subs) => total + subs.size, 0);
  
  // Send acknowledgment for subscription
  const subAckPayload = { // <<< RENAME variable to be specific to subscription ack
    type: MESSAGE_TYPES.ACKNOWLEDGMENT,
    operation: 'subscribe',
    topics: validTopics,
    status: 'success', // <<< ADD status
    message: `Successfully subscribed to ${validTopics.join(', ')}`, // <<< ADD descriptive message
    timestamp: new Date().toISOString()
  };
  // NEW LOGGING: Before sending subscription ACK
  logApi.info(`[WebSocketHandler] WS /api/v69/ws: Sending SUBSCRIBE ACK to client ${ws.clientInfo ? ws.clientInfo.connectionId : 'UNTRACKED'}. Payload: ${JSON.stringify(subAckPayload)}`);
  server.send(ws, subAckPayload);
  
  // Format subscription topics for display
  const topicsDisplay = validTopics.join(',');
  const topicCount = validTopics.length;
  
  // Get a connection ID - if clientInfo is missing, try to use temporaryTracker, 
  // or fall back to UNTRACKED
  const connectionId = ws.clientInfo?.connectionId || 
                       (ws.temporaryTracker?.connectionId || 'UNTRACKED');
  
  // Create simplified log object for console output
  const consoleLogObject = {
    connectionId: connectionId,
    topics: validTopics,
    userId: ws.clientInfo?.userId || null,
    nickname: ws.clientInfo?.nickname || null,
    isAuthenticated: ws.clientInfo?.isAuthenticated || false,
    hasClientInfo: !!ws.clientInfo,
    _icon: "📥",
    _color: "#4CAF50"
  };
  
  // Create detailed log object for Logtail
  const fullLogObject = {
    ...consoleLogObject,
    environment: config.getEnvironment(ws.clientInfo?.origin),
    service: 'uni-ws',
    topicCount: topicCount,
    ip: ws.clientInfo?.ip || req?.socket?.remoteAddress || 'unknown',
    origin: ws.clientInfo?.origin || req?.headers?.origin || 'unknown'
  };

  // Log subscription with appropriate detail level - use safe access for connectionId
  logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${wsColors.subscribe}CONN#${connectionId} SUBS - ${topicsDisplay} (${topicCount} ${topicCount === 1 ? 'topic' : 'topics'})${fancyColors.RESET}`, 
    config.debug_modes.websocket ? fullLogObject : consoleLogObject
  );
}

/**
 * Handle unsubscription request
 * @param {WebSocket} ws - WebSocket connection
 * @param {Object} message - Parsed message
 * @param {Object} server - The unified WebSocket server instance
 */
export function handleUnsubscription(ws, message, server) {
  // Validate topics
  if (!message.topics || !Array.isArray(message.topics) || message.topics.length === 0) {
    return server.sendError(ws, 'Unsubscription requires at least one topic', 4005);
  }
  
  const clientSubs = server.clientSubscriptions.get(ws);
  if (!clientSubs) {
    return; // No subscriptions to process
  }
  
  // Process each topic
  for (const topic of message.topics) {
    // Remove topic from client subscriptions
    clientSubs.delete(topic);
    
    // Remove client from topic subscribers
    const topicSubs = server.topicSubscribers.get(topic);
    if (topicSubs) {
      topicSubs.delete(ws);
      if (topicSubs.size === 0) {
        server.topicSubscribers.delete(topic);
      }
    }
  }
  
  // Update metrics
  server.metrics.subscriptions = [...server.clientSubscriptions.values()]
    .reduce((total, subs) => total + subs.size, 0);
  
  // Send acknowledgment
  server.send(ws, {
    type: MESSAGE_TYPES.ACKNOWLEDGMENT,
    operation: 'unsubscribe',
    topics: message.topics,
    timestamp: new Date().toISOString()
  });
  
  logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${wsColors.disconnect}Client unsubscribed from topics: ${message.topics.join(', ')}${fancyColors.RESET}`, {
    environment: config.getEnvironment(ws.clientInfo?.origin),
    service: 'uni-ws',
    topics: message.topics,
    userId: ws.clientInfo?.userId || null,
    isAuthenticated: ws.clientInfo?.isAuthenticated || false,
    _icon: "📤",
    _color: "#FFC107"
  });
}

/**
 * Handle client logs directly sent from client
 * @param {WebSocket} ws - WebSocket connection
 * @param {Object} message - Parsed client log message
 * @param {Object} server - The unified WebSocket server instance
 */
export async function handleClientLogs(ws, message, server) {
  try {
    // Extract logs from message
    const { logs } = message;
    
    if (!logs || !Array.isArray(logs) || logs.length === 0) {
      return server.sendError(ws, 'Invalid logs format: logs array is required', 4015);
    }
    
    // Process each log entry
    logs.forEach(logEntry => {
      // Extract log data
      const { level, message: logMessage, timestamp, tags, stack, ...details } = logEntry;
      
      // Map client level to server level (fallback to info)
      const serverLevel = ['error', 'warn', 'info', 'http', 'debug'].includes(level) 
        ? level 
        : 'info';
      
      // Format client information
      const clientContext = {
        clientLogger: true,
        clientIp: ws.clientInfo?.ip,
        clientInfo: ws.clientInfo,
        sessionId: details.sessionId || message.sessionId,
        service: 'CLIENT',
        userId: details.userId || message.userId || ws.clientInfo?.userId,
        walletAddress: ws.clientInfo?.userId, // In WebSocket, userId is the wallet address
        tags: tags || message.tags,
        stack,
        batchId: message.batchId,
        frontend: true,
        transport: 'websocket'
      };
      
      // Send to server logger
      if (logApi[serverLevel]) {
        logApi[serverLevel](
          `[Client] ${logMessage || 'No message provided'}`, 
          { ...clientContext, ...details }
        );
      } else {
        logApi.info(
          `[Client] ${logMessage || 'No message provided'}`, 
          { level: serverLevel, ...clientContext, ...details }
        );
      }
    });
    
    // Send acknowledgment
    server.send(ws, {
      type: MESSAGE_TYPES.ACKNOWLEDGMENT,
      topic: TOPICS.LOGS,
      message: 'Logs received',
      count: logs.length,
      timestamp: new Date().toISOString()
    });
    
    // Log summary (debug level to avoid spamming logs with broadcasts)
    logApi.debug(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.GREEN}Received ${logs.length} client logs via WebSocket${fancyColors.RESET}`);
  } catch (error) {
    logApi.error(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.RED}Error processing client logs:${fancyColors.RESET}`, error);
  }
}

/**
 * Handle command requests (actions that change state)
 * @param {WebSocket} ws - WebSocket connection
 * @param {Object} message - Parsed message
 * @param {Object} server - The unified WebSocket server instance
 */
export async function handleCommand(ws, message, server) {
  // Commands require authentication
  if (!ws.clientInfo?.isAuthenticated || !ws.clientInfo?.userId) {
    return server.sendError(ws, 'Authentication required for commands', 4013);
  }
  
  // Validate command
  if (!message.topic || !message.action) {
    return server.sendError(ws, 'Command requires topic and action', 4014);
  }

  // Normalize topic
  const normalizedTopic = normalizeTopic(message.topic);
  const senderWalletAddress = ws.clientInfo.userId;
  const senderNickname = ws.clientInfo.nickname || senderWalletAddress.substring(0, 6) + '...';
  const senderRole = ws.clientInfo.role || 'user';
  
  logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.YELLOW}Command received: ${normalizedTopic}/${message.action} from ${senderNickname}${fancyColors.RESET}`);
  
  // Handle command based on topic
  try {
    switch (normalizedTopic) {
      case TOPICS.CONTEST_CHAT:
        if (message.action === 'SEND_MESSAGE' || message.action === 'sendMessage') {
          const { contestId, text } = message.data || {};

          // Validate input
          if (!contestId || typeof contestId !== 'number' || !text || typeof text !== 'string' || text.trim().length === 0) {
            return server.sendError(ws, 'Command requires numeric contestId and non-empty text in data', 4016);
          }
          if (text.length > 500) { // Example length limit
              return server.sendError(ws, 'Message text exceeds 500 character limit', 4017);
          }

          // TODO: Add validation: Check if user is actually in the contest / allowed to chat
          // This might involve checking contest_participants table
          // const participant = await prisma.contest_participants.findUnique({ where: { contest_id_wallet_address: { contest_id: contestId, wallet_address: senderWalletAddress } } });
          // if (!participant) { return server.sendError(ws, 'Not participating in this contest', 4033); }

          const isAdmin = ['admin', 'superadmin'].includes(senderRole.toLowerCase());

          // Save message to database
          const savedMessage = await prisma.contest_chat_messages.create({
            data: {
              contest_id: contestId,
              sender_wallet_address: senderWalletAddress,
              message_text: text.trim(), // Trim whitespace
              // created_at is handled by default
            },
            include: { sender: { select: { nickname: true, role: true }} } // Include sender details for the event
          });

          // Emit event for broadcasters to pick up
          const eventData = {
            id: savedMessage.id.toString(),
            contestId: savedMessage.contest_id,
            sender: {
              wallet: savedMessage.sender_wallet_address,
              // Use nickname/role from the ws.clientInfo for consistency if sender include fails or is different
              nickname: ws.clientInfo.nickname || savedMessage.sender?.nickname || 'Unknown',
              role: ws.clientInfo.role || savedMessage.sender?.role || 'user'
            },
            text: savedMessage.message_text,
            timestamp: savedMessage.created_at.toISOString(),
            isAdmin: isAdmin
          };
          serviceEvents.emit('contest:chat:message', eventData);

          // Send acknowledgment back to sender (optional)
          server.send(ws, {
            type: MESSAGE_TYPES.ACKNOWLEDGMENT,
            topic: normalizedTopic,
            action: message.action,
            requestId: message.requestId, // Echo request ID if present
            data: { success: true, messageId: savedMessage.id },
            timestamp: new Date().toISOString()
          });

          logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.CYAN}User ${senderNickname} sent chat message to contest ${contestId}${fancyColors.RESET}`);

        } else {
          server.sendError(ws, `Unknown action for ${normalizedTopic}: ${message.action}`, 4009);
        }
        break;

      // --- Add other COMMAND handlers for different topics below --- 
      // case TOPICS.SOME_OTHER_TOPIC:
      //  // ... handler logic ...
      //  break;
      
      default:
        server.sendError(ws, `Commands not implemented for topic: ${normalizedTopic}`, 5003);
    }
  } catch (error) {
    logApi.error(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.RED}Error handling command (${normalizedTopic}/${message.action}):${fancyColors.RESET}`, error);
    server.sendError(ws, 'Error processing command', 5004);
  }
}

/**
 * Send initial data for a topic when client subscribes
 * @param {WebSocket} ws - WebSocket connection
 * @param {string} topic - The topic name
 * @param {Object} server - The unified WebSocket server instance
 */
export async function sendInitialData(ws, topic, server) {
    // Normalize the topic to support both hyphenated and underscore formats
    const normalizedTopic = normalizeTopic(topic);

    // Add scope-level declaration for this function to avoid reference errors in the catch block
    let topicForLogs = normalizedTopic;
  
  try {

    switch (normalizedTopic) {
      case TOPICS.MARKET_DATA:
        const tokens = await marketDataService.getAllTokens();
        server.send(ws, {
          type: MESSAGE_TYPES.DATA,
          topic: normalizedTopic, // Use the normalized topic
          data: tokens,
          timestamp: new Date().toISOString(),
          initialData: true
        });
        break;
        
      case TOPICS.TERMINAL:
        // Use cached terminal data if available, otherwise fetch it
        let terminalData = server.terminalData;
        if (!terminalData) {
          terminalData = await fetchTerminalData();
          server.terminalData = terminalData;
        }
        
        server.send(ws, {
          type: MESSAGE_TYPES.DATA,
          topic: normalizedTopic,
          subtype: 'terminal',
          action: 'update',
          data: terminalData,
          timestamp: new Date().toISOString(),
          initialData: true
        });
        break;
        
      // For authenticated topics, send user-specific data
      case TOPICS.USER:
        if (ws.clientInfo.isAuthenticated) {
          // Fetch basic user information
          const userData = await prisma.users.findUnique({
            where: { wallet_address: ws.clientInfo.userId },
            select: {
              id: true,
              wallet_address: true,
              nickname: true,
              role: true,
              created_at: true,
              last_login: true,
              profile_image_url: true
            }
          });
          
          if (userData) {
            server.send(ws, {
              type: MESSAGE_TYPES.DATA,
              topic: normalizedTopic,
              action: 'profile',
              data: userData,
              timestamp: new Date().toISOString(),
              initialData: true
            });
          }
        }
        break;
        
      // Add other topics as needed
    }
  } catch (error) {
    logApi.error(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.RED}Error sending initial data for topic ${topicForLogs}:${fancyColors.RESET}`, error);
  }
}

/**
 * Generate a unique connection ID for tracking
 * @returns {string} Unique connection ID
 */
function generateConnectionId() {
  // Generate a random hexadecimal string
  const hexChars = "0123456789ABCDEF";
  let id = "";
  for (let i = 0; i < 6; i++) {
    id += hexChars[Math.floor(Math.random() * 16)];
  }
  return id;
}

/**
 * Save WebSocket connection to database
 * @param {string} connectionId - Unique connection identifier
 * @param {Object} connectionData - Connection data
 * @returns {Promise} Database operation result
 */
async function saveConnectionToDatabase(connectionId, connectionData) {
  try {
    // Prepare the data to be saved
    const dataToSave = {
      connection_id: connectionId,
      ip_address: connectionData.ip_address,
      user_agent: connectionData.user_agent,
      wallet_address: connectionData.wallet_address,
      nickname: connectionData.nickname,
      is_authenticated: connectionData.is_authenticated,
      environment: connectionData.environment,
      origin: connectionData.origin,
      country: connectionData.country,
      region: connectionData.region,
      city: connectionData.city
      // Removed metadata field - not providing clear value at this time
    };
    
    // Log the full data being saved to help debug field length issues
    logApi.debug(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BLUE}Saving connection data:${fancyColors.RESET}`, {
      connectionId,
      dataFields: Object.entries(dataToSave).map(([key, value]) => ({
        field: key,
        type: typeof value,
        value: value,
        length: typeof value === 'string' ? value.length : null,
      }))
    });
    
    // Create a new connection record
    return await prisma.websocket_connections.create({
      data: dataToSave
    });
  } catch (error) {
    // Enhanced error logging with field data when a length error occurs
    if (error.code === 'P2000') {
      // This is a field length error
      logApi.error(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.RED}Field length error saving connection to database:${fancyColors.RESET}`, {
        error: error.message,
        connectionId,
        // Add the data that was being saved to help identify which field is too long
        connectionData: Object.entries(connectionData).map(([key, value]) => ({
          field: key,
          type: typeof value,
          value: value,
          length: typeof value === 'string' ? value.length : null,
        }))
      });
    } else {
      // Other types of errors
      logApi.error(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.RED}Failed to save connection to database:${fancyColors.RESET}`, error);
    }
    
    // Don't throw error here to prevent affecting the connection handling
    return null;
  }
}

/**
 * Authenticate client based on token
 * @param {WebSocket} ws - WebSocket client
 * @param {string} token - Authentication token
 * @param {Object} server - WebSocket server instance
 * @returns {Promise<Object|null>} Authentication data or null if failed
 */
export async function authenticateClient(ws, token, server) {
  try {
    if (!token) return null;
    
    // Verify token
    const decoded = jwt.verify(token, config.jwt.secret);
    if (!decoded || !decoded.wallet_address) return null;
    
    const authData = {
      userId: decoded.wallet_address,
      role: decoded.role
    };
    
    // Get user's nickname from database
    let userNickname = null;
    try {
      const user = await prisma.users.findUnique({
        where: { wallet_address: authData.userId },
        select: { nickname: true }
      });
      userNickname = user?.nickname || null;
    } catch (dbError) {
      logApi.debug(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.YELLOW}Failed to fetch nickname for ${authData.userId}: ${dbError.message}${fancyColors.RESET}`);
    }
    
    // Update client info
    if (ws.clientInfo) {
      ws.clientInfo.isAuthenticated = true;
      ws.clientInfo.userId = authData.userId;
      ws.clientInfo.role = authData.role;
      ws.clientInfo.nickname = userNickname;
    }
    
    return {
      ...authData,
      nickname: userNickname
    };
  } catch (error) {
    logApi.error(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.RED}Authentication error:${fancyColors.RESET}`, error);
    return null;
  }
}

/**
 * Handle client subscribe request
 * @param {WebSocket} ws - WebSocket client
 * @param {Object} message - Subscription message
 * @param {Object} server - WebSocket server instance
 */
export async function handleClientSubscribe(ws, message, server) {
  // Same as handleSubscription but adapted for server parameter
  await handleSubscription(ws, message, null, server);
}

/**
 * Handle client unsubscribe request
 * @param {WebSocket} ws - WebSocket client
 * @param {Object} message - Unsubscription message
 * @param {Object} server - WebSocket server instance
 */
export function handleClientUnsubscribe(ws, message, server) {
  // Same as handleUnsubscription but adapted for server parameter
  handleUnsubscription(ws, message, server);
}

/**
 * Handle client request
 * @param {WebSocket} ws - WebSocket client
 * @param {Object} message - Request message
 * @param {Object} server - WebSocket server instance
 */
export async function handleClientRequest(ws, message, server) {
  // Forward to handleRequest from requestHandlers.js
  await handleRequest(ws, message, 
    // Passing send functions as a callback to avoid circular dependencies
    (client, data) => server.send(client, data),
    (client, message, code) => server.sendError(client, message, code)
  );
}

/**
 * Handle client command
 * @param {WebSocket} ws - WebSocket client
 * @param {Object} message - Command message
 * @param {Object} server - WebSocket server instance
 */
export async function handleClientCommand(ws, message, server) {
  // Forward to command handler
  await handleCommand(ws, message, server);
}

/**
 * Broadcast message to topic subscribers
 * @param {string} topic - Topic to broadcast to
 * @param {Object} data - Data to broadcast
 * @param {Object} subscriptions - Topic subscriptions map
 * @param {Map} clients - Clients map
 * @param {string|null} excludeClientId - Client ID to exclude from broadcast
 */
export function broadcastToSubscribers(topic, data, subscriptions, clients, excludeClientId = null) {
  try {
    if (!subscriptions[topic]) return;
    
    const formatted = formatMessage(data);
    const subscribers = subscriptions[topic];
    let sentCount = 0;
    
    for (const ws of subscribers) {
      try {
        // Skip if this is the client to exclude
        if (excludeClientId && ws.clientInfo && ws.clientInfo.connectionId === excludeClientId) {
          continue;
        }
        
        // Only send to clients in OPEN state
        if (ws.readyState === 1) { // WebSocket.OPEN
          ws.send(formatted);
          // Track message sent on the connection object for database
          ws.messagesSent = (ws.messagesSent || 0) + 1;
          sentCount++;
        }
      } catch (clientErr) {
        logApi.error(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.RED}Error sending to client:${fancyColors.RESET}`, clientErr);
      }
    }
    
    // Debug level logging to avoid spamming logs with broadcasts
    if (sentCount > 0) {
      logApi.debug(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.GREEN}Broadcast ${topic} to ${sentCount} clients${fancyColors.RESET}`);
    }
  } catch (error) {
    logApi.error(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.RED}Broadcast error:${fancyColors.RESET}`, error);
  }
}

/**
 * Update WebSocket connection in database upon disconnection
 * @param {string} connectionId - Unique connection identifier
 * @param {Object} disconnectData - Disconnect data
 * @returns {Promise} Database operation result
 */
async function updateConnectionOnDisconnect(connectionId, disconnectData) {
  try {
    // Find the connection by ID
    const connection = await prisma.websocket_connections.findFirst({
      where: { connection_id: connectionId }
    });
    
    if (!connection) {
      logApi.warn(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${wsColors.warning}Connection not found in database for disconnect: ${connectionId}${fancyColors.RESET}`);
      return null;
    }
    
    // Calculate duration in seconds
    const connectedAt = connection.connected_at;
    const disconnectedAt = new Date();
    const durationSeconds = Math.round((disconnectedAt - connectedAt) / 1000);
    
    // Update the connection record with disconnect data
    return await prisma.websocket_connections.update({
      where: { id: connection.id },
      data: {
        disconnected_at: disconnectedAt,
        duration_seconds: durationSeconds,
        close_code: disconnectData.code,
        close_reason: disconnectData.reason,
        subscribed_topics: disconnectData.subscribedTopics || [],
        messages_received: disconnectData.messagesReceived || 0,
        messages_sent: disconnectData.messagesSent || 0,
        connection_error: disconnectData.error || null
      }
    });
  } catch (error) {
    logApi.error(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.RED}Failed to update connection on disconnect:${fancyColors.RESET}`, error);
    // Don't throw error here to prevent affecting the disconnect handling
    return null;
  }
}

