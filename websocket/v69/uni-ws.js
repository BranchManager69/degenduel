// websocket/v69/uni-ws.js
// @ts-nocheck

/**
 * Unified WebSocket Server
 * 
 * This is a centralized WebSocket implementation that replaces multiple separate WebSocket servers.
 * It uses a topic-based subscription model allowing clients to subscribe to specific data channels.
 * 
 * Features:
 * - Single connection for multiple data types
 * - Topic-based subscriptions
 * - Unified authentication
 * - Centralized error handling and rate limiting
 */

import { WebSocketServer } from 'ws';
import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors, wsColors } from '../../utils/colors.js';
import jwt from 'jsonwebtoken';
import prisma from '../../config/prisma.js';

// Config
import config from '../../config/config.js';
const AUTH_DEBUG_MODE = config.debug_modes.auth === true || config.debug_modes.auth === 'true';
const WS_DEBUG_MODE = config.debug_modes.websocket === true || config.debug_modes.websocket === 'true';
logApi.info('AUTH_DEBUG_MODE (uni-ws):', AUTH_DEBUG_MODE);
logApi.info('WS_DEBUG_MODE (uni-ws):', WS_DEBUG_MODE);

// Import services as needed
import marketDataService from '../../services/marketDataService.js';
import serviceEvents from '../../utils/service-suite/service-events.js';

// Use message types and topics from config
const MESSAGE_TYPES = config.websocket.messageTypes;
const TOPICS = {
  ...config.websocket.topics,
  // Add client logs topic
  LOGS: 'logs'
};

/**
 * Unified WebSocket Server
 */
class UnifiedWebSocketServer {
  constructor(httpServer, options = {}) {
    this.path = '/api/v69/ws';
    this.clientsByUserId = new Map();            // userId -> Set of WebSocket connections
    this.clientSubscriptions = new Map();        // client -> Set of topics
    this.topicSubscribers = new Map();           // topic -> Set of WebSocket connections
    this.authenticatedClients = new Map();       // client -> userData
    this.startTime = Date.now();                 // Server start time for uptime tracking
    this.metrics = {
      messagesReceived: 0,
      messagesSent: 0,
      errors: 0,
      subscriptions: 0,
      uniqueClients: 0,
      lastActivity: new Date()
    };
    
    // Service event listeners
    this.eventHandlers = new Map();
    
    // Initialize WebSocket server with ALL compression options explicitly DISABLED
    this.wss = new WebSocketServer({
      server: httpServer,
      path: this.path,
      maxPayload: 1024 * 50,  // 50KB max payload
      perMessageDeflate: false, // EXPLICITLY DISABLE COMPRESSION to avoid client issues
      // Additional explicit compression options to ensure nothing tries to compress frames
      skipUTF8Validation: false, // Ensure proper UTF8 validation
      // Extra safety options to manage RSV1, RSV2, RSV3 bits
      handleProtocols: (protocols) => {
        // Accept first protocol if provided, or null otherwise
        return protocols?.[0] || null;
      },
      // Create custom verifyClient function to add more logging
      verifyClient: (info, callback) => {
        // Log detailed client info before verification (only if debug mode is enabled)
        if (WS_DEBUG_MODE) {
          logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} CLIENT VERIFY ${fancyColors.RESET}`, {
            clientConnInfo: {
              origin: info.origin,
              secure: info.secure,
              req: {
                url: info.req.url,
                headers: info.req.headers
              }
            },
            _icon: "🔍",
            _color: "#0088FF"
          });
        } else {
          // Log a more concise verification message in normal mode
          logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} Connection from ${info.origin}`, {
            ip: info.req.headers['x-real-ip'] || info.req.headers['x-forwarded-for'] || info.req.socket?.remoteAddress,
            environment: config.getEnvironment(info.origin),
            service: 'uni-ws',
            _icon: "🔌", 
            _color: "#E91E63"
          });
        }
        
        // Always accept connections - we'll handle auth later
        callback(true);
      }
    });
    
    // Set up connection handler
    this.wss.on('connection', this.handleConnection.bind(this));
    
    // Initialize topic handlers
    this.initializeTopicHandlers();
    
    logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${wsColors.success}Unified WebSocket server initialized at ${this.path}${fancyColors.RESET}`);
  }
  
  /**
   * Initialize handlers for different topics
   */
  initializeTopicHandlers() {
    // Market Data handler
    this.registerEventHandler(
      'market:broadcast', 
      (data) => this.broadcastToTopic(TOPICS.MARKET_DATA, {
        type: MESSAGE_TYPES.DATA,
        topic: TOPICS.MARKET_DATA,
        data: data,
        timestamp: new Date().toISOString()
      })
    );
    
    // Add more topic handlers as needed for other event types
  }
  
  /**
   * Generate a unique connection ID
   * @returns {string} - A unique connection ID
   */
  generateConnectionId() {
    // Generate a random 5-character hex string
    return Math.random().toString(16).substring(2, 7).toUpperCase();
  }

  /**
   * Parse browser and OS info from user agent
   * @param {string} userAgent - User agent string
   * @returns {string} - Formatted browser/OS info
   */
  parseClientInfo(userAgent) {
    if (!userAgent) return "Unknown Client";
    
    // Simple parsing for common browsers and OS
    let browser = "Unknown";
    let os = "Unknown";
    
    // Detect browser
    if (userAgent.includes("Chrome") && !userAgent.includes("Edg")) {
      browser = "Chrome";
    } else if (userAgent.includes("Firefox")) {
      browser = "Firefox";
    } else if (userAgent.includes("Safari") && !userAgent.includes("Chrome")) {
      browser = "Safari";
    } else if (userAgent.includes("Edg")) {
      browser = "Edge";
    }
    
    // Detect OS
    if (userAgent.includes("Windows")) {
      os = "Windows";
    } else if (userAgent.includes("Mac OS")) {
      os = "macOS";
    } else if (userAgent.includes("Linux")) {
      os = "Linux";
    } else if (userAgent.includes("Android")) {
      os = "Android";
    } else if (userAgent.includes("iPhone") || userAgent.includes("iPad")) {
      os = "iOS";
    }
    
    return `${browser}/${os}`;
  }
  
  /**
   * Format authentication flow state into a visual representation
   * @param {Object} authFlowState - Auth flow state object
   * @param {string} nickname - User nickname if available
   * @param {string} userId - User wallet address if available
   * @param {BigInt} solanaBalance - User's SOL balance in lamports
   * @returns {string} - Formatted visual representation
   */
  formatAuthFlowVisual(authFlowState, nickname, userId, solanaBalance) {
    // Define color codes and symbols
    const GREEN = '\x1b[32m';
    const RED = '\x1b[31m';
    const YELLOW = '\x1b[33m';
    const BLUE = '\x1b[34m';
    const CYAN = '\x1b[36m';
    const RESET = '\x1b[0m';
    const BOLD = '\x1b[1m';
    
    const SUCCESS = '✓';
    const FAILURE = '✗';
    const ARROW = '→';
    
    // Format the balance in SOL if available
    let balanceStr = '';
    if (solanaBalance) {
      // Convert lamports to SOL (1 SOL = 1,000,000,000 lamports)
      const solBalance = Number(solanaBalance) / 1000000000;
      balanceStr = ` ${CYAN}${BOLD}$SOL:${solBalance.toFixed(2)}${RESET}`;
    }
    
    // Format wallet address
    const walletStr = userId ? `${userId.slice(0, 6)}...` : 'none';
    
    // Create visual flow with stages
    const cookieStep = authFlowState.cookie ? 
      `${GREEN}🍪${SUCCESS}${RESET}` : `${RED}🍪${FAILURE}${RESET}`;
      
    const tokenStep = authFlowState.cookie ? 
      (authFlowState.token ? `${GREEN}🔑${SUCCESS}${RESET}` : `${RED}🔑${FAILURE}${RESET}`) : '';
      
    const walletStep = authFlowState.token ? 
      (authFlowState.wallet ? `${GREEN}👛${SUCCESS}${RESET}` : `${RED}👛${FAILURE}${RESET}`) : '';
      
    const userStep = authFlowState.wallet ? 
      (authFlowState.user ? `${GREEN}👤${SUCCESS}${RESET}` : `${RED}👤${FAILURE}${RESET}`) : '';
      
    const nicknameStep = authFlowState.user ? 
      (authFlowState.nickname ? `${GREEN}📝${SUCCESS}${RESET}` : `${YELLOW}📝${FAILURE}${RESET}`) : '';
      
    const balanceStep = authFlowState.user ? 
      (authFlowState.balance ? `${GREEN}💰${SUCCESS}${RESET}` : `${YELLOW}💰${FAILURE}${RESET}`) : '';
      
    const authResult = authFlowState.user ? 
      `${GREEN}🔓${RESET}` : `${RED}🔒${RESET}`;
      
    // Build the flow with arrows
    const arrowStr = ` ${BLUE}${ARROW}${RESET} `;
    
    // Construct the visual representation based on how far the auth process got
    let visual = `[${cookieStep}`;
    
    if (tokenStep) {
      visual += `${arrowStr}${tokenStep}`;
    }
    
    if (walletStep) {
      visual += `${arrowStr}${walletStep}`;
    }
    
    if (userStep) {
      visual += `${arrowStr}${userStep}`;
    }
    
    if (nicknameStep) {
      visual += `${arrowStr}${nicknameStep}`;
    }
    
    if (balanceStep) {
      visual += `${arrowStr}${balanceStep}`;
    }
    
    visual += `${arrowStr}${authResult}]`;
    
    // Add name and balance if available
    const nameStr = nickname ? `"${nickname}"` : (userId ? walletStr : 'anonymous');
    visual += ` ${nameStr}${balanceStr}`;
    
    return visual;
  }

  /**
   * Get location info for IP address
   * @param {string} ip - IP address
   * @returns {Promise<Object>} - Location info object or null
   */
  async getLocationInfo(ip) {
    try {
      // Skip lookup for local/private IPs
      if (!ip || ip === '127.0.0.1' || ip === 'localhost' || 
          ip.startsWith('192.168.') || ip.startsWith('10.') || 
          ip.startsWith('172.16.') || ip.includes('::1')) {
        return null;
      }
      
      // Use the getIpInfo function from logApi
      const ipInfo = await logApi.getIpInfo(ip);
      
      // Log the full ipInfo structure to understand what fields are available
      if (WS_DEBUG_MODE) {
        logApi.debug(`${wsColors.tag}[uni-ws]${fancyColors.RESET} IP Info structure:`, {
          ipInfo,
          ip
        });
      }
      
      if (ipInfo && !ipInfo.error && !ipInfo.bogon) {
        // Return full info object instead of just a string
        return {
          city: ipInfo.city || null,
          region: ipInfo.region || null,
          regionCode: ipInfo.region_code || null,
          country: ipInfo.country || null,
          countryCode: ipInfo.country_code || null,
          formattedString: ipInfo.city && ipInfo.region && ipInfo.country ? 
            `${ipInfo.city}, ${ipInfo.region}, ${ipInfo.country}` : 
            (ipInfo.city && ipInfo.country ? 
              `${ipInfo.city}, ${ipInfo.country}` : 
              ipInfo.country || '')
        };
      }
      
      return null;
    } catch (error) {
      logApi.error(`${wsColors.tag}[uni-ws]${fancyColors.RESET} Error getting IP info:`, error);
      return null;
    }
  }
  
  /**
   * Register an event handler for a specific event
   * @param {string} eventName - The event to listen for
   * @param {Function} handler - The handler function
   */
  registerEventHandler(eventName, handler) {
    // Store reference to handler function for cleanup
    this.eventHandlers.set(eventName, handler);
    
    // Register with service events
    serviceEvents.on(eventName, handler);
    
    logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BLUE}Registered handler for event: ${eventName}${fancyColors.RESET}`);
  }
  
  /**
   * Handle new WebSocket connection
   * @param {WebSocket} ws - WebSocket connection
   * @param {Request} req - HTTP request
   */
  async handleConnection(ws, req) {
    try {
      // ===== DEBUG LOGGING: Connection start =====
      logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_CYAN}${fancyColors.WHITE} CONNECTION START ${fancyColors.RESET} WebSocket connection received`);
      // ===== END DEBUG LOGGING =====
      
      // Set up message handler for this connection
      ws.on('message', (message) => this.handleMessage(ws, message, req));
      
      // Set up close handler
      ws.on('close', (code, reason) => {
        // Store close code and reason on the ws object for the disconnect handler
        ws.closeCode = code;
        ws.closeReason = reason ? reason.toString() : null;
        this.handleDisconnect(ws);
      });
      
      // Set up error handler
      ws.on('error', (error) => this.handleError(ws, error));
      
      // Generate connection ID and counter
      const connectionId = this.generateConnectionId();
      const connectionCounter = this.metrics.uniqueClients + 1;
      
      // Client IP and user agent
      const clientIp = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
      const userAgent = req.headers['user-agent'] || 'unknown';
      const origin = req.headers['origin'] || 'unknown';
      const clientInfo = this.parseClientInfo(userAgent);
      
      // Get location info (asynchronous)
      const locationInfo = await this.getLocationInfo(clientIp);
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
        logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_CYAN}${fancyColors.WHITE} AUTH ATTEMPT ${fancyColors.RESET} Starting auth from cookies`);
        // ===== END DEBUG LOGGING =====
        
        // Check for session cookie
        const cookies = req.headers.cookie || '';
        const sessionCookie = cookies.split(';').find(cookie => cookie.trim().startsWith('session='));
        
        // ===== DEBUG LOGGING: Cookie check =====
        logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_CYAN}${fancyColors.WHITE} COOKIE CHECK ${fancyColors.RESET} Cookie found: ${!!sessionCookie}, cookies: "${cookies.substring(0, 100)}${cookies.length > 100 ? '...' : ''}"`);
        // ===== END DEBUG LOGGING =====
        
        if (sessionCookie) {
          authFlowState.cookie = true; // Cookie found
          
          // Extract the token from the cookie
          const token = sessionCookie.split('=')[1].trim();
          
          // ===== DEBUG LOGGING: Token extraction =====
          logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_CYAN}${fancyColors.WHITE} TOKEN EXTRACT ${fancyColors.RESET} Token length: ${token.length}, starts with: ${token.substring(0, 10)}...`);
          // ===== END DEBUG LOGGING =====
          
          // Store raw token for auth API calls
          ws.clientInfo = ws.clientInfo || {};
          ws.clientInfo._rawToken = token;
          
          // ===== DEBUG LOGGING: clientInfo initialization =====
          logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_CYAN}${fancyColors.WHITE} CLIENTINFO INIT ${fancyColors.RESET} Initial clientInfo object created with token`);
          // ===== END DEBUG LOGGING ====
          
          // Decode the token without verifying (to avoid exceptions) 
          try {
            // ===== DEBUG LOGGING: Token decode attempt =====
            logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_CYAN}${fancyColors.WHITE} TOKEN DECODE ${fancyColors.RESET} Attempting to decode JWT token without verification`);
            // ===== END DEBUG LOGGING =====
            
            const decoded = jwt.decode(token);
            
            // ===== DEBUG LOGGING: Decode result =====
            if (decoded) {
              logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_CYAN}${fancyColors.WHITE} TOKEN SUCCESS ${fancyColors.RESET} Token decoded successfully, has wallet: ${!!decoded.wallet_address}, has role: ${!!decoded.role}`);
            } else {
              logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} TOKEN FAIL ${fancyColors.RESET} Failed to decode token`);
            }
            // ===== END DEBUG LOGGING =====
            
            if (decoded && decoded.wallet_address) {
              authFlowState.token = true; // Token decoded
              userId = decoded.wallet_address;
              role = decoded.role;
              authFlowState.wallet = true; // Wallet address found
              
              // ===== DEBUG LOGGING: Wallet extraction =====
              logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_CYAN}${fancyColors.WHITE} WALLET FOUND ${fancyColors.RESET} Wallet: ${userId}, Role: ${role}`);
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
              logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_CYAN}${fancyColors.WHITE} DB LOOKUP ${fancyColors.RESET} Looking up user in database: ${userId}`);
              // ===== END DEBUG LOGGING =====
              
              if (user) {
                authFlowState.user = true; // User found in DB
                
                // ===== DEBUG LOGGING: User found =====
                logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_CYAN}${fancyColors.WHITE} USER FOUND ${fancyColors.RESET} Found user in database: ${userId}, has nickname: ${!!user.nickname}, has balance: ${!!user.last_known_balance}`);
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
                logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} AUTH SUCCESS ${fancyColors.RESET} User authenticated successfully: ${nickname || userId}`);
                // ===== END DEBUG LOGGING =====
              } else {
                // ===== DEBUG LOGGING: User not found =====
                logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} USER NOT FOUND ${fancyColors.RESET} User not found in database: ${userId}`);
                // ===== END DEBUG LOGGING =====
              }
            }
          } catch (tokenErr) {
            // ===== DEBUG LOGGING: Token error =====
            logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} TOKEN ERROR ${fancyColors.RESET} Error decoding token: ${tokenErr.message}`);
            // ===== END DEBUG LOGGING =====
            // Silently continue on token error
          }
        } else {
          // ===== DEBUG LOGGING: No cookie =====
          logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} NO COOKIE ${fancyColors.RESET} No session cookie found in request`);
          // ===== END DEBUG LOGGING =====
        }
      } catch (authErr) {
        // ===== DEBUG LOGGING: Auth error =====
        logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} AUTH ERROR ${fancyColors.RESET} Error during authentication: ${authErr.message}`);
        // ===== END DEBUG LOGGING =====
        // Silently continue on auth error
      }
      
      // ===== DEBUG LOGGING: Auth flow summary =====
      logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} AUTH FLOW SUMMARY ${fancyColors.RESET}`, {
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
      const authFlowVisual = this.formatAuthFlowVisual(authFlowState, nickname, userId, solanaBalance);
      
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
        this.parseClientInfo(userAgent).length,
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
${bgColor}${fgColor}│ ${'Browser:'.padEnd(fieldWidth)} ${this.parseClientInfo(userAgent).padEnd(maxValueWidth)}${fancyColors.RESET}
${bgColor}${fgColor}│ ${'Location:'.padEnd(fieldWidth)} ${(locationInfo?.formattedString ? locationInfo.formattedString.padEnd(maxValueWidth) : 'Unknown'.padEnd(maxValueWidth))}${fancyColors.RESET}
${bgColor}${fgColor}└${'─'.repeat(fieldWidth + maxValueWidth + 3)}${fancyColors.RESET}`;

      // ===== DEBUG LOGGING: Before final clientInfo assignment =====
      logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_MAGENTA}${fancyColors.WHITE} CLIENTINFO BEFORE ${fancyColors.RESET} Current state before final assignment:`, {
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
        // Preserve any existing raw token
        _rawToken: oldClientInfo._rawToken || null,
        headers: headerEntries.reduce((obj, [key, value]) => {
          // Mask cookie value for security
          if (key === 'cookie') {
            obj[key] = value.replace(/(session=)[^;]+/, '$1***JWT_TOKEN***');
          } else {
            obj[key] = value;
          }
          return obj;
        }, {})
      };
      
      // ===== DEBUG LOGGING: After final clientInfo assignment =====
      logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_MAGENTA}${fancyColors.WHITE} CLIENTINFO FINAL ${fancyColors.RESET} Final state after assignment:`, {
        exists: true,
        hasAuthentication: 'isAuthenticated' in ws.clientInfo,
        authState: ws.clientInfo.isAuthenticated ? 'authenticated' : 'not authenticated',
        hasUserId: !!ws.clientInfo.userId,
        userId: ws.clientInfo.userId || 'none',
        connectionId: ws.clientInfo.connectionId,
        fieldsCount: Object.keys(ws.clientInfo).length
      });
      // ===== END DEBUG LOGGING =====
      
      // Log raw headers only in debug mode
      if (WS_DEBUG_MODE) {
        // Clone and mask headers for logging
        const maskedHeaders = {...req.headers};
        if (maskedHeaders.cookie) {
          maskedHeaders.cookie = maskedHeaders.cookie.replace(/(session=)[^;]+/, '$1***JWT_TOKEN***');
        }
        
        logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} RAW HEADERS ${fancyColors.RESET}`, {
          unifiedWS: true,
          rawHeaders: maskedHeaders,
          connectionId,
          socketInfo: {
            remoteAddress: req.socket?.remoteAddress,
            remotePort: req.socket?.remotePort,
            protocol: req.protocol,
            url: req.url,
            method: req.method
          },
          _icon: "📋",
          _color: "#FF8800"
        });
      }
      
      // Initial welcome message
      this.send(ws, {
        type: MESSAGE_TYPES.SYSTEM,
        message: 'Connected to DegenDuel Unified WebSocket',
        serverTime: new Date().toISOString(),
        topics: Object.values(TOPICS)
      });
      
      // Update metrics
      this.metrics.uniqueClients = this.wss.clients.size;
      this.metrics.lastActivity = new Date();
      
      // Format origin for display (removing protocol)
      const originDisplay = origin.replace(/^https?:\/\//, '');
      
      // Log connection with format consistent with disconnection logging
      // Create a simplified log object for console output
      const consoleLogObject = {
        ip: clientIp,
        origin: origin,
        connectionId,
        timestamp: new Date().toISOString(),
        environment: config.getEnvironment(origin),
        service: 'uni-ws',
        userId: userId,
        nickname: nickname,
        isAuthenticated,
        solanaBalance: solanaBalance ? Number(solanaBalance) / 1000000000 : null, // convert to SOL
        authFlow: authFlowVisual,
        _icon: "🔌",
        _color: "#FFA500" // Match orange color used for disconnect
      };
      
      // Format user info for consistent display
      const userInfo = userId ? (nickname ? ` "${nickname}" (${userId.slice(0, 6)}...)` : ` ${userId.slice(0, 6)}...`) : '';
      
      // Log connect with format matching disconnect
      logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${wsColors.disconnect}CONN#${connectionId} CONNECT - ${clientIp}${userInfo} (${locationInfo?.formattedString || 'Unknown'})${fancyColors.RESET}`, 
        config.debug_modes.websocket ? {
          ...consoleLogObject,
          userAgent: userAgent,
          protocol: req.headers['sec-websocket-version'] || 'unknown',
          extensions: req.headers['sec-websocket-extensions'] || 'none',
          connectionLog,
          headers: req.headers
        } : consoleLogObject
      );
      
      // Track connection in database
      this.saveConnectionToDatabase(connectionId, {
        ip_address: clientIp,
        user_agent: userAgent,
        wallet_address: userId,
        nickname: nickname,
        is_authenticated: isAuthenticated,
        environment: config.getEnvironment(origin),
        origin,
        // Use the country code if available, otherwise use the first 2 chars or null
        country: locationInfo?.countryCode || 
                (locationCountry && locationCountry.length >= 2 ? locationCountry.substring(0, 2).toUpperCase() : null),
        region: locationRegion,
        city: locationCity
        // Removed metadata - not providing clear value at this time
      }).catch(err => {
        logApi.error(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.RED}Error saving connection to database:${fancyColors.RESET}`, err);
      });
      
      // Create a detailed log object for Logtail with all details
      const fullLogObject = {
        ...consoleLogObject,
        userAgent: userAgent,
        connectionNumber: connectionCounter,
        clientInfo,
        locationInfo,
        connectionLog, // Add the new formatted log
        important_headers: importantHeaders.reduce((obj, key) => {
          if (key === 'cookie' && req.headers[key]) {
            obj[key] = req.headers[key].replace(/(session=)[^;]+/, '$1***JWT_TOKEN***');
          } else {
            obj[key] = req.headers[key] || 'missing';
          }
          return obj;
        }, {})
      };
      
      // Use log level with object to ensure proper console vs logtail handling
      const clientInfoStr = this.parseClientInfo(userAgent);
      logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${wsColors.connect}CONN#${connectionId} NEW - ${clientIp} (${clientInfoStr}) ${authFlowVisual} from ${originDisplay}${locationDisplay}${fancyColors.RESET}`, 
        config.debug_modes.websocket ? fullLogObject : consoleLogObject
      );
      
      // Log the fancy connection format to console - always show this for readability
      console.log(connectionLog);
    } catch (error) {
      logApi.error(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.RED}Error handling connection:${fancyColors.RESET}`, error);
      ws.terminate();
    }
  }
  
  /**
   * Handle incoming message from client
   * @param {WebSocket} ws - WebSocket connection
   * @param {Buffer} rawMessage - Raw message buffer
   * @param {Request} req - Original HTTP request
   */
  async handleMessage(ws, rawMessage, req) {
    try {
      // ===== DEBUG LOGGING: Message received =====
      logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} MESSAGE RECEIVED ${fancyColors.RESET} New WebSocket message`);
      
      // Check clientInfo state
      logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} MESSAGE CLIENTINFO ${fancyColors.RESET} clientInfo state:`, {
        exists: !!ws.clientInfo,
        hasAuth: ws.clientInfo && 'isAuthenticated' in ws.clientInfo,
        isAuthenticated: ws.clientInfo?.isAuthenticated || false,
        hasUserId: !!ws.clientInfo?.userId,
        userId: ws.clientInfo?.userId || 'none',
        connectionId: ws.clientInfo?.connectionId || 'unknown'
      });
      // ===== END DEBUG LOGGING =====
      
      this.metrics.messagesReceived++;
      
      // Track message count on the connection object for database tracking
      ws.messagesReceived = (ws.messagesReceived || 0) + 1;
      this.metrics.lastActivity = new Date();
      
      // Parse message
      let message;
      try {
        const messageText = rawMessage.toString();
        message = JSON.parse(messageText);
      } catch (error) {
        return this.sendError(ws, 'Invalid message format. JSON expected.', 4000);
      }
      
      // Validate message structure
      if (!message.type) {
        return this.sendError(ws, 'Message type is required', 4001);
      }
      
      // Special handling for client logs - they can be processed directly
      // This allows logs to be sent without requiring subscription first
      if (message.type === 'LOGS' || (message.type === MESSAGE_TYPES.DATA && message.topic === TOPICS.LOGS)) {
        await this.handleClientLogs(ws, message);
        return;
      }
      
      // Process based on message type
      switch (message.type) {
        case MESSAGE_TYPES.SUBSCRIBE:
          await this.handleSubscription(ws, message, req);
          break;
          
        case MESSAGE_TYPES.UNSUBSCRIBE:
          this.handleUnsubscription(ws, message);
          break;
          
        case MESSAGE_TYPES.REQUEST:
          await this.handleRequest(ws, message);
          break;
          
        case MESSAGE_TYPES.COMMAND:
          await this.handleCommand(ws, message);
          break;
          
        default:
          this.sendError(ws, `Unknown message type: ${message.type}`, 4002);
      }
    } catch (error) {
      logApi.error(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.RED}Error handling message:${fancyColors.RESET}`, error);
      this.metrics.errors++;
      this.sendError(ws, 'Internal server error', 5000);
    }
  }
  
  /**
   * Handle subscription request
   * @param {WebSocket} ws - WebSocket connection
   * @param {Object} message - Parsed message
   * @param {Request} req - Original HTTP request
   */
  async handleSubscription(ws, message, req) {
    // ===== DEBUG LOGGING: Check if clientInfo exists =====
    logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} SUBSCRIPTION DEBUG ${fancyColors.RESET} clientInfo exists: ${!!ws.clientInfo}, topics: ${JSON.stringify(message.topics)}`);
    if (ws.clientInfo) {
      logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} CLIENTINFO STATE ${fancyColors.RESET} isAuthenticated: ${ws.clientInfo.isAuthenticated}, userId: ${ws.clientInfo.userId}, connectionId: ${ws.clientInfo.connectionId}`);
    } else {
      logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} MISSING CLIENTINFO ${fancyColors.RESET} WebSocket connection has no clientInfo object`);
      // Detailed object inspection (safely)
      try {
        const wsKeys = Object.keys(ws).filter(k => k !== '_events' && k !== '_eventsCount');
        logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} WS KEYS ${fancyColors.RESET} Available WebSocket properties: ${wsKeys.join(', ')}`);
      } catch (err) {
        logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} KEYS ERROR ${fancyColors.RESET} Error inspecting WebSocket: ${err.message}`);
      }
    }
    // ===== END DEBUG LOGGING =====

    // Validate topics
    if (!message.topics || !Array.isArray(message.topics) || message.topics.length === 0) {
      return this.sendError(ws, 'Subscription requires at least one topic', 4003);
    }
    
    // Check authorization for restricted topics
    const restrictedTopics = [TOPICS.ADMIN, TOPICS.PORTFOLIO, TOPICS.USER, TOPICS.WALLET];
    const hasRestrictedTopic = message.topics.some(topic => restrictedTopics.includes(topic));
    
    // ===== DEBUG LOGGING: Topic restriction check =====
    logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} TOPIC CHECK ${fancyColors.RESET} hasRestrictedTopic: ${hasRestrictedTopic}, clientInfo exists: ${!!ws.clientInfo}`);
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
          return this.send(ws, {
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
          try {
            // Track JWT tokens that were already denied to prevent repeated log spam
            if (!ws.authFailedTokens) {
              ws.authFailedTokens = new Set();
            }
            
            const authToken = message.authToken;
            
            // Skip verification if this token already failed (prevents log spam)
            if (ws.authFailedTokens.has(authToken)) {
              return this.send(ws, {
                type: MESSAGE_TYPES.ERROR,
                code: 4401,
                reason: 'token_expired',
                message: 'Your session has expired. Please log in again.',
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
              return this.sendError(ws, 'Authentication required for restricted topics', 4010);
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
            this.authenticatedClients.set(ws, { ...authData, nickname: userNickname });
            
            // Associate this connection with the user ID
            if (!this.clientsByUserId.has(authData.userId)) {
              this.clientsByUserId.set(authData.userId, new Set());
            }
            this.clientsByUserId.get(authData.userId).add(ws);
            
            // Format wallet address for display (first 6 chars)
            const shortWallet = authData.userId.slice(0, 6) + '...';
            const userDisplay = userNickname 
              ? `"${userNickname}" (${shortWallet})` 
              : shortWallet;
            
            // Create fancy auth log with enhanced formatting and visual frame
            // Define a consistent field width for better alignment
            const authFieldWidth = 8; // Longest field name is "Session"
            
            // Calculate a reasonable box width based on maximum value lengths
            const authMaxValueWidth = Math.max(
              (userNickname || 'Unknown').length + authData.role.length + 3, // User: Unknown (ROLE)
              authData.userId.length,                                         // Wallet: address
              (decoded.session_id || 'unknown').length + 12                   // Session: id ✅ Validated
            );
            
            // Create a shorter folder-tab style header
            const authHeaderWidth = 14; // "AUTHENTICATION" length
            const authHeaderExtension = 5; // Short extension for tab-like appearance
            const authHeaderBar = '═'.repeat(authHeaderWidth + authHeaderExtension);
          
            // Create the enhanced auth log with box drawing characters and consistent spacing - folder tab style
            const authLog = `
${wsColors.auth}╔${authHeaderBar}╗${fancyColors.RESET}
${wsColors.auth}║ AUTHENTICATION ${' '.repeat(authHeaderExtension)}║${fancyColors.RESET}
${wsColors.authBoxBg}${wsColors.authBoxFg}┌${'─'.repeat(authFieldWidth + authMaxValueWidth + 3)}${fancyColors.RESET}
${wsColors.authBoxBg}${wsColors.authBoxFg}│ ${'User:'.padEnd(authFieldWidth)} ${(userNickname || 'Unknown')} (${authData.role})${' '.repeat(Math.max(0, authMaxValueWidth - (userNickname || 'Unknown').length - authData.role.length - 3))}${fancyColors.RESET}
${wsColors.authBoxBg}${wsColors.authBoxFg}│ ${'Wallet:'.padEnd(authFieldWidth)} ${authData.userId}${' '.repeat(Math.max(0, authMaxValueWidth - authData.userId.length))}${fancyColors.RESET}
${wsColors.authBoxBg}${wsColors.authBoxFg}│ ${'Session:'.padEnd(authFieldWidth)} ${decoded.session_id || 'unknown'} ${wsColors.success}✅ Validated${' '.repeat(Math.max(0, authMaxValueWidth - (decoded.session_id || 'unknown').length - 12))} ${fancyColors.RESET}
${wsColors.authBoxBg}${wsColors.authBoxFg}└${'─'.repeat(authFieldWidth + authMaxValueWidth + 3)}${fancyColors.RESET}`;
            
            // Log authentication with improved format
            logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${wsColors.auth}CONN#${ws.clientInfo.connectionId} AUTH - User ${userDisplay} [${authData.role}]${fancyColors.RESET}`, {
              environment: config.getEnvironment(ws.clientInfo?.origin),
              service: 'uni-ws',
              connectionId: ws.clientInfo.connectionId,
              userId: authData.userId,
              nickname: userNickname,
              role: authData.role,
              ip: ws.clientInfo.ip,
              authLog, // Add fancy auth log
              _icon: "🔐",
              _color: "#3F51B5"
            });
            
            // Also log the fancy auth format to console
            console.log(authLog);
          } catch (error) {
            // Detect the type of error
            const expiredJwt = error.name === 'TokenExpiredError';
            
            // Store this token in the failed tokens set to prevent repeated attempts
            if (authToken) {
              ws.authFailedTokens.add(authToken);
            }
            
            // Only log the first occurrence of each expired token to reduce spam
            if (!expiredJwt || !authToken) {
              logApi.error(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.RED}Authentication error:${fancyColors.RESET}`, error);
            }
            
            // Special handling for expired tokens
            if (expiredJwt) {
              // Send a special error type that clients can detect to clear their tokens and redirect to login
              return this.send(ws, {
                type: MESSAGE_TYPES.ERROR,
                code: 4401,
                reason: 'token_expired',
                message: 'Your session has expired. Please log in again.',
                timestamp: new Date().toISOString()
              });
            } else {
              return this.sendError(ws, 'Invalid authentication token', 4011);
            }
          }
        }
      } else {
        return this.sendError(ws, 'Authentication required for restricted topics', 4010);
      }
    } catch (error) {
      // Handle any errors that occurred during client info or auth processing
      logApi.error(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.RED}Error during subscription authentication:${fancyColors.RESET}`, error);
      return this.sendError(ws, 'Internal error during subscription processing', 5000);
    }
    
    // Check for admin-only topics
    if (message.topics.includes(TOPICS.ADMIN)) {
      // If we've gotten this far without clientInfo, we should have the temporary tracker
      // but we know it's not authenticated as an admin
      if (!ws.clientInfo || !ws.clientInfo.role || !['ADMIN', 'SUPER_ADMIN'].includes(ws.clientInfo.role)) {
        return this.sendError(ws, 'Admin role required for admin topics', 4012);
      }
    }
    
    // Process valid topics
    const validTopics = message.topics.filter(topic => Object.values(TOPICS).includes(topic));
    
    if (validTopics.length === 0) {
      return this.sendError(ws, 'No valid topics provided', 4004);
    }
    
    // Update client subscriptions
    if (!this.clientSubscriptions.has(ws)) {
      this.clientSubscriptions.set(ws, new Set());
    }
    
    const clientSubs = this.clientSubscriptions.get(ws);
    
    // Add to topic subscribers
    for (const topic of validTopics) {
      // Add topic to client's subscriptions
      clientSubs.add(topic);
      
      // Add client to topic's subscribers
      if (!this.topicSubscribers.has(topic)) {
        this.topicSubscribers.set(topic, new Set());
      }
      this.topicSubscribers.get(topic).add(ws);
      
      // Send initial data for the topic if available
      await this.sendInitialData(ws, topic);
    }
    
    // Update metrics
    this.metrics.subscriptions = [...this.clientSubscriptions.values()]
      .reduce((total, subs) => total + subs.size, 0);
    
    // Send acknowledgment
    this.send(ws, {
      type: MESSAGE_TYPES.ACKNOWLEDGMENT,
      operation: 'subscribe',
      topics: validTopics,
      timestamp: new Date().toISOString()
    });
    
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
   */
  handleUnsubscription(ws, message) {
    // Validate topics
    if (!message.topics || !Array.isArray(message.topics) || message.topics.length === 0) {
      return this.sendError(ws, 'Unsubscription requires at least one topic', 4005);
    }
    
    const clientSubs = this.clientSubscriptions.get(ws);
    if (!clientSubs) {
      return; // No subscriptions to process
    }
    
    // Process each topic
    for (const topic of message.topics) {
      // Remove topic from client subscriptions
      clientSubs.delete(topic);
      
      // Remove client from topic subscribers
      const topicSubs = this.topicSubscribers.get(topic);
      if (topicSubs) {
        topicSubs.delete(ws);
        if (topicSubs.size === 0) {
          this.topicSubscribers.delete(topic);
        }
      }
    }
    
    // Update metrics
    this.metrics.subscriptions = [...this.clientSubscriptions.values()]
      .reduce((total, subs) => total + subs.size, 0);
    
    // Send acknowledgment
    this.send(ws, {
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
   * Handle specific data request
   * @param {WebSocket} ws - WebSocket connection
   * @param {Object} message - Parsed message
   */
  async handleRequest(ws, message) {
    // Validate request
    if (!message.topic || !message.action) {
      return this.sendError(ws, 'Request requires topic and action', 4006);
    }
    
    // Check if topic exists
    if (!Object.values(TOPICS).includes(message.topic)) {
      return this.sendError(ws, `Unknown topic: ${message.topic}`, 4007);
    }
    
    // Process different request types based on topic and action
    try {
      switch (message.topic) {
        case TOPICS.MARKET_DATA:
          await this.handleMarketDataRequest(ws, message);
          break;
          
        case TOPICS.USER:
          await this.handleUserRequest(ws, message);
          break;
          
        case TOPICS.LOGS:
          await this.handleLogsRequest(ws, message);
          break;
          
        case TOPICS.SYSTEM:
          await this.handleSystemRequest(ws, message);
          break;
          
        // Add cases for other topics as needed
        
        default:
          this.sendError(ws, `Request handling not implemented for topic: ${message.topic}`, 5001);
      }
    } catch (error) {
      logApi.error(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.RED}Error handling request:${fancyColors.RESET}`, error);
      this.sendError(ws, 'Error processing request', 5002);
    }
  }
  
  /**
   * Handle market data requests
   * @param {WebSocket} ws - WebSocket connection
   * @param {Object} message - Parsed message
   */
  async handleMarketDataRequest(ws, message) {
    switch (message.action) {
      case 'getToken':
        if (!message.symbol) {
          return this.sendError(ws, 'Symbol is required for getToken action', 4008);
        }
        
        const token = await marketDataService.getToken(message.symbol);
        if (token) {
          this.send(ws, {
            type: MESSAGE_TYPES.DATA,
            topic: TOPICS.MARKET_DATA,
            action: 'getToken',
            requestId: message.requestId,
            data: token,
            timestamp: new Date().toISOString()
          });
        } else {
          this.sendError(ws, `Token not found: ${message.symbol}`, 4040);
        }
        break;
        
      case 'getAllTokens':
        const tokens = await marketDataService.getAllTokens();
        this.send(ws, {
          type: MESSAGE_TYPES.DATA,
          topic: TOPICS.MARKET_DATA,
          action: 'getAllTokens',
          requestId: message.requestId,
          data: tokens,
          timestamp: new Date().toISOString()
        });
        break;
        
      default:
        this.sendError(ws, `Unknown action for market data: ${message.action}`, 4009);
    }
  }
  
  /**
   * Handle logs requests
   * @param {WebSocket} ws - WebSocket connection
   * @param {Object} message - Parsed message
   */
  async handleLogsRequest(ws, message) {
    switch (message.action) {
      case 'getStatus':
        // Return log system status
        this.send(ws, {
          type: MESSAGE_TYPES.DATA,
          topic: TOPICS.LOGS,
          action: 'getStatus',
          requestId: message.requestId,
          data: {
            status: 'operational',
            version: '1.0.0',
            transport: 'websocket'
          },
          timestamp: new Date().toISOString()
        });
        break;
        
      default:
        this.sendError(ws, `Unknown action for logs: ${message.action}`, 4009);
    }
  }
  
  /**
   * Handle system topic requests
   * @param {WebSocket} ws - WebSocket connection
   * @param {Object} message - Parsed message
   */
  async handleSystemRequest(ws, message) {
    switch (message.action) {
      case 'getStatus':
        // Return system status
        this.send(ws, {
          type: MESSAGE_TYPES.DATA,
          topic: TOPICS.SYSTEM,
          action: 'getStatus',
          requestId: message.requestId,
          data: {
            status: 'operational',
            version: '1.0.0',
            serverTime: new Date().toISOString(),
            uptime: Math.floor((Date.now() - this.startTime) / 1000),
            connections: this.wss.clients.size
          },
          timestamp: new Date().toISOString()
        });
        break;
        
      case 'ping':
        // Send a pong response with server timestamp
        this.send(ws, {
          type: MESSAGE_TYPES.DATA,
          topic: TOPICS.SYSTEM,
          action: 'pong',
          requestId: message.requestId,
          data: {
            serverTime: new Date().toISOString(),
            clientTime: message.clientTime || null,
            roundTrip: message.clientTime ? true : false
          },
          timestamp: new Date().toISOString()
        });
        break;
        
      case 'getMetrics':
        // Return WebSocket metrics (only if authenticated as admin)
        if (!ws.clientInfo.isAuthenticated || 
            !ws.clientInfo.role || 
            !['ADMIN', 'SUPER_ADMIN'].includes(ws.clientInfo.role)) {
          return this.sendError(ws, 'Admin role required for system metrics', 4012);
        }
        
        this.send(ws, {
          type: MESSAGE_TYPES.DATA,
          topic: TOPICS.SYSTEM,
          action: 'getMetrics',
          requestId: message.requestId,
          data: this.getMetrics(),
          timestamp: new Date().toISOString()
        });
        break;
        
      default:
        this.sendError(ws, `Unknown action for system topic: ${message.action}`, 4009);
    }
  }
  
  /**
   * Handle client logs directly sent from client
   * @param {WebSocket} ws - WebSocket connection
   * @param {Object} message - Parsed client log message
   */
  async handleClientLogs(ws, message) {
    try {
      // Extract logs from message
      const { logs } = message;
      
      if (!logs || !Array.isArray(logs) || logs.length === 0) {
        return this.sendError(ws, 'Invalid logs format: logs array is required', 4015);
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
      this.send(ws, {
        type: MESSAGE_TYPES.ACKNOWLEDGMENT,
        topic: TOPICS.LOGS,
        message: 'Logs received',
        count: logs.length,
        timestamp: new Date().toISOString()
      });
      
      // Log summary (debug level to avoid log flooding)
      logApi.debug(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.GREEN}Received ${logs.length} client logs via WebSocket${fancyColors.RESET}`);
    } catch (error) {
      logApi.error(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.RED}Error processing client logs:${fancyColors.RESET}`, error);
    }
  }
  
  /**
   * Handle user data requests
   * @param {WebSocket} ws - WebSocket connection
   * @param {Object} message - Parsed message
   */
  async handleUserRequest(ws, message) {
    // User requests require authentication
    if (!ws.clientInfo.isAuthenticated) {
      return this.sendError(ws, 'Authentication required for user requests', 4013);
    }
    
    switch (message.action) {
      case 'getProfile':
        // Fetch user profile from database
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
          this.send(ws, {
            type: MESSAGE_TYPES.DATA,
            topic: TOPICS.USER,
            action: 'getProfile',
            requestId: message.requestId,
            data: userData,
            timestamp: new Date().toISOString()
          });
        } else {
          this.sendError(ws, 'User profile not found', 4041);
        }
        break;
        
      case 'getStats':
        // Fetch user stats from database
        const userStats = await prisma.user_stats.findUnique({
          where: { user_id: ws.clientInfo.userId },
          select: {
            total_trades: true,
            win_count: true,
            loss_count: true,
            xp: true,
            level: true,
            rank: true,
            last_updated: true
          }
        });
        
        this.send(ws, {
          type: MESSAGE_TYPES.DATA,
          topic: TOPICS.USER,
          action: 'getStats',
          requestId: message.requestId,
          data: userStats || { message: 'No stats available' },
          timestamp: new Date().toISOString()
        });
        break;
        
      case 'getAuthStatus':
        // Fetch comprehensive auth status from API endpoint
        try {
          logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.CYAN}Auth status requested by user ${ws.clientInfo.userId.substring(0, 8)}...${fancyColors.RESET}`);
          
          const authStatusRes = await fetch(`http://localhost:${config.port || process.env.PORT || 3000}/api/auth/status`, {
            method: 'GET',
            headers: {
              'Cookie': `session=${ws.clientInfo._rawToken || ''}`,
              'User-Agent': 'UniWS Internal Request',
              'X-Device-Id': ws.clientInfo.headers['x-device-id'] || message.deviceId || ''
            }
          });
          
          if (authStatusRes.ok) {
            const authStatus = await authStatusRes.json();
            
            // Log summary of auth methods
            const activeAuthMethods = Object.entries(authStatus.methods)
              .filter(([_, info]) => info.active)
              .map(([method]) => method);
              
            logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.CYAN}Auth status sent:${fancyColors.RESET} User ${ws.clientInfo.userId.substring(0, 8)}... is using ${activeAuthMethods.join(', ') || 'no'} auth methods`);
            
            this.send(ws, {
              type: MESSAGE_TYPES.DATA,
              topic: TOPICS.USER,
              action: 'authStatus',
              requestId: message.requestId,
              data: authStatus,
              timestamp: new Date().toISOString()
            });
          } else {
            // Handle error response
            const errorText = await authStatusRes.text();
            logApi.error(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.RED}Auth status API error:${fancyColors.RESET}`, {
              status: authStatusRes.status,
              statusText: authStatusRes.statusText,
              errorText,
              userId: ws.clientInfo.userId
            });
            
            this.sendError(ws, 'Failed to retrieve auth status', 5002);
          }
        } catch (error) {
          logApi.error(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.RED}Error fetching auth status:${fancyColors.RESET}`, error);
          this.sendError(ws, 'Internal error retrieving auth status', 5003);
        }
        break;
        
      default:
        this.sendError(ws, `Unknown action for user data: ${message.action}`, 4009);
    }
  }
  
  /**
   * Handle command requests (actions that change state)
   * @param {WebSocket} ws - WebSocket connection
   * @param {Object} message - Parsed message
   */
  async handleCommand(ws, message) {
    // Commands require authentication
    if (!ws.clientInfo.isAuthenticated) {
      return this.sendError(ws, 'Authentication required for commands', 4013);
    }
    
    // Validate command
    if (!message.topic || !message.action) {
      return this.sendError(ws, 'Command requires topic and action', 4014);
    }
    
    logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.YELLOW}Command received: ${message.topic}/${message.action}${fancyColors.RESET}`);
    
    // Handle command based on topic
    try {
      switch (message.topic) {
        // Implement command handlers for different topics
        
        default:
          this.sendError(ws, `Commands not implemented for topic: ${message.topic}`, 5003);
      }
    } catch (error) {
      logApi.error(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.RED}Error handling command:${fancyColors.RESET}`, error);
      this.sendError(ws, 'Error processing command', 5004);
    }
  }
  
  /**
   * Send initial data for a topic when client subscribes
   * @param {WebSocket} ws - WebSocket connection
   * @param {string} topic - The topic name
   */
  async sendInitialData(ws, topic) {
    try {
      switch (topic) {
        case TOPICS.MARKET_DATA:
          const tokens = await marketDataService.getAllTokens();
          this.send(ws, {
            type: MESSAGE_TYPES.DATA,
            topic: TOPICS.MARKET_DATA,
            data: tokens,
            timestamp: new Date().toISOString(),
            initialData: true
          });
          break;
          
        // Add cases for other topics
          
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
              this.send(ws, {
                type: MESSAGE_TYPES.DATA,
                topic: TOPICS.USER,
                data: userData,
                timestamp: new Date().toISOString(),
                initialData: true
              });
              
              // Also send auth status as part of initial data
              try {
                const authStatusRes = await fetch(`http://localhost:${config.port || process.env.PORT || 3000}/api/auth/status`, {
                  method: 'GET',
                  headers: {
                    'Cookie': `session=${ws.clientInfo._rawToken || ''}`,
                    'User-Agent': 'UniWS Internal Request'
                  }
                });
                
                if (authStatusRes.ok) {
                  const authStatus = await authStatusRes.json();
                  this.send(ws, {
                    type: MESSAGE_TYPES.DATA,
                    topic: TOPICS.USER,
                    action: 'authStatus',
                    data: authStatus,
                    timestamp: new Date().toISOString(),
                    initialData: true
                  });
                  
                  logApi.debug(`${wsColors.tag}[uni-ws]${fancyColors.RESET} Sent initial auth status to user ${ws.clientInfo.userId.substring(0, 8)}...`);
                }
              } catch (error) {
                logApi.error(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.RED}Error fetching auth status:${fancyColors.RESET}`, error);
              }
            }
          }
          break;
          
        case TOPICS.PORTFOLIO:
          if (ws.clientInfo.isAuthenticated) {
            // Fetch and send portfolio data
          }
          break;
      }
    } catch (error) {
      logApi.error(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.RED}Error sending initial data for ${topic}:${fancyColors.RESET}`, error);
    }
  }
  
  /**
   * Handle client disconnection
   * @param {WebSocket} ws - WebSocket connection
   */
  async handleDisconnect(ws) {
    try {
      // Get connection ID and info
      const connectionId = ws.clientInfo?.connectionId || 'UNKNOWN';
      
      // Get connection duration
      const connectedAt = ws.clientInfo?.connectedAt || new Date();
      const disconnectTime = new Date();
      const durationMs = disconnectTime - connectedAt;
      const durationSeconds = Math.floor(durationMs / 1000);
      
      // Format human readable duration
      const humanDuration = durationSeconds < 60 
        ? `${durationSeconds}s` 
        : `${Math.floor(durationSeconds / 60)}m ${durationSeconds % 60}s`;
      
      // Get subscription info before cleanup
      const subscriptions = this.clientSubscriptions.get(ws) || new Set();
      const subscribedTopics = [...subscriptions];
      
      // Clean up client subscriptions
      this.clientSubscriptions.delete(ws);
      
      // Clean up topic subscribers
      for (const [topic, subscribers] of this.topicSubscribers.entries()) {
        subscribers.delete(ws);
        if (subscribers.size === 0) {
          this.topicSubscribers.delete(topic);
        }
      }
      
      // Clean up authenticated client
      const authData = this.authenticatedClients.get(ws);
      let userId = null;
      let nickname = null;
      if (authData) {
        userId = authData.userId;
        nickname = authData.nickname;
        this.authenticatedClients.delete(ws);
        
        // Remove from user's connections
        const userConnections = this.clientsByUserId.get(authData.userId);
        if (userConnections) {
          userConnections.delete(ws);
          if (userConnections.size === 0) {
            this.clientsByUserId.delete(authData.userId);
          }
        }
      }
      
      // Update metrics
      this.metrics.uniqueClients = this.wss.clients.size;
      this.metrics.subscriptions = [...this.clientSubscriptions.values()]
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
            const user = await prisma.users.findUnique({
              where: { wallet_address: userId },
              select: { nickname: true }
            });
            nickname = user?.nickname || null;
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
        connectionId,
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
      
      // Prepare topics list if any exist
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
${disconnectBgColor}${disconnectFgColor}│ ${'Connection:'.padEnd(disconnectFieldWidth)} #${connectionId} (${humanDuration})${' '.repeat(Math.max(0, disconnectMaxValueWidth - connectionId.length - humanDuration.length - 3))}${fancyColors.RESET}
${disconnectBgColor}${disconnectFgColor}│ ${'IP:'.padEnd(disconnectFieldWidth)} ${clientIdentifier}${' '.repeat(Math.max(0, disconnectMaxValueWidth - clientIdentifier.length))}${fancyColors.RESET}
${userId ? `${disconnectBgColor}${disconnectFgColor}│ ${'User:'.padEnd(disconnectFieldWidth)} ${nickname || 'Unknown'} (${userId.slice(0, 6)}...)${' '.repeat(Math.max(0, disconnectMaxValueWidth - (nickname || 'Unknown').length - 11))}${fancyColors.RESET}` : ''}
${subscribedTopics.length > 0 ? `${disconnectBgColor}${disconnectFgColor}│ ${'Topics:'.padEnd(disconnectFieldWidth)} ${topicsList.length > disconnectMaxValueWidth ? topicsList.slice(0, disconnectMaxValueWidth - 3) + '...' : topicsList}${' '.repeat(Math.max(0, disconnectMaxValueWidth - Math.min(topicsList.length, disconnectMaxValueWidth)))}${fancyColors.RESET}` : ''}
${ws.closeCode ? `${disconnectBgColor}${disconnectFgColor}│ ${'Close Code:'.padEnd(disconnectFieldWidth)} ${ws.closeCode}${ws.closeReason ? `: ${ws.closeReason}` : ''}${' '.repeat(Math.max(0, disconnectMaxValueWidth - (ws.closeCode ? `${ws.closeCode}${ws.closeReason ? `: ${ws.closeReason}` : ''}`.length : 0)))}${fancyColors.RESET}` : ''}
${disconnectBgColor}${disconnectFgColor}└${'─'.repeat(disconnectFieldWidth + disconnectMaxValueWidth + 3)}${fancyColors.RESET}`;
      
      // Log the enhanced disconnect format to console
      console.log(disconnectLog);
      
      // Also log through the regular logging system
      logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${wsColors.disconnect}CONN#${connectionId} CLOSE - ${clientIdentifier} (${humanDuration})${userInfo}${topicsSummary}${fancyColors.RESET}`, 
        {
          ...(config.debug_modes.websocket ? fullLogObject : consoleLogObject),
          disconnectLog
        }
      );
      
      // Record disconnect in database
      this.updateConnectionOnDisconnect(connectionId, {
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
   */
  handleError(ws, error) {
    this.metrics.errors++;
    
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
   * Send a message to a specific client
   * @param {WebSocket} ws - WebSocket connection
   * @param {Object} data - Data to send
   */
  send(ws, data) {
    try {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(data));
        this.metrics.messagesSent++;
        
        // Track message count on the connection object for database tracking
        ws.messagesSent = (ws.messagesSent || 0) + 1;
      }
    } catch (error) {
      logApi.error(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.RED}Error sending message:${fancyColors.RESET}`, error);
      this.metrics.errors++;
    }
  }
  
  /**
   * Send an error message to a client
   * @param {WebSocket} ws - WebSocket connection
   * @param {string} message - Error message
   * @param {number} code - Error code
   */
  sendError(ws, message, code = 5000) {
    this.send(ws, {
      type: MESSAGE_TYPES.ERROR,
      message,
      code,
      timestamp: new Date().toISOString()
    });
    this.metrics.errors++;
  }
  
  /**
   * Broadcast message to all subscribers of a topic
   * @param {string} topic - The topic to broadcast to
   * @param {Object} data - The data to broadcast
   */
  broadcastToTopic(topic, data) {
    const subscribers = this.topicSubscribers.get(topic);
    if (!subscribers || subscribers.size === 0) {
      return; // No subscribers
    }
    
    let sentCount = 0;
    
    // Send to each subscriber
    for (const client of subscribers) {
      if (client.readyState === client.OPEN) {
        this.send(client, data);
        sentCount++;
      }
    }
    
    if (sentCount > 0) {
      logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${wsColors.notification}Broadcast to topic ${topic}: ${sentCount} clients${fancyColors.RESET}`, {
        environment: config.getEnvironment(),
        service: 'uni-ws',
        topic: topic,
        clients: sentCount,
        _icon: "📢",
        _color: "#4CAF50"
      });
    }
    
    // Update metrics
    this.metrics.lastActivity = new Date();
  }
  
  /**
   * Send a message to all clients of a specific user
   * @param {string} userId - The user ID
   * @param {Object} data - The data to send
   */
  sendToUser(userId, data) {
    const userClients = this.clientsByUserId.get(userId);
    if (!userClients || userClients.size === 0) {
      return; // User not connected
    }
    
    let sentCount = 0;
    
    // Send to each of the user's connections
    for (const client of userClients) {
      if (client.readyState === client.OPEN) {
        this.send(client, data);
        sentCount++;
      }
    }
    
    if (sentCount > 0) {
      logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${wsColors.message}Sent to user ${userId}: ${sentCount} clients${fancyColors.RESET}`, {
        environment: config.getEnvironment(),
        service: 'uni-ws',
        userId: userId,
        clients: sentCount,
        _icon: "📨",
        _color: "#2196F3"
      });
    }
  }
  
  /**
   * Broadcast a message to all connected clients
   * @param {Object} data - The data to broadcast
   */
  broadcastToAll(data) {
    let sentCount = 0;
    
    for (const client of this.wss.clients) {
      if (client.readyState === client.OPEN) {
        this.send(client, data);
        sentCount++;
      }
    }
    
    if (sentCount > 0) {
      logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.GREEN}Broadcast to all: ${sentCount} clients${fancyColors.RESET}`);
    }
  }
  
  /**
   * Get WebSocket server metrics
   * @returns {Object} - Metrics information
   */
  getMetrics() {
    return {
      connections: {
        total: this.wss.clients.size,
        authenticated: this.authenticatedClients.size
      },
      subscriptions: {
        total: this.metrics.subscriptions,
        byTopic: Object.values(TOPICS).map(topic => ({
          topic,
          subscribers: this.topicSubscribers.get(topic)?.size || 0
        }))
      },
      messages: {
        sent: this.metrics.messagesSent,
        received: this.metrics.messagesReceived,
        errors: this.metrics.errors
      },
      performance: {
        uptime: Math.floor((Date.now() - this.startTime) / 1000),
        lastActivity: this.metrics.lastActivity
      },
      status: 'operational'
    };
  }
  
  /**
   * Initialize the WebSocket server
   * Mainly for compatibility with the WebSocket initialization process
   */
  async initialize() {
    // Start any periodic tasks
    this.startPeriodicalTasks();
    
    logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.GREEN}Unified WebSocket server fully initialized${fancyColors.RESET}`);
    return true;
  }
  
  /**
   * Start periodic maintenance tasks
   */
  startPeriodicalTasks() {
    // Send periodic heartbeats to keep connections alive
    setInterval(() => {
      // Check for clients that haven't received a message in a while
      const now = Date.now();
      
      for (const client of this.wss.clients) {
        if (client.readyState === client.OPEN) {
          // Only send heartbeat if no other message was sent recently
          if (now - (client.lastMessageAt || 0) > 25000) {
            this.send(client, {
              type: MESSAGE_TYPES.SYSTEM,
              action: 'heartbeat',
              timestamp: new Date().toISOString()
            });
            client.lastMessageAt = now;
          }
        }
      }
    }, 30000); // Every 30 seconds
  }
  
  /**
   * Clean up resources
   * Called during server shutdown
   * @returns {Promise<void>} - Resolves when cleanup is complete
   */
  cleanup() {
    return new Promise((resolve, reject) => {
      try {
        logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${wsColors.warning}Cleaning up unified WebSocket server...${fancyColors.RESET}`);
        
        // Remove event listeners
        for (const [eventName, handler] of this.eventHandlers.entries()) {
          serviceEvents.removeListener(eventName, handler);
        }
        
        // First, send shutdown notification to all clients
        logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${wsColors.warning}Sending shutdown notification to all clients...${fancyColors.RESET}`);
        
        const shutdownNotification = {
          type: MESSAGE_TYPES.SYSTEM,
          action: "shutdown",
          message: "Server is restarting, please reconnect in 30 seconds",
          expectedDowntime: 30000,
          timestamp: new Date().toISOString()
        };
        
        // Send notification to each client
        for (const client of this.wss.clients) {
          if (client.readyState === client.OPEN) {
            try {
              client.send(JSON.stringify(shutdownNotification));
            } catch (err) {
              logApi.warn(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.YELLOW}Failed to send shutdown notification to client: ${err.message}${fancyColors.RESET}`);
            }
          }
        }
        
        // Give time for notifications to be delivered (300ms)
        setTimeout(async () => {
          // Close all connections properly with code 1000 (Normal Closure)
          let closedCount = 0;
          const totalClients = this.wss.clients.size;
          
          logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.YELLOW}Gracefully closing ${totalClients} client connections...${fancyColors.RESET}`);
          
          // If no clients, skip to server closure
          if (totalClients === 0) {
            closeServerAndFinish();
            return;
          }
          
          for (const client of this.wss.clients) {
            if (client.readyState === client.OPEN) {
              try {
                // Get user info for enhanced logging
                const clientInfo = client.clientInfo || {};
                const connectionId = clientInfo.connectionId || 'UNKNOWN';
                const ip = clientInfo.ip || 'unknown';
                const userId = clientInfo.userId;
                let nickname = clientInfo.nickname;
                
                // Try to get nickname if we have userId but no nickname
                if (userId && !nickname) {
                  try {
                    const user = await prisma.users.findUnique({
                      where: { wallet_address: userId },
                      select: { nickname: true }
                    });
                    nickname = user?.nickname || null;
                  } catch (dbError) {
                    // Silently continue on DB error
                  }
                }
                
                // Format user info for logging
                const userInfo = userId ? (nickname ? ` "${nickname}" (${userId.slice(0, 6)}...)` : ` ${userId.slice(0, 6)}...`) : '';
                
                // Create a simplified log object for console output
                const consoleLogObject = {
                  connectionId,
                  ip,
                  userId,
                  nickname,
                  reason: "server_shutdown",
                  timestamp: new Date().toISOString(),
                  environment: config.getEnvironment(clientInfo.origin),
                  _icon: "🔌",
                  _color: "#FFA500" // Orange for disconnect
                };
                
                // Create a detailed log object for Logtail with all extra details
                const fullLogObject = {
                  ...consoleLogObject,
                  origin: clientInfo.origin || 'unknown',
                  userAgent: clientInfo.userAgent || 'unknown', 
                  service: 'uni-ws'
                };
                
                // Enhanced log with user info
                logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${wsColors.disconnect}CONN#${connectionId} SHUTDOWN - ${ip}${userInfo}${fancyColors.RESET}`, 
                  config.debug_modes.websocket ? fullLogObject : consoleLogObject
                );
                
                // Use proper WebSocket close code (1000 = normal closure) with reason
                client.close(1000, "Server restarting");
              } catch (err) {
                logApi.warn(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.YELLOW}Failed to gracefully close client: ${err.message}${fancyColors.RESET}`);
                // Fallback to terminate if close fails
                try {
                  client.terminate();
                } catch (termErr) {
                  // Just log and continue
                  logApi.error(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.RED}Failed to terminate client: ${termErr.message}${fancyColors.RESET}`);
                }
              }
              closedCount++;
            }
          }
          
          // Give connections time to close gracefully before closing server (200ms)
          setTimeout(closeServerAndFinish, 200);
          
        }, 300);
        
        // Function to close the server and finish cleanup
        const closeServerAndFinish = () => {
          // Close the WebSocket server
          this.wss.close(() => {
            logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.GREEN}WebSocket server closed${fancyColors.RESET}`);
            
            // Clear all data structures
            this.clientsByUserId.clear();
            this.clientSubscriptions.clear();
            this.topicSubscribers.clear();
            this.authenticatedClients.clear();
            this.eventHandlers.clear();
            
            logApi.info(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.GREEN}Unified WebSocket cleanup complete${fancyColors.RESET}`);
            resolve();
          });
        };
        
      } catch (error) {
        logApi.error(`${wsColors.tag}[uni-ws]${fancyColors.RESET} ${fancyColors.RED}Error during cleanup:${fancyColors.RESET}`, error);
        reject(error);
      }
    });
  }
  
  /**
   * Save WebSocket connection to database
   * @param {string} connectionId - Unique connection identifier
   * @param {Object} connectionData - Connection data
   * @returns {Promise} Database operation result
   */
  async saveConnectionToDatabase(connectionId, connectionData) {
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
   * Update WebSocket connection in database upon disconnection
   * @param {string} connectionId - Unique connection identifier
   * @param {Object} disconnectData - Disconnect data
   * @returns {Promise} Database operation result
   */
  async updateConnectionOnDisconnect(connectionId, disconnectData) {
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
}

/**
 * Create or return the unified WebSocket server instance
 * @param {http.Server} httpServer - HTTP server instance
 * @returns {UnifiedWebSocketServer} WebSocket server instance
 */
export function createUnifiedWebSocket(httpServer) {
  if (!config.websocket.unifiedWebSocket) {
    const ws = new UnifiedWebSocketServer(httpServer);
    // Store in config instead of using global
    config.websocket.unifiedWebSocket = ws;
  }
  return config.websocket.unifiedWebSocket;
}

export { UnifiedWebSocketServer, TOPICS, MESSAGE_TYPES };