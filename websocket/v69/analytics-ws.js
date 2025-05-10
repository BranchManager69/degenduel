// websocket/v69/analytics-ws.js

/**
 * @deprecated This implementation is deprecated and will be removed in a future release.
 * Please use the new Unified WebSocket System instead, which provides the same functionality
 * with a more maintainable architecture.
 * 
 * Migration Guide:
 * 1. Use the unified endpoint instead: /api/v69/ws
 * 2. Subscribe to the 'admin' topic
 * 3. See /websocket/v69/unified/ for the new implementation
 * 4. See /websocket/v69/transition-examples/README.md for detailed migration steps
 *
 * AnalyticsWebSocket (v69)
 * 
 * Real-time analytics and monitoring system with:
 * - User activity tracking
 * - Performance metrics
 * - Admin dashboard data
 * - Event tracking and aggregation
 */

import { BaseWebSocketServer } from './base-websocket.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors } from '../../utils/colors.js';
import prisma from '../../config/prisma.js';

// Configuration
const WSS_PATH = '/api/v69/ws/analytics';
const WSS_REQUIRE_AUTH = false; // TEMPORARILY disabled auth for testing
const WSS_MAX_PAYLOAD = 512 * 1024; // 512KB max payload
const WSS_PER_MESSAGE_DEFLATE = false;
const WSS_RATE_LIMIT = 300;

// Analytics constants
const ACTIVE_USER_TIMEOUT = 5 * 60 * 1000; // 5 minutes until user considered inactive
const EVENT_BUFFER_FLUSH_INTERVAL = 10 * 1000; // Flush events every 10 seconds
const WHALE_THRESHOLD = 100; // 100 SOL minimum for whale status

class AnalyticsWebSocket extends BaseWebSocketServer {
  /**
   * Create a new AnalyticsWebSocket
   * @param {http.Server} server - The HTTP server to attach the WebSocket to
   */
  constructor(server) {
    super(server, {
      path: WSS_PATH,
      requireAuth: WSS_REQUIRE_AUTH,
      publicEndpoints: ['*'], // ALL endpoints are public for testing
      maxPayload: WSS_MAX_PAYLOAD,
      perMessageDeflate: WSS_PER_MESSAGE_DEFLATE,
      rateLimit: WSS_RATE_LIMIT,
      authMode: 'query' // Use query auth mode for most reliable browser connections
    });
    
    // Initialize analytics state
    this.eventBuffer = new Map(); // userId -> events[]
    this.activeUsers = new Map(); // userId -> lastActivity timestamp
    this.dashboardSubscribers = new Set(); // Set of admin connectionIds subscribed to dashboard
    this.metricSubscriptions = new Map(); // metric name -> Set of connectionIds
    
    // Start background tasks
    this.flushInterval = setInterval(() => this.flushEventBuffer(), EVENT_BUFFER_FLUSH_INTERVAL);
    this.cleanupInterval = setInterval(() => this.cleanupInactiveUsers(), ACTIVE_USER_TIMEOUT);
    
    // Track current server stats
    this.stats = {
      startTime: Date.now(),
      connections: {
        total: 0,
        admin: 0,
        user: 0
      },
      events: {
        received: 0,
        processed: 0,
        buffered: 0
      },
      activeUsers: 0
    };
    
    logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.BOLD}${fancyColors.WHITE} V69 WEBSOCKET ${fancyColors.RESET} ${fancyColors.CYAN}${fancyColors.BOLD}Analytics WebSocket initialized${fancyColors.RESET}`);
  }
  
  /**
   * Initialize the analytics WebSocket
   */
  async onInitialize() {
    try {
      // Start with clean analytics state
      this.eventBuffer.clear();
      this.activeUsers.clear();
      this.dashboardSubscribers.clear();
      this.metricSubscriptions.clear();
      
      logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 INIT ${fancyColors.RESET} ${fancyColors.CYAN}Analytics WebSocket initialized${fancyColors.RESET}`);
      return true;
    } catch (error) {
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 INIT ${fancyColors.RESET} ${fancyColors.RED}Failed to initialize Analytics WebSocket:${fancyColors.RESET} ${error.message}`);
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
    
    // Update stats
    this.stats.connections.total++;
    
    // Check if this is an admin or regular user
    const isAdmin = clientInfo.authenticated && 
      (clientInfo.user.role === 'admin' || clientInfo.user.role === 'superadmin');
    
    if (isAdmin) {
      this.stats.connections.admin++;
    } else {
      this.stats.connections.user++;
    }
    
    // If authenticated, mark user as active
    if (clientInfo.authenticated) {
      this.activeUsers.set(clientInfo.user.id, Date.now());
      this.stats.activeUsers = this.activeUsers.size;
    }
    
    // Send welcome message
    this.sendToClient(ws, {
      type: 'welcome',
      message: 'Connected to Analytics WebSocket',
      isAdmin,
      timestamp: new Date().toISOString()
    });
    
    // If admin, send current stats
    if (isAdmin) {
      this.sendToClient(ws, {
        type: 'server_stats',
        stats: {
          ...this.stats,
          uptime: Date.now() - this.stats.startTime
        },
        timestamp: new Date().toISOString()
      });
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
    
    // Update last activity time for authenticated users
    if (clientInfo.authenticated) {
      this.activeUsers.set(clientInfo.user.id, Date.now());
    }
    
    // Check if this is an admin
    const isAdmin = clientInfo.authenticated && 
      (clientInfo.user.role === 'admin' || clientInfo.user.role === 'superadmin');
    
    // Increment event counter
    this.stats.events.received++;
    
    switch (message.type) {
      case 'track_event':
        // Track client-side event
        if (clientInfo.authenticated && message.event) {
          this.trackEvent(clientInfo.user.id, message.event, message.data);
          
          // Send acknowledgement
          this.sendToClient(ws, {
            type: 'event_tracked',
            event: message.event,
            timestamp: new Date().toISOString()
          });
        }
        break;
        
      case 'subscribe_dashboard':
        // Admin-only: subscribe to dashboard updates
        if (isAdmin) {
          this.dashboardSubscribers.add(clientInfo.connectionId);
          
          // Send current stats immediately
          this.sendToClient(ws, {
            type: 'dashboard_update',
            stats: {
              ...this.stats,
              uptime: Date.now() - this.stats.startTime
            },
            activeUsers: this.activeUsers.size,
            timestamp: new Date().toISOString()
          });
          
          // Also send active user information
          this.sendActiveUsers(ws);
        } else {
          this.sendError(ws, 'PERMISSION_DENIED', 'Only admins can subscribe to dashboard');
        }
        break;
        
      case 'unsubscribe_dashboard':
        // Unsubscribe from dashboard updates
        this.dashboardSubscribers.delete(clientInfo.connectionId);
        
        this.sendToClient(ws, {
          type: 'unsubscribed',
          dashboard: true,
          timestamp: new Date().toISOString()
        });
        break;
        
      case 'subscribe_metric':
        // Admin-only: subscribe to specific metric updates
        if (isAdmin && message.metric) {
          if (!this.metricSubscriptions.has(message.metric)) {
            this.metricSubscriptions.set(message.metric, new Set());
          }
          
          this.metricSubscriptions.get(message.metric).add(clientInfo.connectionId);
          
          this.sendToClient(ws, {
            type: 'subscribed_metric',
            metric: message.metric,
            timestamp: new Date().toISOString()
          });
        } else if (!isAdmin) {
          this.sendError(ws, 'PERMISSION_DENIED', 'Only admins can subscribe to metrics');
        } else {
          this.sendError(ws, 'INVALID_REQUEST', 'Metric name is required');
        }
        break;
        
      case 'unsubscribe_metric':
        // Unsubscribe from metric updates
        if (message.metric && this.metricSubscriptions.has(message.metric)) {
          this.metricSubscriptions.get(message.metric).delete(clientInfo.connectionId);
          
          this.sendToClient(ws, {
            type: 'unsubscribed_metric',
            metric: message.metric,
            timestamp: new Date().toISOString()
          });
        }
        break;
        
      case 'get_active_users':
        // Admin-only: get current active users
        if (isAdmin) {
          this.sendActiveUsers(ws);
        } else {
          this.sendError(ws, 'PERMISSION_DENIED', 'Only admins can access user data');
        }
        break;
        
      case 'get_server_stats':
        // Admin-only: get current server stats
        if (isAdmin) {
          this.sendToClient(ws, {
            type: 'server_stats',
            stats: {
              ...this.stats,
              uptime: Date.now() - this.stats.startTime
            },
            timestamp: new Date().toISOString()
          });
        } else {
          this.sendError(ws, 'PERMISSION_DENIED', 'Only admins can access server stats');
        }
        break;
        
      case 'heartbeat':
        // Update user's active status and respond with ack
        this.sendToClient(ws, {
          type: 'heartbeat_ack',
          timestamp: new Date().toISOString()
        });
        break;
        
      default:
        logApi.debug(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 ANALYTICS ${fancyColors.RESET} ${fancyColors.YELLOW}Unknown message type: ${message.type}${fancyColors.RESET}`);
    }
  }
  
  /**
   * Track a user event
   * @param {string} userId - User ID
   * @param {string} eventName - Event name
   * @param {Object} eventData - Event data
   */
  trackEvent(userId, eventName, eventData = {}) {
    // Create event record
    const event = {
      user_id: userId,
      event_name: eventName,
      event_data: eventData,
      timestamp: new Date()
    };
    
    // Add to buffer
    if (!this.eventBuffer.has(userId)) {
      this.eventBuffer.set(userId, []);
    }
    
    this.eventBuffer.get(userId).push(event);
    this.stats.events.buffered++;
    
    // Notify metric subscribers if applicable
    this.notifyMetricSubscribers('event', {
      userId,
      eventName,
      timestamp: event.timestamp
    });
    
    logApi.debug(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 ANALYTICS ${fancyColors.RESET} Tracked event "${eventName}" for user ${userId}`);
  }
  
  /**
   * Flush the event buffer to database
   */
  async flushEventBuffer() {
    if (this.eventBuffer.size === 0) return;
    
    const allEvents = [];
    let totalEvents = 0;
    
    // Collect all events from buffer
    for (const [userId, events] of this.eventBuffer.entries()) {
      totalEvents += events.length;
      allEvents.push(...events);
      
      // Clear buffer for this user
      this.eventBuffer.set(userId, []);
    }
    
    if (totalEvents === 0) return;
    
    // Verify prisma is available
    if (!prisma || typeof prisma.userEvent?.createMany !== 'function') {
      logApi.warn(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 ANALYTICS ${fancyColors.RESET} ${fancyColors.YELLOW}Prisma client not fully initialized, cannot flush events to database${fancyColors.RESET}`);
      return;
    }
    
    try {
      // Batch insert events into database
      await prisma.userEvent.createMany({
        data: allEvents.map(e => ({
          userId: e.user_id,
          eventName: e.event_name,
          eventData: e.event_data,
          createdAt: e.timestamp
        })),
        skipDuplicates: true
      });
      
      // Update stats
      this.stats.events.processed += totalEvents;
      this.stats.events.buffered = 0;
      
      logApi.debug(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 ANALYTICS ${fancyColors.RESET} Flushed ${totalEvents} events to database`);
    } catch (error) {
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 ANALYTICS ${fancyColors.RESET} ${fancyColors.RED}Failed to flush events:${fancyColors.RESET} ${error.message}`);
    }
  }
  
  /**
   * Clean up inactive users
   */
  cleanupInactiveUsers() {
    const now = Date.now();
    let removed = 0;
    
    for (const [userId, lastActivity] of this.activeUsers.entries()) {
      if (now - lastActivity > ACTIVE_USER_TIMEOUT) {
        this.activeUsers.delete(userId);
        removed++;
      }
    }
    
    if (removed > 0) {
      this.stats.activeUsers = this.activeUsers.size;
      
      logApi.debug(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 ANALYTICS ${fancyColors.RESET} Removed ${removed} inactive users`);
      
      // Notify dashboard subscribers
      this.broadcastToDashboard('active_users_update', {
        activeUsers: this.activeUsers.size
      });
    }
  }
  
  /**
   * Send active users information to a client
   * @param {WebSocket} ws - The WebSocket client
   */
  async sendActiveUsers(ws) {
    try {
      // Get basic info for all active users
      const activeUserIds = Array.from(this.activeUsers.keys());
      
      if (activeUserIds.length === 0) {
        this.sendToClient(ws, {
          type: 'active_users',
          users: [],
          count: 0,
          timestamp: new Date().toISOString()
        });
        return;
      }
      
      // Verify prisma is available
      if (!prisma || typeof prisma.user?.findMany !== 'function') {
        logApi.warn(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 ANALYTICS ${fancyColors.RESET} ${fancyColors.YELLOW}Prisma client not fully initialized, cannot fetch user data${fancyColors.RESET}`);
        this.sendToClient(ws, {
          type: 'active_users',
          users: [],
          count: 0,
          error: "Database connection unavailable",
          timestamp: new Date().toISOString()
        });
        return;
      }
      
      // Fetch user data from database
      const users = await prisma.user.findMany({
        where: {
          id: { in: activeUserIds }
        },
        select: {
          id: true,
          nickname: true,
          wallet_address: true,
          role: true,
          avatar_url: true,
          created_at: true,
          total_balance: true
        }
      });
      
      // Add last activity info
      const enrichedUsers = users.map(user => ({
        ...user,
        lastActivity: this.activeUsers.get(user.id),
        isWhale: user.total_balance >= WHALE_THRESHOLD
      }));
      
      // Send to client
      this.sendToClient(ws, {
        type: 'active_users',
        users: enrichedUsers,
        count: enrichedUsers.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 ANALYTICS ${fancyColors.RESET} ${fancyColors.RED}Failed to fetch active users:${fancyColors.RESET} ${error.message}`);
      this.sendError(ws, 'DATA_FETCH_ERROR', 'Failed to fetch active users');
    }
  }
  
  /**
   * Broadcast to all dashboard subscribers
   * @param {string} type - Message type
   * @param {Object} data - Message data
   */
  broadcastToDashboard(type, data) {
    if (this.dashboardSubscribers.size === 0) return;
    
    const message = {
      type,
      ...data,
      timestamp: new Date().toISOString()
    };
    
    for (const connectionId of this.dashboardSubscribers) {
      const client = this.findClientByConnectionId(connectionId);
      if (client) {
        this.sendToClient(client, message);
      }
    }
  }
  
  /**
   * Notify metric subscribers about updates
   * @param {string} metric - Metric name
   * @param {Object} data - Metric data
   */
  notifyMetricSubscribers(metric, data) {
    if (!this.metricSubscriptions.has(metric)) return;
    
    const message = {
      type: 'metric_update',
      metric,
      data,
      timestamp: new Date().toISOString()
    };
    
    for (const connectionId of this.metricSubscriptions.get(metric)) {
      const client = this.findClientByConnectionId(connectionId);
      if (client) {
        this.sendToClient(client, message);
      }
    }
  }
  
  /**
   * Find client by connection ID
   * @param {string} connectionId - The connection ID
   * @returns {WebSocket|null} - The WebSocket client or null if not found
   */
  findClientByConnectionId(connectionId) {
    for (const [client, info] of this.clientInfoMap.entries()) {
      if (info.connectionId === connectionId) {
        return client;
      }
    }
    return null;
  }
  
  /**
   * Handle client disconnection
   * @param {WebSocket} ws - The WebSocket connection
   */
  onDisconnection(ws) {
    const clientInfo = this.clientInfoMap.get(ws);
    if (!clientInfo) return;
    
    // Update stats
    this.stats.connections.total--;
    
    if (clientInfo.user && 
        (clientInfo.user.role === 'admin' || clientInfo.user.role === 'superadmin')) {
      this.stats.connections.admin--;
    } else {
      this.stats.connections.user--;
    }
    
    // Remove from subscribers
    this.dashboardSubscribers.delete(clientInfo.connectionId);
    
    for (const subscribers of this.metricSubscriptions.values()) {
      subscribers.delete(clientInfo.connectionId);
    }
  }
  
  /**
   * Clean up resources when shutting down
   */
  async onCleanup() {
    // Clear intervals
    clearInterval(this.flushInterval);
    clearInterval(this.cleanupInterval);
    
    // Flush any remaining events
    await this.flushEventBuffer();
    
    // Clear all state
    this.eventBuffer.clear();
    this.activeUsers.clear();
    this.dashboardSubscribers.clear();
    this.metricSubscriptions.clear();
    
    logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 CLEANUP ${fancyColors.RESET} ${fancyColors.CYAN}Analytics WebSocket cleaned up${fancyColors.RESET}`);
  }
  
  /**
   * Get custom metrics for this WebSocket
   * @returns {Object} - Custom metrics
   */
  getCustomMetrics() {
    return {
      stats: {
        ...this.stats,
        uptime: Date.now() - this.stats.startTime
      },
      subscriptions: {
        dashboard: this.dashboardSubscribers.size,
        metrics: Array.from(this.metricSubscriptions.entries())
          .map(([metric, subs]) => ({ metric, subscribers: subs.size }))
      }
    };
  }
}

export function createAnalyticsWebSocket(server) {
  return new AnalyticsWebSocket(server);
}