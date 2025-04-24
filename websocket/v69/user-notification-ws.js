/**
 * @deprecated This implementation is deprecated and will be removed in a future release.
 * Please use the new Unified WebSocket System instead, which provides the same functionality
 * with a more maintainable architecture.
 * 
 * Migration Guide:
 * 1. Use the unified endpoint instead: /api/v69/ws
 * 2. Subscribe to the 'user' topic
 * 3. See /websocket/v69/unified/ for the new implementation
 * 4. See /websocket/v69/transition-examples/README.md for detailed migration steps
 *
 * User Notification WebSocket (v69)
 * 
 * This WebSocket provides real-time user notifications including:
 * - Level-up events
 * - Achievement unlocks
 * - Contest invitations
 * - System announcements
 * - Profile updates
 * 
 * It delivers notifications stored in the websocket_messages table
 * and enables clients to mark messages as read.
 */

import { BaseWebSocketServer } from './base-websocket.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import prisma from '../../config/prisma.js';
import { fancyColors } from '../../utils/colors.js';

// Log prefix for User Notification WebSocket
const LOG_PREFIX = `${fancyColors.BG_DARK_MAGENTA}${fancyColors.WHITE} NOTIFICATION-WS ${fancyColors.RESET}`;

// Constants for message types
const MESSAGE_TYPES = {
  // Server → Client messages
  NOTIFICATION: 'notification',
  NOTIFICATION_BATCH: 'notification_batch',
  UNREAD_COUNT: 'unread_count',
  READ_CONFIRMED: 'read_confirmed',
  
  // Client → Server messages
  MARK_READ: 'mark_read',
  MARK_ALL_READ: 'mark_all_read',
  GET_UNREAD: 'get_unread',
  GET_NOTIFICATIONS: 'get_notifications'
};

// Constants for notification types
const NOTIFICATION_TYPES = {
  LEVEL_UP: 'LEVEL_UP',
  ACHIEVEMENT_UNLOCK: 'ACHIEVEMENT_UNLOCK',
  CONTEST_INVITE: 'CONTEST_INVITE',
  SYSTEM_ANNOUNCEMENT: 'SYSTEM_ANNOUNCEMENT',
  PROFILE_UPDATE: 'PROFILE_UPDATE'
};

// Constants for channel names
const CHANNELS = {
  USER_NOTIFICATIONS: 'user.notifications', // user.notifications.{walletAddress}
  SYSTEM_ANNOUNCEMENTS: 'system.announcements' // Public announcements channel
};

/**
 * User Notification WebSocket Server
 * Provides real-time notification delivery and management
 */
class UserNotificationWebSocketServer extends BaseWebSocketServer {
  /**
   * Create a new UserNotificationWebSocketServer
   * @param {http.Server} server - The HTTP server to attach to
   */
  constructor(server) {
    super(server, {
      path: '/api/v69/ws/notifications',
      requireAuth: true,
      publicEndpoints: [CHANNELS.SYSTEM_ANNOUNCEMENTS],
      maxPayload: 128 * 1024, // 128KB should be plenty
      rateLimit: 60, // 1 message per second
      heartbeatInterval: 30000, // 30s heartbeat
      authMode: 'query' // Use query auth mode for most reliable browser connections
    });
    
    // Initialize data caches
    this.userUnreadCountCache = new Map();
    this.userNotificationsCache = new Map();
    this.announcementsCache = [];
    
    // Track polling interval
    this.pollingInterval = null;
    this.lastCleanup = null;
    
    // Metrics for monitoring
    this.metrics = {
      messagesDelivered: 0,
      messagesFailed: 0,
      unreadMessages: 0, 
      totalPolls: 0,
      cleanups: 0,
      deliveryLatencyMs: 0,
      // Stats by message type
      byType: {
        LEVEL_UP: { delivered: 0, pending: 0 },
        ACHIEVEMENT_UNLOCK: { delivered: 0, pending: 0 },
        CONTEST_INVITE: { delivered: 0, pending: 0 },
        SYSTEM_ANNOUNCEMENT: { delivered: 0, pending: 0 },
        PROFILE_UPDATE: { delivered: 0, pending: 0 }
      }
    };
    
    // Schedule regular updates and cleanup
    this._setupDataUpdateIntervals();
    
    logApi.info(`${LOG_PREFIX} ${fancyColors.CYAN}User Notification WebSocket initialized on ${fancyColors.BOLD}${this.path}${fancyColors.RESET}`);
  }
  
  /**
   * Set up regular data update intervals
   * @private
   */
  _setupDataUpdateIntervals() {
    // Poll for undelivered messages every 5 seconds
    this.pollingInterval = setInterval(() => {
      this._deliverPendingMessages();
      this.metrics.totalPolls++;
    }, 5000);
    
    // Clean up old messages every 24 hours
    this.cleanupInterval = setInterval(() => {
      this._cleanupOldMessages();
    }, 24 * 60 * 60 * 1000);
    
    // Update unread counts every minute
    this.unreadCountInterval = setInterval(() => {
      this._updateUnreadCounts();
    }, 60 * 1000);
  }
  
  /**
   * Initialize the notification WebSocket
   */
  async onInitialize() {
    try {
      // Load initial data
      await Promise.all([
        this._loadSystemAnnouncements(),
        this._updateUnreadCounts()
      ]);
      
      logApi.info(`${LOG_PREFIX} ${fancyColors.GREEN}${fancyColors.BOLD}Initialization complete${fancyColors.RESET} - notification system ready`);
      return true;
    } catch (error) {
      logApi.error(`${LOG_PREFIX} ${fancyColors.BG_RED}${fancyColors.WHITE} ERROR ${fancyColors.RESET} ${fancyColors.RED}Initialization failed: ${error.message}${fancyColors.RESET}`, error);
      return false;
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
    logApi.debug(`${LOG_PREFIX} ${fancyColors.CYAN}New connection${fancyColors.RESET} ID:${clientInfo.connectionId.substring(0,8)} ${walletDisplay} role:${roleDisplay}`, {
      connectionId: clientInfo.connectionId,
      authenticated: clientInfo.authenticated,
      wallet: clientInfo.authenticated ? clientInfo.user.wallet_address : 'unauthenticated',
      role: clientInfo.authenticated ? clientInfo.user.role : 'none'
    });
    
    // If this is a public endpoint access only, restrict subscription capabilities
    if (!clientInfo.authenticated && req.url.includes(CHANNELS.SYSTEM_ANNOUNCEMENTS)) {
      // Subscribe to the system announcements channel automatically
      await this.subscribeToChannel(ws, CHANNELS.SYSTEM_ANNOUNCEMENTS);
      
      // Send recent system announcements
      if (this.announcementsCache.length > 0) {
        this.sendToClient(ws, {
          type: MESSAGE_TYPES.NOTIFICATION_BATCH,
          subtype: 'announcements',
          data: this.announcementsCache.slice(-5) // Last 5 announcements
        });
      }
      
      return;
    }
    
    // For authenticated users, send welcome message and setup channels
    if (clientInfo.authenticated) {
      // Send welcome message with capabilities
      this.sendToClient(ws, {
        type: 'welcome',
        message: 'Notification WebSocket Connected',
        capabilities: {
          notifications: true,
          unreadCount: true,
          markRead: true
        }
      });
      
      // Subscribe to user's notification channel
      const userNotificationChannel = `${CHANNELS.USER_NOTIFICATIONS}.${clientInfo.user.wallet_address}`;
      await this.subscribeToChannel(ws, userNotificationChannel);
      
      // Subscribe to system announcements
      await this.subscribeToChannel(ws, CHANNELS.SYSTEM_ANNOUNCEMENTS);
      
      // Send unread count
      const unreadCount = this.userUnreadCountCache.get(clientInfo.user.wallet_address) || 0;
      this.sendToClient(ws, {
        type: MESSAGE_TYPES.UNREAD_COUNT,
        count: unreadCount
      });
      
      // Send recent system announcements
      if (this.announcementsCache.length > 0) {
        this.sendToClient(ws, {
          type: MESSAGE_TYPES.NOTIFICATION_BATCH,
          subtype: 'announcements',
          data: this.announcementsCache.slice(-5) // Last 5 announcements
        });
      }
      
      // Schedule delivery of unread notifications
      setTimeout(() => {
        this._sendUnreadNotifications(ws, clientInfo.user.wallet_address);
      }, 500);
      
      logApi.debug(`${LOG_PREFIX} ${fancyColors.CYAN}User ${walletDisplay} subscribed to notifications${fancyColors.RESET}`);
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
        case MESSAGE_TYPES.MARK_READ:
          await this._handleMarkRead(ws, clientInfo, message);
          break;
          
        case MESSAGE_TYPES.MARK_ALL_READ:
          await this._handleMarkAllRead(ws, clientInfo);
          break;
          
        case MESSAGE_TYPES.GET_UNREAD:
          await this._handleGetUnread(ws, clientInfo);
          break;
          
        case MESSAGE_TYPES.GET_NOTIFICATIONS:
          await this._handleGetNotifications(ws, clientInfo, message);
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
   * Handle mark notification as read
   * @param {WebSocket} ws - The WebSocket connection
   * @param {Object} clientInfo - Client information
   * @param {Object} message - The message object
   * @private
   */
  async _handleMarkRead(ws, clientInfo, message) {
    if (!clientInfo.authenticated) {
      return this.sendError(ws, 'UNAUTHORIZED', 'Authentication required');
    }
    
    if (!message.id) {
      return this.sendError(ws, 'MISSING_ID', 'Notification ID is required');
    }
    
    try {
      const walletAddress = clientInfo.user.wallet_address;
      
      // Mark message as read in database
      const result = await prisma.websocket_messages.updateMany({
        where: {
          id: message.id,
          wallet_address: walletAddress
        },
        data: {
          read: true,
          read_at: new Date()
        }
      });
      
      if (result.count > 0) {
        // Update unread count in cache
        const currentCount = this.userUnreadCountCache.get(walletAddress) || 0;
        if (currentCount > 0) {
          this.userUnreadCountCache.set(walletAddress, currentCount - 1);
        }
        
        // Send updated unread count
        this.sendToClient(ws, {
          type: MESSAGE_TYPES.UNREAD_COUNT,
          count: this.userUnreadCountCache.get(walletAddress) || 0
        });
        
        // Confirm to client
        this.sendToClient(ws, {
          type: MESSAGE_TYPES.READ_CONFIRMED,
          id: message.id
        });
        
        logApi.debug(`${LOG_PREFIX} ${fancyColors.CYAN}User ${walletAddress.substring(0,8)}... marked notification ${message.id} as read${fancyColors.RESET}`);
      } else {
        this.sendError(ws, 'NOTIFICATION_NOT_FOUND', 'Notification not found or already read');
      }
    } catch (error) {
      logApi.error(`${LOG_PREFIX} ${fancyColors.RED}Error marking notification as read: ${error.message}${fancyColors.RESET}`, error);
      this.sendError(ws, 'DATABASE_ERROR', 'Error updating notification status');
    }
  }
  
  /**
   * Handle mark all notifications as read
   * @param {WebSocket} ws - The WebSocket connection
   * @param {Object} clientInfo - Client information
   * @private
   */
  async _handleMarkAllRead(ws, clientInfo) {
    if (!clientInfo.authenticated) {
      return this.sendError(ws, 'UNAUTHORIZED', 'Authentication required');
    }
    
    try {
      const walletAddress = clientInfo.user.wallet_address;
      
      // Mark all messages as read in database
      const result = await prisma.websocket_messages.updateMany({
        where: {
          wallet_address: walletAddress,
          read: false,
          delivered: true
        },
        data: {
          read: true,
          read_at: new Date()
        }
      });
      
      // Reset unread count in cache
      this.userUnreadCountCache.set(walletAddress, 0);
      
      // Send updated unread count
      this.sendToClient(ws, {
        type: MESSAGE_TYPES.UNREAD_COUNT,
        count: 0
      });
      
      // Confirm to client
      this.sendToClient(ws, {
        type: 'all_read_confirmed',
        count: result.count
      });
      
      logApi.debug(`${LOG_PREFIX} ${fancyColors.CYAN}User ${walletAddress.substring(0,8)}... marked all (${result.count}) notifications as read${fancyColors.RESET}`);
    } catch (error) {
      logApi.error(`${LOG_PREFIX} ${fancyColors.RED}Error marking all notifications as read: ${error.message}${fancyColors.RESET}`, error);
      this.sendError(ws, 'DATABASE_ERROR', 'Error updating notification status');
    }
  }
  
  /**
   * Handle get unread notifications
   * @param {WebSocket} ws - The WebSocket connection
   * @param {Object} clientInfo - Client information
   * @private
   */
  async _handleGetUnread(ws, clientInfo) {
    if (!clientInfo.authenticated) {
      return this.sendError(ws, 'UNAUTHORIZED', 'Authentication required');
    }
    
    const walletAddress = clientInfo.user.wallet_address;
    await this._sendUnreadNotifications(ws, walletAddress);
  }
  
  /**
   * Handle get notifications (with filter options)
   * @param {WebSocket} ws - The WebSocket connection
   * @param {Object} clientInfo - Client information
   * @param {Object} message - The message object with filter options
   * @private
   */
  async _handleGetNotifications(ws, clientInfo, message) {
    if (!clientInfo.authenticated) {
      return this.sendError(ws, 'UNAUTHORIZED', 'Authentication required');
    }
    
    try {
      const walletAddress = clientInfo.user.wallet_address;
      const limit = Math.min(message.limit || 20, 50); // Maximum 50 messages per request
      const offset = message.offset || 0;
      const types = message.types || Object.values(NOTIFICATION_TYPES);
      const onlyUnread = message.onlyUnread === true;
      
      // Build query
      const where = {
        wallet_address: walletAddress,
        delivered: true,
        type: {
          in: types
        }
      };
      
      // Add unread filter if requested
      if (onlyUnread) {
        where.read = false;
      }
      
      // Query notifications
      const notifications = await prisma.websocket_messages.findMany({
        where,
        orderBy: {
          timestamp: 'desc'
        },
        skip: offset,
        take: limit
      });
      
      // Send notifications to client
      this.sendToClient(ws, {
        type: MESSAGE_TYPES.NOTIFICATION_BATCH,
        data: notifications.map(notification => ({
          id: notification.id,
          type: notification.type,
          data: notification.data,
          timestamp: notification.timestamp,
          read: notification.read,
          read_at: notification.read_at
        })),
        count: notifications.length,
        hasMore: notifications.length === limit
      });
      
      logApi.debug(`${LOG_PREFIX} ${fancyColors.CYAN}Sent ${notifications.length} notifications to ${walletAddress.substring(0,8)}...${fancyColors.RESET}`);
    } catch (error) {
      logApi.error(`${LOG_PREFIX} ${fancyColors.RED}Error fetching notifications: ${error.message}${fancyColors.RESET}`, error);
      this.sendError(ws, 'DATABASE_ERROR', 'Error fetching notifications');
    }
  }
  
  /**
   * Send unread notifications to a client
   * @param {WebSocket} ws - The WebSocket connection
   * @param {string} walletAddress - User wallet address
   * @private
   */
  async _sendUnreadNotifications(ws, walletAddress) {
    try {
      // Query unread notifications
      const unreadNotifications = await prisma.websocket_messages.findMany({
        where: {
          wallet_address: walletAddress,
          delivered: true,
          read: false
        },
        orderBy: {
          timestamp: 'desc'
        },
        take: 20 // Limit to most recent 20
      });
      
      if (unreadNotifications.length > 0) {
        // Send notifications in batch
        this.sendToClient(ws, {
          type: MESSAGE_TYPES.NOTIFICATION_BATCH,
          subtype: 'unread',
          data: unreadNotifications.map(notification => ({
            id: notification.id,
            type: notification.type,
            data: notification.data,
            timestamp: notification.timestamp
          })),
          count: unreadNotifications.length,
          hasMore: unreadNotifications.length === 20
        });
        
        logApi.debug(`${LOG_PREFIX} ${fancyColors.CYAN}Sent ${unreadNotifications.length} unread notifications to ${walletAddress.substring(0,8)}...${fancyColors.RESET}`);
      }
    } catch (error) {
      logApi.error(`${LOG_PREFIX} ${fancyColors.RED}Error sending unread notifications: ${error.message}${fancyColors.RESET}`, error);
    }
  }
  
  /**
   * Load recent system announcements from database
   * @private
   */
  async _loadSystemAnnouncements() {
    try {
      // Query recent system announcements (broadcast messages)
      const announcements = await prisma.websocket_messages.findMany({
        where: {
          type: NOTIFICATION_TYPES.SYSTEM_ANNOUNCEMENT,
          wallet_address: {
            equals: 'BROADCAST' // Special marker for broadcast messages
          }
        },
        orderBy: {
          timestamp: 'desc'
        },
        take: 10 // Keep 10 most recent
      });
      
      // Update cache
      this.announcementsCache = announcements.map(announcement => ({
        id: announcement.id,
        type: announcement.type,
        data: announcement.data,
        timestamp: announcement.timestamp
      }));
      
      logApi.debug(`${LOG_PREFIX} ${fancyColors.CYAN}Loaded ${announcements.length} system announcements${fancyColors.RESET}`);
    } catch (error) {
      logApi.error(`${LOG_PREFIX} ${fancyColors.RED}Error loading system announcements: ${error.message}${fancyColors.RESET}`, error);
    }
  }
  
  /**
   * Update unread notification counts for all users
   * @private
   */
  async _updateUnreadCounts() {
    try {
      // Get counts of unread messages by wallet
      const unreadCounts = await prisma.$queryRaw`
        SELECT wallet_address, COUNT(*) as count
        FROM websocket_messages
        WHERE delivered = true AND read = false
        GROUP BY wallet_address
      `;
      
      // Update cache
      for (const result of unreadCounts) {
        const wallet = result.wallet_address;
        const count = Number(result.count);
        
        if (wallet && wallet !== 'BROADCAST') {
          this.userUnreadCountCache.set(wallet, count);
        }
      }
      
      // Calculate total unread
      let totalUnread = 0;
      for (const count of this.userUnreadCountCache.values()) {
        totalUnread += count;
      }
      this.metrics.unreadMessages = totalUnread;
      
      logApi.debug(`${LOG_PREFIX} ${fancyColors.CYAN}Updated unread counts for ${unreadCounts.length} users, total ${totalUnread} unread messages${fancyColors.RESET}`);
      
      // Broadcast updates to connected clients
      for (const [wallet, count] of this.userUnreadCountCache.entries()) {
        const channel = `${CHANNELS.USER_NOTIFICATIONS}.${wallet}`;
        this.broadcastToChannel(channel, {
          type: MESSAGE_TYPES.UNREAD_COUNT,
          count
        });
      }
    } catch (error) {
      logApi.error(`${LOG_PREFIX} ${fancyColors.RED}Error updating unread counts: ${error.message}${fancyColors.RESET}`, error);
    }
  }
  
  /**
   * Deliver pending messages to connected clients
   * @private
   */
  async _deliverPendingMessages() {
    const startTime = Date.now();
    
    try {
      // Find undelivered messages
      const pendingMessages = await prisma.websocket_messages.findMany({
        where: {
          delivered: false,
          type: {
            in: Object.values(NOTIFICATION_TYPES)
          },
          timestamp: {
            // Only messages from the last 7 days
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
          }
        },
        orderBy: {
          timestamp: 'asc'
        },
        take: 100 // Limit batch size
      });
      
      if (pendingMessages.length === 0) return;
      
      logApi.debug(`${LOG_PREFIX} ${fancyColors.CYAN}Found ${pendingMessages.length} pending notifications to deliver${fancyColors.RESET}`);
      
      // Update metrics for pending messages
      for (const msg of pendingMessages) {
        if (this.metrics.byType[msg.type]) {
          this.metrics.byType[msg.type].pending++;
        }
      }
      
      // Group messages by wallet
      const messagesByWallet = {};
      const broadcastMessages = [];
      
      for (const message of pendingMessages) {
        // Handle broadcast messages separately
        if (message.wallet_address === 'BROADCAST') {
          broadcastMessages.push(message);
          continue;
        }
        
        // Group messages by wallet
        if (!messagesByWallet[message.wallet_address]) {
          messagesByWallet[message.wallet_address] = [];
        }
        messagesByWallet[message.wallet_address].push(message);
      }
      
      // Deliver messages to each wallet's channel
      const deliveredIds = [];
      
      // First handle broadcast messages
      if (broadcastMessages.length > 0) {
        // Add to announcements cache
        this.announcementsCache = [
          ...this.announcementsCache,
          ...broadcastMessages.map(announcement => ({
            id: announcement.id,
            type: announcement.type,
            data: announcement.data,
            timestamp: announcement.timestamp
          }))
        ].slice(-10); // Keep only 10 most recent
        
        // Broadcast to all subscribers
        for (const message of broadcastMessages) {
          this.broadcastToChannel(CHANNELS.SYSTEM_ANNOUNCEMENTS, {
            type: MESSAGE_TYPES.NOTIFICATION,
            id: message.id,
            notificationType: message.type,
            data: message.data,
            timestamp: message.timestamp
          });
          
          deliveredIds.push(message.id);
          this.metrics.messagesDelivered++;
          
          if (this.metrics.byType[message.type]) {
            this.metrics.byType[message.type].delivered++;
            this.metrics.byType[message.type].pending--;
          }
          
          logApi.info(`${LOG_PREFIX} ${fancyColors.BG_LIGHT_MAGENTA}${fancyColors.BLACK} BROADCAST ${fancyColors.RESET} Delivered ${message.type} announcement to all users`);
        }
      }
      
      // Then handle user-specific messages
      for (const [wallet, messages] of Object.entries(messagesByWallet)) {
        const channel = `${CHANNELS.USER_NOTIFICATIONS}.${wallet}`;
        
        // Check if channel has subscribers
        const subscribers = this.channelSubscriptions.get(channel);
        const isUserConnected = subscribers && subscribers.size > 0;
        
        for (const message of messages) {
          if (isUserConnected) {
            // User is connected, deliver message
            this.broadcastToChannel(channel, {
              type: MESSAGE_TYPES.NOTIFICATION,
              id: message.id,
              notificationType: message.type,
              data: message.data,
              timestamp: message.timestamp
            });
            
            this.metrics.messagesDelivered++;
          }
          
          // Mark as delivered regardless of whether user is connected
          deliveredIds.push(message.id);
          
          // Update metrics
          if (this.metrics.byType[message.type]) {
            this.metrics.byType[message.type].delivered++;
            this.metrics.byType[message.type].pending--;
          }
          
          // Log delivery
          const logColor = isUserConnected ? fancyColors.GREEN : fancyColors.YELLOW;
          const logPrefix = isUserConnected ? 'DELIVERED' : 'QUEUED';
          logApi.debug(`${LOG_PREFIX} ${fancyColors.BG_DARK_MAGENTA}${fancyColors.WHITE} ${logPrefix} ${fancyColors.RESET} ${logColor}${message.type}${fancyColors.RESET} to ${wallet.substring(0,8)}...`);
        }
        
        // Update unread count for this wallet
        const currentCount = this.userUnreadCountCache.get(wallet) || 0;
        const newCount = currentCount + messages.length;
        this.userUnreadCountCache.set(wallet, newCount);
        
        // If user is connected, send updated unread count
        if (isUserConnected) {
          this.broadcastToChannel(channel, {
            type: MESSAGE_TYPES.UNREAD_COUNT,
            count: newCount
          });
        }
      }
      
      // Mark messages as delivered in database
      if (deliveredIds.length > 0) {
        await prisma.websocket_messages.updateMany({
          where: {
            id: {
              in: deliveredIds
            }
          },
          data: {
            delivered: true,
            delivered_at: new Date()
          }
        });
        
        logApi.info(`${LOG_PREFIX} ${fancyColors.GREEN}Marked ${deliveredIds.length} notifications as delivered${fancyColors.RESET}`);
      }
      
      // Update latency metrics
      const duration = Date.now() - startTime;
      this.metrics.deliveryLatencyMs = 
        (this.metrics.deliveryLatencyMs * this.metrics.totalPolls + duration) / 
        (this.metrics.totalPolls + 1);
        
    } catch (error) {
      logApi.error(`${LOG_PREFIX} ${fancyColors.RED}Error delivering pending messages: ${error.message}${fancyColors.RESET}`, error);
    }
  }
  
  /**
   * Clean up old delivered and read messages
   * @private
   */
  async _cleanupOldMessages() {
    try {
      const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days
      
      // Delete old delivered and read messages
      const result = await prisma.websocket_messages.deleteMany({
        where: {
          delivered: true,
          read: true,
          delivered_at: {
            lt: cutoffDate
          }
        }
      });
      
      this.lastCleanup = new Date();
      this.metrics.cleanups++;
      
      logApi.info(`${LOG_PREFIX} ${fancyColors.GREEN}Cleaned up ${result.count} old notification messages${fancyColors.RESET}`);
    } catch (error) {
      logApi.error(`${LOG_PREFIX} ${fancyColors.RED}Error cleaning up old messages: ${error.message}${fancyColors.RESET}`, error);
    }
  }
  
  /**
   * Clean up resources before shutdown
   */
  async onCleanup() {
    // Clear intervals
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    if (this.unreadCountInterval) {
      clearInterval(this.unreadCountInterval);
      this.unreadCountInterval = null;
    }
    
    // Clear caches
    this.userUnreadCountCache.clear();
    this.userNotificationsCache.clear();
    this.announcementsCache = [];
    
    logApi.info(`${LOG_PREFIX} ${fancyColors.GREEN}Cleanup complete${fancyColors.RESET} - all data caches cleared`);
  }
  
  /**
   * Get server metrics for monitoring
   * @returns {Object} - Server metrics
   */
  getMetrics() {
    return {
      name: 'User Notification WebSocket v69',
      status: 'operational',
      metrics: {
        ...this.stats,
        messagesDelivered: this.metrics.messagesDelivered,
        messagesFailed: this.metrics.messagesFailed,
        unreadMessages: this.metrics.unreadMessages,
        totalPolls: this.metrics.totalPolls,
        cleanups: this.metrics.cleanups,
        deliveryLatencyMs: this.metrics.deliveryLatencyMs,
        byType: this.metrics.byType,
        channels: {
          userNotifications: Array.from(this.channelSubscriptions.entries())
            .filter(([channel]) => channel.startsWith(CHANNELS.USER_NOTIFICATIONS))
            .reduce((count, [_, subscribers]) => count + subscribers.size, 0),
          systemAnnouncements: this.channelSubscriptions.get(CHANNELS.SYSTEM_ANNOUNCEMENTS)?.size || 0
        },
        lastUpdate: new Date().toISOString(),
        lastCleanup: this.lastCleanup ? this.lastCleanup.toISOString() : null
      }
    };
  }
}

// Export singleton instance
let instance = null;

/**
 * Create user notification WebSocket server instance
 * @param {http.Server} server - HTTP server
 * @returns {UserNotificationWebSocketServer} - User notification WebSocket server instance
 */
export function createUserNotificationWebSocket(server) {
  if (!instance) {
    instance = new UserNotificationWebSocketServer(server);
  }
  return instance;
}

export { UserNotificationWebSocketServer };
export default instance;