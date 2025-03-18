/**
 * Contest WebSocket (v69)
 * 
 * This WebSocket provides real-time contest data and chat functionality:
 * - Contest state updates
 * - Participant status
 * - Leaderboard updates
 * - Contest chat rooms
 * - Spectator functionality
 * - Admin observation capabilities
 */

import { BaseWebSocketServer } from './base-websocket.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import prisma from '../../config/prisma.js';
import { fancyColors } from '../../utils/colors.js';
import serviceEvents from '../../utils/service-suite/service-events.js';

// Log prefix for Contest WebSocket
const LOG_PREFIX = `${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE} CONTEST-WS ${fancyColors.RESET}`;

// Constants for message types
const MESSAGE_TYPES = {
  // Server → Client messages
  CONTEST_STATE: 'contest_state',
  PARTICIPANT_UPDATE: 'participant_update',
  LEADERBOARD_UPDATE: 'leaderboard_update',
  CHAT_MESSAGE: 'chat_message',
  ADMIN_PRESENCE: 'admin_presence',
  SPECTATOR_COUNT: 'spectator_count',
  USER_PRESENCE: 'user_presence',
  ALL_CONTESTS: 'all_contests',
  
  // Client → Server messages
  GET_CONTEST_STATE: 'get_contest_state',
  GET_PARTICIPANT_STATUS: 'get_participant_status',
  GET_LEADERBOARD: 'get_leaderboard',
  SEND_CHAT_MESSAGE: 'send_chat_message',
  JOIN_CONTEST_ROOM: 'join_contest_room',
  LEAVE_CONTEST_ROOM: 'leave_contest_room',
  SET_ADMIN_PRESENCE: 'set_admin_presence',
  GET_ALL_CONTESTS: 'get_all_contests'
};

// Constants for channel prefixes
const CHANNEL_PREFIXES = {
  CONTEST: 'contest', // contest.{contestId}
  PARTICIPANT: 'participant', // participant.{walletAddress}.{contestId}
  LEADERBOARD: 'leaderboard', // leaderboard.{contestId}
  CHAT: 'chat', // chat.{contestId}
  ADMIN: 'admin', // admin.contests
  PUBLIC: 'public', // public.contests for spectators
  USER: 'user' // user.{walletAddress} for user-specific updates
};

/**
 * Contest WebSocket Server
 * Provides real-time contest data, participant status, and chat functionality
 */
class ContestWebSocketServer extends BaseWebSocketServer {
  /**
   * Create a new ContestWebSocketServer
   * @param {http.Server} server - The HTTP server to attach to
   */
  constructor(server) {
    super(server, {
      path: '/api/v69/ws/contest',
      requireAuth: false, // TEMPORARILY disabled auth for testing
      publicEndpoints: ['*'], // ALL endpoints are public for testing
      maxPayload: 256 * 1024, // 256KB for leaderboard data
      rateLimit: 120, // 2 messages per second per client
      heartbeatInterval: 30000, // 30s heartbeat
      perMessageDeflate: false, // Disable compression to avoid frame header issues
      useCompression: false, // Alias for clarity
      authMode: 'query' // Use query auth mode for most reliable browser connections
    });
    
    // Initialize data caches
    this.contestsCache = new Map(); // contestId -> contest data
    this.participantsCache = new Map(); // contestId -> Map of wallet -> participant data
    this.leaderboardCache = new Map(); // contestId -> leaderboard data
    this.chatHistoryCache = new Map(); // contestId -> array of recent messages
    
    // Track room participants
    this.contestRooms = new Map(); // contestId -> Set of user websockets
    this.adminPresence = new Map(); // contestId -> Map of adminId -> visibility
    this.spectatorCounts = new Map(); // contestId -> count
    
    // Track messages per user per contest (for rate limiting chat)
    this.userMessageCounts = new Map(); // wallet -> contestId -> count
    
    // Configure chat settings
    this.chatSettings = {
      messageRateLimit: 10, // 10 messages per minute per user per contest
      messageHistoryLimit: 100, // Store last 100 messages per contest
      messageLengthLimit: 500, // Max 500 characters per message
    };
    
    // Bind event handlers
    this._contestUpdateHandler = this._handleContestUpdate.bind(this);
    this._leaderboardUpdateHandler = this._handleLeaderboardUpdate.bind(this);
    this._participantUpdateHandler = this._handleParticipantUpdate.bind(this);
    this._chatMessageHandler = this._handleChatMessage.bind(this);
    
    // Only keep the chat rate limit interval
    this._chatRateLimitInterval = setInterval(() => {
      this._resetChatRateLimits();
    }, 60000);
    
    logApi.info(`${LOG_PREFIX} ${fancyColors.CYAN}Contest WebSocket initialized on ${fancyColors.BOLD}${this.path}${fancyColors.RESET}`);
  }
  
  /**
   * Register event handlers for real-time data updates
   * @private
   */
  _registerEventHandlers() {
    // Register event handlers for different types of updates
    serviceEvents.on('contest:created', this._contestUpdateHandler);
    serviceEvents.on('contest:updated', this._contestUpdateHandler);
    serviceEvents.on('contest:status', this._contestUpdateHandler);
    
    serviceEvents.on('contest:leaderboard:updated', this._leaderboardUpdateHandler);
    serviceEvents.on('contest:participant:joined', this._participantUpdateHandler);
    serviceEvents.on('contest:participant:updated', this._participantUpdateHandler);
    
    serviceEvents.on('contest:chat:message', this._chatMessageHandler);
    
    logApi.info(`${LOG_PREFIX} ${fancyColors.GREEN}Registered event handlers for real-time updates${fancyColors.RESET}`);
  }
  
  /**
   * Handle contest update event
   * @param {Object} data Contest data
   * @private
   */
  _handleContestUpdate(data) {
    const contestId = data.id;
    
    // Update contest cache
    this.contestsCache.set(contestId, data);
    
    // Broadcast to relevant channels
    this.broadcastToChannel(`contest.${contestId}`, {
      type: MESSAGE_TYPES.CONTEST_UPDATE,
      contestId,
      data
    });
    
    // Also broadcast to public contest channel
    this.broadcastToChannel('public.contests', {
      type: MESSAGE_TYPES.CONTEST_UPDATE,
      contestId,
      data: {
        id: data.id,
        name: data.name,
        description: data.description,
        start_time: data.start_time,
        end_time: data.end_time,
        status: data.status,
        participant_count: data.participant_count
      }
    });
    
    logApi.debug(`${LOG_PREFIX} ${fancyColors.CYAN}Contest ${contestId} updated via event${fancyColors.RESET}`);
  }
  
  /**
   * Handle leaderboard update event
   * @param {Object} data Leaderboard data
   * @private
   */
  _handleLeaderboardUpdate(data) {
    const contestId = data.contestId;
    
    // Update leaderboard cache
    this.leaderboardCache.set(contestId, data.leaderboard);
    
    // Broadcast to leaderboard channel
    this.broadcastToChannel(`leaderboard.${contestId}`, {
      type: MESSAGE_TYPES.LEADERBOARD_UPDATE,
      contestId,
      data: data.leaderboard
    });
    
    logApi.debug(`${LOG_PREFIX} ${fancyColors.CYAN}Leaderboard for contest ${contestId} updated via event${fancyColors.RESET}`);
  }
  
  /**
   * Handle participant update event
   * @param {Object} data Participant data
   * @private
   */
  _handleParticipantUpdate(data) {
    const contestId = data.contestId;
    const walletAddress = data.walletAddress;
    
    // Get or create the participants map for this contest
    let contestParticipants = this.participantsCache.get(contestId);
    if (!contestParticipants) {
      contestParticipants = new Map();
      this.participantsCache.set(contestId, contestParticipants);
    }
    
    // Update participant data
    contestParticipants.set(walletAddress, data);
    
    // Broadcast to participant's personal channel
    this.broadcastToChannel(`participant.${walletAddress}.${contestId}`, {
      type: MESSAGE_TYPES.PARTICIPANT_UPDATE,
      contestId,
      walletAddress,
      data
    });
    
    logApi.debug(`${LOG_PREFIX} ${fancyColors.CYAN}Participant ${walletAddress} in contest ${contestId} updated via event${fancyColors.RESET}`);
  }
  
  /**
   * Handle new chat message event
   * @param {Object} data Chat message data
   * @private
   */
  _handleChatMessage(data) {
    const contestId = data.contestId;
    
    // Get or create chat history for this contest
    let chatHistory = this.chatHistoryCache.get(contestId);
    if (!chatHistory) {
      chatHistory = [];
      this.chatHistoryCache.set(contestId, chatHistory);
    }
    
    // Add new message to history (limited to messageHistoryLimit)
    chatHistory.push(data);
    if (chatHistory.length > this.chatSettings.messageHistoryLimit) {
      chatHistory.shift(); // Remove oldest message
    }
    
    // Broadcast to contest chat channel
    this.broadcastToChannel(`chat.${contestId}`, {
      type: MESSAGE_TYPES.CHAT_MESSAGE,
      contestId,
      data
    });
    
    logApi.debug(`${LOG_PREFIX} ${fancyColors.CYAN}New chat message in contest ${contestId}${fancyColors.RESET}`);
  }
  
  /**
   * Initialize the contest WebSocket
   */
  async onInitialize() {
    try {
      // Load initial contest data
      await this._loadInitialContests();
      
      // Register event handlers for real-time updates
      this._registerEventHandlers();
      
      logApi.info(`${LOG_PREFIX} ${fancyColors.GREEN}${fancyColors.BOLD}Initialization complete${fancyColors.RESET} with ${fancyColors.BOLD}${this.contestsCache.size}${fancyColors.RESET} active contests loaded and event handlers registered`);
      return true;
    } catch (error) {
      logApi.error(`${LOG_PREFIX} ${fancyColors.BG_RED}${fancyColors.WHITE} ERROR ${fancyColors.RESET} ${fancyColors.RED}Initialization failed: ${error.message}${fancyColors.RESET}`, error);
      return false;
    }
  }
  
  /**
   * Load initial contest data from database
   * @private
   */
  async _loadInitialContests() {
    try {
      // Query active contests from database
      const contests = await prisma.contests.findMany({
        where: {
          status: 'active'
        },
        orderBy: [
          { start_time: 'desc' }
        ],
        take: 100 // Limit to 100 contests for initial load
      });
      
      // Initialize caches
      for (const contest of contests) {
        this.contestsCache.set(contest.id, contest);
        
        // Load leaderboard for each contest
        await this._loadLeaderboard(contest.id);
      }
      
      logApi.info(`${LOG_PREFIX} ${fancyColors.GREEN}Loaded ${contests.length} active contests${fancyColors.RESET}`);
      return contests.length;
    } catch (error) {
      logApi.error(`${LOG_PREFIX} ${fancyColors.RED}Failed to load initial contests:${fancyColors.RESET} ${error.message}`, error);
      throw error;
    }
  }
  
  /**
   * Load leaderboard data for a specific contest
   * @param {number} contestId The contest ID
   * @private
   */
  async _loadLeaderboard(contestId) {
    try {
      const leaderboard = await this._fetchLeaderboard(contestId);
      this.leaderboardCache.set(contestId, leaderboard);
      return leaderboard;
    } catch (error) {
      logApi.error(`${LOG_PREFIX} ${fancyColors.RED}Error fetching leaderboard for contest ${contestId}:${fancyColors.RESET} ${error.message}`, error);
      return [];
    }
  }
  
  /**
   * Handle new WebSocket connection
   * @param {WebSocket} ws - The WebSocket connection
   * @param {http.IncomingMessage} req - The HTTP request
   */
  async onConnection(ws, req) {
    const clientInfo = this.clientInfoMap.get(ws);
    if (!clientInfo) return;
    
    // Check if the connection already requested a specific contest channel
    const requestedChannel = clientInfo.requestedChannel;
    const contestId = this._extractContestIdFromChannel(requestedChannel);
    
    // Generate wallet display string
    const walletDisplay = clientInfo.authenticated ? 
                       `${clientInfo.user.role === 'superadmin' || clientInfo.user.role === 'admin' ? 
                         fancyColors.RED : fancyColors.PURPLE}${clientInfo.user.wallet_address.substring(0,8)}...${fancyColors.RESET}` : 
                       `${fancyColors.LIGHT_GRAY}unauthenticated${fancyColors.RESET}`;
    
    const roleDisplay = clientInfo.authenticated ?
                      `${clientInfo.user.role === 'superadmin' || clientInfo.user.role === 'admin' ? 
                        fancyColors.RED : fancyColors.PURPLE}${clientInfo.user.role}${fancyColors.RESET}` :
                      `${fancyColors.LIGHT_GRAY}none${fancyColors.RESET}`;
    
    // Log connection
    logApi.debug(`${LOG_PREFIX} ${fancyColors.CYAN}New connection${fancyColors.RESET} ID:${clientInfo.connectionId.substring(0,8)} ${walletDisplay} role:${roleDisplay} ${contestId ? `contest:${contestId}` : ''}`, {
      connectionId: clientInfo.connectionId,
      authenticated: clientInfo.authenticated,
      wallet: clientInfo.authenticated ? clientInfo.user.wallet_address : 'unauthenticated',
      role: clientInfo.authenticated ? clientInfo.user.role : 'none',
      requestedChannel,
      contestId: contestId || 'none'
    });
    
    // For authenticated users, send welcome message with capabilities
    if (clientInfo.authenticated) {
      this.sendToClient(ws, {
        type: 'welcome',
        message: 'Contest WebSocket Connected',
        capabilities: {
          contests: true,
          chat: true,
          leaderboard: true,
          participant: true,
          admin: ['admin', 'superadmin'].includes(clientInfo.user.role)
        }
      });
      
      // If requested channel is a contest room, join it automatically
      if (contestId) {
        await this._handleJoinContestRoom(ws, { contestId });
      }
      
      // Always subscribe to user's own participant status channel
      if (clientInfo.user.wallet_address) {
        const userChannel = `${CHANNEL_PREFIXES.USER}.${clientInfo.user.wallet_address}`;
        await this.subscribeToChannel(ws, userChannel);
      }
      
      // For admins, also subscribe to admin channel automatically
      if (['admin', 'superadmin'].includes(clientInfo.user.role)) {
        const adminChannel = `${CHANNEL_PREFIXES.ADMIN}.contests`;
        await this.subscribeToChannel(ws, adminChannel);
      }
    } 
    // For unauthenticated (spectator) access
    else if (req.url.includes('public.contests')) {
      // Subscribe to public contest data
      const publicChannel = `${CHANNEL_PREFIXES.PUBLIC}.contests`;
      await this.subscribeToChannel(ws, publicChannel);
      
      // If specific contest requested, subscribe as spectator
      if (contestId) {
        await this._registerSpectator(contestId);
        const contestChannel = `${CHANNEL_PREFIXES.PUBLIC}.contest.${contestId}`;
        await this.subscribeToChannel(ws, contestChannel);
        
        // Send current contest state for spectators
        const contestData = this.contestsCache.get(contestId);
        if (contestData) {
          this.sendToClient(ws, {
            type: MESSAGE_TYPES.CONTEST_STATE,
            contestId,
            data: this._prepareContestDataForSpectator(contestData)
          });
        }
        
        // Send current leaderboard for spectators
        const leaderboardData = this.leaderboardCache.get(contestId);
        if (leaderboardData) {
          this.sendToClient(ws, {
            type: MESSAGE_TYPES.LEADERBOARD_UPDATE,
            contestId,
            data: leaderboardData
          });
        }
      }
    }
  }
  
  /**
   * Handle WebSocket closing
   * @param {WebSocket} ws - The WebSocket connection
   */
  async onClose(ws) {
    const clientInfo = this.clientInfoMap.get(ws);
    if (!clientInfo) return;
    
    try {
      // Leave all contest rooms
      for (const [contestId, participants] of this.contestRooms.entries()) {
        if (participants.has(ws)) {
          await this._handleLeaveContestRoom(ws, { contestId }, true);
        }
      }
      
      // Unregister admin presence
      if (clientInfo.authenticated && ['admin', 'superadmin'].includes(clientInfo.user.role)) {
        for (const [contestId, admins] of this.adminPresence.entries()) {
          if (admins.has(clientInfo.user.wallet_address)) {
            admins.delete(clientInfo.user.wallet_address);
            
            // If no more admins, update the contest
            if (admins.size === 0) {
              this._broadcastAdminPresence(contestId, false);
            }
          }
        }
      }
      
      // Unregister spectator if needed
      for (const [contestId, count] of this.spectatorCounts.entries()) {
        // Check if the client was subscribed to this contest's public channel
        const spectatorChannel = `${CHANNEL_PREFIXES.PUBLIC}.contest.${contestId}`;
        if (clientInfo.subscriptions.has(spectatorChannel)) {
          await this._unregisterSpectator(contestId);
        }
      }
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[ContestWS]${fancyColors.RESET} ${fancyColors.RED}Error handling connection close:${fancyColors.RESET}`, error);
    }
  }
  
  /**
   * Handle messages from clients
   * @param {WebSocket} ws - The WebSocket connection
   * @param {Object} message - The message object
   */
  async onMessage(ws, message) {
    const clientInfo = this.clientInfoMap.get(ws);
    if (!clientInfo) return;
    
    // Handle message based on type
    try {
      switch (message.type) {
        case MESSAGE_TYPES.GET_ALL_CONTESTS:
          await this._handleGetAllContests(ws, clientInfo);
          break;
          
        case MESSAGE_TYPES.GET_CONTEST_STATE:
          await this._handleGetContestState(ws, clientInfo, message);
          break;
          
        case MESSAGE_TYPES.GET_PARTICIPANT_STATUS:
          await this._handleGetParticipantStatus(ws, clientInfo, message);
          break;
          
        case MESSAGE_TYPES.GET_LEADERBOARD:
          await this._handleGetLeaderboard(ws, clientInfo, message);
          break;
          
        case MESSAGE_TYPES.SEND_CHAT_MESSAGE:
          await this._handleSendChatMessage(ws, clientInfo, message);
          break;
          
        case MESSAGE_TYPES.JOIN_CONTEST_ROOM:
          await this._handleJoinContestRoom(ws, message);
          break;
          
        case MESSAGE_TYPES.LEAVE_CONTEST_ROOM:
          await this._handleLeaveContestRoom(ws, message);
          break;
          
        case MESSAGE_TYPES.SET_ADMIN_PRESENCE:
          await this._handleSetAdminPresence(ws, clientInfo, message);
          break;
          
        default:
          this.sendError(ws, 'UNKNOWN_MESSAGE_TYPE', `Unknown message type: ${message.type}`);
          break;
      }
    } catch (error) {
      logApi.error(`${LOG_PREFIX} ${fancyColors.BG_RED}${fancyColors.WHITE} ERROR ${fancyColors.RESET} ${fancyColors.RED}Message handling failed: ${error.message}${fancyColors.RESET}`, error);
      this.sendError(ws, 'INTERNAL_ERROR', 'Error processing message');
    }
  }
  
  /**
   * Handle get all contests request
   * @param {WebSocket} ws - The WebSocket connection
   * @param {Object} clientInfo - Client information
   * @private
   */
  async _handleGetAllContests(ws, clientInfo) {
    // Get all contests from cache
    const contests = [];
    for (const [contestId, contest] of this.contestsCache.entries()) {
      contests.push({
        id: contestId,
        ...this._prepareContestData(contest, clientInfo)
      });
    }
    
    // Send contests to client
    this.sendToClient(ws, {
      type: MESSAGE_TYPES.ALL_CONTESTS,
      data: contests
    });
    
    // Subscribe to all contests updates
    if (clientInfo.authenticated) {
      await this.subscribeToChannel(ws, `${CHANNEL_PREFIXES.PUBLIC}.contests`);
    }
  }
  
  /**
   * Handle get contest state request
   * @param {WebSocket} ws - The WebSocket connection
   * @param {Object} clientInfo - Client information
   * @param {Object} message - The message object
   * @private
   */
  async _handleGetContestState(ws, clientInfo, message) {
    const { contestId } = message;
    if (!contestId) {
      return this.sendError(ws, 'MISSING_CONTEST_ID', 'Contest ID is required');
    }
    
    // Get contest from cache
    const contest = this.contestsCache.get(contestId);
    if (!contest) {
      // If not in cache, try to fetch from database
      try {
        const contestData = await this._fetchContestById(contestId);
        if (contestData) {
          this.contestsCache.set(contestId, contestData);
          
          // Send contest state to client
          this.sendToClient(ws, {
            type: MESSAGE_TYPES.CONTEST_STATE,
            contestId,
            data: this._prepareContestData(contestData, clientInfo)
          });
          
          // Subscribe to contest updates
          await this.subscribeToChannel(ws, `${CHANNEL_PREFIXES.CONTEST}.${contestId}`);
          return;
        }
      } catch (error) {
        logApi.error(`${fancyColors.MAGENTA}[ContestWS]${fancyColors.RESET} ${fancyColors.RED}Error fetching contest:${fancyColors.RESET}`, error);
      }
      
      return this.sendError(ws, 'CONTEST_NOT_FOUND', `Contest ${contestId} not found`);
    }
    
    // Send contest state to client
    this.sendToClient(ws, {
      type: MESSAGE_TYPES.CONTEST_STATE,
      contestId,
      data: this._prepareContestData(contest, clientInfo)
    });
    
    // Subscribe to contest updates
    await this.subscribeToChannel(ws, `${CHANNEL_PREFIXES.CONTEST}.${contestId}`);
  }
  
  /**
   * Handle get participant status request
   * @param {WebSocket} ws - The WebSocket connection
   * @param {Object} clientInfo - Client information
   * @param {Object} message - The message object
   * @private
   */
  async _handleGetParticipantStatus(ws, clientInfo, message) {
    const { contestId, wallet } = message;
    if (!contestId) {
      return this.sendError(ws, 'MISSING_CONTEST_ID', 'Contest ID is required');
    }
    
    // Default to current user if no wallet specified
    const walletAddress = wallet || (clientInfo.authenticated ? clientInfo.user.wallet_address : null);
    
    if (!walletAddress) {
      return this.sendError(ws, 'MISSING_WALLET', 'Wallet address is required');
    }
    
    // Check if user can access this participant data
    if (wallet !== clientInfo.user.wallet_address && !['admin', 'superadmin'].includes(clientInfo.user.role)) {
      return this.sendError(ws, 'UNAUTHORIZED', 'You do not have permission to view this participant data');
    }
    
    // Get participants cache for this contest
    let contestParticipants = this.participantsCache.get(contestId);
    if (!contestParticipants) {
      contestParticipants = new Map();
      this.participantsCache.set(contestId, contestParticipants);
    }
    
    // Get participant from cache
    let participant = contestParticipants.get(walletAddress);
    if (!participant) {
      // If not in cache, try to fetch from database
      try {
        participant = await this._fetchParticipant(contestId, walletAddress);
        if (participant) {
          contestParticipants.set(walletAddress, participant);
        } else {
          participant = { isParticipant: false };
          contestParticipants.set(walletAddress, participant);
        }
      } catch (error) {
        logApi.error(`${fancyColors.MAGENTA}[ContestWS]${fancyColors.RESET} ${fancyColors.RED}Error fetching participant:${fancyColors.RESET}`, error);
        return this.sendError(ws, 'DATABASE_ERROR', 'Error fetching participant data');
      }
    }
    
    // Send participant status to client
    this.sendToClient(ws, {
      type: MESSAGE_TYPES.PARTICIPANT_UPDATE,
      contestId,
      wallet: walletAddress,
      data: participant
    });
    
    // Subscribe to participant updates
    await this.subscribeToChannel(ws, `${CHANNEL_PREFIXES.PARTICIPANT}.${walletAddress}.${contestId}`);
  }
  
  /**
   * Handle get leaderboard request
   * @param {WebSocket} ws - The WebSocket connection
   * @param {Object} clientInfo - Client information
   * @param {Object} message - The message object
   * @private
   */
  async _handleGetLeaderboard(ws, clientInfo, message) {
    const { contestId } = message;
    if (!contestId) {
      return this.sendError(ws, 'MISSING_CONTEST_ID', 'Contest ID is required');
    }
    
    // Get leaderboard from cache
    let leaderboard = this.leaderboardCache.get(contestId);
    if (!leaderboard) {
      // If not in cache, try to fetch from database
      try {
        leaderboard = await this._fetchLeaderboard(contestId);
        if (leaderboard) {
          this.leaderboardCache.set(contestId, leaderboard);
        } else {
          leaderboard = { entries: [] };
          this.leaderboardCache.set(contestId, leaderboard);
        }
      } catch (error) {
        logApi.error(`${fancyColors.MAGENTA}[ContestWS]${fancyColors.RESET} ${fancyColors.RED}Error fetching leaderboard:${fancyColors.RESET}`, error);
        return this.sendError(ws, 'DATABASE_ERROR', 'Error fetching leaderboard data');
      }
    }
    
    // Send leaderboard to client
    this.sendToClient(ws, {
      type: MESSAGE_TYPES.LEADERBOARD_UPDATE,
      contestId,
      data: leaderboard
    });
    
    // Subscribe to leaderboard updates
    await this.subscribeToChannel(ws, `${CHANNEL_PREFIXES.LEADERBOARD}.${contestId}`);
  }
  
  /**
   * Handle send chat message
   * @param {WebSocket} ws - The WebSocket connection
   * @param {Object} clientInfo - Client information
   * @param {Object} message - The message object
   * @private
   */
  async _handleSendChatMessage(ws, clientInfo, message) {
    const { contestId, text } = message;
    if (!contestId) {
      return this.sendError(ws, 'MISSING_CONTEST_ID', 'Contest ID is required');
    }
    
    if (!text) {
      return this.sendError(ws, 'MISSING_MESSAGE_TEXT', 'Message text is required');
    }
    
    // Check that the client is authenticated
    if (!clientInfo.authenticated) {
      logApi.warn(`${LOG_PREFIX} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} CHAT DENIED ${fancyColors.RESET} Unauthenticated user tried to send message to contest ${contestId}`);
      return this.sendError(ws, 'UNAUTHORIZED', 'You must be authenticated to send chat messages');
    }
    
    // Check if user is in the contest room
    const contestRoom = this.contestRooms.get(contestId);
    if (!contestRoom || !contestRoom.has(ws)) {
      logApi.warn(`${LOG_PREFIX} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} CHAT DENIED ${fancyColors.RESET} User ${clientInfo.user.wallet_address.substring(0,8)}... tried to send message to room ${contestId} without joining`);
      return this.sendError(ws, 'NOT_IN_ROOM', 'You must join the contest room to send messages');
    }
    
    // Check message length
    if (text.length > this.chatSettings.messageLengthLimit) {
      logApi.warn(`${LOG_PREFIX} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} CHAT REJECTED ${fancyColors.RESET} Message too long (${text.length}/${this.chatSettings.messageLengthLimit}) from ${clientInfo.user.wallet_address.substring(0,8)}...`);
      return this.sendError(ws, 'MESSAGE_TOO_LONG', `Message too long (max ${this.chatSettings.messageLengthLimit} characters)`);
    }
    
    // Check rate limit for this user
    const walletAddress = clientInfo.user.wallet_address;
    if (!this.userMessageCounts.has(walletAddress)) {
      this.userMessageCounts.set(walletAddress, new Map());
    }
    
    const userContestCounts = this.userMessageCounts.get(walletAddress);
    const count = userContestCounts.get(contestId) || 0;
    
    if (count >= this.chatSettings.messageRateLimit) {
      logApi.warn(`${LOG_PREFIX} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} RATE LIMIT ${fancyColors.RESET} User ${clientInfo.user.wallet_address.substring(0,8)}... exceeded chat rate limit (${count}/${this.chatSettings.messageRateLimit})`);
      return this.sendError(ws, 'RATE_LIMIT_EXCEEDED', 'You are sending messages too quickly');
    }
    
    userContestCounts.set(contestId, count + 1);
    
    // Get user role color for logging
    const roleColor = clientInfo.user.role === 'superadmin' || clientInfo.user.role === 'admin' ? 
                      fancyColors.RED : fancyColors.PURPLE;
    
    // Create the chat message
    const chatMessage = {
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 9),
      contestId,
      sender: {
        wallet: walletAddress,
        nickname: clientInfo.user.nickname || 'Anonymous',
        role: clientInfo.user.role
      },
      text,
      timestamp: new Date().toISOString(),
      isAdmin: ['admin', 'superadmin'].includes(clientInfo.user.role)
    };
    
    // Add to chat history
    let chatHistory = this.chatHistoryCache.get(contestId);
    if (!chatHistory) {
      chatHistory = [];
      this.chatHistoryCache.set(contestId, chatHistory);
    }
    
    chatHistory.push(chatMessage);
    
    // Trim history if needed
    if (chatHistory.length > this.chatSettings.messageHistoryLimit) {
      chatHistory.splice(0, chatHistory.length - this.chatSettings.messageHistoryLimit);
    }
    
    // Log chat message
    logApi.debug(`${LOG_PREFIX} ${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} CHAT ${fancyColors.RESET} ${roleColor}${clientInfo.user.role}${fancyColors.RESET} ${roleColor}${walletAddress.substring(0,8)}...${fancyColors.RESET}: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}" in contest ${contestId}`);
    
    // Broadcast message to all users in the contest room
    this.broadcastToChannel(`${CHANNEL_PREFIXES.CHAT}.${contestId}`, {
      type: MESSAGE_TYPES.CHAT_MESSAGE,
      contestId,
      data: chatMessage
    });
  }
  
  /**
   * Handle join contest room request
   * @param {WebSocket} ws - The WebSocket connection
   * @param {Object} message - The message object
   * @private
   */
  async _handleJoinContestRoom(ws, message) {
    const { contestId } = message;
    if (!contestId) {
      return this.sendError(ws, 'MISSING_CONTEST_ID', 'Contest ID is required');
    }
    
    const clientInfo = this.clientInfoMap.get(ws);
    if (!clientInfo) return;
    
    // Get user role and wallet for logging
    const walletStr = clientInfo.authenticated ? 
                    clientInfo.user.wallet_address.substring(0,8) : 
                    'unauthenticated';
    const roleStr = clientInfo.authenticated ? 
                  clientInfo.user.role : 
                  'none';
    
    // Log room join attempt
    logApi.debug(`${LOG_PREFIX} ${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} ROOM JOIN ${fancyColors.RESET} User ${walletStr} (${roleStr}) attempting to join contest ${contestId}`);
    
    // Check if the contest exists
    const contest = this.contestsCache.get(contestId) || await this._fetchContestById(contestId);
    if (!contest) {
      logApi.warn(`${LOG_PREFIX} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} ROOM DENIED ${fancyColors.RESET} Contest ${contestId} not found for user ${walletStr}`);
      return this.sendError(ws, 'CONTEST_NOT_FOUND', `Contest ${contestId} not found`);
    }
    
    // For authenticated users, check if they're a participant or admin
    let isParticipant = false;
    let isAdmin = false;
    
    if (clientInfo.authenticated) {
      isAdmin = ['admin', 'superadmin'].includes(clientInfo.user.role);
      
      // Check if user is a participant
      if (!isAdmin) {
        // Get participants for this contest
        let contestParticipants = this.participantsCache.get(contestId);
        if (!contestParticipants) {
          contestParticipants = new Map();
          this.participantsCache.set(contestId, contestParticipants);
        }
        
        // Check if user is a participant
        let participant = contestParticipants.get(clientInfo.user.wallet_address);
        if (!participant) {
          // If not in cache, try to fetch from database
          participant = await this._fetchParticipant(contestId, clientInfo.user.wallet_address);
          if (participant) {
            contestParticipants.set(clientInfo.user.wallet_address, participant);
            isParticipant = participant.isParticipant;
          }
        } else {
          isParticipant = participant.isParticipant;
        }
      }
    } else {
      // Unauthenticated users can only be spectators
      isParticipant = false;
    }
    
    // If not admin or participant, check if spectating is allowed for this contest
    const canSpectate = contest.spectators_allowed !== false;
    
    if (!isAdmin && !isParticipant && !canSpectate) {
      logApi.warn(`${LOG_PREFIX} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} ROOM DENIED ${fancyColors.RESET} User ${walletStr} not authorized to join contest ${contestId} (not participant, not admin, spectating disabled)`);
      return this.sendError(ws, 'UNAUTHORIZED', 'You do not have permission to join this contest room');
    }
    
    // Get role color for logging
    const roleColor = clientInfo.authenticated && 
                     (clientInfo.user.role === 'superadmin' || clientInfo.user.role === 'admin') ? 
                     fancyColors.RED : fancyColors.PURPLE;
    
    // Add to contest room
    let contestRoom = this.contestRooms.get(contestId);
    if (!contestRoom) {
      contestRoom = new Set();
      this.contestRooms.set(contestId, contestRoom);
      logApi.info(`${LOG_PREFIX} ${fancyColors.BG_GREEN}${fancyColors.BLACK} ROOM CREATED ${fancyColors.RESET} New room for contest ${contestId} created by ${clientInfo.authenticated ? `${roleColor}${clientInfo.user.role}${fancyColors.RESET} ${roleColor}${walletStr}${fancyColors.RESET}` : 'unauthenticated user'}`);
    }
    
    contestRoom.add(ws);
    
    // Log user's role in the room
    const userType = isAdmin ? `${fancyColors.RED}admin${fancyColors.RESET}` : 
                    isParticipant ? `${fancyColors.PURPLE}participant${fancyColors.RESET}` : 
                    `${fancyColors.LIGHT_GRAY}spectator${fancyColors.RESET}`;
    
    logApi.debug(`${LOG_PREFIX} ${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} ROOM JOINED ${fancyColors.RESET} User ${clientInfo.authenticated ? `${roleColor}${walletStr}${fancyColors.RESET}` : 'unauthenticated'} joined contest ${contestId} as ${userType}`);
    
    // Subscribe to relevant channels
    await this.subscribeToChannel(ws, `${CHANNEL_PREFIXES.CONTEST}.${contestId}`);
    await this.subscribeToChannel(ws, `${CHANNEL_PREFIXES.LEADERBOARD}.${contestId}`);
    await this.subscribeToChannel(ws, `${CHANNEL_PREFIXES.CHAT}.${contestId}`);
    
    // For participants, also subscribe to their participant status
    if (clientInfo.authenticated) {
      await this.subscribeToChannel(ws, `${CHANNEL_PREFIXES.PARTICIPANT}.${clientInfo.user.wallet_address}.${contestId}`);
    }
    
    // For admins, track their presence
    if (isAdmin && clientInfo.authenticated) {
      const visibility = message.visibility || 'invisible';
      await this._setAdminPresence(contestId, clientInfo.user.wallet_address, visibility);
      
      // Log admin visibility
      if (visibility === 'visible') {
        logApi.info(`${LOG_PREFIX} ${fancyColors.BG_RED}${fancyColors.WHITE} ADMIN VISIBLE ${fancyColors.RESET} Admin ${walletStr} is now visible in contest ${contestId}`);
      } else {
        logApi.debug(`${LOG_PREFIX} ${fancyColors.BG_DARK_RED}${fancyColors.WHITE} ADMIN HIDDEN ${fancyColors.RESET} Admin ${walletStr} joined invisibly in contest ${contestId}`);
      }
    }
    
    // For spectators, increment count
    if (!isParticipant && !isAdmin) {
      await this._registerSpectator(contestId);
      logApi.debug(`${LOG_PREFIX} ${fancyColors.BG_LIGHT_GRAY}${fancyColors.BLACK} SPECTATOR ${fancyColors.RESET} New spectator in contest ${contestId}, count: ${this.spectatorCounts.get(contestId) || 1}`);
    }
    
    // Send contest state
    this.sendToClient(ws, {
      type: MESSAGE_TYPES.CONTEST_STATE,
      contestId,
      data: this._prepareContestData(contest, clientInfo)
    });
    
    // Send chat history if available
    const chatHistory = this.chatHistoryCache.get(contestId);
    if (chatHistory && chatHistory.length > 0) {
      logApi.debug(`${LOG_PREFIX} ${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} CHAT HISTORY ${fancyColors.RESET} Sending ${Math.min(chatHistory.length, 20)} messages to ${clientInfo.authenticated ? walletStr : 'unauthenticated'}`);
      
      // Send last 20 messages only
      const recentMessages = chatHistory.slice(-20);
      
      for (const chatMessage of recentMessages) {
        this.sendToClient(ws, {
          type: MESSAGE_TYPES.CHAT_MESSAGE,
          contestId,
          data: chatMessage
        });
      }
    }
    
    // Send leaderboard
    const leaderboard = this.leaderboardCache.get(contestId);
    if (leaderboard) {
      this.sendToClient(ws, {
        type: MESSAGE_TYPES.LEADERBOARD_UPDATE,
        contestId,
        data: leaderboard
      });
    }
    
    // If participant, send participant status
    if (clientInfo.authenticated) {
      const participantData = await this._getParticipantData(contestId, clientInfo.user.wallet_address);
      if (participantData) {
        this.sendToClient(ws, {
          type: MESSAGE_TYPES.PARTICIPANT_UPDATE,
          contestId,
          wallet: clientInfo.user.wallet_address,
          data: participantData
        });
      }
    }
    
    // Broadcast user presence
    this._broadcastUserPresence(contestId, clientInfo, 'join');
  }
  
  /**
   * Handle leave contest room request
   * @param {WebSocket} ws - The WebSocket connection
   * @param {Object} message - The message object
   * @param {boolean} fromClose - Whether this is triggered from connection close
   * @private
   */
  async _handleLeaveContestRoom(ws, message, fromClose = false) {
    const { contestId } = message;
    if (!contestId) {
      if (!fromClose) {
        return this.sendError(ws, 'MISSING_CONTEST_ID', 'Contest ID is required');
      }
      return;
    }
    
    const clientInfo = this.clientInfoMap.get(ws);
    if (!clientInfo) return;
    
    // Get user role and wallet for logging
    const walletStr = clientInfo.authenticated ? 
                    clientInfo.user.wallet_address.substring(0,8) : 
                    'unauthenticated';
    const roleStr = clientInfo.authenticated ? 
                  clientInfo.user.role : 
                  'none';
    
    // Get role color for logging
    const roleColor = clientInfo.authenticated && 
                     (clientInfo.user.role === 'superadmin' || clientInfo.user.role === 'admin') ? 
                     fancyColors.RED : fancyColors.PURPLE;
    
    // Log room leave
    logApi.debug(`${LOG_PREFIX} ${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} ROOM LEAVE ${fancyColors.RESET} User ${clientInfo.authenticated ? `${roleColor}${walletStr}${fancyColors.RESET}` : 'unauthenticated'} leaving contest ${contestId}`);
    
    // Remove from contest room
    const contestRoom = this.contestRooms.get(contestId);
    if (contestRoom) {
      contestRoom.delete(ws);
      
      // If no more users in the room, remove the room
      if (contestRoom.size === 0) {
        this.contestRooms.delete(contestId);
        logApi.debug(`${LOG_PREFIX} ${fancyColors.BG_DARK_YELLOW}${fancyColors.BLACK} ROOM CLOSED ${fancyColors.RESET} Last user left contest ${contestId}, room removed`);
      } else {
        logApi.debug(`${LOG_PREFIX} ${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} ROOM UPDATE ${fancyColors.RESET} Contest ${contestId} has ${contestRoom.size} remaining users`);
      }
    }
    
    // Unsubscribe from channels
    if (!fromClose) {
      await this.unsubscribeFromChannel(ws, `${CHANNEL_PREFIXES.CONTEST}.${contestId}`);
      await this.unsubscribeFromChannel(ws, `${CHANNEL_PREFIXES.LEADERBOARD}.${contestId}`);
      await this.unsubscribeFromChannel(ws, `${CHANNEL_PREFIXES.CHAT}.${contestId}`);
      
      if (clientInfo.authenticated) {
        await this.unsubscribeFromChannel(ws, `${CHANNEL_PREFIXES.PARTICIPANT}.${clientInfo.user.wallet_address}.${contestId}`);
      }
    }
    
    // For admins, update presence
    if (clientInfo.authenticated && ['admin', 'superadmin'].includes(clientInfo.user.role)) {
      const wasVisible = await this._isAdminVisible(contestId, clientInfo.user.wallet_address);
      await this._removeAdminPresence(contestId, clientInfo.user.wallet_address);
      
      if (wasVisible) {
        logApi.info(`${LOG_PREFIX} ${fancyColors.BG_RED}${fancyColors.WHITE} ADMIN LEFT ${fancyColors.RESET} Visible admin ${walletStr} left contest ${contestId}`);
      } else {
        logApi.debug(`${LOG_PREFIX} ${fancyColors.BG_DARK_RED}${fancyColors.WHITE} ADMIN LEFT ${fancyColors.RESET} Hidden admin ${walletStr} left contest ${contestId}`);
      }
    }
    
    // For spectators, decrement count
    const isAdmin = clientInfo.authenticated && ['admin', 'superadmin'].includes(clientInfo.user.role);
    const participantData = clientInfo.authenticated 
      ? await this._getParticipantData(contestId, clientInfo.user.wallet_address)
      : null;
    const isParticipant = participantData?.isParticipant || false;
    
    if (!isParticipant && !isAdmin) {
      const oldCount = this.spectatorCounts.get(contestId) || 0;
      await this._unregisterSpectator(contestId);
      const newCount = this.spectatorCounts.get(contestId) || 0;
      logApi.debug(`${LOG_PREFIX} ${fancyColors.BG_LIGHT_GRAY}${fancyColors.BLACK} SPECTATOR LEFT ${fancyColors.RESET} Spectator left contest ${contestId}, count: ${oldCount} → ${newCount}`);
    }
    
    // Broadcast user presence
    this._broadcastUserPresence(contestId, clientInfo, 'leave');
    
    // Confirm to client if not from close
    if (!fromClose) {
      this.sendToClient(ws, {
        type: 'contest_room_left',
        contestId
      });
    }
  }
  
  /**
   * Handle set admin presence request
   * @param {WebSocket} ws - The WebSocket connection
   * @param {Object} clientInfo - Client information
   * @param {Object} message - The message object
   * @private
   */
  async _handleSetAdminPresence(ws, clientInfo, message) {
    const { contestId, visibility } = message;
    if (!contestId) {
      return this.sendError(ws, 'MISSING_CONTEST_ID', 'Contest ID is required');
    }
    
    // Check that the client is authenticated and an admin
    if (!clientInfo.authenticated) {
      return this.sendError(ws, 'UNAUTHORIZED', 'You must be authenticated to set admin presence');
    }
    
    if (!['admin', 'superadmin'].includes(clientInfo.user.role)) {
      return this.sendError(ws, 'UNAUTHORIZED', 'Only admins can set admin presence');
    }
    
    // Check if the user is in the contest room
    const contestRoom = this.contestRooms.get(contestId);
    if (!contestRoom || !contestRoom.has(ws)) {
      return this.sendError(ws, 'NOT_IN_ROOM', 'You must join the contest room to set admin presence');
    }
    
    // Set admin presence
    await this._setAdminPresence(contestId, clientInfo.user.wallet_address, visibility || 'invisible');
    
    // Confirm to client
    this.sendToClient(ws, {
      type: 'admin_presence_updated',
      contestId,
      visibility: visibility || 'invisible'
    });
  }
  
  /**
   * Set admin presence for a contest
   * @param {string} contestId - Contest ID
   * @param {string} adminWallet - Admin wallet address
   * @param {string} visibility - Visibility ('visible' or 'invisible')
   * @private
   */
  async _setAdminPresence(contestId, adminWallet, visibility) {
    // Get admin presence map for this contest
    let contestAdmins = this.adminPresence.get(contestId);
    if (!contestAdmins) {
      contestAdmins = new Map();
      this.adminPresence.set(contestId, contestAdmins);
    }
    
    // Check previous visibility state
    const previousVisibility = contestAdmins.get(adminWallet);
    const isVisibilityChange = previousVisibility !== visibility;
    
    // Set visibility for this admin
    contestAdmins.set(adminWallet, visibility);
    
    // Check if any admin is visible
    const hasVisibleAdmin = Array.from(contestAdmins.values()).includes('visible');
    
    // Log visibility change
    if (isVisibilityChange && visibility === 'visible') {
      logApi.info(`${LOG_PREFIX} ${fancyColors.BG_RED}${fancyColors.WHITE} ADMIN VISIBLE ${fancyColors.RESET} Admin ${adminWallet.substring(0,8)}... became visible in contest ${contestId}`);
    } else if (isVisibilityChange && visibility === 'invisible') {
      logApi.info(`${LOG_PREFIX} ${fancyColors.BG_DARK_RED}${fancyColors.WHITE} ADMIN HIDDEN ${fancyColors.RESET} Admin ${adminWallet.substring(0,8)}... became invisible in contest ${contestId}`);
    }
    
    // Broadcast admin presence to room
    this._broadcastAdminPresence(contestId, hasVisibleAdmin);
  }
  
  /**
   * Remove admin presence for a contest
   * @param {string} contestId - Contest ID
   * @param {string} adminWallet - Admin wallet address
   * @private
   */
  async _removeAdminPresence(contestId, adminWallet) {
    // Get admin presence map for this contest
    const contestAdmins = this.adminPresence.get(contestId);
    if (!contestAdmins) return;
    
    // Remove this admin
    contestAdmins.delete(adminWallet);
    
    // If no more admins, update the contest
    if (contestAdmins.size === 0) {
      this.adminPresence.delete(contestId);
      this._broadcastAdminPresence(contestId, false);
    } else {
      // Check if any admin is visible
      const hasVisibleAdmin = Array.from(contestAdmins.values()).includes('visible');
      
      // Broadcast admin presence to room
      this._broadcastAdminPresence(contestId, hasVisibleAdmin);
    }
  }
  
  /**
   * Register a spectator for a contest
   * @param {string} contestId - Contest ID
   * @private
   */
  async _registerSpectator(contestId) {
    const count = this.spectatorCounts.get(contestId) || 0;
    const newCount = count + 1;
    this.spectatorCounts.set(contestId, newCount);
    
    // Broadcast updated spectator count
    this._broadcastSpectatorCount(contestId);
    
    // Log milestone spectator counts
    if (count === 0 || count % 10 === 9) { // Log at 1, 10, 20, etc.
      logApi.info(`${LOG_PREFIX} ${fancyColors.BG_LIGHT_GRAY}${fancyColors.BLACK} SPECTATORS ${fancyColors.RESET} Contest ${contestId} now has ${fancyColors.BOLD}${newCount}${fancyColors.RESET} spectator${newCount !== 1 ? 's' : ''}`);
    }
    
    return newCount;
  }
  
  /**
   * Unregister a spectator for a contest
   * @param {string} contestId - Contest ID
   * @returns {number} New spectator count
   * @private
   */
  async _unregisterSpectator(contestId) {
    const count = this.spectatorCounts.get(contestId) || 0;
    if (count > 0) {
      const newCount = count - 1;
      this.spectatorCounts.set(contestId, newCount);
      
      // Broadcast updated spectator count
      this._broadcastSpectatorCount(contestId);
      
      // Log milestone spectator counts (for significant decreases)
      if (count % 10 === 0 && count > 0) { // Log at transitions from 10→9, 20→19, etc.
        logApi.info(`${LOG_PREFIX} ${fancyColors.BG_LIGHT_GRAY}${fancyColors.BLACK} SPECTATORS ${fancyColors.RESET} Contest ${contestId} now has ${fancyColors.BOLD}${newCount}${fancyColors.RESET} spectator${newCount !== 1 ? 's' : ''}`);
      }
      
      return newCount;
    }
    
    return 0;
  }
  
  /**
   * Broadcast spectator count for a contest
   * @param {string} contestId - Contest ID
   * @private
   */
  _broadcastSpectatorCount(contestId) {
    const count = this.spectatorCounts.get(contestId) || 0;
    
    // Only broadcast if there are subscribers
    const channelName = `${CHANNEL_PREFIXES.CONTEST}.${contestId}`;
    const subscribers = this.channelSubscriptions.get(channelName);
    
    if (subscribers && subscribers.size > 0) {
      logApi.debug(`${LOG_PREFIX} ${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} BROADCAST ${fancyColors.RESET} Sending spectator count ${count} to ${subscribers.size} subscribers in contest ${contestId}`);
      
      this.broadcastToChannel(channelName, {
        type: MESSAGE_TYPES.SPECTATOR_COUNT,
        contestId,
        count
      });
    }
  }
  
  /**
   * Broadcast admin presence for a contest
   * @param {string} contestId - Contest ID
   * @param {boolean} hasVisibleAdmin - Whether any admin is visible
   * @private
   */
  _broadcastAdminPresence(contestId, hasVisibleAdmin) {
    // Only broadcast if there are subscribers and state has changed
    const channelName = `${CHANNEL_PREFIXES.CONTEST}.${contestId}`;
    const subscribers = this.channelSubscriptions.get(channelName);
    
    if (subscribers && subscribers.size > 0) {
      logApi.debug(`${LOG_PREFIX} ${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} BROADCAST ${fancyColors.RESET} Admin presence ${hasVisibleAdmin ? `${fancyColors.RED}visible${fancyColors.RESET}` : 'hidden'} in contest ${contestId} to ${subscribers.size} subscribers`);
      
      this.broadcastToChannel(channelName, {
        type: MESSAGE_TYPES.ADMIN_PRESENCE,
        contestId,
        active: hasVisibleAdmin
      });
    }
  }
  
  /**
   * Broadcast user presence update
   * @param {string} contestId - Contest ID
   * @param {Object} clientInfo - Client information
   * @param {string} action - Action ('join' or 'leave')
   * @private
   */
  _broadcastUserPresence(contestId, clientInfo, action) {
    // Only broadcast for authenticated users who are not admins
    if (!clientInfo.authenticated) return;
    
    // Get user role color for logging
    const roleColor = clientInfo.user.role === 'superadmin' || clientInfo.user.role === 'admin' ? 
                     fancyColors.RED : fancyColors.PURPLE;
    
    // For admins, check visibility setting
    if (['admin', 'superadmin'].includes(clientInfo.user.role)) {
      const contestAdmins = this.adminPresence.get(contestId);
      if (!contestAdmins) return;
      
      const visibility = contestAdmins.get(clientInfo.user.wallet_address);
      if (visibility !== 'visible') {
        logApi.debug(`${LOG_PREFIX} ${fancyColors.BG_DARK_RED}${fancyColors.WHITE} HIDDEN ADMIN ${fancyColors.RESET} Not broadcasting ${action} event for hidden admin ${clientInfo.user.wallet_address.substring(0,8)}...`);
        return;
      }
      
      // If admin is visible, log it
      logApi.debug(`${LOG_PREFIX} ${fancyColors.BG_RED}${fancyColors.WHITE} ADMIN PRESENCE ${fancyColors.RESET} Broadcasting ${action} event for visible admin ${clientInfo.user.wallet_address.substring(0,8)}...`);
    } else {
      // Log regular user presence update
      logApi.debug(`${LOG_PREFIX} ${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} USER PRESENCE ${fancyColors.RESET} Broadcasting ${action} event for ${roleColor}${clientInfo.user.wallet_address.substring(0,8)}...${fancyColors.RESET}`);
    }
    
    // Only broadcast if there are subscribers
    const channelName = `${CHANNEL_PREFIXES.CONTEST}.${contestId}`;
    const subscribers = this.channelSubscriptions.get(channelName);
    
    if (subscribers && subscribers.size > 0) {
      this.broadcastToChannel(channelName, {
        type: MESSAGE_TYPES.USER_PRESENCE,
        contestId,
        action,
        user: {
          wallet: clientInfo.user.wallet_address,
          nickname: clientInfo.user.nickname || 'Anonymous',
          timestamp: new Date().toISOString()
        }
      });
    }
  }
  
  /**
   * Update active contests
   * @private
   */
  async _updateActiveContests() {
    try {
      // Fetch active contests from database
      const contests = await this._fetchActiveContests();
      
      // Update cache
      for (const contest of contests) {
        const existingContest = this.contestsCache.get(contest.id.toString());
        
        // If contest is new or updated, update cache and broadcast
        if (!existingContest || existingContest.updated_at !== contest.updated_at) {
          this.contestsCache.set(contest.id.toString(), contest);
          
          // Broadcast contest update
          this.broadcastToChannel(`${CHANNEL_PREFIXES.CONTEST}.${contest.id}`, {
            type: MESSAGE_TYPES.CONTEST_STATE,
            contestId: contest.id.toString(),
            data: this._prepareContestDataForBroadcast(contest)
          });
          
          // Also broadcast to public contests channel
          this.broadcastToChannel(`${CHANNEL_PREFIXES.PUBLIC}.contests`, {
            type: MESSAGE_TYPES.CONTEST_STATE,
            contestId: contest.id.toString(),
            data: this._prepareContestDataForSpectator(contest)
          });
        }
      }
      
      // Check for contests that were removed
      for (const [contestId, cachedContest] of this.contestsCache.entries()) {
        if (!contests.some(c => c.id.toString() === contestId)) {
          // Contest no longer active, remove from cache
          this.contestsCache.delete(contestId);
          
          // Broadcast contest removal
          this.broadcastToChannel(`${CHANNEL_PREFIXES.CONTEST}.${contestId}`, {
            type: 'contest_removed',
            contestId
          });
          
          // Also broadcast to public contests channel
          this.broadcastToChannel(`${CHANNEL_PREFIXES.PUBLIC}.contests`, {
            type: 'contest_removed',
            contestId
          });
        }
      }
      
      // Log update
      logApi.debug(`${LOG_PREFIX} ${fancyColors.CYAN}Updated ${fancyColors.BOLD}${contests.length}${fancyColors.RESET}${fancyColors.CYAN} active contests${fancyColors.RESET}`);
    } catch (error) {
      logApi.error(`${LOG_PREFIX} ${fancyColors.BG_RED}${fancyColors.WHITE} ERROR ${fancyColors.RESET} ${fancyColors.RED}Failed to update active contests: ${error.message}${fancyColors.RESET}`, error);
    }
  }
  
  /**
   * Update leaderboards for active contests
   * @private
   */
  async _updateLeaderboards() {
    try {
      // For each active contest, update leaderboard
      for (const contestId of this.contestsCache.keys()) {
        try {
          // Fetch leaderboard from database
          const leaderboard = await this._fetchLeaderboard(contestId);
          
          if (leaderboard) {
            // Update cache
            this.leaderboardCache.set(contestId, leaderboard);
            
            // Broadcast leaderboard update
            this.broadcastToChannel(`${CHANNEL_PREFIXES.LEADERBOARD}.${contestId}`, {
              type: MESSAGE_TYPES.LEADERBOARD_UPDATE,
              contestId,
              data: leaderboard
            });
            
            // Also broadcast to public channel
            this.broadcastToChannel(`${CHANNEL_PREFIXES.PUBLIC}.contest.${contestId}`, {
              type: MESSAGE_TYPES.LEADERBOARD_UPDATE,
              contestId,
              data: leaderboard
            });
          }
        } catch (error) {
          logApi.error(`${LOG_PREFIX} ${fancyColors.BG_RED}${fancyColors.WHITE} ERROR ${fancyColors.RESET} ${fancyColors.RED}Leaderboard update failed for contest ${contestId}: ${error.message}${fancyColors.RESET}`, error);
        }
      }
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[ContestWS]${fancyColors.RESET} ${fancyColors.RED}Error updating leaderboards:${fancyColors.RESET}`, error);
    }
  }
  
  /**
   * Update spectator counts
   * @private
   */
  async _updateSpectatorCounts() {
    try {
      // For each contest with spectators, broadcast count
      for (const contestId of this.spectatorCounts.keys()) {
        this._broadcastSpectatorCount(contestId);
      }
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[ContestWS]${fancyColors.RESET} ${fancyColors.RED}Error updating spectator counts:${fancyColors.RESET}`, error);
    }
  }
  
  /**
   * Reset chat rate limits
   * @private
   */
  async _resetChatRateLimits() {
    try {
      // Clear all message counts
      this.userMessageCounts.clear();
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[ContestWS]${fancyColors.RESET} ${fancyColors.RED}Error resetting chat rate limits:${fancyColors.RESET}`, error);
    }
  }
  
  /**
   * Extract contest ID from channel name
   * @param {string} channel - Channel name
   * @returns {string|null} - Contest ID or null if not a contest channel
   * @private
   */
  _extractContestIdFromChannel(channel) {
    if (!channel) return null;
    
    // Handle different channel formats
    if (channel.startsWith(`${CHANNEL_PREFIXES.CONTEST}.`)) {
      return channel.substring(CHANNEL_PREFIXES.CONTEST.length + 1);
    }
    
    if (channel.startsWith(`${CHANNEL_PREFIXES.PUBLIC}.contest.`)) {
      return channel.substring(CHANNEL_PREFIXES.PUBLIC.length + 9); // +9 for ".contest."
    }
    
    return null;
  }
  
  /**
   * Prepare contest data for client
   * @param {Object} contest - Contest data
   * @param {Object} clientInfo - Client information
   * @returns {Object} - Prepared contest data
   * @private
   */
  _prepareContestData(contest, clientInfo) {
    // Default preparation for authenticated users
    if (clientInfo.authenticated) {
      // For admins, include all data
      if (['admin', 'superadmin'].includes(clientInfo.user.role)) {
        return {
          ...contest,
          hasAdminPresence: this._hasVisibleAdminPresence(contest.id),
          spectatorCount: this.spectatorCounts.get(contest.id) || 0,
          participantCount: this._getParticipantCount(contest.id)
        };
      }
      
      // For regular users, exclude sensitive data
      return {
        id: contest.id,
        name: contest.name,
        description: contest.description,
        start_time: contest.start_time,
        end_time: contest.end_time,
        status: contest.status,
        prize_pool: contest.prize_pool,
        entry_fee: contest.entry_fee,
        participant_limit: contest.participant_limit,
        tokenIds: contest.tokenIds || [],
        rules: contest.rules,
        hasAdminPresence: this._hasVisibleAdminPresence(contest.id),
        spectatorCount: this.spectatorCounts.get(contest.id) || 0,
        participantCount: this._getParticipantCount(contest.id)
      };
    }
    
    // For unauthenticated users, return public data only
    return this._prepareContestDataForSpectator(contest);
  }
  
  /**
   * Prepare contest data for broadcasting to all subscribers
   * @param {Object} contest - Contest data
   * @returns {Object} - Prepared contest data
   * @private
   */
  _prepareContestDataForBroadcast(contest) {
    // Include everything except sensitive admin data
    return {
      id: contest.id,
      name: contest.name,
      description: contest.description,
      start_time: contest.start_time,
      end_time: contest.end_time,
      status: contest.status,
      prize_pool: contest.prize_pool,
      entry_fee: contest.entry_fee,
      participant_limit: contest.participant_limit,
      tokenIds: contest.tokenIds || [],
      rules: contest.rules,
      hasAdminPresence: this._hasVisibleAdminPresence(contest.id),
      spectatorCount: this.spectatorCounts.get(contest.id) || 0,
      participantCount: this._getParticipantCount(contest.id),
      updated_at: contest.updated_at
    };
  }
  
  /**
   * Prepare contest data for spectators (public data only)
   * @param {Object} contest - Contest data
   * @returns {Object} - Prepared contest data
   * @private
   */
  _prepareContestDataForSpectator(contest) {
    return {
      id: contest.id,
      name: contest.name,
      description: contest.description,
      start_time: contest.start_time,
      end_time: contest.end_time,
      status: contest.status,
      prize_pool: contest.prize_pool,
      tokenIds: contest.tokenIds || [],
      hasAdminPresence: this._hasVisibleAdminPresence(contest.id),
      spectatorCount: this.spectatorCounts.get(contest.id) || 0,
      participantCount: this._getParticipantCount(contest.id)
    };
  }
  
  /**
   * Check if a contest has visible admin presence
   * @param {string} contestId - Contest ID
   * @returns {boolean} - Whether any admin is visible
   * @private
   */
  _hasVisibleAdminPresence(contestId) {
    const contestAdmins = this.adminPresence.get(contestId);
    if (!contestAdmins) return false;
    
    return Array.from(contestAdmins.values()).includes('visible');
  }
  
  /**
   * Check if a specific admin is visible in a contest
   * @param {string} contestId - Contest ID
   * @param {string} adminWallet - Admin wallet address
   * @returns {boolean} - Whether the admin is visible
   * @private
   */
  async _isAdminVisible(contestId, adminWallet) {
    const contestAdmins = this.adminPresence.get(contestId);
    if (!contestAdmins) return false;
    
    return contestAdmins.get(adminWallet) === 'visible';
  }
  
  /**
   * Get participant count for a contest
   * @param {string} contestId - Contest ID
   * @returns {number} - Participant count
   * @private
   */
  _getParticipantCount(contestId) {
    const participants = this.participantsCache.get(contestId);
    if (!participants) return 0;
    
    // Count only actual participants
    let count = 0;
    for (const participant of participants.values()) {
      if (participant.isParticipant) {
        count++;
      }
    }
    
    return count;
  }
  
  /**
   * Get participant data for a user in a contest
   * @param {string} contestId - Contest ID
   * @param {string} walletAddress - User wallet address
   * @returns {Object} - Participant data
   * @private
   */
  async _getParticipantData(contestId, walletAddress) {
    // Get participants cache for this contest
    let contestParticipants = this.participantsCache.get(contestId);
    if (!contestParticipants) {
      contestParticipants = new Map();
      this.participantsCache.set(contestId, contestParticipants);
    }
    
    // Get participant from cache
    let participant = contestParticipants.get(walletAddress);
    if (!participant) {
      // If not in cache, try to fetch from database
      try {
        participant = await this._fetchParticipant(contestId, walletAddress);
        if (participant) {
          contestParticipants.set(walletAddress, participant);
        } else {
          participant = { isParticipant: false };
          contestParticipants.set(walletAddress, participant);
        }
      } catch (error) {
        logApi.error(`${fancyColors.MAGENTA}[ContestWS]${fancyColors.RESET} ${fancyColors.RED}Error fetching participant:${fancyColors.RESET}`, error);
        return { isParticipant: false, error: 'Error fetching participant data' };
      }
    }
    
    return participant;
  }
  
  /**
   * Fetch active contests from database
   * @returns {Promise<Array>} - Array of contest objects
   * @private
   */
  async _fetchActiveContests() {
    try {
      // Fetch active contests from database
      const contests = await prisma.contests.findMany({
        where: {
          OR: [
            { status: 'active' },
            { status: 'pending' },
            {
              status: 'completed',
              end_time: {
                // Keep completed contests in cache for 24 hours
                gte: new Date(Date.now() - 24 * 60 * 60 * 1000)
              }
            }
          ]
        },
        orderBy: {
          start_time: 'desc'
        }
      });
      
      // Convert BigInt IDs to strings
      return contests.map(contest => ({
        ...contest,
        id: contest.id.toString()
      }));
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[ContestWS]${fancyColors.RESET} ${fancyColors.RED}Error fetching active contests:${fancyColors.RESET}`, error);
      return [];
    }
  }
  
  /**
   * Fetch a contest by ID from database
   * @param {string} contestId - Contest ID
   * @returns {Promise<Object>} - Contest object
   * @private
   */
  async _fetchContestById(contestId) {
    try {
      // Fetch contest from database
      const contest = await prisma.contests.findUnique({
        where: {
          id: BigInt(contestId)
        }
      });
      
      if (!contest) return null;
      
      // Convert BigInt ID to string
      return {
        ...contest,
        id: contest.id.toString()
      };
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[ContestWS]${fancyColors.RESET} ${fancyColors.RED}Error fetching contest ${contestId}:${fancyColors.RESET}`, error);
      return null;
    }
  }
  
  /**
   * Fetch participant data from database
   * @param {string} contestId - Contest ID
   * @param {string} walletAddress - User wallet address
   * @returns {Promise<Object>} - Participant data
   * @private
   */
  async _fetchParticipant(contestId, walletAddress) {
    try {
      // Fetch participant from database
      const participant = await prisma.contest_participants.findUnique({
        where: {
          contest_id_wallet_address: {
            contest_id: parseInt(contestId, 10),
            wallet_address: walletAddress
          }
        }
      });
      
      if (!participant) return { isParticipant: false };
      
      // Format participant data
      return {
        isParticipant: true,
        entryTime: participant.created_at,
        walletAddress: participant.wallet_address,
        status: participant.status,
        initialBalance: participant.initial_balance,
        // Only include portfolio value on joined contests
        portfolioValue: participant.portfolio_value
      };
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[ContestWS]${fancyColors.RESET} ${fancyColors.RED}Error fetching participant for contest ${contestId}, wallet ${walletAddress}:${fancyColors.RESET}`, error);
      return { isParticipant: false, error: 'Error fetching participant data' };
    }
  }
  
  /**
   * Fetch leaderboard for a contest
   * @param {string} contestId - Contest ID
   * @returns {Promise<Object>} - Leaderboard data
   * @private
   */
  async _fetchLeaderboard(contestId) {
    try {
      // Fetch leaderboard from database
      const participants = await prisma.contest_participants.findMany({
        where: {
          contest_id: parseInt(contestId, 10),
          status: 'active'
        },
        orderBy: [
          {
            portfolio_value: 'desc' // Sort by portfolio value first (highest first)
          },
          {
            entry_time: 'asc' // Break ties by entry time (earliest first)
          }
        ],
        select: {
          wallet_address: true,
          portfolio_value: true,
          initial_balance: true,
          entry_time: true,
          users: {
            select: {
              nickname: true
            }
          }
        }
      });
      
      // Calculate ranks and returns
      const entries = participants.map((participant, index) => {
        // Calculate return
        const initialBalance = parseFloat(participant.initial_balance) || 0;
        const currentValue = parseFloat(participant.portfolio_value) || 0;
        const returnPct = initialBalance > 0 
          ? ((currentValue - initialBalance) / initialBalance) * 100
          : 0;
        
        return {
          rank: index + 1,
          wallet: participant.wallet_address,
          nickname: participant.users?.nickname || 'Anonymous',
          value: currentValue,
          returnPct: parseFloat(returnPct.toFixed(2)),
          entryTime: participant.created_at
        };
      });
      
      return {
        contestId,
        entries,
        updatedAt: new Date().toISOString()
      };
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[ContestWS]${fancyColors.RESET} ${fancyColors.RED}Error fetching leaderboard for contest ${contestId}:${fancyColors.RESET}`, error);
      return null;
    }
  }
  
  /**
   * Clean up resources before shutdown
   */
  async onCleanup() {
    // Remove event listeners
    serviceEvents.removeListener('contest:created', this._contestUpdateHandler);
    serviceEvents.removeListener('contest:updated', this._contestUpdateHandler);
    serviceEvents.removeListener('contest:status', this._contestUpdateHandler);
    
    serviceEvents.removeListener('contest:leaderboard:updated', this._leaderboardUpdateHandler);
    serviceEvents.removeListener('contest:participant:joined', this._participantUpdateHandler);
    serviceEvents.removeListener('contest:participant:updated', this._participantUpdateHandler);
    
    serviceEvents.removeListener('contest:chat:message', this._chatMessageHandler);
    
    // Clear remaining interval
    if (this._chatRateLimitInterval) {
      clearInterval(this._chatRateLimitInterval);
      this._chatRateLimitInterval = null;
    }
    
    // Clear caches
    const contestCount = this.contestsCache.size;
    const participantCount = Array.from(this.participantsCache.values()).reduce((acc, map) => acc + map.size, 0);
    const chatCount = Array.from(this.chatHistoryCache.values()).reduce((acc, arr) => acc + arr.length, 0);
    
    this.contestsCache.clear();
    this.participantsCache.clear();
    this.leaderboardCache.clear();
    this.chatHistoryCache.clear();
    this.contestRooms.clear();
    this.adminPresence.clear();
    this.spectatorCounts.clear();
    this.userMessageCounts.clear();
    
    logApi.info(`${LOG_PREFIX} ${fancyColors.GREEN}Cleanup complete${fancyColors.RESET} - cleared ${contestCount} contests, ${participantCount} participants, ${chatCount} chat messages`);
  }
  
  /**
   * Get server metrics for monitoring
   * @returns {Object} - Server metrics
   */
  getMetrics() {
    return {
      name: 'Contest WebSocket v69',
      status: 'operational',
      metrics: {
        ...this.stats,
        contests: this.contestsCache.size,
        participants: Array.from(this.participantsCache.values()).reduce((count, participants) => count + participants.size, 0),
        chatMessages: Array.from(this.chatHistoryCache.values()).reduce((count, messages) => count + messages.length, 0),
        contestRooms: this.contestRooms.size,
        adminPresenceCount: this.adminPresence.size,
        spectatorCount: Array.from(this.spectatorCounts.values()).reduce((count, value) => count + value, 0),
        channels: {
          contests: this.channelSubscriptions.get(`${CHANNEL_PREFIXES.PUBLIC}.contests`)?.size || 0,
          admin: this.channelSubscriptions.get(`${CHANNEL_PREFIXES.ADMIN}.contests`)?.size || 0
        },
        lastUpdate: new Date().toISOString()
      }
    };
  }
}

// Export singleton instance
let instance = null;

/**
 * Create contest WebSocket server instance
 * @param {http.Server} server - HTTP server
 * @returns {ContestWebSocketServer} - Contest WebSocket server instance
 */
export function createContestWebSocket(server) {
  if (!instance) {
    instance = new ContestWebSocketServer(server);
  }
  return instance;
}

export { ContestWebSocketServer };
export default instance;